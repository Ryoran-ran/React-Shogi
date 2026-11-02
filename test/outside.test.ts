import { expect, test } from "bun:test";
import { BoardEditor } from "../src/editor";
import { boardArea, boardCoordinates, isOutsideSquare } from "../src/boardgeometry";
import { algebraicSquare } from "../src/boarddesign";
import { ShogiGame, emptyPosition, legalMoves, positionKey, validatePosition, inCheck } from "../src/shogi";
import { createSetup, loadSetup } from "../src/setups";
import { readSavedSession } from "../src/savedpreview";
import { runRuleScript } from "../src/rulescript";
import { chooseAIMove } from "../src/ai";

function board() {
  const position = emptyPosition(5, 5);
  position.board[24] = { type: "K", side: "sente", promoted: false };
  position.board[0] = { type: "K", side: "gote", promoted: false };
  position.board[11] = { type: "R", side: "sente", promoted: false, data: { hp: 3 } };
  const editor = new BoardEditor(position);
  editor.setSettings({ promotionDepth: 0, selfCheck: false });
  editor.setOutsideMargin(1);
  return editor;
}

test("outside rings preserve pieces, colors, hands and inner coordinates through editing and undo", () => {
  const editor = board(), before = editor.position;
  expect(boardArea(before)).toEqual({ margin: 1, width: 5, height: 5 });
  expect(before.board[23]?.data).toEqual({ hp: 3 });
  expect(boardCoordinates(before, 8)).toEqual({ x: 1, y: 1 });
  expect(algebraicSquare(before, 8)).toBe("a5");
  expect(algebraicSquare(before, 7)).toBe("場外(0,1)");
  expect(isOutsideSquare(before, 7)).toBe(true);
  expect(isOutsideSquare(before, 8)).toBe(false);
  editor.setSquareColor(23, "#abcdef"); editor.setHand("sente", "S", 2);
  editor.setOutsideMargin(3);
  expect(boardArea(editor.position)).toEqual({ margin: 3, width: 5, height: 5 });
  expect(editor.position.board[59]?.data).toEqual({ hp: 3 });
  expect(editor.position.squareColors?.[59]).toBe("#abcdef");
  expect(editor.position.hands.sente.S).toBe(2);
  editor.undo(); expect(editor.position.width).toBe(7);
  editor.redo(); expect(editor.position.width).toBe(11);
  editor.setOutsideMargin(0); expect(editor.position.board[11]?.type).toBe("R");
  expect(editor.position.outsideMargin).toBeUndefined();
  editor.undo(); editor.clear(); expect(editor.position.outsideMargin).toBe(3);
  editor.resize(12, 11); expect(boardArea(editor.position).width).toBe(6);
});

test("pieces can move out on every edge, stay outside, return, capture and replay", () => {
  const editor = board(), start = editor.position, from = 23;
  const destinations = legalMoves(start).filter(move => move.from === from).map(move => move.to);
  expect(destinations).toEqual(expect.arrayContaining([2, 44, 21, 27]));
  const game = new ShogiGame(start, { passLimit: null });
  game.play({ from, to: 21, promote: false });
  expect(game.position.board[21]?.data).toEqual({ hp: 3 });
  expect(game.records[0].notation).toContain("場外(0,3)");
  game.play({ pass: true });
  expect(legalMoves(game.position).some(move => move.from === 21 && move.to === 23)).toBe(true);
  const outsideSave = game.save();
  expect(outsideSave.version).toBe(14);
  expect(ShogiGame.load(JSON.parse(JSON.stringify(outsideSave))).position).toEqual(game.position);
  expect(readSavedSession(JSON.stringify({ game: outsideSave })).gameKind).toBe("custom");
  game.play({ from: 21, to: 23, promote: false });
  expect(game.position.board[23]?.type).toBe("R");
  game.undo(); expect(game.position.board[21]?.type).toBe("R");
  const captured = structuredClone(start);
  captured.board[21] = { type: "S", side: "gote", promoted: false };
  const captureGame = new ShogiGame(captured);
  captureGame.play({ from, to: 21, promote: false });
  expect(captureGame.position.hands.sente.S).toBe(1);
  const ai = chooseAIMove(start, { maxDepth: 1, maxNodes: 80, maxTimeMs: 150 });
  expect(ai.move).not.toBeNull();
  expect(legalMoves(start).some(move => JSON.stringify(move) === JSON.stringify(ai.move))).toBe(true);
});

test("outside configuration survives setup files and rejects invalid and older formats", () => {
  const editor = board(), setup = createSetup(editor.position, null, "場外の盤");
  expect(setup.version).toBe(12);
  expect(loadSetup(JSON.parse(JSON.stringify(setup)))).toEqual(setup);
  expect(() => loadSetup({ ...setup, version: 11 })).toThrow("場外エリア");
  const saved = new ShogiGame(editor.position).save();
  expect(() => ShogiGame.load({ ...saved, version: 13 })).toThrow("場外エリア");
  for (const outsideMargin of [-1, 0, 1.5, 4, "1", null]) expect(() => validatePosition({ ...editor.position, outsideMargin })).toThrow();
  expect(() => editor.setOutsideMargin(4)).toThrow();
  const big = new BoardEditor(emptyPosition(15, 15));
  expect(() => big.setOutsideMargin(1)).toThrow(); expect(big.position.width).toBe(15);
  editor.place(21, { type: "G", side: "sente", promoted: false });
  const before = editor.snapshot;
  expect(() => editor.setOutsideMargin(0)).toThrow("駒があります");
  expect(editor.snapshot).toEqual(before);
  expect(() => editor.resize(4, 7)).toThrow();
  expect(positionKey(editor.position)).not.toBe(positionKey({ ...editor.position, outsideMargin: undefined }));
});

test("king safety includes outside attacks, and promotion uses the inner zone and outer dead ranks", () => {
  const editor = board();
  editor.setSettings({ selfCheck: true });
  editor.place(21, { type: "K", side: "sente", promoted: false });
  editor.place(7, { type: "R", side: "gote", promoted: false });
  expect(inCheck(editor.position)).toBe(true);
  expect(legalMoves(editor.position).some(move => move.from === 21 && move.to === 22)).toBe(true);
  expect(legalMoves(editor.position).some(move => move.from === 21 && move.to === 14)).toBe(false);
  editor.setSettings({ selfCheck: false, promotionDepth: 1 });
  editor.place(16, { type: "P", side: "sente", promoted: false });
  expect(legalMoves(editor.position).filter(move => move.from === 16 && move.to === 9).map(move => move.promote)).toEqual([false, true]);
  editor.move(16, 9);
  expect(legalMoves(editor.position).filter(move => move.from === 9 && move.to === 2).map(move => move.promote)).toEqual([true]);
});

test("scripts can distinguish inner and outside squares while preserving outside pieces", () => {
  const position = board().position;
  const result = runRuleScript('export default { onStart(ctx) { ctx.state.outside = ctx.board.isOutside(21); ctx.state.inside = ctx.board.isOutside(23); ctx.state.width = ctx.board.innerWidth; ctx.state.margin = ctx.board.outsideMargin; }, afterMove(ctx) { ctx.state.left = ctx.board.isOutside(ctx.event.to); } }', position, {}, { from: 23, to: 21, promote: false });
  expect(result.position?.outsideMargin).toBe(1);
  expect(result.position?.ruleState?.data).toMatchObject({ left: true });
  const start = runRuleScript('export default { onStart(ctx) { ctx.state.outside = ctx.board.isOutside(21); ctx.state.inside = ctx.board.isOutside(23); ctx.state.width = ctx.board.innerWidth; ctx.state.margin = ctx.board.outsideMargin; } }', position, {});
  expect(start.position?.ruleState?.data).toEqual({ outside: true, inside: false, width: 5, margin: 1 });
});
