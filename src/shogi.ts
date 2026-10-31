import { HAND_TYPES, canPromote, pieceState, loadPieceRules, pieceDefinition, pieceTypes, handTypes, isBuiltinPiece, hasPieceLibrary, hasPieceScripts, hasRuleScripts } from "./pieces";
import type { PieceType, HandType, PieceRules } from "./pieces";
import { pieceDestinations, traceMovement } from "./movement";
import { loadRuleScript, validateRuleScript, runRuleScript, validateScriptData, validateRuleState } from "./rulescript";
import type { ScriptData, RuleState, RuleChoice } from "./rulescript";
export { PIECE_TYPES, HAND_TYPES, PIECE_NAMES, PIECE_LABELS, canPromote, pieceState } from "./pieces";
export type { PieceType, HandType } from "./pieces";

export type Side = "sente" | "gote";
export interface Piece { type: PieceType; side: Side; promoted: boolean; data?: ScriptData }
export interface Position { width: number; height: number; board: Array<Piece | null>; hands: Record<Side, Record<HandType, number>>; turn: Side; ruleState?: RuleState }
export interface Move { from?: number; drop?: HandType; to: number; promote: boolean; choices?: string[] }
export interface PassMove { pass: true; choices?: string[] }
export type GameMove = Move | PassMove;
export type PassAllowance = Record<Side, number | null>;
export interface GameOptions { passLimit?: number | null; pieceRules?: PieceRules; ruleScript?: string }
export interface Result { reason: "mate" | "noMoves" | "repetition" | "perpetualCheck" | "resign" | "agreement" | "script"; winner: Side | null }
export interface MoveRecord { move: GameMove; side: Side; notation: string; check: boolean; effects?: string[] }
interface Frame { position: Position; record: MoveRecord | null; result: Result | null; passesUsed: Record<Side, number> }
export interface SavedGame { version: 1 | 2 | 3 | 4 | 5 | 6 | 7; moves: GameMove[]; passLimit?: number | null; initialPosition?: Position; pieceRules?: PieceRules; ruleScript?: string; ending?: "resign" | "agreement" }
export const isPassMove = (move: GameMove): move is PassMove => "pass" in move && move.pass === true;
export const SIDE_NAMES = { sente: "先手", gote: "後手" };
export const MIN_BOARD_SIZE = 3, MAX_BOARD_SIZE = 15;
export const opposite = (side: Side): Side => side === "sente" ? "gote" : "sente";
export function pieceLabel(p: Piece, rules?: PieceRules): string { const state = pieceState(p, rules); return p.side === "gote" ? state.goteLabel ?? state.label : state.label; }
export function pieceName(p: Piece, rules?: PieceRules): string { const state = pieceState(p, rules); return p.side === "gote" ? state.goteName ?? state.name : state.name; }
export const promotionDepth = (height: number) => Math.min(3, Math.floor(height / 3));
const zone = (position: Position, side: Side, y: number) => side === "sente" ? y < promotionDepth(position.height) : y >= position.height - promotionDepth(position.height);
const forcedPromotion = (position: Position, p: Piece, y: number, rules?: PieceRules) => {
  const ranks = pieceDefinition(p.type, rules).promotion?.forcedRanks ?? 0;
  return (p.side === "sente" ? y : position.height - 1 - y) < ranks;
};
const clone = <T,>(v: T): T => structuredClone(v);
const emptyHand = (): Record<HandType, number> => Object.fromEntries(HAND_TYPES.map(type => [type, 0])) as Record<HandType, number>;
export const fileLabel = (file: number): string => file < 10 ? "０１２３４５６７８９"[file] : String(file);
export const rankLabel = (rank: number): string => rank < 10 ? "零一二三四五六七八九"[rank] : rank === 10 ? "十" : `十${"零一二三四五六七八九"[rank - 10]}`;
export function validateBoardSize(width: number, height: number): void {
  if (![width, height].every(n => Number.isInteger(n) && n >= MIN_BOARD_SIZE && n <= MAX_BOARD_SIZE)) throw new Error(`盤面の縦・横は${MIN_BOARD_SIZE}〜${MAX_BOARD_SIZE}の整数で設定してください`);
}
export function emptyPosition(width = 9, height = 9): Position {
  validateBoardSize(width, height);
  return { width, height, board: Array(width * height).fill(null), hands: { sente: emptyHand(), gote: emptyHand() }, turn: "sente" };
}
export function validatePosition(data: unknown, rules?: PieceRules): asserts data is Position {
  if (!data || typeof data !== "object") throw new Error("盤面の設定が壊れています");
  const p = data as Position;
  validateBoardSize(p.width, p.height);
  if (!Array.isArray(p.board) || p.board.length !== p.width * p.height || !["sente", "gote"].includes(p.turn)) throw new Error("盤面の設定が壊れています");
  const types = pieceTypes(rules), handPieces = handTypes(rules);
  for (const piece of p.board) {
    if (piece === null) continue;
    if (!piece || typeof piece !== "object" || !types.includes(piece.type) || !["sente", "gote"].includes(piece.side) || typeof piece.promoted !== "boolean" || (piece.promoted && !canPromote(piece.type, rules))) throw new Error("駒の設定が壊れています");
    if (piece.data !== undefined) validateScriptData(piece.data);
  }
  for (const side of ["sente", "gote"] as Side[]) {
    const hand = p.hands?.[side];
    if (!hand || typeof hand !== "object" || Array.isArray(hand) || Object.keys(hand).some(type => !handPieces.includes(type as HandType))) throw new Error("持ち駒の設定が壊れています");
    for (const type of handPieces) {
      const count = isBuiltinPiece(type) ? hand[type] : hand[type] ?? 0;
      if (!Number.isSafeInteger(count) || count < 0 || count > MAX_BOARD_SIZE * MAX_BOARD_SIZE) throw new Error("持ち駒の設定が壊れています");
    }
  }
  if (p.ruleState !== undefined) validateRuleState(p.ruleState);
}
export function setupIssues(position: Position, rules?: PieceRules, ruleScript = ""): string[] {
  validatePosition(position, rules);
  const issues: string[] = [];
  for (const side of ["sente", "gote"] as Side[]) {
    const kings = position.board.filter(p => p?.type === "K" && p.side === side).length;
    if (kings !== 1) issues.push(`${SIDE_NAMES[side]}の王・玉を1枚配置してください（現在${kings}枚）`);
  }
  if (!issues.length && inCheck(position, opposite(position.turn), rules)) issues.push("手番ではない側の王・玉が王手を受けています。配置または最初の手番を変更してください");
  try {
    if (!issues.length && inCheck(position, position.turn, rules) && legalMoveIterator(position, rules, ruleScript).next().done) issues.push("最初の手番の王・玉が詰んでいます。配置を変更してください");
  } catch (error) { issues.push((error as Error).message); }
  return issues;
}

export function initialPosition(): Position {
  const p = emptyPosition();
  const back: PieceType[] = ["L", "N", "S", "G", "K", "G", "S", "N", "L"];
  const put = (x: number, y: number, type: PieceType, side: Side) => { p.board[y * 9 + x] = { type, side, promoted: false }; };
  for (let x = 0; x < 9; x++) { put(x, 0, back[x], "gote"); put(x, 2, "P", "gote"); put(x, 6, "P", "sente"); put(x, 8, back[x], "sente"); }
  put(1, 1, "R", "gote"); put(7, 1, "B", "gote"); put(1, 7, "B", "sente"); put(7, 7, "R", "sente");
  return p;
}

/** Capture reach, including empty and friendly occupied squares for king safety. */
export function attacks(position: Position, from: number, rules?: PieceRules): number[] {
  const p = position.board[from]; if (!p) return [];
  return traceMovement(position, from, pieceState(p, rules).captures);
}
export function inCheck(position: Position, side = position.turn, rules?: PieceRules): boolean {
  const king = position.board.findIndex(p => p?.type === "K" && p.side === side);
  if (king < 0) return true;
  return position.board.some((p, index) => p?.side === opposite(side) && attacks(position, index, rules).includes(king));
}
function applyUnchecked(position: Position, move: GameMove): Position {
  const next = clone(position), side = position.turn;
  if (isPassMove(move)) { next.turn = opposite(side); return next; }
  if (move.drop) { next.hands[side][move.drop]--; next.board[move.to] = { type: move.drop, side, promoted: false }; }
  else {
    const p = next.board[move.from!]!, captured = next.board[move.to];
    if (captured && captured.type !== "K") next.hands[side][captured.type] = (next.hands[side][captured.type] ?? 0) + 1;
    next.board[move.from!] = null; next.board[move.to] = { ...p, promoted: p.promoted || move.promote };
  }
  next.turn = opposite(side); return next;
}
/** Search helper: the caller must obtain the move from a legal move/action iterator. */
export function positionAfterLegalMove(position: Position, move: GameMove, rules: PieceRules = {}, ruleScript = ""): Position {
  if (!hasRuleScripts(ruleScript, rules)) return applyUnchecked(position, move);
  const outcome = runRuleScript(ruleScript, position, rules, move);
  if (!outcome.position) throw new Error(outcome.rejected ?? "ルールの選択を完了してください");
  validatePosition(outcome.position, rules); return outcome.position;
}
export function ruleChoiceForMove(position: Position, move: GameMove, rules: PieceRules, ruleScript: string): RuleChoice | undefined { return runRuleScript(ruleScript, position, rules, move).choice; }
function* expandedMoves<T extends GameMove>(position: Position, move: T, rules: PieceRules = {}, ruleScript = ""): Generator<{ move: T; next: Position }> {
  if (!hasRuleScripts(ruleScript, rules)) { yield { move, next: applyUnchecked(position, move) }; return; }
  let branches = 0;
  function* expand(candidate: T): Generator<{ move: T; next: Position }> {
    if (++branches > 128) throw new Error("1手のルール選択の組み合わせが多すぎます");
    const outcome = runRuleScript(ruleScript, position, rules, candidate);
    if (outcome.rejected) return;
    if (outcome.choice) {
      for (const option of outcome.choice.options) yield* expand({ ...candidate, choices: [...(candidate.choices ?? []), option.value] });
    } else if (outcome.position) { validatePosition(outcome.position, rules); yield { move: candidate, next: outcome.position }; }
  }
  yield* expand(move);
}
function* boardMoves(position: Position, rules?: PieceRules, ruleScript = ""): Generator<Move> {
  for (let from = 0; from < position.board.length; from++) {
    const p = position.board[from]; if (!p || p.side !== position.turn) continue;
    for (const to of pieceDestinations(position, from, pieceState(p, rules))) {
      const target = position.board[to]; if (target && (target.side === p.side || target.type === "K")) continue;
      const y = Math.floor(to / position.width), promotion = !p.promoted && canPromote(p.type, rules) && (zone(position, p.side, Math.floor(from / position.width)) || zone(position, p.side, y));
      for (const promote of promotion ? forcedPromotion(position, p, y, rules) ? [true] : [false, true] : [false]) {
        for (const { move, next } of expandedMoves(position, { from, to, promote }, rules, ruleScript)) if ((hasRuleScripts(ruleScript, rules) && next.ruleState?.result) || !inCheck(next, p.side, rules)) yield move;
      }
    }
  }
}
export function* legalMoveIterator(position: Position, rules?: PieceRules, ruleScript = ""): Generator<Move> {
  if (hasRuleScripts(ruleScript, rules) && position.ruleState?.result) return;
  yield* boardMoves(position, rules, ruleScript);
  const side = position.turn;
  for (const drop of handTypes(rules)) {
    if (!position.hands[side][drop]) continue;
    for (let to = 0; to < position.board.length; to++) {
      if (position.board[to]) continue;
      const x = to % position.width, y = Math.floor(to / position.width), p: Piece = { type: drop, side, promoted: false };
      if (forcedPromotion(position, p, y, rules)) continue;
      if (drop === "P" && position.board.some((piece, i) => i % position.width === x && piece?.side === side && piece.type === "P" && !piece.promoted)) continue;
      for (const { move, next } of expandedMoves<Move>(position, { drop, to, promote: false }, rules, ruleScript)) {
        if (!(hasRuleScripts(ruleScript, rules) && next.ruleState?.result) && inCheck(next, side, rules)) continue;
        if (!(hasRuleScripts(ruleScript, rules) && next.ruleState?.result) && drop === "P" && attacks(next, to, rules).some(i => next.board[i]?.type === "K" && next.board[i]?.side === next.turn) && legalMoveIterator(next, rules, ruleScript).next().done) continue;
        yield move;
      }
    }
  }
}
export const legalMoves = (position: Position, rules?: PieceRules, ruleScript = ""): Move[] => [...legalMoveIterator(position, rules, ruleScript)];
export function canPass(position: Position, remaining: PassAllowance, rules?: PieceRules): boolean {
  return (remaining[position.turn] === null || remaining[position.turn]! > 0) && !inCheck(position, position.turn, rules);
}
export function* legalActionIterator(position: Position, remaining?: PassAllowance, rules?: PieceRules, ruleScript = ""): Generator<GameMove> {
  if (hasRuleScripts(ruleScript, rules) && position.ruleState?.result) return;
  yield* legalMoveIterator(position, rules, ruleScript);
  if (remaining && canPass(position, remaining, rules)) for (const { move, next } of expandedMoves<PassMove>(position, { pass: true }, rules, ruleScript)) if ((hasRuleScripts(ruleScript, rules) && next.ruleState?.result) || !inCheck(next, position.turn, rules)) yield move;
}
export function positionKey(position: Position, remaining?: PassAllowance): string {
  const passKey = remaining && (remaining.sente !== null || remaining.gote !== null) ? `|pass:${remaining.sente ?? "-"},${remaining.gote ?? "-"}` : "";
  const customHands = [...new Set([...Object.keys(position.hands.sente), ...Object.keys(position.hands.gote)])].filter(type => !isBuiltinPiece(type) && ((position.hands.sente[type as HandType] ?? 0) > 0 || (position.hands.gote[type as HandType] ?? 0) > 0)).sort();
  const customKey = customHands.length ? `|custom:${customHands.map(type => `${type}:${position.hands.sente[type as HandType] ?? 0}:${position.hands.gote[type as HandType] ?? 0}`).join(",")}` : "";
  const dataKey = position.ruleState || position.board.some(piece => piece?.data) ? `|rule:${JSON.stringify([position.ruleState, position.board.map(piece => piece?.data ?? null)])}` : "";
  return `${position.width}x${position.height}|${position.turn}|${position.board.map(p => p ? `${p.side[0]}${p.type}${p.promoted ? "+" : ""}` : ".").join(",")}|${(["sente", "gote"] as Side[]).map(side => HAND_TYPES.map(t => position.hands[side][t]).join(",")).join("|")}${passKey}${customKey}${dataKey}`;
}
function notation(position: Position, move: GameMove, rules?: PieceRules): string {
  if (isPassMove(move)) return `${position.turn === "sente" ? "▲" : "△"}パス`;
  const name = move.drop ? pieceDefinition(move.drop, rules).name : pieceName(position.board[move.from!]!, rules);
  return `${position.turn === "sente" ? "▲" : "△"}${fileLabel(position.width - move.to % position.width)}${rankLabel(Math.floor(move.to / position.width) + 1)}${name}${move.drop ? "打" : move.promote ? "成" : ""}`;
}
export function validatePassLimit(value: unknown): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) throw new Error("パス上限は0以上の整数、または無制限にしてください");
}
export class ShogiGame {
  private frames: Frame[];
  private configuredPassLimit: number | null;
  private configuredPieceRules: PieceRules;
  private configuredRuleScript: string;
  private startingPosition: Position;
  constructor(position = initialPosition(), options: GameOptions = {}) {
    this.configuredPieceRules = loadPieceRules(options.pieceRules);
    this.configuredRuleScript = loadRuleScript(options.ruleScript); validateRuleScript(this.configuredRuleScript, this.configuredPieceRules);
    validatePosition(position, this.configuredPieceRules);
    this.startingPosition = clone(position);
    const limit = options.passLimit === undefined ? null : options.passLimit;
    validatePassLimit(limit); this.configuredPassLimit = limit;
    let start = clone(position);
    if (this.hasScripts) {
      const outcome = runRuleScript(this.ruleScript, start, this.configuredPieceRules);
      if (!outcome.position) throw new Error(outcome.rejected ?? "対局開始時のルールでは選択を要求できません");
      start = outcome.position; validatePosition(start, this.configuredPieceRules);
    }
    this.frames = [{ position: start, record: null, result: this.hasScripts ? start.ruleState?.result ?? null : null, passesUsed: { sente: 0, gote: 0 } }];
  }
  get passLimit(): number | null { return this.configuredPassLimit; }
  get pieceRules(): PieceRules { return clone(this.configuredPieceRules); }
  get ruleScript(): string { return this.configuredRuleScript; }
  get hasScripts(): boolean { return hasRuleScripts(this.ruleScript, this.configuredPieceRules); }
  private remainingPasses(frame: Frame): PassAllowance {
    return { sente: this.passLimit === null ? null : this.passLimit - frame.passesUsed.sente, gote: this.passLimit === null ? null : this.passLimit - frame.passesUsed.gote };
  }
  get passesRemaining(): PassAllowance { return this.remainingPasses(this.frames.at(-1)!); }
  get canPass(): boolean { return !this.result && canPass(this.position, this.passesRemaining, this.configuredPieceRules) && (!this.hasScripts || [...expandedMoves<PassMove>(this.position, { pass: true }, this.configuredPieceRules, this.ruleScript)].some(item => item.next.ruleState?.result || !inCheck(item.next, this.position.turn, this.configuredPieceRules))); }
  setPassLimit(limit: number | null): void {
    validatePassLimit(limit);
    if (this.moveCount || this.result) throw new Error("パス上限は対局開始前に設定してください");
    this.configuredPassLimit = limit;
  }
  get position(): Position { return clone(this.frames.at(-1)!.position); }
  get initialPosition(): Position { return clone(this.startingPosition); }
  get result(): Result | null { return clone(this.frames.at(-1)!.result); }
  get records(): MoveRecord[] { return clone(this.frames.flatMap(f => f.record ? [f.record] : [])); }
  get moveCount(): number { return this.frames.length - 1; }
  get positionHistory(): string[] { return this.frames.map(frame => positionKey(frame.position, this.remainingPasses(frame))); }
  pass(): void { this.play({ pass: true }); }
  get passMoves(): PassMove[] { return this.canPass ? [...expandedMoves<PassMove>(this.position, { pass: true }, this.configuredPieceRules, this.ruleScript)].filter(item => item.next.ruleState?.result || !inCheck(item.next, this.position.turn, this.configuredPieceRules)).map(item => item.move) : []; }
  play(move: GameMove): void {
    if (this.result) throw new Error("対局は終了しています");
    const previous = this.position;
    if (move.choices !== undefined && (!Array.isArray(move.choices) || move.choices.length > 4 || move.choices.some(value => typeof value !== "string" || value.length > 80))) throw new Error("ルールの選択記録が壊れています");
    if (isPassMove(move)) {
      if (Object.keys(move).some(key => key !== "pass" && key !== "choices")) throw new Error("パスの指し手が壊れています");
      if (inCheck(previous, previous.turn, this.configuredPieceRules)) throw new Error("王手中はパスできません");
      if (!canPass(previous, this.passesRemaining, this.configuredPieceRules)) throw new Error("パスの残り回数がありません");
      if (!this.passMoves.some(candidate => JSON.stringify(candidate.choices ?? []) === JSON.stringify(move.choices ?? []))) throw new Error("そのパスはルールで許可されていません");
    } else {
      const valid = legalMoveIterator(previous, this.configuredPieceRules, this.ruleScript);
      let found = false;
      for (const candidate of valid) if (candidate.from === move.from && candidate.drop === move.drop && candidate.to === move.to && candidate.promote === move.promote && JSON.stringify(candidate.choices ?? []) === JSON.stringify(move.choices ?? [])) { found = true; break; }
      if (!found) throw new Error("その手は指せません");
    }
    const next = positionAfterLegalMove(previous, move, this.configuredPieceRules, this.ruleScript), check = !(this.hasScripts && next.ruleState?.result) && inCheck(next, next.turn, this.configuredPieceRules);
    const effects = this.hasScripts ? runRuleScript(this.ruleScript, previous, this.configuredPieceRules, move).effects : undefined;
    const record: MoveRecord = { move: clone(move), side: previous.turn, notation: notation(previous, move, this.configuredPieceRules), check, ...(effects?.length ? { effects } : {}) };
    const passesUsed = { ...this.frames.at(-1)!.passesUsed };
    if (isPassMove(move)) passesUsed[previous.turn]++;
    const frame: Frame = { position: next, record, result: this.hasScripts ? next.ruleState?.result ?? null : null, passesUsed };
    if (!frame.result && legalActionIterator(next, this.remainingPasses(frame), this.configuredPieceRules, this.ruleScript).next().done) frame.result = { reason: check ? "mate" : "noMoves", winner: previous.turn };
    this.frames.push(frame);
    if (frame.result) return;
    else {
      const key = positionKey(next, this.passesRemaining), matches = this.frames.flatMap((f, i) => positionKey(f.position, this.remainingPasses(f)) === key ? [i] : []);
      if (matches.length >= 4) {
        const interval = this.frames.slice(matches.at(-4)! + 1);
        const checker = (["sente", "gote"] as Side[]).find(side => { const moves = interval.filter(f => f.record?.side === side); return moves.length > 0 && moves.every(f => f.record!.check); });
        frame.result = checker ? { reason: "perpetualCheck", winner: opposite(checker) } : { reason: "repetition", winner: null };
      }
    }
  }
  undo(): boolean {
    const current = this.frames.at(-1)!;
    if (current.result?.reason === "resign" || current.result?.reason === "agreement") { current.result = null; return true; }
    if (this.frames.length === 1) return false;
    this.frames.pop(); return true;
  }
  resign(): void { if (!this.result) this.frames.at(-1)!.result = { reason: "resign", winner: opposite(this.position.turn) }; }
  agreeDraw(): void { if (!this.result) this.frames.at(-1)!.result = { reason: "agreement", winner: null }; }
  save(): SavedGame { const reason = this.result?.reason, custom = Object.keys(this.configuredPieceRules).length > 0; return { version: hasPieceScripts(this.configuredPieceRules) ? 7 : this.ruleScript ? 6 : hasPieceLibrary(this.configuredPieceRules) ? 5 : custom ? 4 : 3, initialPosition: this.initialPosition, passLimit: this.passLimit, ...(custom || this.ruleScript ? { pieceRules: this.pieceRules } : {}), ...(this.ruleScript ? { ruleScript: this.ruleScript } : {}), moves: this.records.map(r => r.move), ...((reason === "resign" || reason === "agreement") ? { ending: reason } : {}) }; }
  static load(data: unknown): ShogiGame {
    if (!data || typeof data !== "object") throw new Error("将棋の保存データではありません");
    const d = data as SavedGame;
    if (![1, 2, 3, 4, 5, 6, 7].includes(d.version) || !Array.isArray(d.moves) || d.moves.length > 1024 || (d.ending !== undefined && !["resign", "agreement"].includes(d.ending)) || (d.version < 6 && d.ruleScript !== undefined) || (d.version === 6 && !d.ruleScript)) throw new Error("対応していない保存データです");
    if ((d.version >= 4 && d.pieceRules === undefined) || (d.version < 4 && d.pieceRules !== undefined)) throw new Error("駒の動きの保存形式が壊れています");
    const pieceRules = loadPieceRules(d.pieceRules);
    if (d.version < 7 && hasPieceScripts(pieceRules)) throw new Error("駒のルールコードの保存形式が壊れています");
    if (d.version < 5 && hasPieceLibrary(pieceRules)) throw new Error("追加駒・デザインの保存形式が壊れています");
    const passLimit = d.version === 1 ? 0 : d.passLimit;
    validatePassLimit(passLimit);
    let position = initialPosition();
    if (d.version >= 3) {
      validatePosition(d.initialPosition, pieceRules); position = d.initialPosition;
      const issues = setupIssues(position, pieceRules, d.ruleScript); if (issues.length) throw new Error(issues[0]);
    }
    const game = new ShogiGame(position, { passLimit, pieceRules, ruleScript: d.ruleScript });
    for (const move of d.moves) {
      if (!move || typeof move !== "object") throw new Error("指し手が壊れています");
      if (isPassMove(move)) { if (d.version === 1) throw new Error("以前の保存形式ではパスを使用できません"); }
      else if ("pass" in move || !Number.isInteger(move.to) || typeof move.promote !== "boolean") throw new Error("指し手が壊れています");
      game.play(move);
    }
    if (d.ending === "resign") game.resign(); if (d.ending === "agreement") game.agreeDraw();
    return game;
  }
}
