import type { PieceMovement, PieceStateDefinition } from "./pieces";
import type { Position } from "./shogi";

/** Geometry before landing restrictions: occupied squares are included and stop a ray. */
export function traceMovement(position: Position, from: number, movements: readonly PieceMovement[]): number[] {
  const piece = position.board[from]; if (!piece) return [];
  const x = from % position.width, y = Math.floor(from / position.width), direction = piece.side === "sente" ? -1 : 1;
  const squares: number[] = [];
  for (const { dx, dy, range } of movements) {
    for (let n = 1; n <= (range ?? Math.max(position.width, position.height) - 1); n++) {
      const nx = x + dx * n, ny = y + dy * direction * n;
      if (nx < 0 || nx >= position.width || ny < 0 || ny >= position.height) break;
      const index = ny * position.width + nx;
      squares.push(index);
      if (position.board[index]) break;
    }
  }
  return squares;
}

/** Landing squares before king safety, king capture and promotion rules are applied. */
export function pieceDestinations(position: Position, from: number, rules: Pick<PieceStateDefinition, "moves" | "captures">): number[] {
  const piece = position.board[from]; if (!piece) return [];
  const movement = traceMovement(position, from, rules.moves);
  const attacks = rules.captures === rules.moves ? movement : traceMovement(position, from, rules.captures);
  const emptyTargets = new Set(movement), captureTargets = new Set(attacks);
  // Preserve direction order when movement and capture share the same geometry.
  return [...new Set([...movement, ...attacks])].filter(to => {
    const target = position.board[to];
    return target ? target.side !== piece.side && captureTargets.has(to) : emptyTargets.has(to);
  });
}
