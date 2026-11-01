export const PIECE_ICONS = ["king","queen","rook","bishop","knight","pawn"] as const;
export type PieceIcon = typeof PIECE_ICONS[number];
export const PIECE_ICON_NAMES: Record<PieceIcon,string> = {king:"キング",queen:"クイーン",rook:"ルーク",bishop:"ビショップ",knight:"ナイト",pawn:"ポーン"};

// Original, self-contained vector drawings. Fill and outline use the ordinary piece design colors.
const drawings: Record<PieceIcon,string> = {
  pawn: '<circle cx="40" cy="25" r="12"/><path d="M30 38h20v8c-7 7-8 15-7 22h10l7 12H20l7-12h10c1-7 0-15-7-22z"/><path d="M24 80h32l6 9v5H18v-5z"/><path d="M28 68h24M24 87h32" fill="none"/>',
  rook: '<path d="M19 14h11v10h6V14h8v10h6V14h11v23l-8 8 3 29 8 10v10H16V84l8-10 3-29-8-8z"/><path d="M20 37h40M27 45h26M24 74h32M20 84h40M22 89h36" fill="none"/>',
  bishop: '<path d="M40 9c-5 8-18 17-18 30 0 8 7 13 18 13s18-5 18-13c0-13-13-22-18-30z"/><path d="M44 22 32 37" fill="none"/><path d="M30 53h20l-4 18 13 11H21l13-11z"/><path d="M24 82h32l8 8v5H16v-5z"/><path d="M29 71h22M23 89h34" fill="none"/>',
  knight: '<path d="M22 79c-1-20 2-31 13-40l-9 5-9-6 8-14 15-8 3-10 8 10c17 4 23 17 20 34l-8 29z"/><path d="M22 79c18-8 27-17 28-31l-12 7-13-2-6-9 15-9" fill="none"/><circle cx="42" cy="27" r="2.2" stroke="none" fill="currentColor"/><path d="M53 24c9 11 9 23 4 36M25 80h34l7 10v5H17v-5z"/><path d="M24 89h34" fill="none"/>',
  queen: '<path d="m16 30 13 12 11-23 11 23 13-12-11 37H27z"/><circle cx="15" cy="24" r="5"/><circle cx="40" cy="13" r="5"/><circle cx="65" cy="24" r="5"/><path d="M27 66h26v7l10 13H17l10-13z"/><path d="M22 86h36l7 6v4H15v-4z"/><path d="M29 58h22M25 74h30M22 91h36" fill="none"/>',
  king: '<path d="M35 5h10v9h9v9h-9v10H35V23h-9v-9h9z"/><path d="M40 36c-12-13-27-2-21 12l9 17h24l9-17c6-14-9-25-21-12z"/><path d="M28 65h24v8l10 12H18l10-12z"/><path d="M23 85h34l8 7v4H15v-4z"/><path d="M40 37v20M29 57h22M26 73h28M23 90h34" fill="none"/>',
};
export function renderPieceIcon(icon: PieceIcon, fill: string, outline: string): string {
  if(!PIECE_ICONS.includes(icon)||![fill,outline].every(color=>/^#[0-9a-f]{6}$/i.test(color)))throw new Error("駒のシルエットや色が壊れています");
  return `<svg class="piece-icon" viewBox="0 0 80 100" aria-hidden="true" focusable="false" fill="${fill}" stroke="${outline}" style="color:${outline}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round">${drawings[icon]}</svg>`;
}
