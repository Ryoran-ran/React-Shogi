import { describe, expect, test } from "bun:test";
import { BoardEditor } from "../src/editor";
import { ShogiGame, attacks, emptyPosition, initialPosition, legalMoves, setupIssues, positionKey, promotionDepth, validatePosition } from "../src/shogi";
import type { Piece, PieceType, Position, Side } from "../src/shogi";
import { chooseAIMove } from "../src/ai";

const at = (p: Position, x: number, y: number) => y * p.width + x;
function put(p: Position, x: number, y: number, type: PieceType, side: Side = "sente", promoted = false): void { p.board[at(p, x, y)] = { type, side, promoted }; }
function kings(width: number, height: number): Position {
  const p = emptyPosition(width, height); put(p, width - 1, height - 1, "K"); put(p, 0, 0, "K", "gote"); return p;
}

describe("board setup editor", () => {
  test("resizing preserves coordinates and hands, and undo restores cropped pieces", () => {
    const p = initialPosition(); p.hands.sente.B = 1;
    const editor = new BoardEditor(p);
    editor.resize(5, 7);
    expect(editor.position.board).toHaveLength(35);
    expect(editor.position.board[2 * 5 + 4]).toEqual(p.board[2 * 9 + 4]);
    expect(editor.position.board[6 * 5]).toEqual(p.board[6 * 9]);
    expect(editor.position.hands.sente.B).toBe(1);
    expect(editor.issues).toContain("先手の王・玉を1枚配置してください（現在0枚）");
    editor.undo(); expect(editor.position).toEqual(p); expect(editor.canUndo).toBe(false);
    editor.resize(12, 15); expect(editor.position.board).toHaveLength(180);
    expect(editor.position.board[8 * 12 + 4]).toEqual(p.board[8 * 9 + 4]);
    expect(editor.position.board[14 * 12 + 11]).toBeNull();
    for (const [width, height] of [[2, 9], [9, 16], [4.5, 7], [Infinity, 9], [NaN, 9]]) expect(() => editor.resize(width, height)).toThrow();
    expect(editor.position.width).toBe(12); expect(p.board).toHaveLength(81);
  });
  test("placing, erasing, moving a king, clearing, presets and undo keep independent drafts", () => {
    const original = kings(5, 7), editor = new BoardEditor(original);
    const piece: Piece = { type: "S", side: "sente", promoted: true };
    editor.place(17, piece); piece.promoted = false;
    expect(editor.position.board[17]?.promoted).toBe(true); expect(original.board[17]).toBeNull();
    editor.place(29, { type: "K", side: "sente", promoted: false });
    expect(editor.position.board[34]).toBeNull();
    expect(editor.position.board.filter(p => p?.type === "K" && p.side === "sente")).toHaveLength(1);
    editor.place(17, null); expect(editor.position.board[17]).toBeNull();
    editor.undo(); expect(editor.position.board[17]?.promoted).toBe(true);
    editor.setTurn("gote"); expect(editor.position.turn).toBe("gote");
    editor.clear(); expect(editor.position.board.every(p => p === null)).toBe(true);
    expect(editor.position.turn).toBe("gote"); expect(editor.issues).toHaveLength(2);
    editor.undo(); expect(editor.position.board[29]?.type).toBe("K");
    editor.reset(); expect(editor.position).toEqual(initialPosition());
    editor.undo(); expect(editor.position.width).toBe(5);
    for (const index of [-1, 35, 1.5, NaN]) expect(() => editor.place(index, null)).toThrow();
  });
  test("setup validation requires one king on each side and the correct side to answer check", () => {
    expect(setupIssues(emptyPosition(3, 3))).toHaveLength(2);
    const p = kings(5, 7); expect(setupIssues(p)).toEqual([]);
    put(p, 0, 4, "R"); expect(setupIssues(p)[0]).toContain("手番ではない側");
    p.turn = "gote"; expect(setupIssues(p)).toEqual([]);
    put(p, 3, 6, "K"); expect(setupIssues(p)[0]).toContain("現在2枚");
    const invalid = kings(5, 7); invalid.board[5] = { type: "G", side: "sente", promoted: true };
    expect(() => validatePosition(invalid)).toThrow("駒の設定");
    expect(() => validatePosition({ ...kings(5, 7), board: [] })).toThrow();
    expect(() => validatePosition({ ...kings(5, 7), hands: {} })).toThrow();
    const mated = kings(5, 7); put(mated, 3, 0, "R", "gote"); put(mated, 0, 5, "R", "gote"); put(mated, 4, 0, "R", "gote");
    expect(setupIssues(mated)[0]).toContain("詰んでいます");
  });
});

describe("play on custom boards", () => {
  test("rectangular movement, rays and king safety use the selected dimensions without wrapping", () => {
    const p = kings(5, 7); put(p, 4, 3, "R");
    expect(attacks(p, 19)).toContain(15); expect(attacks(p, 19)).not.toContain(20);
    expect(legalMoves(p).every(m => m.to >= 0 && m.to < 35)).toBe(true);
    const wide = kings(15, 3); put(wide, 0, 1, "R");
    expect(attacks(wide, 15)).toContain(29);
    const narrow = kings(3, 15); put(narrow, 1, 14, "L");
    expect(attacks(narrow, 43)).toContain(1);
    expect(positionKey(kings(5, 7))).not.toBe(positionKey(kings(7, 5)));
  });
  test("promotion, dead-rank drops and nifu follow custom width and height", () => {
    expect(promotionDepth(5)).toBe(1); expect(promotionDepth(7)).toBe(2); expect(promotionDepth(15)).toBe(3);
    const p = kings(5, 7); put(p, 2, 2, "S");
    expect(legalMoves(p).filter(m => m.from === 12 && m.to === 7).map(m => m.promote)).toEqual([false, true]);
    put(p, 2, 1, "P");
    expect(legalMoves(p).filter(m => m.from === 7)).toEqual([{ from: 7, to: 2, promote: true }]);
    p.hands.sente.P = 1; p.hands.sente.N = 1;
    const drops = legalMoves(p).filter(m => m.drop);
    expect(drops.some(m => m.drop === "P" && m.to % 5 === 2)).toBe(false);
    expect(drops.some(m => m.drop === "P" && m.to < 5)).toBe(false);
    expect(drops.some(m => m.drop === "N" && m.to < 10)).toBe(false);
    const gote = kings(5, 7); gote.turn = "gote"; put(gote, 2, 5, "P", "gote");
    expect(legalMoves(gote).filter(m => m.from === 27)).toEqual([{ from: 27, to: 32, promote: true }]);
  });
  test("custom initial positions, captures, passes and undo survive a save round trip", () => {
    const p = kings(5, 7); put(p, 0, 4, "R"); put(p, 0, 2, "S", "gote");
    const game = new ShogiGame(p, { passLimit: 2 });
    game.play({ from: 20, to: 10, promote: false });
    game.play({ from: 0, to: 1, promote: false }); game.pass();
    expect(game.position.hands.sente.S).toBe(1);
    expect(game.records[0].notation).toBe("▲５三飛");
    const loaded = ShogiGame.load(JSON.parse(JSON.stringify(game.save())));
    expect(loaded.initialPosition).toEqual(p); expect(loaded.position).toEqual(game.position);
    expect(loaded.records).toEqual(game.records); expect(loaded.passesRemaining).toEqual(game.passesRemaining);
    loaded.undo(); loaded.undo(); loaded.undo(); expect(loaded.position).toEqual(p);
    const first = loaded.initialPosition; first.board.fill(null); expect(loaded.initialPosition).toEqual(p);
    expect(() => ShogiGame.load({ version: 3, passLimit: null, moves: [] })).toThrow();
    expect(() => ShogiGame.load({ version: 3, passLimit: null, initialPosition: { ...p, width: 500 }, moves: [] })).toThrow();
    expect(() => ShogiGame.load({ version: 3, passLimit: null, initialPosition: emptyPosition(5, 7), moves: [] })).toThrow("王・玉");
    const legacy = ShogiGame.load({ version: 2, passLimit: 3, moves: [{ from: 56, to: 47, promote: false }] });
    expect(legacy.position.width).toBe(9); expect(legacy.position.height).toBe(9); expect(legacy.passLimit).toBe(3);
  });
  test("coordinates beyond nine and AI search work on enlarged boards", () => {
    const p = kings(15, 12); put(p, 10, 10, "R");
    const game = new ShogiGame(p); game.play({ from: 160, to: 145, promote: false });
    expect(game.records[0].notation).toBe("▲５十飛");
    const move = chooseAIMove(game.position, { maxDepth: 1, maxNodes: 100, maxTimeMs: 5000 }).move;
    expect(move).not.toBeNull();
    if (!move || "pass" in move) throw new Error("Expected an AI board move");
    expect(legalMoves(game.position)).toContainEqual(move);
    game.play(move); expect(game.position.board).toHaveLength(180);
  });
});
