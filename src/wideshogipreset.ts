import { emptyPosition, initialPosition } from "./shogi";
import { createSetup } from "./setups";
import type { SavedSetup } from "./setups";

/** Standard shogi in the middle, with three playable outside files on each side. */
export function createWideShogiPreset(): SavedSetup {
  const standard = initialPosition(), margin = 3;
  const position = emptyPosition(standard.width + margin * 2, standard.height);
  position.outsideMargin = margin;
  position.outsideHorizontalOnly = true;
  for (let y = 0; y < standard.height; y++) for (let x = 0; x < standard.width; x++) {
    position.board[y * position.width + x + margin] = standard.board[y * standard.width + x];
  }
  return createSetup(position, 0, "横長将棋");
}
