import { expect, test } from "bun:test";
import { renderBoardFrame } from "../src/boardview";
import type { BoardCellView } from "../src/boardview";
import { initialPosition } from "../src/shogi";
import type { Position } from "../src/shogi";
import { createWideShogiPreset } from "../src/wideshogipreset";

function render(position: Position, flipped = false): string {
  return renderBoardFrame(position, ({ index, classes, style }: BoardCellView) => {
    const piece = position.board[index];
    return `<button class="${classes}" data-cell="${index}"${style}>${piece ? `${piece.side}:${piece.type}` : ""}</button>`;
  }, { flipped });
}
function innerBoard(html: string): string {
  return html.split('<div class="board">')[1].split(/<div class="outside-layer"|<\/div><div class="rank-labels">/)[0].replace(/ data-cell="\d+"/g, "");
}

test("outside play leaves the visible board, coordinates, stars and initial pieces identical to standard shogi", () => {
  const standard = render(initialPosition()), wide = render(createWideShogiPreset().position);
  expect(innerBoard(wide)).toBe(innerBoard(standard));
  expect(wide.match(/class="square(?: |")/g)).toHaveLength(81);
  expect(wide.match(/class="outside-slot(?: |")/g)).toHaveLength(54);
  expect(wide).toContain('--board-width:9;--board-height:9');
  expect(wide).not.toContain('<span>外</span>');
  expect(wide.match(/<div class="file-labels">(.*?)<\/div>/)?.[1]).toBe(standard.match(/<div class="file-labels">(.*?)<\/div>/)?.[1]);
  expect(wide.match(/<div class="rank-labels">(.*?)<\/div>/)?.[1]).toBe(standard.match(/<div class="rank-labels">(.*?)<\/div>/)?.[1]);
});

test("outside pieces stay in the surrounding space and change sides visually when the board is flipped", () => {
  const position = createWideShogiPreset().position;
  position.board[119] = position.board[115]; position.board[115] = null;
  const html = render(position), flipped = render(position, true);
  expect(innerBoard(html)).not.toContain("sente:R");
  expect(html.split('class="outside-layer"')[1]).toContain("sente:R");
  expect(html).toContain('class="outside-slot outside-right" data-cell="119" style="grid-column:15;grid-row:8"');
  expect(flipped).toContain('class="outside-slot outside-left" data-cell="119" style="grid-column:1;grid-row:2"');
  expect(flipped.match(/class="square(?: |")/g)).toHaveLength(81);
});
