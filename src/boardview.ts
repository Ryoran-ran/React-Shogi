import { boardArea, isOutsideSquare, verticalOutsideMargin } from "./boardgeometry";
import type { BoardGeometry } from "./boardgeometry";
import { fileLabel, rankLabel } from "./shogi";

export function boardLayoutStyle(position: BoardGeometry): string {
  const area = boardArea(position);
  return `--board-width:${area.width};--board-height:${area.height};--outside-x:${area.margin};--outside-y:${verticalOutsideMargin(position)}`;
}

export interface BoardCellView { index: number; outside: boolean; classes: string; style: string }

/** Outside pieces extend over adjacent UI; only the inner board participates in layout. */
export function renderBoardFrame(
  position: BoardGeometry & { boardTheme?: "chess" },
  renderCell: (cell: BoardCellView) => string,
  options: { flipped?: boolean; editor?: boolean } = {},
): string {
  const { margin, width, height } = boardArea(position), marginY = verticalOutsideMargin(position);
  const indices = Array.from({ length: position.width * position.height }, (_, i) => options.flipped ? position.width * position.height - 1 - i : i);
  const inside: string[] = [], outside: string[] = [];
  for (const [display, index] of indices.entries()) {
    const x = display % position.width, y = Math.floor(display / position.width), offboard = isOutsideSquare(position, index);
    if (offboard) {
      const classes = ["outside-slot", x < margin ? "outside-left" : x >= position.width - margin ? "outside-right" : "", y < marginY ? "outside-top" : y >= position.height - marginY ? "outside-bottom" : ""].filter(Boolean).join(" ");
      outside.push(renderCell({ index, outside: true, classes, style: ` style="grid-column:${x + 1};grid-row:${y + 1}"` }));
    } else {
      const classes = ["square", x === position.width - margin - 1 ? "board-right-edge" : "", y === position.height - marginY - 1 ? "board-bottom-edge" : ""].filter(Boolean).join(" ");
      inside.push(renderCell({ index, outside: false, classes, style: "" }));
    }
  }
  const files = Array.from({ length: width }, (_, i) => position.boardTheme === "chess" ? String.fromCharCode(97 + (options.flipped ? width - i - 1 : i)) : fileLabel(options.flipped ? i + 1 : width - i));
  const ranks = Array.from({ length: height }, (_, i) => position.boardTheme === "chess" ? String(options.flipped ? i + 1 : height - i) : rankLabel(options.flipped ? height - i : i + 1));
  const stars = !options.editor && width === 9 && height === 9 && position.boardTheme !== "chess" ? '<i class="star s1"></i><i class="star s2"></i><i class="star s3"></i><i class="star s4"></i>' : "";
  const outsideLayer = outside.length ? `<div class="outside-layer" role="group" aria-label="盤外の配置先" style="--outside-columns:${position.width};--outside-rows:${position.height}">${outside.join("")}</div>` : "";
  const frame = `<div class="board-surround ${options.editor ? "editor-board-frame" : ""} ${position.boardTheme === "chess" ? "board-theme-chess" : ""}"><div class="file-labels">${files.map(label => `<span>${label}</span>`).join("")}</div><div class="board-and-ranks"><div class="board">${inside.join("")}${stars}${outsideLayer}</div><div class="rank-labels">${ranks.map(label => `<span>${label}</span>`).join("")}</div></div></div>`;
  return `<div class="board-exterior ${options.editor ? "editor-board-exterior" : ""}" style="${boardLayoutStyle(position)}">${frame}</div>`;
}
