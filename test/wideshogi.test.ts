import { expect, test } from "bun:test";
import { createWideShogiPreset } from "../src/wideshogipreset";
import { boardArea, boardCoordinates, isOutsideSquare } from "../src/boardgeometry";
import { BoardEditor } from "../src/editor";
import { ShogiGame, initialPosition, legalMoves, validatePosition, positionKey, setupIssues } from "../src/shogi";
import { createSetup, loadSetup } from "../src/setups";
import { getSpecialGame, assertSpecialEditorAllowed } from "../src/special";
import { readSavedSession } from "../src/savedpreview";
import { chooseAIMove } from "../src/ai";
import { runRuleScript } from "../src/rulescript";

test("wide shogi preserves standard shogi in the center with only left and right outside files", () => {
  const setup = createWideShogiPreset(), position = setup.position, standard = initialPosition();
  expect([position.width, position.height]).toEqual([15, 9]);
  expect(boardArea(position)).toEqual({ margin: 3, width: 9, height: 9 });
  expect(position.board.filter(Boolean)).toHaveLength(40);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 15; x++) {
    const index = y * 15 + x;
    expect(isOutsideSquare(position, index)).toBe(x < 3 || x > 11);
    expect(position.board[index]).toEqual(x >= 3 && x <= 11 ? standard.board[y * 9 + x - 3] : null);
  }
  expect(boardCoordinates(position, 3)).toEqual({ x: 1, y: 1 });
  expect(setup.passLimit).toBe(0); expect(setup.ruleScript).toBeUndefined();
  expect(setupIssues(position)).toEqual([]);
  expect(() => assertSpecialEditorAllowed(getSpecialGame("wide-shogi"), setup)).not.toThrow();
  position.board[3] = null;
  expect(createWideShogiPreset().position.board[3]?.type).toBe("L");
});

test("the standard rook leaves through the side, returns, and survives undo, saved games and AI", () => {
  const setup = createWideShogiPreset(), game = new ShogiGame(setup.position, { passLimit: 0 });
  game.play({ from: 115, to: 119, promote: false });
  expect(game.position.board[119]?.type).toBe("R");
  expect(game.records[0].notation).toContain("場外(12,8)");
  game.play({ from: 33, to: 48, promote: false });
  const saved = game.save(); expect(saved.version).toBe(15);
  expect(readSavedSession(JSON.stringify({ game: saved })).gameKind).toBe("custom");
  const restored = ShogiGame.load(JSON.parse(JSON.stringify(saved)));
  expect(restored.position).toEqual(game.position);
  restored.play({ from: 119, to: 115, promote: false });
  expect(restored.position.board[115]?.type).toBe("R");
  restored.undo(); expect(restored.position.board[119]?.type).toBe("R");
  const ai = chooseAIMove(restored.position, { maxDepth: 1, maxNodes: 100, maxTimeMs: 300 });
  expect(legalMoves(restored.position).some(move => JSON.stringify(move) === JSON.stringify(ai.move))).toBe(true);
});

test("horizontal outside edits, rectangular dimensions and files preserve their direction", () => {
  const setup = createWideShogiPreset(), editor = new BoardEditor(setup.position);
  expect(setup.version).toBe(13);
  expect(loadSetup(JSON.parse(JSON.stringify(setup)))).toEqual(setup);
  expect(() => loadSetup({ ...setup, version: 12 })).toThrow("左右の場外");
  const saved = new ShogiGame(setup.position, { passLimit: 0 }).save();
  expect(() => ShogiGame.load({ ...saved, version: 14 })).toThrow("左右の場外");
  editor.setOutsideMargin(1);
  expect([editor.position.width, editor.position.height]).toEqual([11, 9]);
  expect(editor.position.board[7 * 11 + 8]?.type).toBe("R");
  editor.setOutsideMargin(1, false);
  expect([editor.position.width, editor.position.height]).toEqual([11, 11]);
  expect(editor.position.outsideHorizontalOnly).toBeUndefined();
  editor.undo(); expect(editor.position.outsideHorizontalOnly).toBe(true);
  editor.setOutsideMargin(0); expect(editor.position).toEqual(initialPosition());
  editor.undo(); editor.resize(11, 15); expect(boardArea(editor.position).height).toBe(15);
  expect(() => editor.setOutsideMargin(1, false)).toThrow();
  editor.clear(); expect(editor.position.outsideHorizontalOnly).toBe(true);
  expect(createSetup(editor.position, 0).version).toBe(13);
  expect(() => validatePosition({ ...setup.position, outsideHorizontalOnly: false })).toThrow();
  expect(() => validatePosition({ ...initialPosition(), outsideHorizontalOnly: true })).toThrow();
  expect(positionKey(setup.position)).not.toBe(positionKey({ ...setup.position, outsideHorizontalOnly: undefined }));
});

test("script helpers treat the inner top and bottom ranks as inside on a wide board", () => {
  const result = runRuleScript('export default { onStart(ctx) { ctx.state.size = [ctx.board.innerWidth, ctx.board.innerHeight]; ctx.state.horizontal = ctx.board.outsideHorizontalOnly; ctx.state.outside = ctx.board.isOutside(0); ctx.state.top = ctx.board.isOutside(3); ctx.state.bottom = ctx.board.isOutside(131); } }', createWideShogiPreset().position, {});
  expect(result.position?.ruleState?.data).toEqual({ size: [9, 9], horizontal: true, outside: true, top: false, bottom: false });
});
