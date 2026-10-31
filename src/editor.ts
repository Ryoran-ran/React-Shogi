import { emptyPosition, initialPosition, setupIssues, validateBoardSize, validatePosition } from "./shogi";
import type { Piece, Position, Side } from "./shogi";
import { loadPieceRules, updatePieceMovements, resetPieceMovements, isRoyal, handTypes } from "./pieces";
import type { PieceRules, PieceType, PieceAction, PieceMovement } from "./pieces";
import { loadRuleScript, validateRuleScript } from "./rulescript";
import { validateScriptData } from "./scriptconfig";
import type { ScriptData } from "./scriptconfig";
import { boardSettings, configuredBoardSettings } from "./boardsettings";
import type { BoardSettings } from "./boardsettings";
export interface EditorSnapshot { position: Position; rules: PieceRules; script: string }
export interface PieceRegion { width: number; height: number; cells: Array<Piece | null> }

export class BoardEditor {
  private draft: Position;
  private rules: PieceRules;
  private script: string;
  private history: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];
  constructor(position: Position, rules?: PieceRules, ruleScript = "") { this.rules = loadPieceRules(rules); this.script = loadRuleScript(ruleScript); validatePosition(position, this.rules); this.draft = structuredClone(position); }
  get position(): Position { return structuredClone(this.draft); }
  get pieceRules(): PieceRules { return structuredClone(this.rules); }
  get ruleScript(): string { return this.script; }
  get canUndo(): boolean { return this.history.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get snapshot(): EditorSnapshot { return { position: this.position, rules: this.pieceRules, script: this.script }; }
  get issues(): string[] { try { return setupIssues(this.draft, this.rules, this.script); } catch (error) { return [(error as Error).message]; } }
  private commit(next: Position, rules = this.rules, script = this.script): void {
    validatePosition(next, rules);
    if (JSON.stringify(next) === JSON.stringify(this.draft) && JSON.stringify(rules) === JSON.stringify(this.rules) && script === this.script) return;
    this.history.push({ position: this.draft, rules: this.rules, script: this.script });
    this.future = [];
    if (this.history.length > 100) this.history.shift();
    this.draft = structuredClone(next);
    this.rules = structuredClone(rules);
    this.script = script;
  }
  resize(width: number, height: number): void {
    validateBoardSize(width, height);
    const next = emptyPosition(width, height);
    next.turn = this.draft.turn; next.hands = structuredClone(this.draft.hands);
    if (this.draft.settings) next.settings = { ...this.draft.settings, promotionDepth: this.draft.settings.promotionDepth === null ? null : Math.min(height, this.draft.settings.promotionDepth) };
    for (let y = 0; y < Math.min(height, this.draft.height); y++) for (let x = 0; x < Math.min(width, this.draft.width); x++) next.board[y * width + x] = this.draft.board[y * this.draft.width + x];
    this.commit(next);
  }
  place(index: number, piece: Piece | null): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.draft.board.length) throw new Error("盤面のマスを選んでください");
    const next = this.position;
    if (piece && isRoyal(piece.type, this.rules)) next.board = next.board.map(p => p && isRoyal(p.type, this.rules) && p.side === piece.side ? null : p);
    next.board[index] = piece;
    this.commit(next);
  }
  setTurn(side: Side): void { const next = this.position; next.turn = side; this.commit(next); }
  clear(): void { const next = emptyPosition(this.draft.width, this.draft.height); next.turn = this.draft.turn; if (this.draft.settings) next.settings = structuredClone(this.draft.settings); this.commit(next); }
  setSettings(change: Partial<BoardSettings>): void { const next = this.position, settings = configuredBoardSettings({ ...boardSettings(next), ...change }); if (settings) next.settings = settings; else delete next.settings; this.commit(next); }
  setHand(side: Side, type: PieceType, count: number): void {
    if (!["sente", "gote"].includes(side) || !handTypes(this.rules).includes(type) || isRoyal(type, this.rules) || !Number.isSafeInteger(count) || count < 0 || count > 225) throw new Error("持ち駒は0〜225枚で設定してください");
    const next = this.position; next.hands[side][type] = count; this.commit(next);
  }
  setPieceData(index: number, data: ScriptData): void {
    validateScriptData(data); const next = this.position;
    if (!next.board[index]) throw new Error("データを設定する駒を選んでください");
    next.board[index] = { ...next.board[index]!, data: structuredClone(data) }; this.commit(next);
  }
  move(from: number, to: number): void {
    const next = this.position;
    if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < next.board.length) || !next.board[from]) throw new Error("移動元の駒と移動先を選んでください");
    if (from === to) return; next.board[to] = next.board[from]; next.board[from] = null; this.commit(next);
  }
  copyRegion(first: number, last: number): PieceRegion {
    const p = this.draft;
    if (![first,last].every(index => Number.isInteger(index) && index >= 0 && index < p.board.length)) throw new Error("コピーする範囲を選んでください");
    const left = Math.min(first % p.width, last % p.width), top = Math.min(Math.floor(first / p.width), Math.floor(last / p.width));
    const width = Math.abs(first % p.width - last % p.width) + 1, height = Math.abs(Math.floor(first / p.width) - Math.floor(last / p.width)) + 1;
    return { width, height, cells: Array.from({length: width * height}, (_, index) => structuredClone(p.board[(top + Math.floor(index / width)) * p.width + left + index % width])) };
  }
  pasteRegion(origin: number, region: PieceRegion): void {
    const next = this.position, x = origin % next.width, y = Math.floor(origin / next.width);
    if (!Number.isInteger(origin) || origin < 0 || !region || !Number.isInteger(region.width) || !Number.isInteger(region.height) || region.width < 1 || region.height < 1 || !Array.isArray(region.cells) || region.cells.length !== region.width * region.height || x + region.width > next.width || y + region.height > next.height) throw new Error("コピー範囲が盤面に収まりません");
    for (let index = 0; index < region.cells.length; index++) next.board[(y + Math.floor(index / region.width)) * next.width + x + index % region.width] = structuredClone(region.cells[index]);
    this.commit(next);
  }
  mirror(axis: "horizontal" | "vertical"): void {
    const next = this.position, original = this.position;
    for (let y = 0; y < next.height; y++) for (let x = 0; x < next.width; x++) next.board[y * next.width + x] = original.board[(axis === "vertical" ? next.height - 1 - y : y) * next.width + (axis === "horizontal" ? next.width - 1 - x : x)];
    this.commit(next);
  }
  swapSides(): void {
    const next = this.position; next.board = next.board.reverse().map(piece => piece ? { ...piece, side: piece.side === "sente" ? "gote" : "sente" } : null);
    next.hands = { sente: next.hands.gote, gote: next.hands.sente }; next.turn = next.turn === "sente" ? "gote" : "sente"; this.commit(next);
  }
  setPieceMovements(type: PieceType, promoted: boolean, action: PieceAction, movements: readonly PieceMovement[]): void {
    this.commit(this.position, updatePieceMovements(this.rules, type, promoted, action, movements));
  }
  resetPieceMovements(type: PieceType, promoted: boolean): void {
    this.commit(this.position, resetPieceMovements(this.rules, type, promoted));
  }
  setPieceRules(rules: PieceRules): void {
    const normalized = loadPieceRules(rules), next = this.position;
    if (isRoyal("K", normalized)) for (const side of ["sente", "gote"] as Side[]) {
      if (next.hands[side].K === 0) delete (next.hands[side] as Partial<typeof next.hands[typeof side]>).K;
    }
    this.commit(next, normalized);
  }
  setRuleScript(source: string): void { source = loadRuleScript(source); validateRuleScript(source, this.rules); this.commit(this.position, this.rules, source); }
  reset(position = initialPosition(), rules = this.rules, ruleScript = this.script): void { this.commit(position, loadPieceRules(rules), loadRuleScript(ruleScript)); }
  undo(): void { const previous = this.history.pop(); if (previous) { this.future.push(this.snapshot); this.draft = previous.position; this.rules = previous.rules; this.script = previous.script; } }
  redo(): void { const next = this.future.pop(); if (next) { this.history.push(this.snapshot); this.draft = next.position; this.rules = next.rules; this.script = next.script; } }
}
