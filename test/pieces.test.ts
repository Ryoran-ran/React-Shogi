import { describe, expect, test } from "bun:test";
import { PIECE_DEFINITIONS, PIECE_TYPES, HAND_TYPES, PIECE_NAMES, PIECE_LABELS, canPromote, pieceState } from "../src/pieces";
import { attacks, emptyPosition, legalMoves, pieceName, pieceLabel } from "../src/shogi";
import type { PieceType, Side } from "../src/shogi";

describe("built-in piece definitions", () => {
  test("the shogi preset can be copied as JSON independently of the built-in data", () => {
    const copy = JSON.parse(JSON.stringify(PIECE_DEFINITIONS));
    expect(copy).toEqual(PIECE_DEFINITIONS);
    copy.P.moves[0].dy = -1;
    copy.S.promotion.name = "別の成銀";
    expect(PIECE_DEFINITIONS.P.moves[0].dy).toBe(1);
    expect(PIECE_DEFINITIONS.S.promotion?.name).toBe("成銀");
    const editable = structuredClone(PIECE_DEFINITIONS);
    expect(editable.P.moves).not.toBe(editable.P.captures);
    expect(editable.P.moves[0]).not.toBe(editable.P.captures[0]);
    expect(editable.G.moves).not.toBe(editable.S.promotion?.moves);
    expect(editable.G.captures).not.toBe(editable.S.promotion?.captures);
    for (const definition of Object.values(PIECE_DEFINITIONS)) {
      expect(definition.captures).toEqual(definition.moves);
      if (definition.promotion) expect(definition.promotion.captures).toEqual(definition.promotion.moves);
    }
    expect(PIECE_TYPES).toEqual(["K", "R", "B", "G", "S", "N", "L", "P"]);
    expect(HAND_TYPES).toEqual(["R", "B", "G", "S", "N", "L", "P"]);
  });

  test("display names, promotion eligibility and material values agree for both players", () => {
    const expected: Array<[PieceType, string, string, number, { name: string; label: string; value: number }?]> = [
      ["K", "王", "王将", 20000], ["R", "飛", "飛車", 1000, { name: "龍", label: "龍王", value: 1400 }],
      ["B", "角", "角行", 850, { name: "馬", label: "龍馬", value: 1200 }], ["G", "金", "金将", 550],
      ["S", "銀", "銀将", 450, { name: "成銀", label: "成銀", value: 550 }],
      ["N", "桂", "桂馬", 320, { name: "成桂", label: "成桂", value: 550 }],
      ["L", "香", "香車", 300, { name: "成香", label: "成香", value: 550 }],
      ["P", "歩", "歩兵", 100, { name: "と", label: "と", value: 550 }],
    ];
    for (const [type, name, label, value, promotion] of expected) {
      expect(PIECE_NAMES[type]).toBe(name); expect(PIECE_LABELS[type]).toBe(label);
      expect(canPromote(type)).toBe(promotion !== undefined);
      for (const side of ["sente", "gote"] as Side[]) {
        const piece = { type, side, promoted: false };
        expect(pieceName(piece)).toBe(type === "K" && side === "gote" ? "玉" : name);
        expect(pieceLabel(piece)).toBe(type === "K" && side === "gote" ? "玉将" : label);
        expect(pieceState(piece).value).toBe(value);
        if (!promotion) continue;
        piece.promoted = true;
        expect(pieceName(piece)).toBe(promotion.name); expect(pieceLabel(piece)).toBe(promotion.label);
        expect(pieceState(piece).value).toBe(promotion.value);
      }
    }
  });

  test("asymmetric steps and jumps face the opponent, and promoted minor pieces move as golds", () => {
    const expected: Partial<Record<PieceType, number[]>> = {
      G: [30, 31, 32, 39, 41, 49], S: [30, 31, 32, 48, 50], N: [21, 23], P: [31],
    };
    for (const side of ["sente", "gote"] as Side[]) {
      const position = emptyPosition();
      for (const type of ["G", "S", "N", "P", "L"] as PieceType[]) {
        position.board[40] = { type, side, promoted: false };
        const forward = type === "L" ? [4, 13, 22, 31] : expected[type]!;
        const oriented = forward.map(index => side === "sente" ? index : (8 - Math.floor(index / 9)) * 9 + index % 9);
        expect(attacks(position, 40).sort((a, b) => a - b)).toEqual(oriented.sort((a, b) => a - b));
        if (type === "G") continue;
        position.board[40]!.promoted = true;
        const gold = expected.G!.map(index => side === "sente" ? index : (8 - Math.floor(index / 9)) * 9 + index % 9);
        expect(attacks(position, 40).sort((a, b) => a - b)).toEqual(gold.sort((a, b) => a - b));
      }
    }
  });

  test("dead-rank drop restrictions apply to each piece, side and board height", () => {
    const deadRanks = { R: 0, B: 0, G: 0, S: 0, N: 2, L: 1, P: 1 };
    for (const height of [3, 7, 15]) for (const side of ["sente", "gote"] as Side[]) {
      const position = emptyPosition(5, height); position.turn = side;
      position.board[0] = { type: "K", side: "gote", promoted: false };
      position.board[5 * height - 1] = { type: "K", side: "sente", promoted: false };
      for (const type of HAND_TYPES) position.hands[side][type] = 1;
      const moves = legalMoves(position);
      for (const type of HAND_TYPES) {
        const rows = moves.filter(move => move.drop === type && move.to % 5 === 2).map(move => Math.floor(move.to / 5));
        const expected = Array.from({ length: height }, (_, row) => row)
          .filter(row => (side === "sente" ? row : height - 1 - row) >= deadRanks[type]);
        expect(rows).toEqual(expected);
      }
    }
  });
});
