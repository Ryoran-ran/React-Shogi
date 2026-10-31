import { attacks, inCheck, legalActionIterator, isPassMove, positionAfterLegalMove, positionKey, HAND_TYPES } from "./shogi";
import type { GameMove, PassAllowance, Piece, Position, Side } from "./shogi";
import { PIECE_DEFINITIONS, pieceState } from "./pieces";

export interface AIOptions { maxDepth?: number; maxNodes?: number; maxTimeMs?: number; previousPositions?: string[]; passesRemaining?: PassAllowance }
export interface AISearchResult { move: GameMove | null; depth: number; nodes: number; score: number }
export interface AIRequest { id: number; position: Position; options: AIOptions }
export type AIReply = { id: number; result: AISearchResult } | { id: number; error: string };
const MATE = 1000000;
const valueOf = (piece: Piece): number => pieceState(piece).value;
function evaluate(position: Position): number {
  let score = 0;
  const defended: Record<Side, Map<number, number>> = { sente: new Map(), gote: new Map() };
  for (let i = 0; i < position.board.length; i++) {
    const p = position.board[i]; if (!p) continue;
    for (const to of attacks(position, i)) defended[p.side].set(to, Math.min(defended[p.side].get(to) ?? Infinity, valueOf(p)));
  }
  for (let i = 0; i < position.board.length; i++) {
    const p = position.board[i]; if (!p) continue;
    const x = i % position.width, y = Math.floor(i / position.width), advance = p.side === "sente" ? position.height - 1 - y : y;
    const center = (position.width - 1) / 2;
    let value = p.type === "K" ? (position.height - 1 - advance) * 4 : valueOf(p) + advance * (p.type === "P" ? 8 : 3) + (center - Math.abs(center - x)) * 2;
    const enemy = defended[p.side === "sente" ? "gote" : "sente"].get(i);
    if (enemy !== undefined && p.type !== "K") {
      value -= valueOf(p) * (defended[p.side].has(i) ? .12 : .5);
      value -= Math.max(0, valueOf(p) - enemy) * .25;
    }
    score += p.side === "sente" ? value : -value;
  }
  for (const side of ["sente", "gote"] as Side[]) for (const type of HAND_TYPES) score += (side === "sente" ? 1 : -1) * position.hands[side][type] * PIECE_DEFINITIONS[type].value * 1.05;
  return Math.round(position.turn === "sente" ? score : -score);
}
function priority(position: Position, move: GameMove): number {
  if (isPassMove(move)) return -10000;
  const target = position.board[move.to], piece = move.from === undefined ? undefined : position.board[move.from];
  return (target ? valueOf(target) * 10 + PIECE_DEFINITIONS[target.type].value - (piece ? valueOf(piece) / 10 : 0) : 0) + (move.promote ? 500 : 0);
}
function ordered(position: Position, moves: GameMove[]): GameMove[] { return moves.sort((a, b) => priority(position, b) - priority(position, a)); }
function remainingAfter(remaining: PassAllowance | undefined, side: Side, move: GameMove): PassAllowance | undefined {
  if (!remaining || !isPassMove(move) || remaining[side] === null) return remaining;
  return { ...remaining, [side]: remaining[side]! - 1 };
}

/** Bounded, deterministic alpha-beta search for local play and repeatable debugging. */
export function chooseAIMove(position: Position, options: AIOptions = {}): AISearchResult {
  const maxDepth = Math.max(1, Math.min(5, options.maxDepth ?? 2));
  const maxNodes = Math.max(1, options.maxNodes ?? 2000), deadline = performance.now() + Math.max(1, options.maxTimeMs ?? 250);
  const rootMoves = ordered(position, [...legalActionIterator(position, options.passesRemaining)]);
  if (!rootMoves.length) return { move: null, score: -MATE, depth: 0, nodes: 0 };
  const limit = Symbol("search limit"); let nodes = 0;
  const checkBudget = () => { if (nodes >= maxNodes || performance.now() >= deadline) throw limit; };
  function search(current: Position, remaining: PassAllowance | undefined, depth: number, alpha: number, beta: number, ply: number): number {
    checkBudget(); nodes++;
    if (depth === 0) {
      if (inCheck(current) && legalActionIterator(current, remaining).next().done) return -MATE + ply;
      return evaluate(current);
    }
    const moves: GameMove[] = [];
    for (const move of legalActionIterator(current, remaining)) { checkBudget(); moves.push(move); }
    if (!moves.length) return -MATE + ply;
    let best = -Infinity;
    for (const move of ordered(current, moves)) {
      const score = -search(positionAfterLegalMove(current, move), remainingAfter(remaining, current.turn, move), depth - 1, -beta, -alpha, ply + 1);
      best = Math.max(best, score); alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return best;
  }
  let bestMove = rootMoves[0], bestScore = -Infinity, completedDepth = 0;
  const repeats = new Map<string, number>();
  for (const key of options.previousPositions ?? []) repeats.set(key, (repeats.get(key) ?? 0) + 1);
  for (let depth = 1; depth <= maxDepth; depth++) {
    let candidate = rootMoves[0], iterationBest = -Infinity, alpha = -Infinity;
    try {
      for (const move of rootMoves) {
        checkBudget();
        const next = positionAfterLegalMove(position, move);
        const remaining = remainingAfter(options.passesRemaining, position.turn, move);
        const repetitionPenalty = (repeats.get(positionKey(next, remaining)) ?? 0) * 35;
        const score = -search(next, remaining, depth - 1, -Infinity, -(alpha + repetitionPenalty), 1) - repetitionPenalty;
        if (score > iterationBest) { iterationBest = score; candidate = move; }
        alpha = Math.max(alpha, score);
      }
      bestMove = candidate; bestScore = iterationBest; completedDepth = depth;
      rootMoves.splice(rootMoves.indexOf(bestMove), 1); rootMoves.unshift(bestMove);
      if (bestScore > MATE - 1000) break;
    } catch (error) { if (error !== limit) throw error; break; }
  }
  return { move: structuredClone(bestMove), score: Number.isFinite(bestScore) ? bestScore : evaluate(position), depth: completedDepth, nodes };
}
