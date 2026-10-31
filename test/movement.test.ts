import { describe, expect, test } from "bun:test";
import { pieceDestinations, traceMovement } from "../src/movement";
import { PIECE_DEFINITIONS, pieceState } from "../src/pieces";
import type { PieceStateDefinition } from "../src/pieces";
import { emptyPosition } from "../src/shogi";
import type { Position, Side } from "../src/shogi";

type Rules = Pick<PieceStateDefinition, "moves" | "captures">;
const at = (position: Position, x: number, y: number) => y * position.width + x;
function withPiece(side: Side = "sente", width = 7, height = 7): Position {
  const position = emptyPosition(width, height);
  position.board[at(position, 3, 3)] = { type: "P", side, promoted: false };
  return position;
}
const pawn: Rules = {
  moves: [{ dx: 0, dy: 1, range: 1 }],
  captures: [{ dx: -1, dy: 1, range: 1 }, { dx: 1, dy: 1, range: 1 }],
};

describe("independent movement and capture rules", () => {
  test("a pawn-like piece advances into empty squares and captures diagonally for both sides", () => {
    for (const side of ["sente", "gote"] as Side[]) {
      const position = withPiece(side), from = at(position, 3, 3), row = side === "sente" ? 2 : 4;
      const forward = at(position, 3, row), left = at(position, 2, row), right = at(position, 4, row);
      expect(pieceDestinations(position, from, pawn)).toEqual([forward]);
      // Empty capture squares remain attacked even though they cannot be used for movement.
      expect(traceMovement(position, from, pawn.captures)).toEqual([left, right]);
      expect(traceMovement(position, from, pawn.captures)).not.toContain(forward);
      position.board[left] = { type: "S", side: side === "sente" ? "gote" : "sente", promoted: false };
      position.board[right] = { type: "G", side, promoted: false };
      expect(pieceDestinations(position, from, pawn)).toEqual([forward, left]);
      // Defended friendly squares still belong to the capture reach used for king safety.
      expect(traceMovement(position, from, pawn.captures)).toContain(right);
      for (const blocker of [side, side === "sente" ? "gote" : "sente"] as Side[]) {
        position.board[forward] = { type: "P", side: blocker, promoted: false };
        expect(pieceDestinations(position, from, pawn)).toEqual([left]);
      }
    }
  });

  test("empty lists allow movement-only, capture-only and immobile pieces", () => {
    const position = withPiece(), from = at(position, 3, 3), forward = at(position, 3, 2);
    const movementOnly: Rules = { moves: pawn.moves, captures: [] };
    const captureOnly: Rules = { moves: [], captures: pawn.moves };
    expect(pieceDestinations(position, from, movementOnly)).toEqual([forward]);
    expect(traceMovement(position, from, movementOnly.captures)).toEqual([]);
    expect(pieceDestinations(position, from, captureOnly)).toEqual([]);
    expect(traceMovement(position, from, captureOnly.captures)).toEqual([forward]);
    position.board[forward] = { type: "R", side: "gote", promoted: false };
    expect(pieceDestinations(position, from, movementOnly)).toEqual([]);
    expect(pieceDestinations(position, from, captureOnly)).toEqual([forward]);
    expect(pieceDestinations(position, from, { moves: [], captures: [] })).toEqual([]);
  });

  test("movement and capture rays each stop at the first piece, even when it cannot be taken", () => {
    const position = withPiece(), from = at(position, 3, 3);
    const rules: Rules = { moves: [{ dx: 1, dy: 0, range: null }], captures: [{ dx: 0, dy: 1, range: null }] };
    position.board[at(position, 5, 3)] = { type: "S", side: "gote", promoted: false };
    position.board[at(position, 3, 1)] = { type: "S", side: "gote", promoted: false };
    expect(pieceDestinations(position, from, rules)).toEqual([at(position, 4, 3), at(position, 3, 1)]);
    expect(traceMovement(position, from, rules.captures)).toEqual([at(position, 3, 2), at(position, 3, 1)]);
    position.board[at(position, 3, 2)] = { type: "G", side: "sente", promoted: false };
    expect(pieceDestinations(position, from, rules)).toEqual([at(position, 4, 3)]);
    expect(traceMovement(position, from, rules.captures)).toEqual([at(position, 3, 2)]);
  });

  test("finite ranges, jumping offsets and rectangular bounds work separately for each action", () => {
    const position = withPiece("sente", 5, 7), from = at(position, 3, 3);
    const rules: Rules = { moves: [{ dx: -1, dy: 0, range: 2 }], captures: [{ dx: -1, dy: 2, range: 1 }, { dx: 1, dy: 2, range: 1 }] };
    position.board[at(position, 3, 2)] = { type: "P", side: "sente", promoted: false };
    position.board[at(position, 2, 2)] = { type: "P", side: "gote", promoted: false };
    position.board[at(position, 2, 1)] = { type: "R", side: "gote", promoted: false };
    expect(pieceDestinations(position, from, rules)).toEqual([at(position, 2, 3), at(position, 1, 3), at(position, 2, 1)]);
    expect(traceMovement(position, from, rules.captures)).toEqual([at(position, 2, 1), at(position, 4, 1)]);
    expect(traceMovement(position, from, [{ dx: 1, dy: 0, range: null }])).toEqual([at(position, 4, 3)]);
    expect(pieceDestinations(position, 0, rules)).toEqual([]);
  });

  test("overlapping directions produce each landing square once and use the selected promoted state", () => {
    const position = withPiece(), from = at(position, 3, 3);
    const original = PIECE_DEFINITIONS.P;
    const definition = { ...original, moves: pawn.moves, captures: pawn.captures };
    expect(pieceDestinations(position, from, definition)).toEqual([at(position, 3, 2)]);
    position.board[from]!.promoted = true;
    const promoted = pieceState(position.board[from]!);
    const repeated: Rules = { moves: [...promoted.moves, ...promoted.moves], captures: [...promoted.captures, ...promoted.captures] };
    expect(pieceDestinations(position, from, repeated)).toEqual([
      at(position, 2, 2), at(position, 3, 2), at(position, 4, 2), at(position, 2, 3), at(position, 4, 3), at(position, 3, 4),
    ]);
  });
});
