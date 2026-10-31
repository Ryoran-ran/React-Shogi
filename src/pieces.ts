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
  /** Destinations for moving to an empty square. */
  readonly moves: readonly PieceMovement[];
  /** Attack directions, including empty squares and defended friendly pieces. */
  readonly captures: readonly PieceMovement[];
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
const kingMoves: readonly PieceMovement[] = [
  { dx: -1, dy: -1, range: 1 }, { dx: -1, dy: 0, range: 1 }, { dx: -1, dy: 1, range: 1 },
  { dx: 0, dy: -1, range: 1 }, { dx: 0, dy: 1, range: 1 },
  { dx: 1, dy: -1, range: 1 }, { dx: 1, dy: 0, range: 1 }, { dx: 1, dy: 1, range: 1 },
];
const silverMoves: readonly PieceMovement[] = [
  { dx: -1, dy: 1, range: 1 }, { dx: 0, dy: 1, range: 1 }, { dx: 1, dy: 1, range: 1 },
  { dx: -1, dy: -1, range: 1 }, { dx: 1, dy: -1, range: 1 },
];
const knightMoves: readonly PieceMovement[] = [{ dx: -1, dy: 2, range: 1 }, { dx: 1, dy: 2, range: 1 }];
const lanceMoves: readonly PieceMovement[] = [{ dx: 0, dy: 1, range: null }];
const pawnMoves: readonly PieceMovement[] = [{ dx: 0, dy: 1, range: 1 }];
const rookMoves: readonly PieceMovement[] = [
  { dx: 0, dy: 1, range: null }, { dx: 0, dy: -1, range: null },
  { dx: 1, dy: 0, range: null }, { dx: -1, dy: 0, range: null },
];
const bishopMoves: readonly PieceMovement[] = [
  { dx: 1, dy: 1, range: null }, { dx: 1, dy: -1, range: null },
  { dx: -1, dy: 1, range: null }, { dx: -1, dy: -1, range: null },
];
const dragonMoves: readonly PieceMovement[] = [...rookMoves,
  { dx: 1, dy: 1, range: 1 }, { dx: 1, dy: -1, range: 1 },
  { dx: -1, dy: 1, range: 1 }, { dx: -1, dy: -1, range: 1 },
];
const horseMoves: readonly PieceMovement[] = [...bishopMoves,
  { dx: 0, dy: 1, range: 1 }, { dx: 0, dy: -1, range: 1 },
  { dx: 1, dy: 0, range: 1 }, { dx: -1, dy: 0, range: 1 },
];
const goldDescription = "前と斜め前、横、真後ろに1マス進めます。";

// Plain, JSON-serializable data. The current shogi preset is shared by rules, UI and AI.
const definitions = {
  K: {
    name: "王", label: "王将", goteName: "玉", goteLabel: "玉将", value: 20000,
    description: "縦・横・斜めに1マス進めます。",
    moves: kingMoves, captures: kingMoves,
  },
  R: {
    name: "飛", label: "飛車", value: 1000,
    description: "縦・横に、駒にぶつかるまで進めます。", moves: rookMoves, captures: rookMoves,
    promotion: {
      name: "龍", label: "龍王", value: 1400, forcedRanks: 0,
      description: "縦・横に駒にぶつかるまで、斜めに1マス進めます。",
      moves: dragonMoves, captures: dragonMoves,
    },
  },
  B: {
    name: "角", label: "角行", value: 850,
    description: "斜めに、駒にぶつかるまで進めます。", moves: bishopMoves, captures: bishopMoves,
    promotion: {
      name: "馬", label: "龍馬", value: 1200, forcedRanks: 0,
      description: "斜めに駒にぶつかるまで、縦・横に1マス進めます。",
      moves: horseMoves, captures: horseMoves,
    },
  },
  G: {
    name: "金", label: "金将", value: 550, description: goldDescription, moves: goldMoves, captures: goldMoves,
  },
  S: {
    name: "銀", label: "銀将", value: 450,
    description: "前と斜め前、斜め後ろに1マス進めます。",
    moves: silverMoves, captures: silverMoves,
    promotion: {
      name: "成銀", label: "成銀", value: 550, forcedRanks: 0, description: goldDescription, moves: goldMoves, captures: goldMoves,
    },
  },
  N: {
    name: "桂", label: "桂馬", value: 320,
    description: "前に2マス、横に1マス跳びます。",
    moves: knightMoves, captures: knightMoves,
    promotion: {
      name: "成桂", label: "成桂", value: 550, forcedRanks: 2, description: goldDescription, moves: goldMoves, captures: goldMoves,
    },
  },
  L: {
    name: "香", label: "香車", value: 300,
    description: "前に、駒にぶつかるまで進めます。", moves: lanceMoves, captures: lanceMoves,
    promotion: {
      name: "成香", label: "成香", value: 550, forcedRanks: 1, description: goldDescription, moves: goldMoves, captures: goldMoves,
    },
  },
  P: {
    name: "歩", label: "歩兵", value: 100,
    description: "前に1マス進めます。", moves: pawnMoves, captures: pawnMoves,
    promotion: {
      name: "と", label: "と", value: 550, forcedRanks: 1, description: goldDescription, moves: goldMoves, captures: goldMoves,
    },
  },
} satisfies Record<string, PieceDefinition>;

export type BuiltinPieceType = keyof typeof definitions;
export type CustomPieceType = `custom_${string}`;
export type PieceType = BuiltinPieceType | CustomPieceType;
export type HandType = Exclude<PieceType, "K">;
export type PieceAction = "moves" | "captures";
export type PieceActions = Pick<PieceStateDefinition, PieceAction> & { readonly separateCapture?: true };
export interface PieceDesign { readonly text: string; readonly fill: string; readonly color: string; readonly shape: "shogi" | "circle" | "square" }
export type DesignSide = "sente" | "gote";
export interface PieceRuleEntry {
  readonly definition?: PieceDefinition;
  readonly normal?: PieceActions;
  readonly promoted?: PieceActions;
  readonly design?: { readonly normal?: Partial<Record<DesignSide, PieceDesign>>; readonly promoted?: Partial<Record<DesignSide, PieceDesign>> };
}
export type PieceRules = Readonly<Partial<Record<PieceType, PieceRuleEntry>>>;
export const MAX_PIECE_OFFSET = 14;
export const MAX_MOVEMENT_RULES = 64;
export const MAX_CUSTOM_PIECES = 32;
export const MAX_PIECE_NAME_LENGTH = 20;
function independentState<T extends PieceStateDefinition>(state: T): T {
  return { ...state, moves: state.moves.map(move => ({ ...move })), captures: state.captures.map(move => ({ ...move })) };
}
// Keep the two settings and each piece independent when a preset is cloned for editing.
export const PIECE_DEFINITIONS: Readonly<Record<BuiltinPieceType, PieceDefinition>> = Object.fromEntries(
  Object.entries(definitions).map(([type, data]) => {
    const definition: PieceDefinition = data;
    return [type, { ...independentState(definition), ...(definition.promotion ? { promotion: independentState(definition.promotion) } : {}) }];
  }),
) as Record<BuiltinPieceType, PieceDefinition>;

// Editing a future variant must not mutate the built-in shogi preset.
for (const definition of Object.values(PIECE_DEFINITIONS)) {
  for (const state of [definition.promotion, definition]) {
    if (!state) continue;
    for (const movements of [state.moves, state.captures]) {
      movements.forEach(Object.freeze);
      Object.freeze(movements);
    }
    Object.freeze(state);
  }
}
Object.freeze(PIECE_DEFINITIONS);

export const PIECE_TYPES = Object.freeze(Object.keys(PIECE_DEFINITIONS) as BuiltinPieceType[]);
export const HAND_TYPES = Object.freeze(PIECE_TYPES.filter((type): type is Exclude<BuiltinPieceType, "K"> => type !== "K"));
export const PIECE_NAMES = Object.freeze(Object.fromEntries(PIECE_TYPES.map(type => [type, PIECE_DEFINITIONS[type].name])) as Record<PieceType, string>);
export const PIECE_LABELS = Object.freeze(Object.fromEntries(PIECE_TYPES.map(type => [type, PIECE_DEFINITIONS[type].label])) as Record<PieceType, string>);
export function isBuiltinPiece(type: string): type is BuiltinPieceType { return (PIECE_TYPES as readonly string[]).includes(type); }
export function pieceDefinition(type: PieceType, rules?: PieceRules): PieceDefinition {
  const definition = isBuiltinPiece(type) ? PIECE_DEFINITIONS[type] : rules?.[type]?.definition;
  if (!definition) throw new Error("駒の定義が見つかりません");
  return definition;
}
export function pieceTypes(rules?: PieceRules): PieceType[] { return [...PIECE_TYPES, ...Object.keys(rules ?? {}).filter(key => !isBuiltinPiece(key)) as CustomPieceType[]]; }
export function handTypes(rules?: PieceRules): HandType[] { return pieceTypes(rules).filter((type): type is HandType => type !== "K"); }
export const canPromote = (type: PieceType, rules?: PieceRules): boolean => pieceDefinition(type, rules).promotion !== undefined;
export function pieceState(piece: { readonly type: PieceType; readonly promoted: boolean }, rules?: PieceRules): PieceStateDefinition {
  const definition = pieceDefinition(piece.type, rules);
  const state = (piece.promoted ? definition.promotion : undefined) ?? definition;
  const actions = rules?.[piece.type]?.[piece.promoted ? "promoted" : "normal"];
  return actions ? { ...state, moves: actions.moves, captures: actions.captures } : state;
}

function sameMovements(first: readonly PieceMovement[], second: readonly PieceMovement[]): boolean {
  return first.length === second.length && first.every(move => second.some(other => move.dx === other.dx && move.dy === other.dy && move.range === other.range));
}
export function pieceActionsSeparate(type: PieceType, promoted: boolean, rules?: PieceRules): boolean {
  const state = pieceState({ type, promoted }, rules);
  return rules?.[type]?.[promoted ? "promoted" : "normal"]?.separateCapture === true || !sameMovements(state.moves, state.captures);
}

function ruleRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("駒の動きの設定が壊れています");
  return data as Record<string, unknown>;
}
export function loadMovements(data: unknown): PieceMovement[] {
  if (!Array.isArray(data) || data.length > MAX_MOVEMENT_RULES) throw new Error(`動きは${MAX_MOVEMENT_RULES}方向以内で設定してください`);
  const seen = new Set<string>();
  return data.map(item => {
    const move = ruleRecord(item), { dx, dy, range } = move;
    if (![dx, dy].every(value => Number.isInteger(value) && Math.abs(value as number) <= MAX_PIECE_OFFSET) || (dx === 0 && dy === 0)) throw new Error(`移動先は縦・横それぞれ−${MAX_PIECE_OFFSET}〜${MAX_PIECE_OFFSET}で、現在のマス以外を指定してください`);
    if (range !== null && (!Number.isInteger(range) || (range as number) < 1 || (range as number) > MAX_PIECE_OFFSET)) throw new Error(`移動回数は1〜${MAX_PIECE_OFFSET}回、または盤端までを指定してください`);
    const key = `${dx},${dy}`;
    if (seen.has(key)) throw new Error("同じ移動先が重複しています");
    seen.add(key);
    return { dx: dx as number, dy: dy as number, range: range as number | null };
  });
}
function shortText(data: unknown, max: number, empty = false): string {
  if (typeof data !== "string" || (!empty && !data.trim()) || data.length > max) throw new Error(`文字は${empty ? "0" : "1"}〜${max}文字で入力してください`);
  return data;
}
function loadCustomDefinition(data: unknown): PieceDefinition {
  const source = ruleRecord(data);
  if (Object.keys(source).some(key => !["name", "label", "description", "moves", "captures", "value", "promotion"].includes(key))) throw new Error("駒の定義が壊れています");
  const state = (raw: Record<string, unknown>): PieceStateDefinition => {
    if (typeof raw.value !== "number" || !Number.isFinite(raw.value) || raw.value < 0 || raw.value > 20000) throw new Error("駒の価値が壊れています");
    return { name: shortText(raw.name, MAX_PIECE_NAME_LENGTH), label: shortText(raw.label, MAX_PIECE_NAME_LENGTH), description: shortText(raw.description, 300, true), value: raw.value, moves: loadMovements(raw.moves), captures: loadMovements(raw.captures) };
  };
  const result: PieceDefinition = state(source);
  if (source.promotion === undefined) return result;
  const promoted = ruleRecord(source.promotion);
  if (Object.keys(promoted).some(key => !["name", "label", "description", "moves", "captures", "value", "forcedRanks"].includes(key)) || !Number.isInteger(promoted.forcedRanks) || (promoted.forcedRanks as number) < 0 || (promoted.forcedRanks as number) > 2) throw new Error("成り後の定義が壊れています");
  return { ...result, promotion: { ...state(promoted), forcedRanks: promoted.forcedRanks as number } };
}
function loadDesign(data: unknown): PieceDesign {
  const raw = ruleRecord(data);
  if (Object.keys(raw).some(key => !["text", "fill", "color", "shape"].includes(key)) || typeof raw.fill !== "string" || !/^#[0-9a-f]{6}$/i.test(raw.fill) || typeof raw.color !== "string" || !/^#[0-9a-f]{6}$/i.test(raw.color) || !["shogi", "circle", "square"].includes(raw.shape as string)) throw new Error("駒のデザインが壊れています");
  return { text: shortText(raw.text, 6, true), fill: raw.fill.toLowerCase(), color: raw.color.toLowerCase(), shape: raw.shape as PieceDesign["shape"] };
}
export function defaultPieceDesign(piece: { type: PieceType; promoted: boolean; side: DesignSide }, rules?: PieceRules): PieceDesign {
  const state = pieceState(piece, rules);
  return { text: (piece.side === "gote" ? state.goteLabel ?? state.label : state.label).slice(0, 6), fill: "#ddbb7d", color: piece.promoted ? "#a84634" : "#4a3a25", shape: "shogi" };
}
export function pieceDesign(piece: { type: PieceType; promoted: boolean; side: DesignSide }, rules?: PieceRules): PieceDesign {
  return rules?.[piece.type]?.design?.[piece.promoted ? "promoted" : "normal"]?.[piece.side] ?? defaultPieceDesign(piece, rules);
}
export function pieceTypeLabel(type: PieceType, rules?: PieceRules): string { const definition = pieceDefinition(type, rules); return isBuiltinPiece(type) ? definition.label : definition.name; }
export function hasPieceLibrary(rules?: PieceRules): boolean { return Object.values(rules ?? {}).some(entry => !!(entry?.definition || entry?.design)); }

/** Validate imported definitions, actions and designs; omit unchanged built-in settings. */
export function loadPieceRules(data: unknown = {}): PieceRules {
  const source = ruleRecord(data), result: Partial<Record<PieceType, PieceRuleEntry>> = {};
  let customCount = 0;
  for (const key of Object.keys(source)) {
    const entry = ruleRecord(source[key]);
    if (Object.keys(entry).some(key => !["definition", "normal", "promoted", "design"].includes(key))) throw new Error("駒の状態の設定が壊れています");
    if (isBuiltinPiece(key)) { if (entry.definition !== undefined) throw new Error("標準の駒の定義は置き換えられません"); }
    else {
      if (!/^custom_[a-z0-9_-]{1,48}$/.test(key) || ++customCount > MAX_CUSTOM_PIECES) throw new Error(`追加できる駒は${MAX_CUSTOM_PIECES}種類までです`);
      result[key as CustomPieceType] = { definition: loadCustomDefinition(entry.definition) };
    }
  }
  for (const key of Object.keys(source)) {
    const type = key as PieceType, entry = ruleRecord(source[key]), definition = pieceDefinition(type, result);
    const states: { definition?: PieceDefinition; normal?: PieceActions; promoted?: PieceActions; design?: { normal?: Partial<Record<DesignSide, PieceDesign>>; promoted?: Partial<Record<DesignSide, PieceDesign>> } } = { ...result[type] };
    for (const stateKey of ["normal", "promoted"] as const) {
      if (entry[stateKey] === undefined) continue;
      if (stateKey === "promoted" && !definition.promotion) throw new Error("この駒に成り後の動きは設定できません");
      const raw = ruleRecord(entry[stateKey]);
      if (Object.keys(raw).some(key => !["moves", "captures", "separateCapture"].includes(key)) || (raw.separateCapture !== undefined && raw.separateCapture !== true)) throw new Error("駒の動きの設定が壊れています");
      const actions: PieceActions = { moves: loadMovements(raw.moves), captures: loadMovements(raw.captures), ...(raw.separateCapture === true ? { separateCapture: true } : {}) };
      const standard = stateKey === "promoted" ? definition.promotion! : definition;
      if (actions.separateCapture || JSON.stringify(actions.moves) !== JSON.stringify(standard.moves) || JSON.stringify(actions.captures) !== JSON.stringify(standard.captures)) states[stateKey] = actions;
    }
    if (entry.design !== undefined) {
      const designs = ruleRecord(entry.design), normalized: NonNullable<typeof states.design> = {};
      for (const stateKey of Object.keys(designs)) {
        if (stateKey !== "normal" && stateKey !== "promoted") throw new Error("デザインの状態が壊れています");
        if (stateKey === "promoted" && !definition.promotion) throw new Error("この駒に成り後のデザインは設定できません");
        const sides = ruleRecord(designs[stateKey]), kept: Partial<Record<DesignSide, PieceDesign>> = {};
        for (const side of Object.keys(sides)) {
          if (side !== "sente" && side !== "gote") throw new Error("先手または後手のデザインを指定してください");
          const design = loadDesign(sides[side]), standard = defaultPieceDesign({ type, promoted: stateKey === "promoted", side }, result);
          if (JSON.stringify(design) !== JSON.stringify(standard)) kept[side] = design;
        }
        if (Object.keys(kept).length) normalized[stateKey] = kept;
      }
      if (Object.keys(normalized).length) states.design = normalized;
    }
    if (Object.keys(states).length) result[type] = states;
  }
  return result;
}

export function updatePieceDesign(rules: PieceRules, type: PieceType, promoted: boolean, side: DesignSide, design: PieceDesign): PieceRules {
  const entry = rules[type], state = promoted ? "promoted" : "normal";
  return loadPieceRules({ ...rules, [type]: { ...entry, design: { ...entry?.design, [state]: { ...entry?.design?.[state], [side]: design } } } });
}
export function resetPieceDesign(rules: PieceRules, type: PieceType, promoted: boolean, side: DesignSide): PieceRules {
  return updatePieceDesign(rules, type, promoted, side, defaultPieceDesign({ type, promoted, side }, rules));
}
export function addCustomPiece(rules: PieceRules, template?: PieceType): { rules: PieceRules; type: CustomPieceType } {
  if (pieceTypes(rules).length - PIECE_TYPES.length >= MAX_CUSTOM_PIECES) throw new Error(`追加できる駒は${MAX_CUSTOM_PIECES}種類までです`);
  let number = 1; while (rules[`custom_${number}`]) number++;
  const type: CustomPieceType = `custom_${number}`, source = template ? pieceDefinition(template, rules) : undefined;
  const names = new Set(pieceTypes(rules).map(type => pieceDefinition(type, rules).name)), base = source ? `${source.name}のコピー` : "新しい駒";
  let name = base.slice(0, MAX_PIECE_NAME_LENGTH), suffix = 2;
  while (names.has(name)) { const ending = ` ${suffix++}`; name = base.slice(0, MAX_PIECE_NAME_LENGTH - ending.length) + ending; }
  const normal = template ? pieceState({ type: template, promoted: false }, rules) : null;
  const modes = template ? Object.fromEntries((["normal", "promoted"] as const).filter(key => rules[template]?.[key]?.separateCapture).map(key => [key, { moves: pieceState({ type: template, promoted: key === "promoted" }, rules).moves, captures: pieceState({ type: template, promoted: key === "promoted" }, rules).captures, separateCapture: true }])) : {};
  const definition: PieceDefinition = { name, label: source?.label ?? "新", description: source?.description ?? "オリジナルの駒です。", value: source?.value ?? 500, moves: normal?.moves ?? [], captures: normal?.captures ?? [], ...(source?.promotion && template ? { promotion: { ...pieceState({ type: template, promoted: true }, rules), forcedRanks: source.promotion.forcedRanks } } : {}) };
  const design: NonNullable<PieceRuleEntry["design"]> = template ? { normal: { sente: pieceDesign({ type: template, promoted: false, side: "sente" }, rules), gote: pieceDesign({ type: template, promoted: false, side: "gote" }, rules) }, ...(source?.promotion ? { promoted: { sente: pieceDesign({ type: template, promoted: true, side: "sente" }, rules), gote: pieceDesign({ type: template, promoted: true, side: "gote" }, rules) } } : {}) } : {};
  // Custom definitions use one logical name; player-specific lettering is kept in the design.
  if (definition.promotion) { const { goteName: _name, goteLabel: _label, ...promotion } = definition.promotion; return { type, rules: loadPieceRules({ ...rules, [type]: { definition: { ...definition, promotion }, design, ...modes } }) }; }
  return { type, rules: loadPieceRules({ ...rules, [type]: { definition, design, ...modes } }) };
}
export function updateCustomPiece(rules: PieceRules, type: PieceType, change: { name?: string; canPromote?: boolean }): PieceRules {
  if (isBuiltinPiece(type)) throw new Error("追加した駒を選んでください");
  const entry = rules[type]!, definition = pieceDefinition(type, rules), name = change.name === undefined ? definition.name : shortText(change.name.trim(), MAX_PIECE_NAME_LENGTH);
  let promotion = definition.promotion;
  if (promotion && change.name !== undefined) promotion = { ...promotion, name: `${name.slice(0, MAX_PIECE_NAME_LENGTH - 1)}成` };
  if (change.canPromote === false) promotion = undefined;
  else if (change.canPromote === true && !promotion) {
    const normal = pieceState({ type, promoted: false }, rules);
    promotion = { name: `${name.slice(0, MAX_PIECE_NAME_LENGTH - 1)}成`, label: `成${definition.label}`.slice(0, MAX_PIECE_NAME_LENGTH), description: "成り後のオリジナル駒です。", moves: normal.moves, captures: normal.captures, value: Math.min(20000, definition.value + 100), forcedRanks: 0 };
  }
  const next = { ...definition, name, ...(promotion ? { promotion } : {}) };
  if (!promotion) delete next.promotion;
  const updated: PieceRuleEntry = { ...entry, definition: next, ...(entry.design ? { design: { normal: entry.design.normal, ...(promotion && entry.design.promoted ? { promoted: entry.design.promoted } : {}) } } : {}) };
  const normalized = { ...updated };
  if (!promotion) delete normalized.promoted;
  // Avoid undefined design states when serializing or validating a draft.
  if (normalized.design) normalized.design = Object.fromEntries(Object.entries(normalized.design).filter(([, value]) => value !== undefined));
  return loadPieceRules({ ...rules, [type]: normalized });
}

export function movementOffsetLabel(move: Pick<PieceMovement, "dx" | "dy">): string {
  return [move.dx ? `${move.dx > 0 ? "右" : "左"}${Math.abs(move.dx)}` : "", move.dy ? `${move.dy > 0 ? "前" : "後"}${Math.abs(move.dy)}` : ""].filter(Boolean).join("・");
}
export function updatePieceMovements(rules: PieceRules, type: PieceType, promoted: boolean, action: PieceAction, movements: readonly PieceMovement[]): PieceRules {
  if (promoted && !canPromote(type, rules)) throw new Error("この駒に成り後の動きは設定できません");
  if (action !== "moves" && action !== "captures") throw new Error("移動または駒取りを選んでください");
  const state = pieceState({ type, promoted }, rules), key = promoted ? "promoted" : "normal";
  return loadPieceRules({ ...rules, [type]: { ...rules[type], [key]: { ...rules[type]?.[key], moves: state.moves, captures: state.captures, [action]: movements } } });
}
export function updateSharedPieceMovements(rules: PieceRules, type: PieceType, promoted: boolean, movements: readonly PieceMovement[]): PieceRules {
  const key = promoted ? "promoted" : "normal";
  return loadPieceRules({ ...rules, [type]: { ...rules[type], [key]: { moves: movements, captures: movements } } });
}
export function setPieceActionsSeparate(rules: PieceRules, type: PieceType, promoted: boolean, separate: boolean): PieceRules {
  const state = pieceState({ type, promoted }, rules), key = promoted ? "promoted" : "normal";
  return separate
    ? loadPieceRules({ ...rules, [type]: { ...rules[type], [key]: { moves: state.moves, captures: state.captures, separateCapture: true } } })
    : updateSharedPieceMovements(rules, type, promoted, state.moves);
}
export function resetPieceMovements(rules: PieceRules, type: PieceType, promoted: boolean): PieceRules {
  const definition = pieceDefinition(type, rules), state = (promoted ? definition.promotion : undefined) ?? definition, key = promoted ? "promoted" : "normal";
  return loadPieceRules({ ...rules, [type]: { ...rules[type], [key]: { moves: state.moves, captures: state.captures } } });
}
export function pieceDescription(piece: { readonly type: PieceType; readonly promoted: boolean }, rules?: PieceRules): string {
  const state = pieceState(piece, rules);
  if (!rules?.[piece.type]?.[piece.promoted ? "promoted" : "normal"]) return state.description;
  const describe = (movements: readonly PieceMovement[]) => movements.length ? movements.map(move => `${movementOffsetLabel(move)}${move.range === null ? "（盤端まで）" : move.range === 1 ? "" : `（最大${move.range}回）`}`).join("、") : "なし";
  return `移動：${describe(state.moves)}。駒取り：${describe(state.captures)}。`;
}
