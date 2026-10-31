import { pieceDesign, pieceState, isBuiltinPiece } from "./pieces";
import type { PieceRules, PieceType, DesignSide } from "./pieces";

export function escapePieceText(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!)); }
export function renderPiece(piece: { type: PieceType; side: DesignSide; promoted: boolean }, rules?: PieceRules, options: { inverted?: boolean; mini?: boolean; compact?: boolean } = {}): string {
  const state = pieceState(piece, rules), design = pieceDesign(piece, rules);
  const designed = !isBuiltinPiece(piece.type) || !!rules?.[piece.type]?.design?.[piece.promoted ? "promoted" : "normal"]?.[piece.side];
  const text = options.compact && !designed ? piece.side === "gote" ? state.goteName ?? state.name : state.name : design.text;
  const length = Math.max(1, [...text].length), classes = `${options.mini ? "mini-piece" : "piece"} ${length > 1 ? "long-name" : ""} ${options.inverted ? "inverted" : ""} ${piece.promoted ? "promoted" : ""} ${designed ? `piece-designed piece-shape-${design.shape}` : ""}`;
  const style = designed ? ` style="background:${escapePieceText(design.fill)};--piece-text-length:${length}"` : "";
  const textStyle = designed ? ` style="color:${escapePieceText(design.color)}${length > 2 ? ";font-size:calc(var(--piece-glyph-space,40px) / var(--piece-text-length))" : ""}"` : "";
  return `<span class="${classes}"${style}><span${textStyle}>${escapePieceText(text)}</span></span>`;
}
