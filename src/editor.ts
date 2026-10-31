import { emptyPosition, initialPosition, setupIssues, validateBoardSize, validatePosition } from "./shogi";
import type { Piece, Position, Side } from "./shogi";

export class BoardEditor {
  private draft: Position;
  private history: Position[] = [];
  constructor(position: Position) { validatePosition(position); this.draft = structuredClone(position); }
  get position(): Position { return structuredClone(this.draft); }
  get canUndo(): boolean { return this.history.length > 0; }
  get issues(): string[] { return setupIssues(this.draft); }
  private commit(next: Position): void {
    validatePosition(next);
    if (JSON.stringify(next) === JSON.stringify(this.draft)) return;
    this.history.push(this.draft);
    if (this.history.length > 100) this.history.shift();
    this.draft = structuredClone(next);
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
  reset(position = initialPosition()): void { this.commit(position); }
  undo(): void { const previous = this.history.pop(); if (previous) this.draft = previous; }
}
