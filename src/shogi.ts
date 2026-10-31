export type Side = "sente" | "gote";
export type PieceType = "K" | "R" | "B" | "G" | "S" | "N" | "L" | "P";
export type HandType = Exclude<PieceType, "K">;
export interface Piece { type: PieceType; side: Side; promoted: boolean }
export interface Position { width: number; height: number; board: Array<Piece | null>; hands: Record<Side, Record<HandType, number>>; turn: Side }
export interface Move { from?: number; drop?: HandType; to: number; promote: boolean }
export interface PassMove { pass: true }
export type GameMove = Move | PassMove;
export type PassAllowance = Record<Side, number | null>;
export interface GameOptions { passLimit?: number | null }
export interface Result { reason: "mate" | "noMoves" | "repetition" | "perpetualCheck" | "resign" | "agreement"; winner: Side | null }
export interface MoveRecord { move: GameMove; side: Side; notation: string; check: boolean }
interface Frame { position: Position; record: MoveRecord | null; result: Result | null; passesUsed: Record<Side, number> }
export interface SavedGame { version: 1 | 2 | 3; moves: GameMove[]; passLimit?: number | null; initialPosition?: Position; ending?: "resign" | "agreement" }
export const isPassMove = (move: GameMove): move is PassMove => "pass" in move && move.pass === true;
export const HAND_TYPES: HandType[] = ["R", "B", "G", "S", "N", "L", "P"];
export const SIDE_NAMES = { sente: "先手", gote: "後手" };
export const PIECE_NAMES: Record<PieceType, string> = { K: "王", R: "飛", B: "角", G: "金", S: "銀", N: "桂", L: "香", P: "歩" };
export const PIECE_LABELS: Record<PieceType, string> = { K: "王将", R: "飛車", B: "角行", G: "金将", S: "銀将", N: "桂馬", L: "香車", P: "歩兵" };
export const MIN_BOARD_SIZE = 3, MAX_BOARD_SIZE = 15;
export const PIECE_TYPES = Object.keys(PIECE_NAMES) as PieceType[];
const promotedLabels: Partial<Record<PieceType, string>> = { R: "龍王", B: "龍馬", S: "成銀", N: "成桂", L: "成香", P: "と" };
export const pieceLabel = (p: Piece): string => p.promoted ? promotedLabels[p.type] ?? PIECE_LABELS[p.type] : p.type === "K" && p.side === "gote" ? "玉将" : PIECE_LABELS[p.type];
const promotedNames: Partial<Record<PieceType, string>> = { R: "龍", B: "馬", S: "成銀", N: "成桂", L: "成香", P: "と" };
export const opposite = (side: Side): Side => side === "sente" ? "gote" : "sente";
export const pieceName = (p: Piece): string => p.promoted ? promotedNames[p.type] ?? PIECE_NAMES[p.type] : p.type === "K" && p.side === "gote" ? "玉" : PIECE_NAMES[p.type];
const inside = (position: Position, x: number, y: number) => x >= 0 && x < position.width && y >= 0 && y < position.height;
export const promotionDepth = (height: number) => Math.min(3, Math.floor(height / 3));
const zone = (position: Position, side: Side, y: number) => side === "sente" ? y < promotionDepth(position.height) : y >= position.height - promotionDepth(position.height);
const canPromote = (type: PieceType) => type !== "K" && type !== "G";
const forcedPromotion = (position: Position, p: Piece, y: number) => (p.type === "P" || p.type === "L") ? y === (p.side === "sente" ? 0 : position.height - 1) : p.type === "N" && (p.side === "sente" ? y <= 1 : y >= position.height - 2);
const clone = <T,>(v: T): T => structuredClone(v);
const emptyHand = (): Record<HandType, number> => ({ R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 });
export const fileLabel = (file: number): string => file < 10 ? "０１２３４５６７８９"[file] : String(file);
export const rankLabel = (rank: number): string => rank < 10 ? "零一二三四五六七八九"[rank] : rank === 10 ? "十" : `十${"零一二三四五六七八九"[rank - 10]}`;
export function validateBoardSize(width: number, height: number): void {
  if (![width, height].every(n => Number.isInteger(n) && n >= MIN_BOARD_SIZE && n <= MAX_BOARD_SIZE)) throw new Error(`盤面の縦・横は${MIN_BOARD_SIZE}〜${MAX_BOARD_SIZE}の整数で設定してください`);
}
export function emptyPosition(width = 9, height = 9): Position {
  validateBoardSize(width, height);
  return { width, height, board: Array(width * height).fill(null), hands: { sente: emptyHand(), gote: emptyHand() }, turn: "sente" };
}
export function validatePosition(data: unknown): asserts data is Position {
  if (!data || typeof data !== "object") throw new Error("盤面の設定が壊れています");
  const p = data as Position;
  validateBoardSize(p.width, p.height);
  if (!Array.isArray(p.board) || p.board.length !== p.width * p.height || !["sente", "gote"].includes(p.turn)) throw new Error("盤面の設定が壊れています");
  for (const piece of p.board) {
    if (piece === null) continue;
    if (!piece || typeof piece !== "object" || !PIECE_TYPES.includes(piece.type) || !["sente", "gote"].includes(piece.side) || typeof piece.promoted !== "boolean" || (piece.promoted && !canPromote(piece.type))) throw new Error("駒の設定が壊れています");
  }
  for (const side of ["sente", "gote"] as Side[]) for (const type of HAND_TYPES) {
    const count = p.hands?.[side]?.[type];
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_BOARD_SIZE * MAX_BOARD_SIZE) throw new Error("持ち駒の設定が壊れています");
  }
}
export function setupIssues(position: Position): string[] {
  validatePosition(position);
  const issues: string[] = [];
  for (const side of ["sente", "gote"] as Side[]) {
    const kings = position.board.filter(p => p?.type === "K" && p.side === side).length;
    if (kings !== 1) issues.push(`${SIDE_NAMES[side]}の王・玉を1枚配置してください（現在${kings}枚）`);
  }
  if (!issues.length && inCheck(position, opposite(position.turn))) issues.push("手番ではない側の王・玉が王手を受けています。配置または最初の手番を変更してください");
  if (!issues.length && inCheck(position) && legalMoveIterator(position).next().done) issues.push("最初の手番の王・玉が詰んでいます。配置を変更してください");
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

/** Destinations before considering the safety of the moving side's king. */
export function attacks(position: Position, from: number): number[] {
  const p = position.board[from]; if (!p) return [];
  const x = from % position.width, y = Math.floor(from / position.width), direction = p.side === "sente" ? -1 : 1, out: number[] = [];
  const add = (dx: number, dy: number, sliding = false) => {
    for (let n = 1; n <= (sliding ? Math.max(position.width, position.height) - 1 : 1); n++) {
      const nx = x + dx * n, ny = y + dy * direction * n; if (!inside(position, nx, ny)) break;
      const index = ny * position.width + nx, target = position.board[index];
      // Include friendly occupied squares as defended squares for king safety.
      out.push(index); if (target) break;
    }
  };
  const gold = () => [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [0, -1]].forEach(([dx, dy]) => add(dx, dy));
  if (p.promoted && ["P", "L", "N", "S"].includes(p.type)) gold();
  else switch (p.type) {
    case "K": for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (dx || dy) add(dx, dy); break;
    case "G": gold(); break;
    case "S": [[-1, 1], [0, 1], [1, 1], [-1, -1], [1, -1]].forEach(([dx, dy]) => add(dx, dy)); break;
    case "N": add(-1, 2); add(1, 2); break;
    case "L": add(0, 1, true); break;
    case "P": add(0, 1); break;
    case "R": [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => add(dx, dy, true)); if (p.promoted) [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => add(dx, dy)); break;
    case "B": [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => add(dx, dy, true)); if (p.promoted) [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => add(dx, dy)); break;
  }
  return out;
}
export function inCheck(position: Position, side = position.turn): boolean {
  const king = position.board.findIndex(p => p?.type === "K" && p.side === side);
  if (king < 0) return true;
  return position.board.some((p, index) => p?.side === opposite(side) && attacks(position, index).includes(king));
}
function applyUnchecked(position: Position, move: GameMove): Position {
  const next = clone(position), side = position.turn;
  if (isPassMove(move)) { next.turn = opposite(side); return next; }
  if (move.drop) { next.hands[side][move.drop]--; next.board[move.to] = { type: move.drop, side, promoted: false }; }
  else {
    const p = next.board[move.from!]!, captured = next.board[move.to];
    if (captured && captured.type !== "K") next.hands[side][captured.type]++;
    next.board[move.from!] = null; next.board[move.to] = { ...p, promoted: p.promoted || move.promote };
  }
  next.turn = opposite(side); return next;
}
/** Search helper: the caller must obtain the move from a legal move/action iterator. */
export function positionAfterLegalMove(position: Position, move: GameMove): Position { return applyUnchecked(position, move); }
function* boardMoves(position: Position): Generator<Move> {
  for (let from = 0; from < position.board.length; from++) {
    const p = position.board[from]; if (!p || p.side !== position.turn) continue;
    for (const to of attacks(position, from)) {
      const target = position.board[to]; if (target && (target.side === p.side || target.type === "K")) continue;
      const y = Math.floor(to / position.width), promotion = !p.promoted && canPromote(p.type) && (zone(position, p.side, Math.floor(from / position.width)) || zone(position, p.side, y));
      if (!promotion || !forcedPromotion(position, p, y)) { const move = { from, to, promote: false }; if (!inCheck(applyUnchecked(position, move), p.side)) yield move; }
      if (promotion) { const move = { from, to, promote: true }; if (!inCheck(applyUnchecked(position, move), p.side)) yield move; }
    }
  }
}
export function* legalMoveIterator(position: Position): Generator<Move> {
  yield* boardMoves(position);
  const side = position.turn;
  for (const drop of HAND_TYPES) {
    if (!position.hands[side][drop]) continue;
    for (let to = 0; to < position.board.length; to++) {
      if (position.board[to]) continue;
      const x = to % position.width, y = Math.floor(to / position.width), p: Piece = { type: drop, side, promoted: false };
      if (forcedPromotion(position, p, y)) continue;
      if (drop === "P" && position.board.some((piece, i) => i % position.width === x && piece?.side === side && piece.type === "P" && !piece.promoted)) continue;
      const move: Move = { drop, to, promote: false }, next = applyUnchecked(position, move);
      if (inCheck(next, side)) continue;
      // A directly checking pawn drop cannot be blocked by a drop. Only board moves can evade it.
      if (drop === "P" && attacks(next, to).some(i => next.board[i]?.type === "K" && next.board[i]?.side === next.turn) && boardMoves(next).next().done) continue;
      yield move;
    }
  }
}
export const legalMoves = (position: Position): Move[] => [...legalMoveIterator(position)];
export function canPass(position: Position, remaining: PassAllowance): boolean {
  return (remaining[position.turn] === null || remaining[position.turn]! > 0) && !inCheck(position);
}
export function* legalActionIterator(position: Position, remaining?: PassAllowance): Generator<GameMove> {
  yield* legalMoveIterator(position);
  if (remaining && canPass(position, remaining)) yield { pass: true };
}
export function positionKey(position: Position, remaining?: PassAllowance): string {
  const passKey = remaining && (remaining.sente !== null || remaining.gote !== null) ? `|pass:${remaining.sente ?? "-"},${remaining.gote ?? "-"}` : "";
  return `${position.width}x${position.height}|${position.turn}|${position.board.map(p => p ? `${p.side[0]}${p.type}${p.promoted ? "+" : ""}` : ".").join(",")}|${(["sente", "gote"] as Side[]).map(side => HAND_TYPES.map(t => position.hands[side][t]).join(",")).join("|")}${passKey}`;
}
function notation(position: Position, move: GameMove): string {
  if (isPassMove(move)) return `${position.turn === "sente" ? "▲" : "△"}パス`;
  const name = move.drop ? PIECE_NAMES[move.drop] : pieceName(position.board[move.from!]!);
  return `${position.turn === "sente" ? "▲" : "△"}${fileLabel(position.width - move.to % position.width)}${rankLabel(Math.floor(move.to / position.width) + 1)}${name}${move.drop ? "打" : move.promote ? "成" : ""}`;
}
export function validatePassLimit(value: unknown): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) throw new Error("パス上限は0以上の整数、または無制限にしてください");
}
export class ShogiGame {
  private frames: Frame[];
  private configuredPassLimit: number | null;
  constructor(position = initialPosition(), options: GameOptions = {}) {
    validatePosition(position);
    const limit = options.passLimit === undefined ? null : options.passLimit;
    validatePassLimit(limit); this.configuredPassLimit = limit;
    this.frames = [{ position: clone(position), record: null, result: null, passesUsed: { sente: 0, gote: 0 } }];
  }
  get passLimit(): number | null { return this.configuredPassLimit; }
  private remainingPasses(frame: Frame): PassAllowance {
    return { sente: this.passLimit === null ? null : this.passLimit - frame.passesUsed.sente, gote: this.passLimit === null ? null : this.passLimit - frame.passesUsed.gote };
  }
  get passesRemaining(): PassAllowance { return this.remainingPasses(this.frames.at(-1)!); }
  get canPass(): boolean { return !this.result && canPass(this.position, this.passesRemaining); }
  setPassLimit(limit: number | null): void {
    validatePassLimit(limit);
    if (this.moveCount || this.result) throw new Error("パス上限は対局開始前に設定してください");
    this.configuredPassLimit = limit;
  }
  get position(): Position { return clone(this.frames.at(-1)!.position); }
  get initialPosition(): Position { return clone(this.frames[0].position); }
  get result(): Result | null { return clone(this.frames.at(-1)!.result); }
  get records(): MoveRecord[] { return clone(this.frames.flatMap(f => f.record ? [f.record] : [])); }
  get moveCount(): number { return this.frames.length - 1; }
  get positionHistory(): string[] { return this.frames.map(frame => positionKey(frame.position, this.remainingPasses(frame))); }
  pass(): void { this.play({ pass: true }); }
  play(move: GameMove): void {
    if (this.result) throw new Error("対局は終了しています");
    const previous = this.position;
    if (isPassMove(move)) {
      if (Object.keys(move).length !== 1) throw new Error("パスの指し手が壊れています");
      if (inCheck(previous)) throw new Error("王手中はパスできません");
      if (!canPass(previous, this.passesRemaining)) throw new Error("パスの残り回数がありません");
    } else {
      const valid = legalMoveIterator(previous);
      let found = false;
      for (const candidate of valid) if (candidate.from === move.from && candidate.drop === move.drop && candidate.to === move.to && candidate.promote === move.promote) { found = true; break; }
      if (!found) throw new Error("その手は指せません");
    }
    const next = applyUnchecked(previous, move), check = inCheck(next);
    const record: MoveRecord = { move: clone(move), side: previous.turn, notation: notation(previous, move), check };
    const passesUsed = { ...this.frames.at(-1)!.passesUsed };
    if (isPassMove(move)) passesUsed[previous.turn]++;
    const frame: Frame = { position: next, record, result: null, passesUsed }; this.frames.push(frame);
    if (legalActionIterator(next, this.passesRemaining).next().done) frame.result = { reason: check ? "mate" : "noMoves", winner: previous.turn };
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
  save(): SavedGame { const reason = this.result?.reason; return { version: 3, initialPosition: this.initialPosition, passLimit: this.passLimit, moves: this.records.map(r => r.move), ...((reason === "resign" || reason === "agreement") ? { ending: reason } : {}) }; }
  static load(data: unknown): ShogiGame {
    if (!data || typeof data !== "object") throw new Error("将棋の保存データではありません");
    const d = data as SavedGame;
    if (![1, 2, 3].includes(d.version) || !Array.isArray(d.moves) || d.moves.length > 1024 || (d.ending !== undefined && !["resign", "agreement"].includes(d.ending))) throw new Error("対応していない保存データです");
    const passLimit = d.version === 1 ? 0 : d.passLimit;
    validatePassLimit(passLimit);
    let position = initialPosition();
    if (d.version === 3) {
      validatePosition(d.initialPosition); position = d.initialPosition;
      const issues = setupIssues(position); if (issues.length) throw new Error(issues[0]);
    }
    const game = new ShogiGame(position, { passLimit });
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
