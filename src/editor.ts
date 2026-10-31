import { emptyPosition, initialPosition, setupIssues, validateBoardSize, validatePosition } from "./shogi";
import type { Piece, Position, Side } from "./shogi";
import { loadPieceRules, updatePieceMovements, resetPieceMovements } from "./pieces";
import type { PieceRules, PieceType, PieceAction, PieceMovement } from "./pieces";
import { loadRuleScript, validateRuleScript } from "./rulescript";

export class BoardEditor {
  private draft: Position;
  private rules: PieceRules;
  private script: string;
  private history: Array<{ position: Position; rules: PieceRules; script: string }> = [];
  constructor(position: Position, rules?: PieceRules, ruleScript = "") { this.rules = loadPieceRules(rules); this.script = loadRuleScript(ruleScript); validatePosition(position, this.rules); this.draft = structuredClone(position); }
  get position(): Position { return structuredClone(this.draft); }
  get pieceRules(): PieceRules { return structuredClone(this.rules); }
  get ruleScript(): string { return this.script; }
  get canUndo(): boolean { return this.history.length > 0; }
  get issues(): string[] { try { return setupIssues(this.draft, this.rules, this.script); } catch (error) { return [(error as Error).message]; } }
  private commit(next: Position, rules = this.rules, script = this.script): void {
    validatePosition(next, rules);
    if (JSON.stringify(next) === JSON.stringify(this.draft) && JSON.stringify(rules) === JSON.stringify(this.rules) && script === this.script) return;
    this.history.push({ position: this.draft, rules: this.rules, script: this.script });
    if (this.history.length > 100) this.history.shift();
    this.draft = structuredClone(next);
    this.rules = structuredClone(rules);
    this.script = script;
  }
  resize(width: number, height: number): void {
    validateBoardSize(width, height);
    const next = emptyPosition(width, height);
    next.turn = this.draft.turn; next.hands = structuredClone(this.draft.hands);
    for (let y = 0; y < Math.min(height, this.draft.height); y++) for (let x = 0; x < Math.min(width, this.draft.width); x++) next.board[y * width + x] = this.draft.board[y * this.draft.width + x];
    this.commit(next);
  }
  place(index: number, piece: Piece | null): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.draft.board.length) throw new Error("盤面のマスを選んでください");
    const next = this.position;
    if (piece?.type === "K") next.board = next.board.map(p => p?.type === "K" && p.side === piece.side ? null : p);
    next.board[index] = piece;
    this.commit(next);
  }
  setTurn(side: Side): void { const next = this.position; next.turn = side; this.commit(next); }
  clear(): void { const next = emptyPosition(this.draft.width, this.draft.height); next.turn = this.draft.turn; this.commit(next); }
  setPieceMovements(type: PieceType, promoted: boolean, action: PieceAction, movements: readonly PieceMovement[]): void {
    this.commit(this.position, updatePieceMovements(this.rules, type, promoted, action, movements));
  }
  resetPieceMovements(type: PieceType, promoted: boolean): void {
    this.commit(this.position, resetPieceMovements(this.rules, type, promoted));
  }
  setPieceRules(rules: PieceRules): void { this.commit(this.position, loadPieceRules(rules)); }
  setRuleScript(source: string): void { source = loadRuleScript(source); validateRuleScript(source, this.rules); this.commit(this.position, this.rules, source); }
  reset(position = initialPosition(), rules = this.rules, ruleScript = this.script): void { this.commit(position, loadPieceRules(rules), loadRuleScript(ruleScript)); }
  undo(): void { const previous = this.history.pop(); if (previous) { this.draft = previous.position; this.rules = previous.rules; this.script = previous.script; } }
}
