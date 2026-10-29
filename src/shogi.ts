export type Side = "sente" | "gote";
export type PieceType = "K" | "R" | "B" | "G" | "S" | "N" | "L" | "P";
export type HandType = Exclude<PieceType, "K">;
export interface Piece { type: PieceType; side: Side; promoted: boolean }
export interface Position { board: Array<Piece | null>; hands: Record<Side, Record<HandType, number>>; turn: Side }
export interface Move { from?: number; drop?: HandType; to: number; promote: boolean }
export interface Result { reason: "mate" | "noMoves" | "repetition" | "perpetualCheck" | "resign" | "agreement"; winner: Side | null }
export interface MoveRecord { move: Move; side: Side; notation: string; check: boolean }
interface Frame { position: Position; record: MoveRecord | null; result: Result | null }
export interface SavedGame { version: 1; moves: Move[]; ending?: "resign" | "agreement" }
export const HAND_TYPES: HandType[] = ["R", "B", "G", "S", "N", "L", "P"];
export const SIDE_NAMES = { sente: "先手", gote: "後手" };
export const PIECE_NAMES: Record<PieceType, string> = { K: "王", R: "飛", B: "角", G: "金", S: "銀", N: "桂", L: "香", P: "歩" };
export const PIECE_LABELS: Record<PieceType, string> = { K: "王将", R: "飛車", B: "角行", G: "金将", S: "銀将", N: "桂馬", L: "香車", P: "歩兵" };
const promotedLabels: Partial<Record<PieceType, string>> = { R: "龍王", B: "龍馬", S: "成銀", N: "成桂", L: "成香", P: "と" };
export const pieceLabel = (p: Piece): string => p.promoted ? promotedLabels[p.type] ?? PIECE_LABELS[p.type] : p.type === "K" && p.side === "gote" ? "玉将" : PIECE_LABELS[p.type];
const promotedNames: Partial<Record<PieceType, string>> = { R: "龍", B: "馬", S: "成銀", N: "成桂", L: "成香", P: "と" };
export const opposite = (side: Side): Side => side === "sente" ? "gote" : "sente";
export const pieceName = (p: Piece): string => p.promoted ? promotedNames[p.type] ?? PIECE_NAMES[p.type] : p.type === "K" && p.side === "gote" ? "玉" : PIECE_NAMES[p.type];
const inside = (x: number, y: number) => x >= 0 && x < 9 && y >= 0 && y < 9;
const zone = (side: Side, y: number) => side === "sente" ? y <= 2 : y >= 6;
const canPromote = (type: PieceType) => type !== "K" && type !== "G";
const forcedPromotion = (p: Piece, y: number) => (p.type === "P" || p.type === "L") ? y === (p.side === "sente" ? 0 : 8) : p.type === "N" && (p.side === "sente" ? y <= 1 : y >= 7);
const clone = <T,>(v: T): T => structuredClone(v);
const emptyHand = (): Record<HandType, number> => ({ R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 });

export function initialPosition(): Position {
  const p: Position = { board: Array(81).fill(null), hands: { sente: emptyHand(), gote: emptyHand() }, turn: "sente" };
  const back: PieceType[] = ["L", "N", "S", "G", "K", "G", "S", "N", "L"];
  const put = (x: number, y: number, type: PieceType, side: Side) => { p.board[y * 9 + x] = { type, side, promoted: false }; };
  for (let x = 0; x < 9; x++) { put(x, 0, back[x], "gote"); put(x, 2, "P", "gote"); put(x, 6, "P", "sente"); put(x, 8, back[x], "sente"); }
  put(1, 1, "R", "gote"); put(7, 1, "B", "gote"); put(1, 7, "B", "sente"); put(7, 7, "R", "sente");
  return p;
}

/** Destinations before considering the safety of the moving side's king. */
export function attacks(position: Position, from: number): number[] {
  const p = position.board[from]; if (!p) return [];
  const x = from % 9, y = Math.floor(from / 9), direction = p.side === "sente" ? -1 : 1, out: number[] = [];
  const add = (dx: number, dy: number, sliding = false) => {
    for (let n = 1; n <= (sliding ? 8 : 1); n++) {
      const nx = x + dx * n, ny = y + dy * direction * n; if (!inside(nx, ny)) break;
      const index = ny * 9 + nx, target = position.board[index];
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
function applyUnchecked(position: Position, move: Move): Position {
  const next = clone(position), side = position.turn;
  if (move.drop) { next.hands[side][move.drop]--; next.board[move.to] = { type: move.drop, side, promoted: false }; }
  else {
    const p = next.board[move.from!]!, captured = next.board[move.to];
    if (captured && captured.type !== "K") next.hands[side][captured.type]++;
    next.board[move.from!] = null; next.board[move.to] = { ...p, promoted: p.promoted || move.promote };
  }
  next.turn = opposite(side); return next;
}
function* boardMoves(position: Position): Generator<Move> {
  for (let from = 0; from < 81; from++) {
    const p = position.board[from]; if (!p || p.side !== position.turn) continue;
    for (const to of attacks(position, from)) {
      const target = position.board[to]; if (target && (target.side === p.side || target.type === "K")) continue;
      const y = Math.floor(to / 9), promotion = !p.promoted && canPromote(p.type) && (zone(p.side, Math.floor(from / 9)) || zone(p.side, y));
      if (!promotion || !forcedPromotion(p, y)) { const move = { from, to, promote: false }; if (!inCheck(applyUnchecked(position, move), p.side)) yield move; }
      if (promotion) { const move = { from, to, promote: true }; if (!inCheck(applyUnchecked(position, move), p.side)) yield move; }
    }
  }
}
export function* legalMoveIterator(position: Position): Generator<Move> {
  yield* boardMoves(position);
  const side = position.turn;
  for (const drop of HAND_TYPES) {
    if (!position.hands[side][drop]) continue;
    for (let to = 0; to < 81; to++) {
      if (position.board[to]) continue;
      const x = to % 9, y = Math.floor(to / 9), p: Piece = { type: drop, side, promoted: false };
      if (forcedPromotion(p, y)) continue;
      if (drop === "P" && position.board.some((piece, i) => i % 9 === x && piece?.side === side && piece.type === "P" && !piece.promoted)) continue;
      const move: Move = { drop, to, promote: false }, next = applyUnchecked(position, move);
      if (inCheck(next, side)) continue;
      // A directly checking pawn drop cannot be blocked by a drop. Only board moves can evade it.
      if (drop === "P" && attacks(next, to).some(i => next.board[i]?.type === "K" && next.board[i]?.side === next.turn) && boardMoves(next).next().done) continue;
      yield move;
    }
  }
}
export const legalMoves = (position: Position): Move[] => [...legalMoveIterator(position)];
export function positionKey(position: Position): string {
  return `${position.turn}|${position.board.map(p => p ? `${p.side[0]}${p.type}${p.promoted ? "+" : ""}` : ".").join(",")}|${(["sente", "gote"] as Side[]).map(side => HAND_TYPES.map(t => position.hands[side][t]).join(",")).join("|")}`;
}
function notation(position: Position, move: Move): string {
  const name = move.drop ? PIECE_NAMES[move.drop] : pieceName(position.board[move.from!]!);
  return `${position.turn === "sente" ? "▲" : "△"}${"１２３４５６７８９"[8 - move.to % 9]}${"一二三四五六七八九"[Math.floor(move.to / 9)]}${name}${move.drop ? "打" : move.promote ? "成" : ""}`;
}
export class ShogiGame {
  private frames: Frame[];
  constructor(position = initialPosition()) { this.frames = [{ position: clone(position), record: null, result: null }]; }
  get position(): Position { return clone(this.frames.at(-1)!.position); }
  get result(): Result | null { return clone(this.frames.at(-1)!.result); }
  get records(): MoveRecord[] { return clone(this.frames.flatMap(f => f.record ? [f.record] : [])); }
  get moveCount(): number { return this.frames.length - 1; }
  play(move: Move): void {
    if (this.result) throw new Error("対局は終了しています");
    const previous = this.position;
    const valid = legalMoveIterator(previous);
    let found = false;
    for (const candidate of valid) if (candidate.from === move.from && candidate.drop === move.drop && candidate.to === move.to && candidate.promote === move.promote) { found = true; break; }
    if (!found) throw new Error("その手は指せません");
    const next = applyUnchecked(previous, move), check = inCheck(next);
    const record: MoveRecord = { move: clone(move), side: previous.turn, notation: notation(previous, move), check };
    const frame: Frame = { position: next, record, result: null }; this.frames.push(frame);
    if (legalMoveIterator(next).next().done) frame.result = { reason: check ? "mate" : "noMoves", winner: previous.turn };
    else {
      const key = positionKey(next), matches = this.frames.flatMap((f, i) => positionKey(f.position) === key ? [i] : []);
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
  save(): SavedGame { const reason = this.result?.reason; return { version: 1, moves: this.records.map(r => r.move), ...((reason === "resign" || reason === "agreement") ? { ending: reason } : {}) }; }
  static load(data: unknown): ShogiGame {
    if (!data || typeof data !== "object") throw new Error("将棋の保存データではありません");
    const d = data as SavedGame;
    if (d.version !== 1 || !Array.isArray(d.moves) || d.moves.length > 1024 || (d.ending !== undefined && !["resign", "agreement"].includes(d.ending))) throw new Error("対応していない保存データです");
    const game = new ShogiGame();
    for (const move of d.moves) { if (!move || typeof move !== "object" || !Number.isInteger(move.to) || typeof move.promote !== "boolean") throw new Error("指し手が壊れています"); game.play(move); }
    if (d.ending === "resign") game.resign(); if (d.ending === "agreement") game.agreeDraw();
    return game;
  }
}
