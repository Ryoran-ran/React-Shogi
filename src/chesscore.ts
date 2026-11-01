import { Chess, DEFAULT_POSITION, SQUARES } from "chess.js";
import type { Color, PieceSymbol, Square, Move } from "chess.js";
export { Chess, DEFAULT_POSITION, SQUARES };
export type { Color, PieceSymbol, Square, Move };

export const CHESS_COLORS = { w: "白", b: "黒" } as const;
export const CHESS_NAMES = { k: "キング", q: "クイーン", r: "ルーク", b: "ビショップ", n: "ナイト", p: "ポーン" } as const;
export const CHESS_GLYPHS = { w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" }, b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" } } as const;
export const PROMOTIONS = ["q", "r", "b", "n"] as const;
export type Promotion = typeof PROMOTIONS[number];
export interface ChessRules { castling: boolean; enPassant: boolean; pawnDouble: boolean; drawClaims: boolean; automaticDraws: boolean; promotions: Promotion[] }
export const DEFAULT_CHESS_RULES: Readonly<ChessRules> = Object.freeze({ castling: true, enPassant: true, pawnDouble: true, drawClaims: true, automaticDraws: true, promotions: Object.freeze([...PROMOTIONS]) as unknown as Promotion[] });
export interface ChessSetup { kind: "chess-setup"; version: 1; name: string; fen: string; rules: ChessRules }
export interface ChessAction { from: Square; to: Square; promotion?: Promotion }
export type ChessReason = "checkmate" | "stalemate" | "insufficient" | "fivefold" | "seventyFive" | "threefold" | "fifty" | "resign" | "resignDraw" | "agreement" | "imported";
export interface ChessResult { winner: Color | null; reason: ChessReason }
export interface ChessSave { kind: "chess-game"; version: 1; setup: ChessSetup; moves: ChessAction[]; ending?: { result: ChessResult; intended?: ChessAction } }
export const oppositeColor = (color: Color): Color => color === "w" ? "b" : "w";
export const chessAction = (move: Pick<Move, "from" | "to" | "promotion">): ChessAction => ({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion as Promotion } : {}) });

export function loadChessRules(data: unknown = {}): ChessRules {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("チェスのルール設定が壊れています");
  const raw = data as Record<string, unknown>;
  if (Object.keys(raw).some(key => !Object.hasOwn(DEFAULT_CHESS_RULES, key))) throw new Error("不明なチェスのルールです");
  for (const key of ["castling", "enPassant", "pawnDouble", "drawClaims", "automaticDraws"] as const) if (raw[key] !== undefined && typeof raw[key] !== "boolean") throw new Error("チェスのルールは有効・無効で設定してください");
  const promotions = raw.promotions ?? [...PROMOTIONS];
  if (!Array.isArray(promotions) || !promotions.length || promotions.length > 4 || new Set(promotions).size !== promotions.length || promotions.some(value => !PROMOTIONS.includes(value))) throw new Error("昇格先はクイーン・ルーク・ビショップ・ナイトから1種類以上選んでください");
  return { ...DEFAULT_CHESS_RULES, ...raw, promotions: [...promotions] } as ChessRules;
}
export function validChessFen(fen: unknown): string {
  if (typeof fen !== "string" || fen.length > 200) throw new Error("チェスの初期配置（FEN）を確認してください");
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6 || !fields.slice(4).every(value => /^\d+$/.test(value) && Number(value) <= 10000)) throw new Error("FENは盤面・手番・キャスリング・アンパッサン・半手数・手数の6項目で指定してください");
  let engine: Chess;
  try { engine = new Chess(fields.join(" ")); } catch (error) { throw new Error(`チェスの初期配置が不正です：${(error as Error).message}`); }
  const other = oppositeColor(engine.turn()), king = engine.findPiece({type:"k",color:other})[0];
  if (engine.isAttacked(king, engine.turn())) throw new Error("手番ではない側のキングがチェックされています");
  for (const [symbol, color, kingSquare, rookSquare] of [["K","w","e1","h1"],["Q","w","e1","a1"],["k","b","e8","h8"],["q","b","e8","a8"]] as const) if (fields[2].includes(symbol)) {
    if (engine.get(kingSquare)?.type !== "k" || engine.get(kingSquare)?.color !== color || engine.get(rookSquare)?.type !== "r" || engine.get(rookSquare)?.color !== color) throw new Error("キャスリング権に対応するキングとルークを初期位置に置いてください");
  }
  if (fields[3] !== "-") {
    const file = fields[3][0], rank = engine.turn() === "w" ? "5" : "4", start = engine.turn() === "w" ? "7" : "2";
    const pawn = engine.get(`${file}${rank}` as Square);
    if (engine.get(fields[3] as Square) || pawn?.type !== "p" || pawn.color !== other || engine.get(`${file}${start}` as Square)) throw new Error("アンパッサンの対象となるポーンの配置が不正です");
  }
  return engine.fen();
}
export function createChessSetup(fen: unknown = DEFAULT_POSITION, rules: unknown = {}, name = "チェス"): ChessSetup {
  if (typeof name !== "string" || name.length > 80) throw new Error("配置名は80文字以内にしてください");
  return { kind:"chess-setup",version:1,name:name.trim() || "チェス",fen:validChessFen(fen),rules:loadChessRules(rules) };
}
export function loadChessSetup(data: unknown): ChessSetup {
  const raw = data as ChessSetup;
  if (!raw || raw.kind !== "chess-setup" || raw.version !== 1) throw new Error("チェスの配置ファイルではありません");
  return createChessSetup(raw.fen, raw.rules, raw.name);
}
/** Apply variant switches to the chess engine's legal moves, without exposing its mutable board. */
export function chessMoves(engine: Chess, rules: ChessRules, square?: Square): Move[] {
  return engine.moves({verbose:true,...(square ? {square} : {})}).filter(move =>
    (rules.castling || (!move.isKingsideCastle() && !move.isQueensideCastle())) &&
    (rules.enPassant || !move.isEnPassant()) && (rules.pawnDouble || !move.isBigPawn()) &&
    (!move.promotion || rules.promotions.includes(move.promotion as Promotion)));
}
export function chessPositionKey(engine: Chess, rules: ChessRules): string {
  const fields = engine.fen().split(" ");
  if (!rules.castling) fields[2] = "-";
  if (!rules.enPassant || fields[3] !== "-" && !chessMoves(engine, rules).some(move => move.isEnPassant())) fields[3] = "-";
  return fields.slice(0,4).join(" ");
}
export class ChessGame {
  private engine: Chess;
  private initial: ChessSetup;
  private keys: string[] = [];
  private terminal: ChessSave["ending"];
  constructor(setup: ChessSetup = createChessSetup()) { this.initial = loadChessSetup(setup); this.engine = new Chess(this.initial.fen); this.keys.push(chessPositionKey(this.engine,this.initial.rules)); }
  get setup(): ChessSetup { return structuredClone(this.initial); }
  get fen(): string { return this.engine.fen(); }
  get turn(): Color { return this.engine.turn(); }
  get inCheck(): boolean { return this.engine.inCheck(); }
  get board() { return this.engine.board().flat().map(piece => piece ? {...piece} : null); }
  get records(): Move[] { return this.engine.history({verbose:true}); }
  get moveCount(): number { return this.keys.length - 1; }
  get halfMoves(): number { return Number(this.fen.split(" ")[4]); }
  get repetitions(): number { const key = this.keys.at(-1); return this.keys.filter(item => item === key).length; }
  get positionHistory(): string[] { return [...this.keys]; }
  piece(square: Square) { const piece = this.engine.get(square); return piece ? {...piece} : undefined; }
  private automaticResult(): ChessResult | null {
    if (!chessMoves(this.engine,this.initial.rules).length) return this.inCheck ? {winner:oppositeColor(this.turn),reason:"checkmate"} : {winner:null,reason:"stalemate"};
    if (this.engine.isInsufficientMaterial()) return {winner:null,reason:"insufficient"};
    if (this.initial.rules.automaticDraws && this.repetitions >= 5) return {winner:null,reason:"fivefold"};
    if (this.initial.rules.automaticDraws && this.halfMoves >= 150) return {winner:null,reason:"seventyFive"};
    return null;
  }
  get result(): ChessResult | null { return this.terminal ? structuredClone(this.terminal.result) : this.automaticResult(); }
  legalMoves(square?: Square): Move[] { return this.result ? [] : chessMoves(this.engine,this.initial.rules,square); }
  play(action: ChessAction): Move {
    if (this.result) throw new Error("対局は終了しています");
    const found = chessMoves(this.engine,this.initial.rules).find(move => move.from === action.from && move.to === action.to && move.promotion === action.promotion);
    if (!found) throw new Error("その手は指せません");
    const move = this.engine.move(chessAction(found)); this.keys.push(chessPositionKey(this.engine,this.initial.rules)); return move;
  }
  undo(): boolean { if (this.terminal) { this.terminal = undefined; return true; } if (!this.engine.undo()) return false; this.keys.pop(); return true; }
  private claimReason(): "threefold" | "fifty" | null { return this.repetitions >= 3 ? "threefold" : this.halfMoves >= 100 ? "fifty" : null; }
  get canClaimDraw(): boolean { return this.initial.rules.drawClaims && !this.result && this.claimReason() !== null; }
  claimDraw(intended?: ChessAction): void {
    if (this.result || !this.initial.rules.drawClaims) throw new Error("引き分けを申請できません");
    let reason = this.claimReason();
    if (intended) {
      this.play(intended); reason = this.claimReason(); this.engine.undo(); this.keys.pop();
    }
    if (!reason) throw new Error("同一局面3回または50手ルールの条件を満たしていません");
    this.terminal = {result:{winner:null,reason},...(intended ? {intended:structuredClone(intended)} : {})};
  }
  get claimableMoves(): ChessAction[] {
    if (!this.initial.rules.drawClaims || this.result) return [];
    if (this.halfMoves < 99 && new Set(this.keys).size === this.keys.length) return [];
    return chessMoves(this.engine,this.initial.rules).filter(move => {
      this.engine.move(chessAction(move)); const key=chessPositionKey(this.engine,this.initial.rules);
      const claimable=this.keys.filter(item=>item===key).length >= 2 || Number(this.engine.fen().split(" ")[4]) >= 100;
      this.engine.undo(); return claimable;
    }).map(chessAction);
  }
  resign(): void { if (!this.result) { const winner=oppositeColor(this.turn),canMate=this.board.some(piece=>piece?.color===winner&&piece.type!=="k");this.terminal={result:canMate?{winner,reason:"resign"}:{winner:null,reason:"resignDraw"}}; } }
  agreeDraw(): void { if (!this.result) this.terminal={result:{winner:null,reason:"agreement"}}; }
  pgn(): string {
    const engine = new Chess(this.initial.fen);
    engine.setHeader("Event", this.initial.name); engine.setHeader("White","White"); engine.setHeader("Black","Black");
    if (JSON.stringify(this.initial.rules) !== JSON.stringify(loadChessRules())) engine.setHeader("Variant","Custom rules");
    for (const move of this.records) engine.move(chessAction(move));
    const result=this.result; engine.setHeader("Result",result ? result.winner === "w" ? "1-0" : result.winner === "b" ? "0-1" : "1/2-1/2" : "*");
    return engine.pgn({maxWidth:80});
  }
  save(): ChessSave { return {kind:"chess-game",version:1,setup:this.setup,moves:this.records.map(chessAction),...(this.terminal ? {ending:structuredClone(this.terminal)} : {})}; }
  static load(data: unknown): ChessGame {
    const raw = data as ChessSave;
    if (!raw || raw.kind !== "chess-game" || raw.version !== 1 || !Array.isArray(raw.moves) || raw.moves.length > 2048) throw new Error("対応していないチェスの棋譜です");
    const game=new ChessGame(loadChessSetup(raw.setup));
    for (const move of raw.moves) { if (!move || typeof move !== "object" || Object.keys(move).some(key=>!["from","to","promotion"].includes(key))) throw new Error("チェスの指し手が壊れています"); game.play(move); }
    if (raw.ending) {
      if (game.result || !raw.ending.result || raw.ending.result.winner !== null && !["w","b"].includes(raw.ending.result.winner)) throw new Error("チェスの終局記録が壊れています");
      const reason=raw.ending.result.reason;
      if (reason === "resign" || reason === "resignDraw") game.resign(); else if (reason === "agreement") game.agreeDraw(); else if (reason === "threefold" || reason === "fifty") game.claimDraw(raw.ending.intended); else if(reason === "imported") game.terminal={result:structuredClone(raw.ending.result)}; else throw new Error("チェスの終局理由が壊れています");
      const resulting=game.terminal?.result;
      if (resulting?.winner !== raw.ending.result.winner || resulting?.reason !== raw.ending.result.reason) throw new Error("チェスの終局記録が一致しません");
    }
    return game;
  }
  static fromPGN(text: string): ChessGame {
    if (text.length > 500000) throw new Error("PGNファイルが大きすぎます");
    const engine=new Chess(); engine.loadPgn(text,{strict:true});
    if (engine.getHeaders().Variant && engine.getHeaders().Variant !== "Standard") throw new Error("独自ルールの棋譜はJSON形式で読み込んでください");
    const records=engine.history({verbose:true}); if(records.length>2048) throw new Error("棋譜は2048手までです");
    const game=new ChessGame(createChessSetup(records[0]?.before ?? engine.fen(),{},engine.getHeaders().Event ?? "チェス"));
    for (const move of records) game.play(chessAction(move));
    const result=engine.getHeaders().Result;
    if (["1-0","0-1","1/2-1/2"].includes(result)) {
      const winner=result === "1-0" ? "w" : result === "0-1" ? "b" : null;
      if (game.result && game.result.winner !== winner) throw new Error("PGNの対局結果が盤面と一致しません");
      if (!game.result) game.terminal={result:{winner,reason:"imported"}};
    }
    return game;
  }
}
