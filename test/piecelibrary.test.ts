import { expect, test } from "bun:test";
import { addCustomPiece, updateCustomPiece, updatePieceMovements, updatePieceDesign, resetPieceDesign, pieceDesign, pieceState, pieceDefinition, pieceTypes, handTypes, canPromote, loadPieceRules, MAX_CUSTOM_PIECES, PIECE_DEFINITIONS } from "../src/pieces";
import { PieceEditor } from "../src/pieceeditor";
import { BoardEditor } from "../src/editor";
import { renderPiece } from "../src/pieceview";
import { ShogiGame, emptyPosition, legalMoves, positionKey, validatePosition } from "../src/shogi";
import { chooseAIMove } from "../src/ai";
import type { AIReply } from "../src/ai";
import { createSetup, loadSetup, copySetup, saveLocalSetup, readLocalSetups } from "../src/setups";

function kings() { const p = emptyPosition(); p.board[80] = { type: "K", side: "sente", promoted: false }; p.board[0] = { type: "K", side: "gote", promoted: false }; return p; }
const front = { text: "猫", fill: "#ccdd88", color: "#123456", shape: "circle" as const };
const back = { text: "虎", fill: "#88aacc", color: "#654321", shape: "square" as const };

test("normal and promoted designs remain independent for each player and render as escaped text", () => {
  let rules = updatePieceDesign({}, "P", false, "sente", front);
  rules = updatePieceDesign(rules, "P", false, "gote", back);
  rules = updatePieceDesign(rules, "P", true, "sente", { ...front, text: "成猫" });
  expect(pieceDesign({ type: "P", promoted: false, side: "sente" }, rules)).toEqual(front);
  expect(pieceDesign({ type: "P", promoted: false, side: "gote" }, rules)).toEqual(back);
  expect(pieceDesign({ type: "P", promoted: true, side: "gote" }, rules).text).toBe("と");
  rules = resetPieceDesign(rules, "P", false, "sente");
  expect(pieceDesign({ type: "P", promoted: false, side: "sente" }, rules).text).toBe("歩兵");
  expect(pieceDesign({ type: "P", promoted: false, side: "gote" }, rules)).toEqual(back);
  const unsafe = updatePieceDesign({}, "P", false, "sente", { ...front, text: "<b>&" });
  const markup = renderPiece({ type: "P", promoted: false, side: "sente" }, unsafe);
  expect(markup).toContain("&lt;b&gt;&amp;"); expect(markup).not.toContain("<b>"); expect(markup).toContain("piece-shape-circle");
  expect(() => updatePieceDesign({}, "P", false, "sente", { ...front, fill: "red;display:none" })).toThrow();
  expect(() => updatePieceDesign({}, "P", false, "sente", { ...front, text: "長すぎる文字です" })).toThrow();
  expect(() => loadPieceRules({ P: { design: { normal: { other: front } } } })).toThrow();
  expect(() => loadPieceRules({ K: { design: { promoted: { sente: front } } } })).toThrow();
  expect(PIECE_DEFINITIONS.P.label).toBe("歩兵");
});

test("new pieces and copies have stable independent identities, names, motion and promotion", () => {
  const created = addCustomPiece({});
  expect(created.type).toBe("custom_1"); expect(pieceTypes(created.rules)).toHaveLength(9); expect(handTypes(created.rules)).toContain(created.type);
  expect(canPromote(created.type, created.rules)).toBe(false);
  let rules = updateCustomPiece(created.rules, created.type, { name: "砲", canPromote: true });
  rules = updatePieceMovements(rules, created.type, false, "moves", [{ dx: 0, dy: 1, range: null }]);
  rules = updatePieceDesign(rules, created.type, false, "sente", front);
  expect(pieceDefinition(created.type, rules).name).toBe("砲"); expect(canPromote(created.type, rules)).toBe(true);
  const copied = addCustomPiece(rules, created.type);
  expect(copied.type).toBe("custom_2"); expect(pieceState({ type: copied.type, promoted: false }, copied.rules).moves).toEqual([{ dx: 0, dy: 1, range: null }]);
  const changed = updatePieceDesign(copied.rules, copied.type, false, "sente", back);
  expect(pieceDesign({ type: created.type, promoted: false, side: "sente" }, changed)).toEqual(front);
  expect(pieceDesign({ type: copied.type, promoted: false, side: "sente" }, changed)).toEqual(back);
  const disabled = updateCustomPiece(changed, copied.type, { canPromote: false }); expect(canPromote(copied.type, disabled)).toBe(false);
  const draft = new PieceEditor(); draft.handleClick({ id: "piece-editor-add" }); const first = draft.view.piece;
  draft.handleClick({ id: "piece-editor-undo" }); expect(draft.view.piece).toBe("P"); expect(draft.pieceRules).toEqual({});
  expect(first.startsWith("custom_")).toBe(true);
});

test("added pieces can be promoted, captured, dropped, evaluated by AI and restored from game files", async () => {
  const created = addCustomPiece({}, "G");
  let rules = updateCustomPiece(created.rules, created.type, { name: "砲", canPromote: true });
  rules = updatePieceMovements(rules, created.type, false, "moves", [{ dx: 0, dy: 1, range: 1 }]);
  rules = updatePieceMovements(rules, created.type, false, "captures", [{ dx: -1, dy: 1, range: 1 }, { dx: 1, dy: 1, range: 1 }]);
  const p = kings(); p.board[40] = { type: created.type, side: "sente", promoted: false }; p.board[30] = { type: "R", side: "gote", promoted: false };
  const game = new ShogiGame(p, { pieceRules: rules });
  expect(chooseAIMove(p, { pieceRules: rules, maxDepth: 1, maxTimeMs: 5000, maxNodes: 1000 }).move).toEqual({ from: 40, to: 30, promote: false });
  const worker = new Worker(new URL("../src/aiworker.ts", import.meta.url).href, { type: "module" });
  let timeout: ReturnType<typeof setTimeout>;
  try {
    const reply = await new Promise<AIReply>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Custom-piece AI worker timed out")), 4000);
      worker.onmessage = event => resolve(event.data as AIReply); worker.onerror = () => reject(new Error("Custom-piece AI worker failed"));
      worker.postMessage({ id: 92, position: p, options: { pieceRules: rules, maxDepth: 1, maxNodes: 1000, maxTimeMs: 5000 } });
    });
    expect(reply.id).toBe(92); expect("result" in reply).toBe(true);
    if ("result" in reply) expect(reply.result.move).toEqual({ from: 40, to: 30, promote: false });
  } finally { clearTimeout(timeout!); worker.terminate(); }
  game.play({ from: 40, to: 30, promote: false }); expect(game.position.hands.sente.R).toBe(1);
  expect(game.records[0].notation).toContain("砲"); expect(game.save().version).toBe(5);
  expect(ShogiGame.load(JSON.parse(JSON.stringify(game.save()))).pieceRules).toEqual(rules);
  const capture = kings(); capture.board[40] = { type: "R", side: "sente", promoted: false }; capture.board[31] = { type: created.type, side: "gote", promoted: true };
  const captured = new ShogiGame(capture, { pieceRules: rules }); captured.play({ from: 40, to: 31, promote: false });
  expect(captured.position.hands.sente[created.type]).toBe(1); captured.pass();
  captured.play({ drop: created.type, to: 60, promote: false }); expect(captured.position.board[60]).toEqual({ type: created.type, side: "sente", promoted: false });
  expect(ShogiGame.load(captured.save()).position).toEqual(captured.position);
  const key = positionKey(p); p.hands.sente[created.type] = 1; expect(positionKey(p)).not.toBe(key); p.hands.sente[created.type] = 0; expect(positionKey(p)).toBe(key);
  const promotion = kings(); promotion.board[31] = { type: created.type, side: "sente", promoted: false };
  expect(legalMoves(promotion, rules).filter(move => move.from === 31 && move.to === 22).map(move => move.promote)).toEqual([false, true]);
  expect(() => validatePosition(p)).toThrow(); validatePosition(p, rules);
});

test("library settings round-trip through setup files, browser saves and editor history with bounded validation", () => {
  const created = addCustomPiece({}); const rules = updatePieceDesign(created.rules, created.type, false, "gote", back);
  const p = kings(); p.board[40] = { type: created.type, side: "sente", promoted: false };
  const setup = createSetup(p, 2, "追加駒", rules); expect(setup.version).toBe(3);
  expect(loadSetup(JSON.parse(JSON.stringify(setup)))).toEqual(setup); expect(copySetup(setup).pieceRules).toEqual(rules);
  const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  saveLocalSetup(storage, setup); expect(readLocalSetups(storage)[0].setup.pieceRules).toEqual(rules);
  const editor = new BoardEditor(p, rules); editor.resize(5, 7); editor.clear(); expect(editor.pieceRules).toEqual(rules);
  editor.reset(undefined, {}); editor.undo(); expect(editor.pieceRules).toEqual(rules);
  expect(() => loadSetup({ ...setup, version: 2 })).toThrow();
  const saved = new ShogiGame(p, { pieceRules: rules }).save(); expect(() => ShogiGame.load({ ...saved, version: 4 })).toThrow();
  expect(() => loadPieceRules({ custom_x: {} })).toThrow(); expect(() => loadPieceRules({ K: { definition: PIECE_DEFINITIONS.K } })).toThrow();
  let full = {};
  for (let i = 0; i < MAX_CUSTOM_PIECES; i++) full = addCustomPiece(full).rules;
  expect(() => addCustomPiece(full)).toThrow(`${MAX_CUSTOM_PIECES}種類`);
});
