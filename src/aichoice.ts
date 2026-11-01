import { isPassMove } from "./shogi";
import type { GameMove, Position } from "./shogi";
import { isRoyal, pieceDefinition } from "./pieces";
import type { PieceRules, PieceType } from "./pieces";
import { boardSettings } from "./boardsettings";

export const AI_MATE_SCORE = 1_000_000;
export const AI_CANDIDATE_LIMIT = 6;
export interface AICandidate { move: GameMove; score: number }
export interface AIVariation { seed: number; tolerance: number }

/** Scale variety to the edited game's least valuable piece, and narrow it as play develops. */
export function aiVariation(position: Position, rules: PieceRules, seed: number | undefined, ply: number): AIVariation | undefined {
  if (seed === undefined || !Number.isFinite(seed)) return;
  let count = 0, unit = Infinity;
  const countPiece = (type: PieceType, amount: number) => {
    if (!amount || isRoyal(type, rules)) return;
    count += amount;
    const value = pieceDefinition(type, rules).value;
    if (value > 0) unit = Math.min(unit, value);
  };
  for (const piece of position.board) if (piece) countPiece(piece.type, 1);
  if (boardSettings(position).useHands) for (const hand of Object.values(position.hands)) for (const [type, amount] of Object.entries(hand)) countPiece(type as PieceType, amount);
  const stage = count <= 6 || ply >= 60 ? .02 : ply >= 16 ? .06 : .18;
  return { seed: Math.trunc(seed) >>> 0, tolerance: (Number.isFinite(unit) ? unit : 100) * stage };
}

/** Only exact scores from the same search depth belong in this pool. */
export function chooseAICandidate(candidates: readonly AICandidate[], variation?: AIVariation): AICandidate | undefined {
  const ranked = candidates.filter(candidate => Number.isFinite(candidate.score)).sort((a,b) => b.score - a.score);
  const best = ranked[0];
  if (!best || !variation || variation.tolerance <= 0 || Math.abs(best.score) >= AI_MATE_SCORE - 1000) return best;
  const pool = ranked.filter(candidate => best.score - candidate.score <= variation.tolerance && isPassMove(candidate.move) === isPassMove(best.move)).slice(0, AI_CANDIDATE_LIMIT);
  if (pool.length < 2) return best;
  // One seeded draw makes repeated progress reports stable and enables reproducible debugging.
  let value = variation.seed + 0x6d2b79f5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  const random = ((value ^ value >>> 14) >>> 0) / 4294967296;
  const weights = pool.map(candidate => Math.max(.05, (1 - (best.score - candidate.score) / variation.tolerance) ** 2));
  let draw = random * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < pool.length; index++) if ((draw -= weights[index]) < 0) return pool[index];
  return pool.at(-1);
}
