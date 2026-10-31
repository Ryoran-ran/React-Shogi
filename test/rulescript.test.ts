import { expect, test } from "bun:test";
import { ShogiGame, emptyPosition, initialPosition, legalMoves, positionKey, ruleChoiceForMove, isPassMove } from "../src/shogi";
import { SCRIPT_EXAMPLES, runRuleScript, validateRuleScript } from "../src/rulescript";
import { addCustomPiece, updateSharedPieceMovements } from "../src/pieces";
import { chooseAIMove } from "../src/ai";
import { BoardEditor } from "../src/editor";
import { createSetup, copySetup, loadSetup, readLocalSetups, saveLocalSetup } from "../src/setups";
import { ScriptEditor } from "../src/scripteditor";
import type { AIReply } from "../src/ai";

function kings() { const p = emptyPosition(); p.board[80] = { type: "K", side: "sente", promoted: false }; p.board[0] = { type: "K", side: "gote", promoted: false }; return p; }

test("JavaScript loops, capture disposal, destruction events and piece data resolve atomically and undo together", () => {
  const p = kings(); p.board[40] = { type: "R", side: "sente", promoted: false };
  p.board[31] = { type: "P", side: "gote", promoted: false }; p.board[30] = { type: "B", side: "gote", promoted: false };
  p.board[32] = { type: "N", side: "sente", promoted: false };
  const ruleScript = `export default {
    afterCapture(ctx) {
      if (ctx.event.captured.type === "P") ctx.discardCapture();
      for (const target of ctx.board.neighbors(ctx.event.to)) {
        if (target.piece && target.piece.side !== ctx.actor.side) ctx.destroy(target.square);
      }
      ctx.setPieceData(ctx.event.to, { hp: 3 });
      ctx.state.captures = (ctx.state.captures ?? 0) + 1;
    },
    afterDestroy(ctx) { ctx.state.destroyed = (ctx.state.destroyed ?? 0) + 1; }
  };`;
  const game = new ShogiGame(p, { ruleScript }); const before = game.position;
  game.play({ from: 40, to: 31, promote: false });
  expect(game.position.board[30]).toBeNull(); expect(game.position.board[32]).toEqual(p.board[32]);
  expect(game.position.board[31]?.data).toEqual({ hp: 3 }); expect(game.position.hands.sente.P).toBe(0); expect(game.position.hands.sente.B).toBe(0);
  expect(game.position.ruleState?.data).toEqual({ captures: 1, destroyed: 1 }); expect(game.records[0].effects).toHaveLength(2);
  const saved = game.save(); expect(saved.version).toBe(6);
  const restored = ShogiGame.load(JSON.parse(JSON.stringify(saved))); expect(restored.position).toEqual(game.position); expect(restored.records).toEqual(game.records);
  game.undo(); expect(game.position).toEqual(before); expect(p.board[40]?.type).toBe("R"); expect(p.ruleState).toBeUndefined();
});

test("start and turn hooks automatically move pieces, with repeatable randomness and independent search branches", () => {
  const p = kings(); p.board[58] = { type: "P", side: "sente", promoted: false }; p.board[22] = { type: "P", side: "gote", promoted: false };
  const ruleScript = `export default {
    onStart(ctx) { ctx.state.started = (ctx.state.started ?? 0) + 1; },
    turnStart(ctx) {
      for (const target of ctx.board.pieces(ctx.side)) {
        if (target.piece.type !== "P") continue;
        const to = ctx.board.forward(target.square, ctx.side);
        if (to !== null && !ctx.board.at(to)) ctx.move(target.square, to);
      }
    },
    afterMove(ctx) { ctx.state.roll = Math.floor(ctx.random() * 6) + 1; }
  };`;
  const game = new ShogiGame(p, { ruleScript }); const start = game.position;
  expect(start.board[58]).toBeNull(); expect(start.board[49]?.side).toBe("sente"); expect(start.ruleState?.data.started).toBe(1);
  game.play({ from: 80, to: 79, promote: false });
  expect(game.position.board[22]).toBeNull(); expect(game.position.board[31]?.side).toBe("gote"); expect(game.position.ruleState?.ply).toBe(1);
  expect(game.records[0].effects).toHaveLength(1);
  expect(ShogiGame.load(JSON.parse(JSON.stringify(game.save()))).position).toEqual(game.position);
  const same = new ShogiGame(p, { ruleScript }); same.play({ from: 80, to: 79, promote: false }); expect(same.position).toEqual(game.position);
  expect(game.initialPosition).toEqual(p); game.undo(); expect(game.position).toEqual(start);
  const request = { from: 80, to: 79, promote: false };
  expect(runRuleScript(ruleScript, start, {}, request)).toEqual(runRuleScript(ruleScript, start, {}, request));
  expect(game.position).toEqual(start);
});

test("transformation choices are legal action branches for humans, AI and worker execution", async () => {
  const created = addCustomPiece({}), type = created.type;
  const rules = updateSharedPieceMovements(created.rules, type, false, [{ dx: 0, dy: 1, range: 1 }]);
  const p = kings(); p.board[13] = { type, side: "sente", promoted: false };
  const ruleScript = `export default { afterMove(ctx) {
    if (ctx.actor.type === "${type}" && Math.floor(ctx.event.to / ctx.board.width) === 0) {
      ctx.choosePiece(ctx.event.to, ["R", "B", "G"], "変身先");
    }
  } };`;
  const game = new ShogiGame(p, { ruleScript, pieceRules: rules });
  const candidates = legalMoves(game.position, rules, ruleScript).filter(move => move.from === 13 && move.to === 4);
  expect(candidates.map(move => move.choices)).toEqual([["R"], ["B"], ["G"]]);
  expect(ruleChoiceForMove(game.position, { from: 13, to: 4, promote: false }, rules, ruleScript)?.title).toBe("変身先");
  const before = game.save(); expect(() => game.play({ from: 13, to: 4, promote: false, choices: ["K"] })).toThrow(); expect(game.save()).toEqual(before);
  const options = { pieceRules: rules, ruleScript, maxDepth: 1, maxTimeMs: 5000, maxNodes: 300 };
  const chosen = chooseAIMove(game.position, options).move!;
  if (isPassMove(chosen)) throw new Error("Expected a transformation move");
  expect(candidates).toContainEqual(chosen); expect(chosen.choices).toEqual(["R"]);
  const worker = new Worker(new URL("../src/aiworker.ts", import.meta.url).href);
  try {
    const response = await new Promise<AIReply>((resolve, reject) => {
      worker.onmessage = event => resolve(event.data); worker.onerror = reject;
      worker.postMessage({ id: 401, position: game.position, options });
    });
    expect(response.id).toBe(401); expect("result" in response && response.result.move).toEqual(chosen);
  } finally { worker.terminate(); }
  game.play(chosen); expect(game.position.board[4]?.type).toBe("R");
  expect(ShogiGame.load(JSON.parse(JSON.stringify(game.save()))).position).toEqual(game.position);
});

test("validation hooks and final effect positions determine legality, and errors never commit a partial move", () => {
  const p = kings(); p.board[40] = { type: "R", side: "sente", promoted: false };
  const source = 'export default { validateMove(ctx) { return ctx.event.to !== 31; }, afterMove(ctx) { ctx.state.count = (ctx.state.count ?? 0) + 1; } };';
  const game = new ShogiGame(p, { ruleScript: source });
  expect(legalMoves(game.position, {}, source).some(move => move.to === 31)).toBe(false);
  const key = positionKey(game.position); expect(() => game.play({ from: 40, to: 31, promote: false })).toThrow(); expect(positionKey(game.position)).toBe(key);
  const broken = new ShogiGame(p, { ruleScript: 'export default { afterMove(ctx) { ctx.destroy(ctx.event.to); throw new Error("中止"); } };' });
  const initial = broken.position;
  expect(() => broken.play({ from: 40, to: 31, promote: false })).toThrow("中止"); expect(broken.position).toEqual(initial); expect(broken.moveCount).toBe(0);
  const selfCheck = 'export default { afterMove(ctx) { if (ctx.event.to === 79) ctx.spawn(70, "R", "gote"); } };';
  const checked = new ShogiGame(kings(), { ruleScript: selfCheck });
  expect(legalMoves(checked.position, {}, selfCheck).some(move => move.from === 80 && move.to === 79)).toBe(false);
});

test("the VM bounds loops, event chains and invalid output without exposing host capabilities", () => {
  for (const source of ['while (true) {}', 'export default { unknown() {} };', 'export default { afterMove: 1 };', 'export default {']) expect(() => validateRuleScript(source)).toThrow();
  const globals = 'export default { onStart(ctx) { ctx.state.host = [typeof process, typeof window, typeof fetch, typeof Date]; } };';
  expect(new ShogiGame(kings(), { ruleScript: globals }).position.ruleState?.data.host).toEqual(["undefined", "undefined", "undefined", "undefined"]);
  const p = kings(); p.board[40] = { type: "G", side: "sente", promoted: false };
  const looping = 'export default { afterMove() { while (true) {} } };';
  const game = new ShogiGame(p, { ruleScript: looping });
  expect(() => game.play({ from: 40, to: 31, promote: false })).toThrow(); expect(game.moveCount).toBe(0);
  const chain = 'export default { afterMove(ctx) { if (ctx.actor.type === "G") ctx.move(ctx.event.to, ctx.event.from); } };';
  expect(() => new ShogiGame(p, { ruleScript: chain }).play({ from: 40, to: 31, promote: false })).toThrow("イベント");
  const invalid = 'export default { afterMove(ctx) { ctx.state.bad = NaN; } };';
  expect(() => new ShogiGame(p, { ruleScript: invalid }).play({ from: 40, to: 31, promote: false })).toThrow();
  validateRuleScript(SCRIPT_EXAMPLES.empty.source);
});

test("script wins, draws and destroyed kings finish after effects and survive save and undo", () => {
  for (const [effect, winner] of [['ctx.win("sente")', "sente"], ["ctx.draw()", null], ["ctx.destroy(0)", "sente"]] as const) {
    const game = new ShogiGame(kings(), { ruleScript: `export default { afterMove(ctx) { ${effect}; } };` });
    game.play({ from: 80, to: 79, promote: false }); expect(game.result).toEqual({ reason: "script", winner });
    expect(ShogiGame.load(game.save()).result).toEqual(game.result); game.undo(); expect(game.result).toBeNull(); expect(game.position.board[0]?.type).toBe("K");
  }
});

test("code, setup files, local saves, copies and editor history stay independent", () => {
  const source = SCRIPT_EXAMPLES.vanish.source, setup = createSetup(initialPosition(), null, "消滅", {}, source);
  expect(setup.version).toBe(4); expect(loadSetup(JSON.parse(JSON.stringify(setup))).ruleScript).toBe(source);
  expect(copySetup(setup).ruleScript).toBe(source); expect(() => loadSetup({ ...setup, version: 3 })).toThrow();
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveLocalSetup(storage, setup); expect(readLocalSetups(storage)[0].setup.ruleScript).toBe(source);
  const editor = new BoardEditor(setup.position, {}, source); editor.clear(); expect(editor.ruleScript).toBe(source);
  editor.setRuleScript(SCRIPT_EXAMPLES.explosion.source); editor.undo(); expect(editor.ruleScript).toBe(source);
  const draft = new ScriptEditor(source, setup.position, {}); draft.setSource('export default { afterMove() { throw new Error("確認失敗"); } };');
  expect(draft.verify()).toBe(false); expect(draft.status).toContain("確認失敗"); expect(editor.ruleScript).toBe(source);
  draft.useExample("vanish"); expect(draft.verify()).toBe(true);
  draft.setSource('export default { afterMove(ctx) { ctx.log("</textarea><b>"); } };'); expect(draft.render()).toContain("&lt;/textarea&gt;&lt;b&gt;");
});

test("generated pieces and automatic captures emit events, and pass choices are recorded as one undoable action", () => {
  const p = kings(); p.board[31] = { type: "N", side: "gote", promoted: false };
  const source = `export default {
    onStart(ctx) { ctx.spawn(40, "G", "sente"); },
    beforeCapture(ctx) { ctx.state.before = ctx.event.captured.type; },
    afterMove(ctx) { if (!ctx.event.automatic && ctx.actor.type === "K" && ctx.board.at(40)?.side === ctx.actor.side) ctx.capture(40, 31); },
    afterCapture(ctx) { ctx.state.automatic = ctx.event.automatic; }
  };`;
  const game = new ShogiGame(p, { ruleScript: source });
  game.play({ from: 80, to: 79, promote: false });
  expect(game.position.board[40]).toBeNull(); expect(game.position.board[31]?.type).toBe("G"); expect(game.position.hands.sente.N).toBe(1);
  expect(game.position.ruleState?.data).toEqual({ before: "N", automatic: true });
  expect(ShogiGame.load(game.save()).position).toEqual(game.position);
  const choose = 'export default { turnEnd(ctx) { ctx.state.mode = ctx.choose("モード", ["a", "b"]); } };';
  const passing = new ShogiGame(kings(), { passLimit: 1, ruleScript: choose });
  const before = passing.position;
  expect(passing.passMoves.map(move => move.choices)).toEqual([["a"], ["b"]]);
  passing.play({ pass: true, choices: ["b"] });
  expect(passing.position.ruleState?.data.mode).toBe("b"); expect(passing.passesRemaining.sente).toBe(0);
  expect(ShogiGame.load(passing.save()).position).toEqual(passing.position); passing.undo(); expect(passing.position).toEqual(before); expect(passing.passesRemaining.sente).toBe(1);
});
