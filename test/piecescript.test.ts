import { expect, test } from "bun:test";
import { ShogiGame, emptyPosition, legalMoves, positionKey } from "../src/shogi";
import { updatePieceScript, addCustomPiece, updateSharedPieceMovements, loadPieceRules } from "../src/pieces";
import { PIECE_SCRIPT_EXAMPLES, validateRuleScript } from "../src/rulescript";
import { BoardEditor } from "../src/editor";
import { PieceEditor } from "../src/pieceeditor";
import { ScriptEditor } from "../src/scripteditor";
import { createSetup, loadSetup, copySetup, saveLocalSetup, readLocalSetups } from "../src/setups";
import { chooseAIMove } from "../src/ai";
import type { AIReply } from "../src/ai";

function kings() { const p = emptyPosition(); p.board[80] = { type: "K", side: "sente", promoted: false }; p.board[0] = { type: "K", side: "gote", promoted: false }; return p; }

test("capturer, captured and destroyed piece rules run only for their subjects, before the board's final result", () => {
  const p = kings(); p.board[40] = { type: "R", side: "sente", promoted: false }; p.board[31] = { type: "G", side: "gote", promoted: false }; p.board[30] = { type: "B", side: "gote", promoted: false }; p.board[32] = { type: "N", side: "sente", promoted: false };
  let rules = updatePieceScript({}, "R", `export default {
    afterCapture(ctx) { ctx.state.captureSquare = ctx.self.square; for (const t of ctx.board.neighbors(ctx.self.square)) if (t.piece && t.piece.side !== ctx.self.side) ctx.destroy(t.square); },
    afterMove(ctx) { ctx.setPieceData(ctx.self.square, { moves: 1 }); }
  };`);
  rules = updatePieceScript(rules, "G", `export default { afterCaptured(ctx) { ctx.state.victim = [ctx.self.type, ctx.self.side, ctx.self.square, ctx.self.alive, ctx.actor.type]; ctx.discardCapture(); } };`);
  rules = updatePieceScript(rules, "B", 'export default { afterDestroy(ctx) { ctx.state.destroyed = ctx.self.square; } };');
  rules = updatePieceScript(rules, "N", 'export default { afterMove(ctx) { ctx.state.unrelated = true; } };');
  const board = 'export default { afterCapture(ctx) { ctx.discardCapture(); }, checkResult(ctx) { if (ctx.state.destroyed === 30 && ctx.state.victim) ctx.win("sente"); } };';
  const game = new ShogiGame(p, { pieceRules: rules, ruleScript: board }); const start = game.position;
  game.play({ from: 40, to: 31, promote: false });
  expect(game.position.ruleState?.data).toEqual({ captureSquare: 31, victim: ["G", "gote", 31, false, "R"], destroyed: 30 });
  expect(game.position.board[31]?.data).toEqual({ moves: 1 }); expect(game.position.board[30]).toBeNull(); expect(game.position.board[32]?.type).toBe("N");
  expect(game.position.hands.sente.G).toBe(0); expect(game.records[0].effects?.filter(effect => effect.includes("消滅"))).toHaveLength(1);
  expect(game.result).toEqual({ reason: "script", winner: "sente" });
  const saved = game.save(); expect(saved.version).toBe(7); expect(saved.ruleScript).toBe(board);
  expect(ShogiGame.load(JSON.parse(JSON.stringify(saved))).position).toEqual(game.position);
  game.undo(); expect(game.position).toEqual(start);
});

test("shared type code keeps data on each instance and runs turn hooks only for its owner", () => {
  const p = kings(); p.board[58] = { type: "P", side: "sente", promoted: false }; p.board[60] = { type: "P", side: "sente", promoted: false }; p.board[22] = { type: "P", side: "gote", promoted: false };
  const script = `export default {
    onStart(ctx) { ctx.setPieceData(ctx.self.square, { hp: ctx.self.side === "sente" ? 3 : 4, moves: 0 }); },
    turnStart(ctx) { const to = ctx.board.forward(ctx.self.square, ctx.self.side); if (to !== null && !ctx.board.at(to)) ctx.move(ctx.self.square, to); },
    afterMove(ctx) { ctx.setPieceData(ctx.self.square, { ...ctx.self.data, moves: ctx.self.data.moves + 1 }); }
  };`;
  const game = new ShogiGame(p, { pieceRules: updatePieceScript({}, "P", script) });
  expect(game.ruleScript).toBe(""); expect(game.hasScripts).toBe(true);
  expect(game.position.board[49]?.data).toEqual({ hp: 3, moves: 1 }); expect(game.position.board[51]?.data).toEqual({ hp: 3, moves: 1 }); expect(game.position.board[22]?.data).toEqual({ hp: 4, moves: 0 });
  const start = game.position; game.play({ from: 80, to: 79, promote: false });
  expect(game.position.board[31]?.data).toEqual({ hp: 4, moves: 1 }); expect(game.position.board[49]?.data).toEqual({ hp: 3, moves: 1 });
  expect(ShogiGame.load(game.save()).position).toEqual(game.position); game.undo(); expect(game.position).toEqual(start);
  expect(game.save().version).toBe(7); expect(game.save().ruleScript).toBeUndefined();
});

test("piece identities prevent newly spawned replacements from receiving another piece's phase hook", () => {
  const p = kings(); p.board[58] = { type: "P", side: "sente", promoted: false }; p.board[60] = { type: "P", side: "sente", promoted: false };
  const source = `export default { turnStart(ctx) {
    ctx.state.starts = (ctx.state.starts ?? 0) + 1;
    if (ctx.self.square === 58 && !ctx.state.replaced) { ctx.destroy(60); ctx.spawn(60, "P", "sente"); ctx.state.replaced = true; }
    ctx.setPieceData(ctx.self.square, { started: true });
  } };`;
  const game = new ShogiGame(p, { pieceRules: updatePieceScript({}, "P", source) });
  expect(game.position.ruleState?.data.starts).toBe(1); expect(game.position.board[58]?.data).toEqual({ started: true }); expect(game.position.board[60]?.data).toBeUndefined();
});

test("captured bombs can remove the capturer and do not fire a move callback for the removed piece", () => {
  const p = kings(); p.board[40] = { type: "R", side: "sente", promoted: false }; p.board[31] = { type: "G", side: "gote", promoted: false };
  let rules = updatePieceScript({}, "G", 'export default { afterCaptured(ctx) { ctx.destroy(ctx.self.square); ctx.discardCapture(); } };');
  rules = updatePieceScript(rules, "R", 'export default { afterMove(ctx) { ctx.setPieceData(ctx.self.square, { moved: true }); }, afterDestroy(ctx) { ctx.state.removed = [ctx.self.type, ctx.self.square, ctx.self.alive]; } };');
  const game = new ShogiGame(p, { pieceRules: rules }); game.play({ from: 40, to: 31, promote: false });
  expect(game.position.board[31]).toBeNull(); expect(game.position.board[40]).toBeNull(); expect(game.position.hands.sente.G).toBe(0);
  expect(game.position.ruleState?.data.removed).toEqual(["R", 31, false]); expect(game.result).toBeNull();
});

test("piece transformation choices and board victory conditions are both used by AI and workers", async () => {
  const created = addCustomPiece({}), type = created.type;
  let rules = updateSharedPieceMovements(created.rules, type, false, [{ dx: 0, dy: 1, range: 1 }]); rules = updatePieceScript(rules, type, PIECE_SCRIPT_EXAMPLES.transform.source);
  const p = kings(); p.board[13] = { type, side: "sente", promoted: false };
  const board = 'export default { checkResult(ctx) { if (ctx.board.at(4)?.type === "R") ctx.win("sente"); } };';
  const game = new ShogiGame(p, { pieceRules: rules, ruleScript: board });
  const choices = legalMoves(game.position, rules, board).filter(move => move.from === 13 && move.to === 4); expect(choices).toHaveLength(5);
  const options = { pieceRules: rules, ruleScript: board, maxDepth: 1, maxTimeMs: 5000, maxNodes: 1000 };
  const selected = chooseAIMove(game.position, options).move!; expect(selected.choices).toEqual(["R"]);
  const worker = new Worker(new URL("../src/aiworker.ts", import.meta.url).href);
  try {
    const reply = await new Promise<AIReply>((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = reject; worker.postMessage({ id: 601, position: game.position, options }); });
    expect(reply.id).toBe(601); expect("result" in reply && reply.result.move).toEqual(selected);
  } finally { worker.terminate(); }
  game.play(selected); expect(game.result?.winner).toBe("sente"); expect(game.position.board[4]?.type).toBe("R"); expect(ShogiGame.load(game.save()).ruleScript).toBe(board);
});

test("piece code is validated, copied and saved independently while retaining board rules", () => {
  const source = PIECE_SCRIPT_EXAMPLES.counter.source, rules = updatePieceScript({}, "P", source), board = 'export default { checkResult(ctx) { if (ctx.state.over) ctx.draw(); } };';
  const setup = createSetup(kings(), 0, "駒と盤面", rules, board); expect(setup.version).toBe(5);
  expect(loadSetup(JSON.parse(JSON.stringify(setup)))).toEqual(setup); expect(copySetup(setup).pieceRules).toEqual(rules); expect(copySetup(setup).ruleScript).toBe(board);
  expect(() => loadSetup({ ...setup, version: 4 })).toThrow(); const saved = new ShogiGame(kings(), { pieceRules: rules, ruleScript: board }).save(); expect(() => ShogiGame.load({ ...saved, version: 6 })).toThrow();
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveLocalSetup(storage, setup); expect(readLocalSetups(storage)[0].setup.ruleScript).toBe(board); expect(readLocalSetups(storage)[0].setup.pieceRules?.P?.script).toBe(source);
  const cloned = addCustomPiece(rules, "P"); expect(cloned.rules[cloned.type]?.script).toBe(source); expect(updatePieceScript(cloned.rules, cloned.type, "")[cloned.type]?.script).toBeUndefined(); expect(cloned.rules.P?.script).toBe(source);
  const editor = new BoardEditor(kings(), rules, board), draft = new PieceEditor(editor.pieceRules); draft.setPieceScript(PIECE_SCRIPT_EXAMPLES.vanish.source); expect(editor.pieceRules).toEqual(rules); draft.handleClick({ id: "piece-editor-undo" }); expect(draft.pieceRules).toEqual(rules);
  const code = new ScriptEditor(source, kings(), rules, { piece: "P", boardScript: board }); expect(code.verify()).toBe(true); code.setSource('export default { checkResult() {} };'); expect(code.verify()).toBe(false);
  expect(loadPieceRules({ P: { script: "  " } })).toEqual({}); expect(() => loadPieceRules({ P: { script: 1 } })).toThrow();
  expect(() => validateRuleScript("", updatePieceScript({}, "P", "export default { afterMove: 1 };"))).toThrow();
});

test("piece-only failures roll back the whole move, and validation applies only to the moving type", () => {
  const p = kings(); p.board[40] = { type: "G", side: "sente", promoted: false };
  const invalid = updatePieceScript({}, "G", 'export default { afterMove(ctx) { ctx.destroy(ctx.self.square); while (true) {} } };');
  const broken = new ShogiGame(p, { pieceRules: invalid }), key = positionKey(broken.position);
  expect(() => broken.play({ from: 40, to: 31, promote: false })).toThrow(); expect(broken.moveCount).toBe(0); expect(positionKey(broken.position)).toBe(key);
  const rules = updatePieceScript({}, "G", 'export default { validateMove(ctx) { return ctx.event.to !== 31; } };');
  const game = new ShogiGame(p, { pieceRules: rules });
  expect(legalMoves(game.position, rules).some(move => move.from === 40 && move.to === 31)).toBe(false);
  expect(legalMoves(game.position, rules).some(move => move.from === 80 && move.to === 79)).toBe(true);
});
