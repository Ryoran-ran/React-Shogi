import { evaluateRule } from "./scriptvm";
import type { GameMove, Position, Side } from "./shogi";
import { pieceTypes, canPromote } from "./pieces";
import type { PieceRules } from "./pieces";
import { loadRuleScript } from "./scriptconfig";
export { loadRuleScript, MAX_SCRIPT_LENGTH, SCRIPT_HOOKS, PIECE_SCRIPT_HOOKS } from "./scriptconfig";

export type ScriptValue = null | boolean | number | string | ScriptValue[] | { [key: string]: ScriptValue };
export type ScriptData = { [key: string]: ScriptValue };
export interface RuleState { data: ScriptData; ply: number; seed: number; result?: { winner: Side | null; reason: "script" } }
export interface RuleChoice { title: string; options: Array<{ value: string; label: string }>; index: number }
export interface ScriptOutcome { position?: Position; effects?: string[]; choice?: RuleChoice; rejected?: string }
export function validateScriptData(value: unknown): asserts value is ScriptData {
  let count = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++count > 4000 || depth > 12) throw new Error("ルールの独自データが大きすぎます");
    if (item === null || typeof item === "boolean" || typeof item === "string") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object") throw new Error("独自データにはJSONで保存できる値を使ってください");
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("独自データに使用できない名前です");
      visit(child, depth + 1);
    }
  };
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 20000) throw new Error("ルールの独自データが壊れています");
  visit(value, 0);
}
export function validateRuleState(value: unknown): asserts value is RuleState {
  const state = value as RuleState;
  if (!state || !Number.isSafeInteger(state.ply) || state.ply < 0 || !Number.isInteger(state.seed) || state.seed < 1 || state.seed > 0xffffffff || (state.result && (state.result.reason !== "script" || !["sente", "gote", null].includes(state.result.winner)))) throw new Error("ルールの状態が壊れています");
  validateScriptData(state.data);
}

// This function is serialized into QuickJS. It deliberately has no host closures or browser APIs.
function scriptProgram(rules: Record<string, any>, input: string, pieceRules: Record<string, any>): string {
  "use strict";
  const payload = JSON.parse(input), p = payload.position;
  const copy = (value: any): any => JSON.parse(JSON.stringify(value));
  const allowed = ["onStart", "validateMove", "beforeMove", "beforeCapture", "afterCapture", "afterCaptured", "afterMove", "afterDestroy", "turnEnd", "turnStart", "checkResult"];
  const validateHandlers = (handlers: any, name: string, supported: string[]): void => {
    if (!handlers || typeof handlers !== "object" || Array.isArray(handlers) || Object.keys(handlers).some(key => !supported.includes(key) || typeof handlers[key] !== "function")) throw new Error(`${name}：export default に対応するイベント名と関数を記述してください`);
  };
  validateHandlers(rules, "盤面ルール", allowed);
  for (const [type, handlers] of Object.entries(pieceRules)) validateHandlers(handlers, `駒 ${type}`, allowed.filter(hook => hook !== "checkResult"));
  if (payload.validate) return JSON.stringify({});
  p.ruleState ??= { data: {}, ply: 0, seed: 1 };
  const state = p.ruleState, effects: string[] = [], queue: any[] = [];
  // Identities are private to this simulation; per-piece persisted state stays in piece.data.
  const identities = new WeakMap<object, number>(), discardedCaptures = new Set<number>();
  let nextIdentity = 1, captureSequence = 0;
  const identity = (value: any): number | undefined => {
    if (!value) return undefined;
    if (!identities.has(value)) identities.set(value, nextIdentity++);
    return identities.get(value);
  };
  const inherit = (previous: any, next: any): any => { identities.set(next, identity(previous)!); return next; };
  for (const item of p.board) identity(item);
  let operations = 0, eventCount = 0, choiceIndex = 0;
  const selections = payload.move?.choices ?? [];
  const pending = {}, rejected = {};
  let requested: any = null, rejection = "";
  const fail = (message: string): never => { throw new Error(message); };
  let dataItems = 0;
  const validateData = (value: any, depth = 0): void => {
    if (++dataItems > 4000 || depth > 12) fail("独自データが大きすぎます");
    if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return;
    if (!value || typeof value !== "object" || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("独自データにはJSONの値を使ってください");
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail("独自データに使用できない名前です");
      validateData(item, depth + 1);
    }
  };
  const tick = (): void => { if (++operations > 256) fail("1手の効果は256操作までです"); };
  const square = (index: number): number => Number.isInteger(index) && index >= 0 && index < p.board.length ? index : fail("盤面の範囲外です");
  const piece = (index: number): any => p.board[square(index)] || fail("対象の駒がありません");
  const knownType = (type: string, promoted = false): void => { if (!payload.types.includes(type) || (promoted && !payload.promotable.includes(type))) fail("変身先・生成する駒の種類が不正です"); };
  const enqueue = (type: string, event: any): void => { queue.push({ ...copy(event), type }); };
  function dispatch(type: string, event: any): void {
    if (++eventCount > 128) fail("効果の連鎖は128イベントまでです");
    if (rules[type]) invoke(type, event, rules[type]);
    const targets = ["onStart", "turnStart", "turnEnd"].includes(type)
      ? p.board.flatMap((item: any, index: number) => item && (type === "onStart" || item.side === event.side) ? [{ piece: copy(item), id: identity(item), square: index, phase: true }] : [])
      : type === "afterCaptured" && event.captured ? [{ piece: event.captured, id: event._capturedId, square: event.to, removed: true }]
      : type === "afterDestroy" && event.piece ? [{ piece: event.piece, id: event._pieceId, square: event.from, removed: true }]
      : type !== "checkResult" && event.piece ? [{ piece: event.piece, id: event._pieceId, square: event.from ?? event.to }] : [];
    for (const target of targets) {
      const handler = pieceRules[target.piece.type]?.[type]; if (!handler) continue;
      const current = target.id === undefined ? -1 : p.board.findIndex((item: any) => item && identities.get(item) === target.id);
      if (!target.removed && target.id !== undefined && (current < 0 || (target.phase && p.board[current].type !== target.piece.type))) continue;
      const self = { ...copy(current < 0 ? target.piece : p.board[current]), square: current < 0 ? target.square : current, alive: current >= 0 };
      invoke(type, event, handler, self);
    }
  }
  function invoke(type: string, event: any, handler: (ctx: any) => any, self?: any): void {
    const e = { ...copy(event), type }, actor = e.piece ? { ...copy(e.piece), square: e.to ?? e.from } : { side: e.side ?? p.turn };
    delete e._pieceId; delete e._capturedId; delete e._captureId;
    const ctx = {
      event: e, actor, self, side: self?.side ?? e.side ?? p.turn, turn: p.turn, ply: state.ply,
      state: state.data,
      board: {
        width: p.width, height: p.height,
        at: (index: number) => copy(p.board[square(index)]),
        pieces: (side?: string) => p.board.flatMap((item: any, index: number) => item && (!side || item.side === side) ? [{ square: index, piece: copy(item) }] : []),
        neighbors: (index: number, radius = 1) => {
          square(index); if (!Number.isInteger(radius) || radius < 1 || radius > 14) fail("周囲の範囲は1〜14です");
          const x = index % p.width, y = Math.floor(index / p.width), result = [];
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            if ((!dx && !dy) || x + dx < 0 || x + dx >= p.width || y + dy < 0 || y + dy >= p.height) continue;
            const target = (y + dy) * p.width + x + dx; result.push({ square: target, piece: copy(p.board[target]) });
          }
          return result;
        },
        forward: (index: number, side: string, steps = 1) => {
          square(index); if (!["sente", "gote"].includes(side) || !Number.isInteger(steps)) fail("前進の指定が不正です");
          const y = Math.floor(index / p.width) + (side === "sente" ? -steps : steps);
          return y < 0 || y >= p.height ? null : y * p.width + index % p.width;
        },
      },
      hands: copy(p.hands),
      pieceTypes: payload.types.slice(),
      destroy: (index: number) => {
        tick(); const target = piece(index), removed = copy(target), id = identity(target); p.board[index] = null;
        effects.push(`${removed.type}を${index}から破壊`); enqueue("afterDestroy", { from: index, piece: removed, side: e.side, automatic: true, _pieceId: id });
      },
      spawn: (index: number, type: string, side: string, promoted = false) => {
        tick(); square(index); knownType(type, promoted);
        if (p.board[index] || !["sente", "gote"].includes(side)) fail("駒を生成できません");
        p.board[index] = { type, side, promoted }; identity(p.board[index]); effects.push(`${type}を${index}に生成`);
      },
      transform: (index: number, type: string, promoted = false) => {
        tick(); const target = piece(index); knownType(type, promoted);
        p.board[index] = inherit(target, { ...target, type, promoted }); effects.push(`${index}の駒を${type}に変身`);
      },
      move: (from: number, to: number, capture = false) => relocate(from, to, capture, true),
      capture: (from: number, to: number) => relocate(from, to, true, true),
      discardCapture: () => {
        if (!e.captured || e.captured.type === "K") fail("捕獲された駒がありません");
        if (type !== "afterCapture" && type !== "afterCaptured") fail("discardCapture は afterCapture / afterCaptured で使ってください");
        if (discardedCaptures.has(event._captureId)) return;
        const hand = p.hands[e.side]; if (!(hand[e.captured.type] > 0)) fail("捕獲した持ち駒がありません");
        hand[e.captured.type]--; discardedCaptures.add(event._captureId); effects.push(`${e.captured.type}は持ち駒にならず消滅`);
      },
      setPieceData: (index: number, data: any) => { tick(); validateData(data); piece(index).data = copy(data); },
      choose: (title: string, options: any[]) => {
        if (choiceIndex >= 4 || !Array.isArray(options) || !options.length || options.length > 32) fail("選択肢は1〜32件、1手につき4回以内です");
        const normalized = options.map(option => typeof option === "string" ? { value: option, label: option } : { value: option.value, label: option.label ?? option.value });
        if (typeof title !== "string" || title.length > 100 || normalized.some(option => typeof option.value !== "string" || !option.value || option.value.length > 80 || typeof option.label !== "string" || option.label.length > 100) || new Set(normalized.map(option => option.value)).size !== normalized.length) fail("選択肢の指定が不正です");
        const index = choiceIndex++, selected = selections[index];
        if (selected === undefined) { requested = { title, options: normalized, index }; throw pending; }
        if (!normalized.some(option => option.value === selected)) fail("選択した値が候補にありません");
        return selected;
      },
      choosePiece: (index: number, types: string[], title = "変身する駒を選んでください") => {
        const selected = ctx.choose(title, types); ctx.transform(index, selected); return selected;
      },
      random: () => { state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0 || 1; return state.seed / 0x100000000; },
      reject: (message = "この手はルールで禁止されています") => { rejection = String(message).slice(0, 200); throw rejected; },
      win: (side: string) => { tick(); if (!["sente", "gote"].includes(side)) fail("勝者の指定が不正です"); state.result = { reason: "script", winner: side }; },
      draw: () => { tick(); state.result = { reason: "script", winner: null }; },
      log: (message: unknown) => { tick(); effects.push(String(message).slice(0, 200)); },
    };
    const result = handler(ctx);
    if (result && typeof result.then === "function") fail("イベント関数は同期関数で記述してください");
    if (type === "validateMove" && result === false) ctx.reject();
  }
  function relocate(from: number, to: number, capture: boolean, automatic: boolean, promote = false): void {
    tick(); square(from); square(to); if (from === to) fail("同じマスには移動できません");
    let moving = copy(piece(from)); const target = copy(p.board[to]);
    if (target && (!capture || target.side === moving.side)) fail("移動先に駒があります");
    const event = { from, to, side: moving.side, piece: moving, ...(target ? { captured: target } : {}), automatic, _pieceId: identity(p.board[from]), _capturedId: identity(p.board[to]), _captureId: target ? ++captureSequence : undefined };
    if (target) dispatch("beforeCapture", event);
    if (!p.board[from] || identities.get(p.board[from]) !== event._pieceId || JSON.stringify(p.board[to]) !== JSON.stringify(target)) fail("捕獲前の効果で対象が変更されました");
    moving = copy(p.board[from]);
    if (target && target.type !== "K") p.hands[moving.side][target.type] = (p.hands[moving.side][target.type] ?? 0) + 1;
    p.board[to] = inherit(p.board[from], { ...moving, promoted: moving.promoted || promote }); p.board[from] = null;
    if (automatic) effects.push(`${moving.type}が${from}から${to}へ自動移動`);
    if (target) { enqueue("afterCapture", event); enqueue("afterCaptured", event); }
    enqueue("afterMove", { ...event, piece: copy(p.board[to]) });
  }
  function drain(): void { while (queue.length) { const event = queue.shift(); dispatch(event.type, event); } }
  try {
    if (payload.start) {
      dispatch("onStart", { side: p.turn }); drain(); dispatch("turnStart", { side: p.turn }); drain();
    } else {
      const move = payload.move, side = p.turn, passing = move.pass === true;
      const event = { side, from: move.from, to: move.to, piece: passing ? null : move.drop ? { type: move.drop, side, promoted: false } : copy(p.board[move.from]), automatic: false, pass: passing, _pieceId: identity(p.board[move.from]) };
      dispatch("validateMove", event); drain(); dispatch("beforeMove", event); drain();
      if (!passing) {
        if (move.drop) {
          tick(); square(move.to); if (p.board[move.to] || !(p.hands[side][move.drop] > 0)) fail("駒を打てません");
          p.hands[side][move.drop]--; p.board[move.to] = { type: move.drop, side, promoted: false }; enqueue("afterMove", { ...event, _pieceId: identity(p.board[move.to]) });
        } else relocate(move.from, move.to, true, false, move.promote);
      }
      drain(); dispatch("turnEnd", { side }); drain();
      p.turn = side === "sente" ? "gote" : "sente"; state.ply++;
      dispatch("turnStart", { side: p.turn }); drain();
    }
    dispatch("checkResult", { side: p.turn }); drain();
    if (selections.length !== choiceIndex) fail("選択の記録が一致しません");
    validateData(state.data);
    for (const item of p.board) if (item?.data !== undefined) validateData(item.data);
    const output = JSON.stringify({ position: p, effects });
    if (output.length > 80000) fail("ルールの出力が大きすぎます");
    return output;
  } catch (error) {
    if (error === pending) return JSON.stringify({ choice: requested });
    if (error === rejected) return JSON.stringify({ rejected: rejection });
    throw error;
  }
}

const program = `(${scriptProgram.toString()})`;
const validationCache = new Set<string>();
function pieceSources(rules: PieceRules): Record<string, string> { return Object.fromEntries(Object.entries(rules).filter(([, entry]) => entry?.script).map(([type, entry]) => [type, entry!.script!])); }
export function validateRuleScript(source: string, rules: PieceRules = {}): void {
  source = loadRuleScript(source); const pieces = pieceSources(rules), key = JSON.stringify([source, pieces]);
  if ((!source && !Object.keys(pieces).length) || validationCache.has(key)) return;
  evaluateRule(source, program, JSON.stringify({ validate: true }), pieces);
  if (validationCache.size >= 32) validationCache.clear(); validationCache.add(key);
}
const transitionCache = new Map<string, ScriptOutcome>();
export function runRuleScript(source: string, position: Position, rules: PieceRules, move?: GameMove): ScriptOutcome {
  const key = JSON.stringify([source, position, rules, move]);
  const cached = transitionCache.get(key); if (cached) return structuredClone(cached);
  const result: ScriptOutcome = JSON.parse(evaluateRule(source, program, JSON.stringify({ position, move, start: !move, types: pieceTypes(rules), promotable: pieceTypes(rules).filter(type => canPromote(type, rules)) }), pieceSources(rules)));
  if (result.position) {
    if (result.position.width !== position.width || result.position.height !== position.height || result.position.turn !== (move ? position.turn === "sente" ? "gote" : "sente" : position.turn)) throw new Error("ルールが盤面サイズ・手番を不正に変更しました");
    validateRuleState(result.position.ruleState);
    const kings = ["sente", "gote"].map(side => result.position!.board.some(piece => piece?.type === "K" && piece.side === side));
    if (!result.position.ruleState!.result && kings.some(present => !present)) result.position.ruleState!.result = { reason: "script", winner: kings[0] ? "sente" : kings[1] ? "gote" : null };
  }
  if (transitionCache.size >= 512) transitionCache.delete(transitionCache.keys().next().value!);
  transitionCache.set(key, structuredClone(result)); return result;
}

export const SCRIPT_EXAMPLES: Record<string, { name: string; source: string }> = {
  goal: { name: "中央のマスに到達した側が勝利", source: 'export default {\n  checkResult(ctx) {\n    const center = Math.floor(ctx.board.width / 2) + Math.floor(ctx.board.height / 2) * ctx.board.width;\n    const piece = ctx.board.at(center);\n    if (piece) ctx.win(piece.side);\n  }\n};\n' },
  empty: { name: "空のルール", source: "export default {\n  afterMove(ctx) {\n    // ここに処理を書きます。\n  }\n};\n" },
  explosion: { name: "駒取り後に周囲の敵駒を破壊", source: 'export default {\n  afterCapture(ctx) {\n    for (const target of ctx.board.neighbors(ctx.event.to)) {\n      if (target.piece && target.piece.side !== ctx.actor.side) {\n        ctx.destroy(target.square);\n      }\n    }\n    ctx.state.explosions = (ctx.state.explosions ?? 0) + 1;\n  }\n};\n' },
  vanish: { name: "歩は取られると消滅", source: 'export default {\n  afterCapture(ctx) {\n    if (ctx.event.captured.type === "P") {\n      ctx.discardCapture();\n    }\n  }\n};\n' },
  advance: { name: "手番開始時に自分の歩が自動前進", source: 'export default {\n  turnStart(ctx) {\n    for (const target of ctx.board.pieces(ctx.side)) {\n      if (target.piece.type !== "P" || target.piece.promoted) continue;\n      const to = ctx.board.forward(target.square, ctx.side);\n      if (to !== null && !ctx.board.at(to)) {\n        ctx.move(target.square, to);\n      }\n    }\n  }\n};\n' },
  transform: { name: "歩が最終段で選んだ駒に変身", source: 'export default {\n  afterMove(ctx) {\n    if (ctx.actor.type !== "P") return;\n    const y = Math.floor(ctx.event.to / ctx.board.width);\n    const last = ctx.actor.side === "sente" ? 0 : ctx.board.height - 1;\n    if (y === last) {\n      ctx.choosePiece(ctx.event.to, ["R", "B", "G", "S", "N"]);\n    }\n  }\n};\n' },
};

export const PIECE_SCRIPT_EXAMPLES: typeof SCRIPT_EXAMPLES = {
  empty: { name: "空の駒ルール", source: 'export default {\n  afterMove(ctx) {\n    // ctx.self が、このコードを持つ駒です。\n  }\n};\n' },
  explosion: { name: "駒取り後に周囲の敵駒を破壊", source: 'export default {\n  afterCapture(ctx) {\n    for (const target of ctx.board.neighbors(ctx.self.square)) {\n      if (target.piece && target.piece.side !== ctx.self.side) {\n        ctx.destroy(target.square);\n      }\n    }\n  }\n};\n' },
  vanish: { name: "この駒は取られると消滅", source: 'export default {\n  afterCaptured(ctx) {\n    ctx.discardCapture();\n  }\n};\n' },
  bomb: { name: "取られたとき周囲の敵駒を破壊", source: 'export default {\n  afterCaptured(ctx) {\n    for (const target of ctx.board.neighbors(ctx.self.square)) {\n      if (target.piece && target.piece.side !== ctx.self.side) {\n        ctx.destroy(target.square);\n      }\n    }\n  }\n};\n' },
  advance: { name: "自分の手番開始時にこの駒が前進", source: 'export default {\n  turnStart(ctx) {\n    const to = ctx.board.forward(ctx.self.square, ctx.self.side);\n    if (to !== null && !ctx.board.at(to)) {\n      ctx.move(ctx.self.square, to);\n    }\n  }\n};\n' },
  transform: { name: "この駒が最終段で選んだ駒に変身", source: 'export default {\n  afterMove(ctx) {\n    const y = Math.floor(ctx.self.square / ctx.board.width);\n    const last = ctx.self.side === "sente" ? 0 : ctx.board.height - 1;\n    if (y === last) {\n      ctx.choosePiece(ctx.self.square, ["R", "B", "G", "S", "N"]);\n    }\n  }\n};\n' },
  counter: { name: "各駒の移動回数を個別に記録", source: 'export default {\n  afterMove(ctx) {\n    const data = ctx.self.data ?? {};\n    ctx.setPieceData(ctx.self.square, {\n      ...data,\n      moves: (data.moves ?? 0) + 1\n    });\n  }\n};\n' },
};
