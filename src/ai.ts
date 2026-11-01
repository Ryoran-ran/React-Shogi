import { attacks, inCheck, legalActionIterator, isPassMove, positionAfterLegalMove, positionKey, royalResult, ruleResult } from "./shogi";
import type { GameMove, PassAllowance, Piece, Position, Side } from "./shogi";
import { pieceDefinition, handTypes, pieceState, loadPieceRules, hasRuleScripts, isRoyal } from "./pieces";
import type { PieceRules } from "./pieces";
import { loadRuleScript, validateRuleScript } from "./rulescript";
import { boardSettings } from "./boardsettings";
import { AI_MATE_SCORE as MATE, AI_CANDIDATE_LIMIT, aiVariation, chooseAICandidate } from "./aichoice";
import type { AICandidate } from "./aichoice";

export interface AIOptions { maxDepth?: number; maxNodes?: number; maxTimeMs?: number; previousPositions?: string[]; passesRemaining?: PassAllowance; pieceRules?: PieceRules; ruleScript?: string; randomSeed?: number; ply?: number }
export interface AISearchResult { move: GameMove | null; depth: number; nodes: number; score: number; claimDraw?:boolean }
export interface AIRequest { id: number; position: Position; options: AIOptions }
export type AIReply = { id: number; result: AISearchResult; progress?: true } | { id: number; error: string };
const valueOf = (piece: Piece, rules?: PieceRules): number => isRoyal(piece.type, rules) ? 20000 : pieceState(piece, rules).value;
function evaluate(position: Position, rules: PieceRules, ruleScript = "", checkBudget?:()=>void): number {
  const result = ruleResult(position,rules,ruleScript,undefined,checkBudget) ?? royalResult(position, rules);
  if (result) return result.winner === null ? 0 : result.winner === position.turn ? MATE : -MATE;
  let score = 0;
  const defended: Record<Side, Map<number, number>> = { sente: new Map(), gote: new Map() };
  for (let i = 0; i < position.board.length; i++) {
    const p = position.board[i]; if (!p) continue;
    for (const to of attacks(position, i, rules)) defended[p.side].set(to, Math.min(defended[p.side].get(to) ?? Infinity, valueOf(p, rules)));
  }
  for (let i = 0; i < position.board.length; i++) {
    const p = position.board[i]; if (!p) continue;
    const x = i % position.width, y = Math.floor(i / position.width), advance = p.side === "sente" ? position.height - 1 - y : y;
    const center = (position.width - 1) / 2;
    const table=rules[p.type]?.aiTable,row=p.side==="sente"?y:position.height-1-y;
    let value = table ? valueOf(p,rules)+table[Math.round(row/(position.height-1)*(table.length-1))][Math.round(x/(position.width-1)*(table[0].length-1))] : isRoyal(p.type, rules) ? (position.height - 1 - advance) * 4 : valueOf(p, rules) + advance * (p.type === "P" ? 8 : 3) + (center - Math.abs(center - x)) * 2;
    const enemy = defended[p.side === "sente" ? "gote" : "sente"].get(i);
    if (enemy !== undefined && !isRoyal(p.type, rules)) {
      value -= valueOf(p, rules) * (defended[p.side].has(i) ? .12 : .5);
      value -= Math.max(0, valueOf(p, rules) - enemy) * .25;
    }
    score += p.side === "sente" ? value : -value;
  }
  if (boardSettings(position).useHands) for (const side of ["sente", "gote"] as Side[]) for (const type of handTypes(rules)) score += (side === "sente" ? 1 : -1) * (position.hands[side][type] ?? 0) * pieceDefinition(type, rules).value * 1.05;
  return Math.round(position.turn === "sente" ? score : -score);
}
function priority(position: Position, move: GameMove, rules: PieceRules): number {
  if (isPassMove(move)) return -10000;
  const target = position.board[move.to], piece = move.from === undefined ? undefined : position.board[move.from];
  return (target ? valueOf(target, rules) * 10 + pieceDefinition(target.type, rules).value - (piece ? valueOf(piece, rules) / 10 : 0) : 0) + (move.promote ? 500 : 0);
}
function ordered(position: Position, moves: GameMove[], rules: PieceRules): GameMove[] { return moves.sort((a, b) => priority(position, b, rules) - priority(position, a, rules)); }
function remainingAfter(remaining: PassAllowance | undefined, side: Side, move: GameMove): PassAllowance | undefined {
  if (!remaining || !isPassMove(move) || remaining[side] === null) return remaining;
  return { ...remaining, [side]: remaining[side]! - 1 };
}

/** Bounded alpha-beta search. A seed enables near-best variety; omitting it keeps deterministic analysis. */
export function chooseAIMove(position: Position, options: AIOptions = {}, onCandidate?: (result:AISearchResult,checkpoint?:boolean)=>void): AISearchResult {
  const started = performance.now();
  const bounded = (value:number|undefined, fallback:number, maximum:number) => Number.isFinite(value) ? Math.max(1,Math.min(maximum,Math.floor(value!))) : fallback;
  const maxDepth = bounded(options.maxDepth,2,5), maxNodes = bounded(options.maxNodes,2000,1_000_000);
  const timeLimit = bounded(options.maxTimeMs,250,10_000), deadline = started + timeLimit;
  // A tiny search budget still needs one verified move. Unsuccessful candidate generation is bounded too.
  const firstMoveDeadline = started + Math.max(timeLimit,1000);
  const limit = Symbol("search limit"); let nodes = 0;
  const rules = loadPieceRules(options.pieceRules);
  const ruleScript = loadRuleScript(options.ruleScript); validateRuleScript(ruleScript, rules);
  const ply = Number.isFinite(options.ply) ? Math.max(0,Math.floor(options.ply!)) : Math.max(0,(options.previousPositions?.length ?? 1)-1);
  const variation = aiVariation(position,rules,options.randomSeed,ply), tolerance = variation?.tolerance ?? 0;
  const shortlist:AICandidate[] = [];
  const remember = (pool:AICandidate[],move:GameMove,score:number) => {
    pool.push({move,score});pool.sort((a,b)=>b.score-a.score);pool.splice(AI_CANDIDATE_LIMIT);
  };
  const repeats = new Map<string, number>();
  for (const key of options.previousPositions ?? []) repeats.set(key, (repeats.get(key) ?? 0) + 1);
  const rootMoves:GameMove[] = [], scores = new Map<GameMove,number>();
  const checkRootBudget = () => { if (performance.now() >= (rootMoves.length ? deadline : firstMoveDeadline)) throw limit; };
  let bestMove:GameMove|null = null, bestScore = -Infinity, completedDepth = 0;
  let choice:AICandidate|undefined;
  const publish=(move:GameMove,score:number,checkpoint=false)=>onCandidate?.({move:structuredClone(move),score:Number.isFinite(score)?score:0,depth:completedDepth,nodes},checkpoint);
  try {
    for (const move of legalActionIterator(position, options.passesRemaining, rules, ruleScript, checkRootBudget)) {
      rootMoves.push(move);
      if(!bestMove) {bestMove=move;publish(move,0);}
      checkRootBudget();
      const next = positionAfterLegalMove(position,move,rules,ruleScript);
      const score = -evaluate(next,rules,ruleScript,checkRootBudget) - (repeats.get(positionKey(next,remainingAfter(options.passesRemaining,position.turn,move)))??0)*35;
      scores.set(move,score);
      const improved=score>bestScore;
      if(improved) { bestScore=score;bestMove=move; }
      if(variation) {
        remember(shortlist,move,score);choice=chooseAICandidate(shortlist,variation);
        if(choice)publish(choice.move,choice.score);
      } else if(improved)publish(move,score);
    }
  } catch(error) {
    if(error!==limit)throw error;
    if(!bestMove)throw new Error("合法手の確認が制限時間を超えました。ルールを見直すか、もう一度AIを再開してください。");
  }
  if (!bestMove) {
    const result=ruleResult(position,rules,ruleScript,options.passesRemaining)??royalResult(position,rules);
    const score=result ? result.winner===null?0:result.winner===position.turn?MATE:-MATE : !inCheck(position,position.turn,rules)&&boardSettings(position).noMoves==="draw"?0:-MATE;
    return {move:null,score,depth:0,nodes:0};
  }
  if(choice)publish(choice.move,choice.score,true);
  ordered(position,rootMoves,rules);
  if(Object.values(rules).some(entry=>entry?.aiTable))rootMoves.sort((a,b)=>(scores.get(b)??-Infinity)-(scores.get(a)??-Infinity));
  const checkBudget = () => { if (nodes >= maxNodes || performance.now() >= deadline) throw limit; };
  function search(current: Position, remaining: PassAllowance | undefined, depth: number, alpha: number, beta: number, ply: number): number {
    checkBudget(); nodes++;
    if ((hasRuleScripts(ruleScript, rules) && current.ruleState?.result) || royalResult(current, rules)) return evaluate(current, rules, ruleScript,checkBudget);
    if (depth === 0) {
      if (inCheck(current, current.turn, rules) && legalActionIterator(current, remaining, rules, ruleScript,checkBudget).next().done) return -MATE + ply;
      if(boardSettings(current).noMoves==="draw"&&!inCheck(current,current.turn,rules)&&legalActionIterator(current,remaining,rules,ruleScript,checkBudget).next().done)return 0;
      return evaluate(current, rules, ruleScript,checkBudget);
    }
    const moves: GameMove[] = [];
    for (const move of legalActionIterator(current, remaining, rules, ruleScript,checkBudget)) { checkBudget(); moves.push(move); }
    if (!moves.length) return !inCheck(current,current.turn,rules)&&boardSettings(current).noMoves==="draw"?0:-MATE + ply;
    let best = -Infinity;
    for (const move of ordered(current, moves, rules)) {
      const score = -search(positionAfterLegalMove(current, move, rules, ruleScript), remainingAfter(remaining, current.turn, move), depth - 1, -beta, -alpha, ply + 1);
      best = Math.max(best, score); alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return best;
  }
  for (let depth = 1; depth <= maxDepth; depth++) {
    let candidate = rootMoves[0], iterationBest = -Infinity, alpha = -Infinity;
    const iterationCandidates:AICandidate[] = [];
    try {
      for (const move of rootMoves) {
        checkBudget();
        const next = positionAfterLegalMove(position, move, rules, ruleScript);
        const remaining = remainingAfter(options.passesRemaining, position.turn, move);
        const repetitionPenalty = (repeats.get(positionKey(next, remaining)) ?? 0) * 35;
        const threshold = alpha - tolerance;
        const score = -search(next, remaining, depth - 1, -Infinity, -(threshold + repetitionPenalty), 1) - repetitionPenalty;
        // Fail-low values are upper bounds, not close alternatives. Never randomize using them.
        if(variation && score>threshold)remember(iterationCandidates,move,score);
        if (score > iterationBest) { iterationBest = score; candidate = move; }
        alpha = Math.max(alpha, score);
      }
      bestMove = candidate; bestScore = iterationBest; completedDepth = depth;
      choice=chooseAICandidate(iterationCandidates,variation);
      publish(choice?.move??bestMove,choice?.score??bestScore,true);
      rootMoves.splice(rootMoves.indexOf(bestMove), 1); rootMoves.unshift(bestMove);
      if (bestScore > MATE - 1000) break;
    } catch (error) { if (error !== limit) throw error; break; }
  }
  if(position.ruleState?.drawClaim&&Number.isFinite(bestScore)&&bestScore<-150)return {move:null,claimDraw:true,score:0,depth:completedDepth,nodes};
  return { move: structuredClone(choice?.move??bestMove), score: choice?.score??(Number.isFinite(bestScore) ? bestScore : 0), depth: completedDepth, nodes };
}
