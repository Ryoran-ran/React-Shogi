/** The backing grid includes the playable outside squares around the inner board. */
export interface BoardGeometry { width: number; height: number; outsideMargin?: number; outsideHorizontalOnly?: true }
export const MAX_OUTSIDE_MARGIN = 3;

export function verticalOutsideMargin(position: BoardGeometry): number {
  return position.outsideHorizontalOnly ? 0 : position.outsideMargin ?? 0;
}

export function boardArea(position: BoardGeometry): { margin: number; width: number; height: number } {
  const margin = position.outsideMargin ?? 0;
  return { margin, width: position.width - margin * 2, height: position.height - verticalOutsideMargin(position) * 2 };
}

export function isOutsideSquare(position: BoardGeometry, index: number): boolean {
  const { margin } = boardArea(position), x = index % position.width, y = Math.floor(index / position.width);
  const marginY = verticalOutsideMargin(position);
  return x < margin || x >= position.width - margin || y < marginY || y >= position.height - marginY;
}

/** Coordinates start at (1, 1) at the inner board's upper left, and extend outside it. */
export function boardCoordinates(position: BoardGeometry, index: number): { x: number; y: number } {
  const { margin } = boardArea(position);
  return { x: index % position.width - margin + 1, y: Math.floor(index / position.width) - verticalOutsideMargin(position) + 1 };
}

export function outsideSquareLabel(position: BoardGeometry, index: number): string {
  const { x, y } = boardCoordinates(position, index);
  return `場外(${x},${y})`;
}
