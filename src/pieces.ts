/** dx is positive to the board's right; dy is positive towards the opponent. */
export interface PieceMovement {
  readonly dx: number;
  readonly dy: number;
  /** Repeat this offset up to range times; null continues to the board's edge. */
  readonly range: number | null;
}

export interface PieceStateDefinition {
  readonly name: string;
  readonly label: string;
  readonly goteName?: string;
  readonly goteLabel?: string;
  readonly description: string;
  readonly moves: readonly PieceMovement[];
  readonly value: number;
}

export interface PieceDefinition extends PieceStateDefinition {
  readonly promotion?: PieceStateDefinition & {
    /** Number of ranks at the opponent's edge where an unpromoted piece cannot remain. */
    readonly forcedRanks: number;
  };
}

const goldMoves: readonly PieceMovement[] = [
  { dx: -1, dy: 1, range: 1 }, { dx: 0, dy: 1, range: 1 }, { dx: 1, dy: 1, range: 1 },
  { dx: -1, dy: 0, range: 1 }, { dx: 1, dy: 0, range: 1 }, { dx: 0, dy: -1, range: 1 },
];
const rookMoves: readonly PieceMovement[] = [
  { dx: 0, dy: 1, range: null }, { dx: 0, dy: -1, range: null },
  { dx: 1, dy: 0, range: null }, { dx: -1, dy: 0, range: null },
];
const bishopMoves: readonly PieceMovement[] = [
  { dx: 1, dy: 1, range: null }, { dx: 1, dy: -1, range: null },
  { dx: -1, dy: 1, range: null }, { dx: -1, dy: -1, range: null },
];
const goldDescription = "前と斜め前、横、真後ろに1マス進めます。";

// Plain, JSON-serializable data. The current shogi preset is shared by rules, UI and AI.
const definitions = {
  K: {
    name: "王", label: "王将", goteName: "玉", goteLabel: "玉将", value: 20000,
    description: "縦・横・斜めに1マス進めます。",
    moves: [
      { dx: -1, dy: -1, range: 1 }, { dx: -1, dy: 0, range: 1 }, { dx: -1, dy: 1, range: 1 },
      { dx: 0, dy: -1, range: 1 }, { dx: 0, dy: 1, range: 1 },
      { dx: 1, dy: -1, range: 1 }, { dx: 1, dy: 0, range: 1 }, { dx: 1, dy: 1, range: 1 },
    ],
  },
  R: {
    name: "飛", label: "飛車", value: 1000,
    description: "縦・横に、駒にぶつかるまで進めます。", moves: rookMoves,
    promotion: {
      name: "龍", label: "龍王", value: 1400, forcedRanks: 0,
      description: "縦・横に駒にぶつかるまで、斜めに1マス進めます。",
      moves: [...rookMoves,
        { dx: 1, dy: 1, range: 1 }, { dx: 1, dy: -1, range: 1 },
        { dx: -1, dy: 1, range: 1 }, { dx: -1, dy: -1, range: 1 },
      ],
    },
  },
  B: {
    name: "角", label: "角行", value: 850,
    description: "斜めに、駒にぶつかるまで進めます。", moves: bishopMoves,
    promotion: {
      name: "馬", label: "龍馬", value: 1200, forcedRanks: 0,
      description: "斜めに駒にぶつかるまで、縦・横に1マス進めます。",
      moves: [...bishopMoves,
        { dx: 0, dy: 1, range: 1 }, { dx: 0, dy: -1, range: 1 },
        { dx: 1, dy: 0, range: 1 }, { dx: -1, dy: 0, range: 1 },
      ],
    },
  },
  G: {
    name: "金", label: "金将", value: 550, description: goldDescription, moves: goldMoves,
  },
  S: {
    name: "銀", label: "銀将", value: 450,
    description: "前と斜め前、斜め後ろに1マス進めます。",
    moves: [
      { dx: -1, dy: 1, range: 1 }, { dx: 0, dy: 1, range: 1 }, { dx: 1, dy: 1, range: 1 },
      { dx: -1, dy: -1, range: 1 }, { dx: 1, dy: -1, range: 1 },
    ],
    promotion: {
      name: "成銀", label: "成銀", value: 550, forcedRanks: 0, description: goldDescription, moves: goldMoves,
    },
  },
  N: {
    name: "桂", label: "桂馬", value: 320,
    description: "前に2マス、横に1マス跳びます。",
    moves: [{ dx: -1, dy: 2, range: 1 }, { dx: 1, dy: 2, range: 1 }],
    promotion: {
      name: "成桂", label: "成桂", value: 550, forcedRanks: 2, description: goldDescription, moves: goldMoves,
    },
  },
  L: {
    name: "香", label: "香車", value: 300,
    description: "前に、駒にぶつかるまで進めます。", moves: [{ dx: 0, dy: 1, range: null }],
    promotion: {
      name: "成香", label: "成香", value: 550, forcedRanks: 1, description: goldDescription, moves: goldMoves,
    },
  },
  P: {
    name: "歩", label: "歩兵", value: 100,
    description: "前に1マス進めます。", moves: [{ dx: 0, dy: 1, range: 1 }],
    promotion: {
      name: "と", label: "と", value: 550, forcedRanks: 1, description: goldDescription, moves: goldMoves,
    },
  },
} satisfies Record<string, PieceDefinition>;

export type PieceType = keyof typeof definitions;
export type HandType = Exclude<PieceType, "K">;
export const PIECE_DEFINITIONS: Readonly<Record<PieceType, PieceDefinition>> = definitions;

// Editing a future variant must not mutate the built-in shogi preset.
for (const definition of Object.values(PIECE_DEFINITIONS)) {
  for (const state of [definition.promotion, definition]) {
    if (!state) continue;
    state.moves.forEach(Object.freeze);
    Object.freeze(state.moves);
    Object.freeze(state);
  }
}
Object.freeze(PIECE_DEFINITIONS);

export const PIECE_TYPES = Object.freeze(Object.keys(PIECE_DEFINITIONS) as PieceType[]);
export const HAND_TYPES = Object.freeze(PIECE_TYPES.filter((type): type is HandType => type !== "K"));
export const PIECE_NAMES = Object.freeze(Object.fromEntries(PIECE_TYPES.map(type => [type, PIECE_DEFINITIONS[type].name])) as Record<PieceType, string>);
export const PIECE_LABELS = Object.freeze(Object.fromEntries(PIECE_TYPES.map(type => [type, PIECE_DEFINITIONS[type].label])) as Record<PieceType, string>);
export const canPromote = (type: PieceType): boolean => PIECE_DEFINITIONS[type].promotion !== undefined;
export function pieceState(piece: { readonly type: PieceType; readonly promoted: boolean }): PieceStateDefinition {
  const definition = PIECE_DEFINITIONS[piece.type];
  return (piece.promoted ? definition.promotion : undefined) ?? definition;
}
