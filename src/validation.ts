import type { Action, BuiltinFunction, Expression, GameDefinition, GameObject, GameState, Id, JsonValue, Position } from "./types";

export const HARD_LIMITS = { maxEventsPerRoot: 1024, maxActionsPerRoot: 10000, maxEventDepth: 32, maxExpressionNodes: 50000, maxCollectionSize: 4096 } as const;
export const ARITY: Record<BuiltinFunction, number> = {
  eq: 2, neq: 2, lt: 2, lte: 2, gt: 2, gte: 2, and: 2, or: 2, not: 1,
  add: 2, sub: 2, mod: 2, count: 1, objectsAt: 1, offset: 3, neighbors4: 1,
  objectsByType: 1, flipTargets: 3, groupsWithoutLiberties: 2, randomInt: 2
};
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
export class EngineError extends Error { constructor(public code: string, message = code) { super(message); } }
export function fail(code: string): never { throw new EngineError(code); }
export function safeKey(value: unknown): asserts value is string { if (typeof value !== "string" || !value || forbidden.has(value)) fail("INVALID_KEY"); }
export function integer(value: unknown, min = 0): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < min) fail("INVALID_INTEGER"); }
export function record(value: unknown): asserts value is Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) fail("INVALID_RECORD"); }
export function json(value: unknown, depth = 0, seen = new Set<object>()): asserts value is JsonValue {
  if (depth > 64) fail("JSON_DEPTH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("INVALID_JSON"); return; }
  if (typeof value !== "object") fail("INVALID_JSON");
  if (seen.has(value)) fail("JSON_CYCLE");
  seen.add(value);
  if (Array.isArray(value)) for (const item of value) json(item, depth + 1, seen);
  else { record(value); for (const [key, item] of Object.entries(value)) { safeKey(key); json(item, depth + 1, seen); } }
  seen.delete(value);
}
export function jsonRecord(value: unknown): asserts value is Record<string, JsonValue> { record(value); for (const [key, item] of Object.entries(value)) { safeKey(key); json(item); } }
export function clone<T>(value: T): T { return structuredClone(value); }
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
    return ak.length === bk.length && ak.every((key, i) => key === bk[i] && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}
export function pathValue(root: unknown, path: string[]): JsonValue {
  let current = root;
  for (const key of path) {
    safeKey(key);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || !Object.hasOwn(current, key)) fail("MISSING_PATH");
      current = current[Number(key)];
    } else if (current && typeof current === "object" && Object.hasOwn(current, key)) current = (current as Record<string, unknown>)[key];
    else fail("MISSING_PATH");
  }
  json(current);
  return clone(current);
}
export function validatePosition(value: unknown, definition: GameDefinition): asserts value is Position {
  record(value);
  if (value.kind === "zone") { safeKey(value.zoneId); if (!definition.zones.includes(value.zoneId)) fail("UNKNOWN_ZONE"); return; }
  if (value.kind !== "grid") fail("INVALID_POSITION");
  safeKey(value.spaceId); integer(value.x); integer(value.y);
  const space = definition.spaces.find(s => s.id === value.spaceId);
  if (!space || value.x >= space.width || value.y >= space.height || space.blocked?.some(p => p.x === value.x && p.y === value.y)) fail("INVALID_POSITION");
}
export function validateOwner(value: unknown, definition: GameDefinition): asserts value is Id | null { if (value !== null && (typeof value !== "string" || !definition.players.includes(value))) fail("UNKNOWN_OWNER"); }
export function validateObject(value: unknown, definition: GameDefinition): asserts value is GameObject {
  record(value); safeKey(value.id); safeKey(value.typeId);
  if (!definition.objectTypes.some(t => t.id === value.typeId)) fail("UNKNOWN_TYPE");
  validateOwner(value.ownerId, definition); validatePosition(value.position, definition); jsonRecord(value.properties);
}
function unique(ids: unknown[]): void { const found = new Set<string>(); for (const id of ids) { safeKey(id); if (found.has(id)) fail("DUPLICATE_ID"); found.add(id); } }
type StaticType = "unknown" | "boolean" | "array" | "number" | "string" | "position";
function expression(value: unknown, count: { value: number }, depth: number): StaticType {
  if (depth > 32 || ++count.value > HARD_LIMITS.maxExpressionNodes) fail("AST_LIMIT");
  record(value);
  switch (value.kind) {
    case "literal": json(value.value); return Array.isArray(value.value) ? "array" : typeof value.value === "boolean" ? "boolean" : typeof value.value === "number" ? "number" : typeof value.value === "string" ? "string" : value.value && typeof value.value === "object" && "kind" in value.value ? "position" : "unknown";
    case "ref":
      if (!["game", "event", "local"].includes(value.scope as string)) fail("INVALID_SCOPE");
      if (!Array.isArray(value.path) || !value.path.length) fail("INVALID_PATH");
      value.path.forEach(safeKey); return "unknown";
    case "objectRef":
      expression(value.objectId, count, depth + 1);
      if (!Array.isArray(value.path)) fail("INVALID_PATH"); value.path.forEach(safeKey); return "unknown";
    case "call": {
      if (typeof value.fn !== "string" || !Object.hasOwn(ARITY, value.fn)) fail("UNKNOWN_FUNCTION");
      const fn = value.fn as BuiltinFunction;
      if (!Array.isArray(value.args) || value.args.length !== ARITY[fn]) fail("INVALID_ARITY");
      const types = value.args.map(arg => expression(arg, count, depth + 1));
      const expected: Partial<Record<BuiltinFunction, StaticType[]>> = { and: ["boolean", "boolean"], or: ["boolean", "boolean"], not: ["boolean"], add: ["number", "number"], sub: ["number", "number"], mod: ["number", "number"], count: ["array"], objectsAt: ["position"], offset: ["position", "number", "number"], neighbors4: ["position"], objectsByType: ["string"], flipTargets: ["position", "string", "string"], groupsWithoutLiberties: ["string", "string"], randomInt: ["number", "number"] };
      expected[fn]?.forEach((type, i) => { if (types[i] !== "unknown" && types[i] !== type) fail("STATIC_TYPE"); });
      return ["eq", "neq", "lt", "lte", "gt", "gte", "and", "or", "not"].includes(fn) ? "boolean" : ["objectsAt", "neighbors4", "objectsByType", "flipTargets", "groupsWithoutLiberties"].includes(fn) ? "array" : fn === "offset" ? "position" : "number";
    }
    default: return fail("UNKNOWN_EXPRESSION");
  }
}
function actions(value: unknown, count: { value: number }, depth: number, definition: GameDefinition): void {
  if (!Array.isArray(value) || depth > 32) fail("AST_LIMIT");
  for (const raw of value) {
    if (++count.value > HARD_LIMITS.maxActionsPerRoot) fail("AST_LIMIT");
    record(raw);
    const ex = (v: unknown) => expression(v, count, depth + 1);
    switch (raw.kind) {
      case "if": { const t = ex(raw.condition); if (t !== "boolean" && t !== "unknown") fail("STATIC_TYPE"); actions(raw.then, count, depth + 1, definition); if (raw.else !== undefined) actions(raw.else, count, depth + 1, definition); break; }
      case "forEach": { const t = ex(raw.list); if (t !== "array" && t !== "unknown") fail("STATIC_TYPE"); safeKey(raw.as); actions(raw.actions, count, depth + 1, definition); break; }
      case "setGameVar": safeKey(raw.key); ex(raw.value); break;
      case "setObject": ex(raw.objectId); ex(raw.value); if (!["ownerId", "position", "property"].includes(raw.field as string)) fail("INVALID_FIELD"); if (raw.field === "property") safeKey(raw.key); else if (raw.key !== undefined) fail("INVALID_FIELD"); break;
      case "createObject": safeKey(raw.typeId); if (!definition.objectTypes.some(t => t.id === raw.typeId)) fail("UNKNOWN_TYPE"); ex(raw.ownerId); ex(raw.position); if (raw.properties !== undefined) { record(raw.properties); for (const [key, value] of Object.entries(raw.properties)) { safeKey(key); ex(value); } } break;
      case "removeObject": ex(raw.objectId); break;
      case "emit": safeKey(raw.eventType); integer(raw.delayTicks); record(raw.payload); for (const [key, value] of Object.entries(raw.payload)) { safeKey(key); ex(value); } break;
      case "reject": safeKey(raw.code); break;
      case "finish": ex(raw.result); break;
      default: fail("UNKNOWN_ACTION");
    }
  }
}
export function validateDefinition(value: unknown): GameDefinition {
  record(value);
  if (value.schemaVersion !== 1 || value.engineVersion !== "0.1") fail("UNSUPPORTED_VERSION");
  safeKey(value.id); integer(value.stepMs, 1);
  for (const key of ["spaces", "zones", "players", "objectTypes", "initialObjects", "rules"]) if (!Array.isArray(value[key])) fail("INVALID_DEFINITION");
  const d = value as unknown as GameDefinition;
  unique(d.spaces.map(s => s?.id)); unique(d.zones); unique(d.players); unique(d.objectTypes.map(t => t?.id)); unique(d.initialObjects.map(o => o?.id)); unique(d.rules.map(r => r?.id));
  for (const s of d.spaces) { if (s.kind !== "squareGrid") fail("INVALID_SPACE"); integer(s.width, 1); integer(s.height, 1); if (s.blocked !== undefined) { if (!Array.isArray(s.blocked)) fail("INVALID_SPACE"); for (const p of s.blocked) { integer(p.x); integer(p.y); if (p.x >= s.width || p.y >= s.height) fail("INVALID_SPACE"); } } }
  for (const t of d.objectTypes) jsonRecord(t.defaults);
  jsonRecord(d.initialVariables);
  for (const o of d.initialObjects) validateObject(o, d);
  record(d.limits); for (const key of Object.keys(HARD_LIMITS) as Array<keyof typeof HARD_LIMITS>) { integer(d.limits[key], 1); if (d.limits[key] > HARD_LIMITS[key]) fail("LIMIT_TOO_HIGH"); }
  const count = { value: 0 };
  for (const rule of d.rules) { safeKey(rule.on); integer(rule.priority, -Number.MAX_SAFE_INTEGER); integer(rule.order, -Number.MAX_SAFE_INTEGER); if (rule.when !== undefined) { const t = expression(rule.when, count, 0); if (t !== "boolean" && t !== "unknown") fail("STATIC_TYPE"); } actions(rule.actions, count, 0, d); }
  json(d);
  return clone(d);
}
export function validateState(state: unknown, definition: GameDefinition): asserts state is GameState {
  record(state); if (!["ready", "running", "paused", "finished", "faulted"].includes(state.status as string)) fail("INVALID_STATE");
  integer(state.tick); integer(state.revision); integer(state.nextSequence, 1); integer(state.nextObjectNumber, 1);
  integer(state.rngState, 1); if (state.rngState > 0xffffffff) fail("INVALID_SEED");
  jsonRecord(state.variables); record(state.objects); for (const [id, obj] of Object.entries(state.objects)) { validateObject(obj, definition); if (id !== obj.id) fail("INVALID_STATE"); }
  if (!Array.isArray(state.pending)) fail("INVALID_STATE");
  for (const ev of state.pending) { record(ev); safeKey(ev.id); safeKey(ev.type); jsonRecord(ev.payload); integer(ev.dueTick); integer(ev.sequence); integer(ev.depth); safeKey(ev.rootId); if (ev.causationId !== null) safeKey(ev.causationId); if (!["timer", "input", "tick"].includes(ev.lane as string)) fail("INVALID_EVENT"); }
  json(state.result);
}
