import { describe, expect, test } from "bun:test";
import { ShogiGame, attacks, initialPosition, inCheck, legalMoves, legalActionIterator, positionKey } from "../src/shogi";
import type { PieceType, Position, Side, Move } from "../src/shogi";
const at = (x: number, y: number) => y * 9 + x;
function empty(turn: Side = "sente"): Position { const p = initialPosition(); p.board.fill(null); p.turn = turn; put(p, 8, 8, "K", "sente"); put(p, 0, 0, "K", "gote"); return p; }
function put(p: Position, x: number, y: number, type: PieceType, side: Side = "sente", promoted = false) { p.board[at(x, y)] = { type, side, promoted }; }
const move = (fx: number, fy: number, tx: number, ty: number, promote = false): Move => ({ from: at(fx, fy), to: at(tx, ty), promote });

describe("shogi", () => {
  test("starts with 40 pieces, the correct major pieces and 30 legal moves", () => {
    const p = initialPosition();
    expect(p.board.filter(Boolean)).toHaveLength(40);
    expect(p.board[at(7, 7)]?.type).toBe("R"); expect(p.board[at(1, 1)]?.type).toBe("R");
    expect(legalMoves(p)).toHaveLength(30);
    expect(inCheck(p)).toBe(false);
  });
  test("all piece movements and promoted movements face the correct direction", () => {
    const counts: Record<PieceType, number> = { K: 8, R: 16, B: 16, G: 6, S: 5, N: 2, L: 4, P: 1 };
    for (const side of ["sente", "gote"] as Side[]) for (const type of Object.keys(counts) as PieceType[]) {
      const p = empty(side); p.board.fill(null); put(p, 4, 4, type, side);
      expect(attacks(p, at(4, 4))).toHaveLength(counts[type]);
      if (type === "P") expect(attacks(p, at(4, 4))).toEqual([at(4, side === "sente" ? 3 : 5)]);
      if (["P", "L", "N", "S"].includes(type)) { p.board[40]!.promoted = true; expect(attacks(p, 40)).toHaveLength(6); }
      if (type === "R" || type === "B") { p.board[40]!.promoted = true; expect(attacks(p, 40)).toHaveLength(20); }
    }
  });
  test("sliding pieces stop at occupied squares, while knights jump", () => {
    const p = empty(); put(p, 4, 4, "R"); put(p, 4, 3, "P");
    expect(legalMoves(p).some(m => m.from === 40 && m.to === at(4, 2))).toBe(false);
    put(p, 4, 4, "N"); expect(legalMoves(p).some(m => m.from === 40 && m.to === at(3, 2))).toBe(true);
  });
  test("captures return unpromoted pieces to the capturer's hand; undo restores them", () => {
    const p = empty(); put(p, 4, 4, "R"); put(p, 4, 3, "P", "gote", true);
    const game = new ShogiGame(p); game.play(move(4, 4, 4, 3));
    expect(game.position.hands.sente.P).toBe(1); expect(game.position.board[at(4, 3)]?.type).toBe("R");
    game.undo(); expect(game.position.board[at(4, 3)]?.promoted).toBe(true); expect(game.position.hands.sente.P).toBe(0);
  });
  test("promotion is optional in the zone and forced on dead ranks", () => {
    const p = empty(); put(p, 4, 3, "S");
    expect(legalMoves(p).filter(m => m.from === at(4, 3) && m.to === at(4, 2)).map(m => m.promote)).toEqual([false, true]);
    put(p, 4, 1, "P"); expect(legalMoves(p).filter(m => m.from === at(4, 1))).toEqual([move(4, 1, 4, 0, true)]);
    put(p, 4, 3, "N"); expect(legalMoves(p).filter(m => m.from === at(4, 3)).every(m => m.promote)).toBe(true);
    const gote = empty("gote"); put(gote, 4, 7, "P", "gote"); expect(legalMoves(gote).filter(m => m.from === at(4, 7))).toEqual([move(4, 7, 4, 8, true)]);
  });
  test("nifu, occupied squares, and dead-rank drops are forbidden", () => {
    const p = empty(); p.hands.sente.P = 1; p.hands.sente.L = 1; p.hands.sente.N = 1; put(p, 4, 6, "P");
    const drops = legalMoves(p).filter(m => m.drop);
    expect(drops.some(m => m.drop === "P" && m.to % 9 === 4)).toBe(false);
    expect(drops.some(m => (m.drop === "P" || m.drop === "L") && m.to < 9)).toBe(false);
    expect(drops.some(m => m.drop === "N" && m.to < 18)).toBe(false);
    expect(drops.some(m => p.board[m.to] !== null)).toBe(false);
    p.board[at(4, 6)]!.promoted = true;
    expect(legalMoves(p).some(m => m.drop === "P" && m.to === at(4, 4))).toBe(true);
  });
  test("pins, king exposure, king adjacency, and king capture are handled", () => {
    const p = empty(); p.board[80] = null; put(p, 4, 8, "K"); put(p, 4, 7, "G"); put(p, 4, 0, "R", "gote");
    expect(legalMoves(p).some(m => m.from === at(4, 7) && m.to === at(3, 7))).toBe(false);
    expect(legalMoves(p).some(m => m.from === at(4, 7) && m.to === at(4, 6))).toBe(true);
    const kings = empty(); kings.board.fill(null); put(kings, 4, 4, "K"); put(kings, 4, 2, "K", "gote");
    expect(legalMoves(kings).some(m => m.to === at(4, 3))).toBe(false);
    put(kings, 0, 2, "R"); expect(legalMoves(kings).some(m => m.to === at(4, 2))).toBe(false);
  });
  test("a pawn drop mate is forbidden, while a checking drop with an escape is legal", () => {
    const p = empty(); p.board[0] = null; put(p, 4, 0, "K", "gote"); put(p, 4, 2, "G"); put(p, 3, 2, "R"); put(p, 5, 2, "R"); p.hands.sente.P = 1;
    expect(inCheck(p, "gote")).toBe(false);
    expect(legalMoves(p).some(m => m.drop === "P" && m.to === at(4, 1))).toBe(false);
    p.hands.gote.G = 1; p.hands.gote.P = 1;
    expect(legalMoves(p).some(m => m.drop === "P" && m.to === at(4, 1))).toBe(false);
    p.board[at(5, 2)] = null;
    expect(legalMoves(p).some(m => m.drop === "P" && m.to === at(4, 1))).toBe(true);
  });
  test("a board pawn move may deliver mate; games stop when the king is mated", () => {
    const p = empty(); p.board[0] = null; put(p, 4, 0, "K", "gote"); put(p, 4, 2, "P"); put(p, 3, 2, "G"); put(p, 2, 1, "B"); put(p, 5, 2, "R");
    const game = new ShogiGame(p); game.play(move(4, 2, 4, 1));
    expect(game.result).toEqual({ reason: "mate", winner: "sente" });
    expect(() => game.play(move(4, 0, 5, 0))).toThrow();
    game.undo(); expect(game.result).toBeNull();
  });
  test("four repetitions end the game, but perpetual check loses for the checking side", () => {
    const p = empty(); p.board.fill(null); put(p, 4, 8, "K"); put(p, 4, 0, "K", "gote");
    const game = new ShogiGame(p);
    for (let i = 0; i < 3; i++) for (const m of [move(4, 8, 3, 8), move(4, 0, 3, 0), move(3, 8, 4, 8), move(3, 0, 4, 0)]) game.play(m);
    expect(game.result).toEqual({ reason: "repetition", winner: null });
    const q = empty("gote"); q.board[0] = null; put(q, 4, 0, "K", "gote"); put(q, 4, 2, "R");
    const perpetual = new ShogiGame(q);
    for (let i = 0; i < 3; i++) for (const m of [move(4, 0, 5, 0), move(4, 2, 5, 2), move(5, 0, 4, 0), move(5, 2, 4, 2)]) perpetual.play(m);
    expect(perpetual.result).toEqual({ reason: "perpetualCheck", winner: "gote" });
  });
  test("opening capture, drop, notation, persistence and resignation round-trip", () => {
    const game = new ShogiGame();
    game.play(move(2, 6, 2, 5)); game.play(move(6, 2, 6, 3)); game.play(move(1, 7, 7, 1, true));
    expect(game.records[0].notation).toBe("▲７六歩"); expect(game.position.hands.sente.B).toBe(1);
    expect(() => game.play({ drop: "P", to: 40, promote: false })).toThrow();
    game.play(move(0, 2, 0, 3)); game.play({ drop: "B", to: 40, promote: false });
    expect(game.position.hands.sente.B).toBe(0); expect(game.position.board[40]).toEqual({ type: "B", side: "sente", promoted: false });
    const loaded = ShogiGame.load(JSON.parse(JSON.stringify(game.save())));
    expect(loaded.position).toEqual(game.position); expect(loaded.records).toEqual(game.records);
  });
  test("invalid saves are rejected without modifying a live game", () => {
    expect(() => ShogiGame.load({ version: 1, moves: [move(2, 6, 2, 4)] })).toThrow();
    expect(() => ShogiGame.load({ version: 2, moves: [] })).toThrow();
    const game = new ShogiGame(); game.play(move(2, 6, 2, 5)); game.resign();
    const loaded = ShogiGame.load(game.save()); expect(loaded.result).toEqual(game.result); expect(positionKey(loaded.position)).toBe(positionKey(game.position));
    loaded.undo(); expect(loaded.result).toBeNull(); expect(loaded.moveCount).toBe(1);
  });
  test("passing changes only the turn, records a move, and can be undone", () => {
    const game = new ShogiGame(), before = game.position;
    expect(game.passLimit).toBeNull(); expect(game.canPass).toBe(true);
    game.pass();
    expect(game.position).toEqual({ ...before, turn: "gote" });
    expect(game.records).toEqual([{ move: { pass: true }, side: "sente", notation: "▲パス", check: false }]);
    expect(game.moveCount).toBe(1); expect(game.passesRemaining).toEqual({ sente: null, gote: null });
    expect(game.result).toBeNull();
    game.undo(); expect(game.position).toEqual(before); expect(game.moveCount).toBe(0);
  });
  test("pass limits apply independently to each player and undo refunds a pass", () => {
    const game = new ShogiGame(undefined, { passLimit: 1 });
    game.pass(); expect(game.passesRemaining).toEqual({ sente: 0, gote: 1 });
    game.pass(); expect(game.passesRemaining).toEqual({ sente: 0, gote: 0 });
    expect(game.canPass).toBe(false);
    expect(() => game.pass()).toThrow("残り回数"); expect(game.moveCount).toBe(2);
    game.undo(); expect(game.passesRemaining).toEqual({ sente: 0, gote: 1 });
    expect(game.canPass).toBe(true); game.pass();
    const disabled = new ShogiGame(undefined, { passLimit: 0 });
    expect(disabled.canPass).toBe(false); expect(() => disabled.pass()).toThrow("残り回数");
    expect(disabled.moveCount).toBe(0);
  });
  test("pass limits are validated and can only change before a game starts", () => {
    const game = new ShogiGame();
    game.setPassLimit(3); expect(game.passesRemaining).toEqual({ sente: 3, gote: 3 });
    for (const invalid of [-1, .5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => game.setPassLimit(invalid)).toThrow();
      expect(() => new ShogiGame(undefined, { passLimit: invalid })).toThrow();
    }
    game.play(move(2, 6, 2, 5));
    expect(() => game.setPassLimit(null)).toThrow("開始前"); expect(game.passLimit).toBe(3);
    game.undo(); game.setPassLimit(null); expect(game.passLimit).toBeNull();
    game.resign(); expect(() => game.setPassLimit(1)).toThrow("開始前");
    expect(() => game.pass()).toThrow("終了");
  });
  test("passing cannot evade check, but remains available when there are no board moves without check", () => {
    const checked = empty(); put(checked, 8, 0, "R", "gote");
    const game = new ShogiGame(checked);
    expect(game.canPass).toBe(false); expect(() => game.pass()).toThrow("王手中");
    expect(game.position).toEqual(checked); expect(game.moveCount).toBe(0);
    const trapped = empty(); put(trapped, 7, 0, "R", "gote"); put(trapped, 0, 7, "R", "gote");
    expect(inCheck(trapped)).toBe(false); expect(legalMoves(trapped)).toHaveLength(0);
    expect([...legalActionIterator(trapped, { sente: 1, gote: 0 })]).toEqual([{ pass: true }]);
    const waiting = new ShogiGame(trapped, { passLimit: 1 }); waiting.pass();
    expect(waiting.position.turn).toBe("gote"); expect(waiting.result).toBeNull();
  });
  test("unlimited passes can repeat a position, while finite pass resources distinguish positions", () => {
    const unlimited = new ShogiGame();
    for (let i = 0; i < 6; i++) unlimited.pass();
    expect(unlimited.result).toEqual({ reason: "repetition", winner: null });
    expect(unlimited.canPass).toBe(false);
    unlimited.undo(); expect(unlimited.result).toBeNull(); expect(unlimited.canPass).toBe(true);
    const finite = new ShogiGame(undefined, { passLimit: 3 });
    for (let i = 0; i < 6; i++) finite.pass();
    expect(finite.result).toBeNull(); expect(finite.passesRemaining).toEqual({ sente: 0, gote: 0 });
    expect(finite.positionHistory[0]).not.toBe(finite.positionHistory[2]);
  });
  test("saves preserve passes and limits, and legacy saves load with passing disabled", () => {
    const game = new ShogiGame(undefined, { passLimit: 2 });
    game.pass(); game.play(move(0, 2, 0, 3)); game.pass();
    const saved = JSON.parse(JSON.stringify(game.save())), loaded = ShogiGame.load(saved);
    expect(saved.version).toBe(3); expect(saved.passLimit).toBe(2);
    expect(loaded.position).toEqual(game.position); expect(loaded.records).toEqual(game.records);
    expect(loaded.passesRemaining).toEqual({ sente: 0, gote: 2 });
    expect(loaded.positionHistory).toEqual(game.positionHistory);
    loaded.undo(); expect(loaded.passesRemaining).toEqual({ sente: 1, gote: 2 });
    const legacy = ShogiGame.load({ version: 1, moves: [move(2, 6, 2, 5)] });
    expect(legacy.passLimit).toBe(0); expect(legacy.canPass).toBe(false);
    const unlimited = new ShogiGame(); unlimited.pass();
    expect(ShogiGame.load(unlimited.save()).passLimit).toBeNull();
    for (const passLimit of [undefined, -1, .5, "1", Infinity]) expect(() => ShogiGame.load({ version: 2, passLimit, moves: [] })).toThrow();
    expect(() => ShogiGame.load({ version: 1, moves: [{ pass: true }] })).toThrow();
    expect(() => ShogiGame.load({ version: 2, passLimit: 0, moves: [{ pass: true }] })).toThrow();
    expect(() => ShogiGame.load({ version: 2, passLimit: 1, moves: [{ pass: true }, { pass: true }, { pass: true }] })).toThrow();
    expect(() => ShogiGame.load({ version: 2, passLimit: null, moves: [{ pass: true, ...move(2, 6, 2, 5) }] })).toThrow();
    expect(() => ShogiGame.load({ version: 2, passLimit: null, moves: [{ pass: false, ...move(2, 6, 2, 5) }] })).toThrow();
  });
});
