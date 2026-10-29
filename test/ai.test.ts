import { describe, expect, test } from "bun:test";
import { chooseAIMove } from "../src/ai";
import type { AIReply } from "../src/ai";
import { ShogiGame, initialPosition, legalMoves, inCheck, positionAfterLegalMove, HAND_TYPES } from "../src/shogi";
import type { PieceType, Position, Side } from "../src/shogi";
const at = (x: number, y: number) => y * 9 + x;
function put(p: Position, x: number, y: number, type: PieceType, side: Side = "sente") { p.board[at(x, y)] = { type, side, promoted: false }; }
function empty(): Position { const p = initialPosition(); p.board.fill(null); put(p, 8, 8, "K"); put(p, 0, 0, "K", "gote"); return p; }
const options = { maxDepth: 1, maxNodes: 1000, maxTimeMs: 5000 };

describe("local shogi AI", () => {
  test("returns legal, repeatable moves without changing the supplied position", () => {
    const p = initialPosition(), original = structuredClone(p);
    const first = chooseAIMove(p, options), second = chooseAIMove(p, options);
    expect(legalMoves(p)).toContainEqual(first.move);
    expect(second.move).toEqual(first.move); expect(first.depth).toBe(1); expect(p).toEqual(original);
  });
  test("takes an undefended rook", () => {
    const p = empty(); put(p, 4, 4, "P"); put(p, 4, 3, "R", "gote");
    expect(chooseAIMove(p, options).move).toEqual({ from: 40, to: 31, promote: false });
  });
  test("recognizes a one-move mate", () => {
    const p = empty(); p.board[0] = null; put(p, 4, 0, "K", "gote"); put(p, 4, 2, "P"); put(p, 3, 2, "G"); put(p, 2, 1, "B"); put(p, 5, 2, "R");
    const result = chooseAIMove(p, options), game = new ShogiGame(p);
    expect(result.move).not.toBeNull(); game.play(result.move!);
    expect(game.result).toEqual({ reason: "mate", winner: "sente" });
    expect(chooseAIMove(game.position, options).move).toBeNull();
  });
  test("escapes check and respects a fixed search budget", () => {
    const p = empty(); p.board[80] = null; put(p, 4, 8, "K"); put(p, 4, 0, "R", "gote"); p.hands.sente.G = 1;
    const result = chooseAIMove(p, { maxDepth: 4, maxNodes: 80, maxTimeMs: 5000 });
    expect(result.nodes).toBeLessThanOrEqual(80); expect(legalMoves(p)).toContainEqual(result.move);
    expect(inCheck(positionAfterLegalMove(p, result.move!), "sente")).toBe(false);
    expect(legalMoves(initialPosition())).toContainEqual(chooseAIMove(initialPosition(), { maxNodes: 1, maxTimeMs: 1 }).move);
  });
  test("self-play preserves all forty pieces and produces a reloadable record", () => {
    const game = new ShogiGame();
    for (let i = 0; i < 24 && !game.result; i++) {
      const result = chooseAIMove(game.position, { ...options, previousPositions: game.positionHistory });
      expect(result.move).not.toBeNull(); game.play(result.move!);
      const p = game.position;
      const held = (["sente", "gote"] as Side[]).reduce((sum, side) => sum + HAND_TYPES.reduce((n, type) => n + p.hands[side][type], 0), 0);
      expect(p.board.filter(Boolean).length + held).toBe(40);
    }
    expect(game.moveCount).toBeGreaterThan(1);
    expect(ShogiGame.load(game.save()).position).toEqual(game.position);
  });
  test("worker responds with the matching request ID and a legal move", async () => {
    const worker = new Worker(new URL("../src/aiworker.ts", import.meta.url).href, { type: "module" });
    let timeout: ReturnType<typeof setTimeout>;
    try {
      const reply = await new Promise<AIReply>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("AI worker timed out")), 4000);
        worker.onmessage = event => resolve(event.data as AIReply);
        worker.onerror = () => reject(new Error("AI worker failed"));
        worker.postMessage({ id: 17, position: initialPosition(), options });
      });
      expect(reply.id).toBe(17); expect("result" in reply).toBe(true);
      if ("result" in reply) expect(legalMoves(initialPosition())).toContainEqual(reply.result.move);
    } finally { clearTimeout(timeout!); worker.terminate(); }
  });
});
