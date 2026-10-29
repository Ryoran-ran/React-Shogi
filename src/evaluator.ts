import type { Expression, GameDefinition, GameEvent, GameObject, GameState, JsonValue, Position } from "./types";
import { clone, equal, fail, integer, json, pathValue, validatePosition } from "./validation";

export interface EvalContext { definition: GameDefinition; state: GameState; event: GameEvent; locals: Record<string, JsonValue>; nodes: { value: number } }
function type(value: unknown, name: string): void { if (typeof value !== name) fail("EXPRESSION_TYPE"); }
function number(value: unknown): asserts value is number { if (!Number.isSafeInteger(value)) fail("EXPRESSION_TYPE"); }
function string(value: unknown): asserts value is string { type(value, "string"); }
function boolean(value: unknown): asserts value is boolean { type(value, "boolean"); }
function collection(value: unknown, ctx: EvalContext): JsonValue[] { if (!Array.isArray(value) || value.length > ctx.definition.limits.maxCollectionSize) fail("COLLECTION_LIMIT"); return value; }
function sortedObjects(state: GameState): GameObject[] { return Object.values(state.objects).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
function at(state: GameState, pos: Position): GameObject[] { return sortedObjects(state).filter(o => pos.kind === "zone" ? o.position.kind === "zone" && o.position.zoneId === pos.zoneId : o.position.kind === "grid" && o.position.spaceId === pos.spaceId && o.position.x === pos.x && o.position.y === pos.y); }
function gridPosition(value: unknown, ctx: EvalContext): asserts value is Extract<Position, { kind: "grid" }> { validatePosition(value, ctx.definition); if (value.kind !== "grid") fail("EXPRESSION_TYPE"); }
function gridAt(ctx: EvalContext, spaceId: string, x: number, y: number): GameObject[] { return at(ctx.state, { kind: "grid", spaceId, x, y }); }
function result(value: JsonValue, ctx: EvalContext): JsonValue { json(value); if (Array.isArray(value)) collection(value, ctx); return clone(value); }
function call(fn: string, a: JsonValue[], ctx: EvalContext): JsonValue {
  switch (fn) {
    case "eq": return equal(a[0], a[1]);
    case "neq": return !equal(a[0], a[1]);
    case "lt": case "lte": case "gt": case "gte": {
      if (typeof a[0] !== typeof a[1] || !(typeof a[0] === "string" || Number.isSafeInteger(a[0]))) fail("EXPRESSION_TYPE");
      const x = a[0] as string | number, y = a[1] as string | number;
      const cmp = typeof x === "string" ? (x < (y as string) ? -1 : x > (y as string) ? 1 : 0) : (x < (y as number) ? -1 : x > (y as number) ? 1 : 0);
      return fn === "lt" ? cmp < 0 : fn === "lte" ? cmp <= 0 : fn === "gt" ? cmp > 0 : cmp >= 0;
    }
    case "not": boolean(a[0]); return !a[0];
    case "add": case "sub": case "mod": {
      number(a[0]); number(a[1]);
      if (fn === "mod" && (a[0] < 0 || a[1] <= 0)) fail("EXPRESSION_TYPE");
      const n = fn === "add" ? a[0] + a[1] : fn === "sub" ? a[0] - a[1] : a[0] % a[1];
      number(n); return n;
    }
    case "count": return collection(a[0], ctx).length;
    case "objectsAt": validatePosition(a[0], ctx.definition); return result(at(ctx.state, a[0]).map(o => o.id), ctx);
    case "objectsByType": string(a[0]); return result(sortedObjects(ctx.state).filter(o => o.typeId === a[0]).map(o => o.id), ctx);
    case "offset": { gridPosition(a[0], ctx); number(a[1]); number(a[2]); const pos = { ...a[0], x: a[0].x + a[1], y: a[0].y + a[2] }; validatePosition(pos, ctx.definition); return pos as unknown as JsonValue; }
    case "neighbors4": {
      gridPosition(a[0], ctx);
      const origin = a[0], space = ctx.definition.spaces.find(s => s.id === origin.spaceId)!;
      const positions: Position[] = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ kind: "grid" as const, spaceId: origin.spaceId, x: origin.x + dx, y: origin.y + dy })).filter(p => p.x >= 0 && p.x < space.width && p.y >= 0 && p.y < space.height && !space.blocked?.some(b => b.x === p.x && b.y === p.y));
      return result(positions as unknown as JsonValue, ctx);
    }
    case "flipTargets": {
      gridPosition(a[0], ctx); string(a[1]); string(a[2]);
      const space = ctx.definition.spaces.find(s => s.id === a[0].spaceId)!;
      const targets = new Set<string>();
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        const line: string[] = [];
        for (let x = a[0].x + dx, y = a[0].y + dy; x >= 0 && x < space.width && y >= 0 && y < space.height; x += dx, y += dy) {
          if (space.blocked?.some(p => p.x === x && p.y === y)) break;
          const pieces = gridAt(ctx, space.id, x, y);
          if (pieces.length !== 1 || pieces[0].typeId !== a[2] || pieces[0].ownerId === null) break;
          if (pieces[0].ownerId === a[1]) { if (line.length) line.forEach(id => targets.add(id)); break; }
          line.push(pieces[0].id);
        }
      }
      return result([...targets].sort(), ctx);
    }
    case "groupsWithoutLiberties": {
      string(a[0]); string(a[1]);
      const space = ctx.definition.spaces.find(s => s.id === a[0]); if (!space) fail("UNKNOWN_SPACE");
      const visited = new Set<string>(), captured: string[] = [];
      for (const obj of sortedObjects(ctx.state)) {
        if (visited.has(obj.id) || obj.typeId !== a[1] || obj.ownerId === null || obj.position.kind !== "grid" || obj.position.spaceId !== a[0]) continue;
        if (gridAt(ctx, a[0], obj.position.x, obj.position.y).length !== 1) continue;
        const group: GameObject[] = [], queue = [obj]; let liberty = false;
        visited.add(obj.id);
        while (queue.length) {
          const current = queue.shift()!; group.push(current);
          const p = current.position as Extract<Position, { kind: "grid" }>;
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const x = p.x + dx, y = p.y + dy;
            if (x < 0 || x >= space.width || y < 0 || y >= space.height || space.blocked?.some(b => b.x === x && b.y === y)) continue;
            const pieces = gridAt(ctx, space.id, x, y);
            if (!pieces.length) liberty = true;
            if (pieces.length === 1 && pieces[0].typeId === a[1] && pieces[0].ownerId === obj.ownerId && !visited.has(pieces[0].id)) { visited.add(pieces[0].id); queue.push(pieces[0]); }
          }
        }
        if (!liberty) captured.push(...group.map(o => o.id));
      }
      return result(captured.sort(), ctx);
    }
    case "randomInt": {
      number(a[0]); number(a[1]); const width = a[1] - a[0] + 1; number(width); if (width <= 0) fail("EXPRESSION_TYPE");
      let x = ctx.state.rngState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      ctx.state.rngState = x; return a[0] + x % width;
    }
    default: return fail("UNKNOWN_FUNCTION");
  }
}
export function evaluate(expression: Expression, ctx: EvalContext): JsonValue {
  if (++ctx.nodes.value > ctx.definition.limits.maxExpressionNodes) fail("EXPRESSION_LIMIT");
  switch (expression.kind) {
    case "literal": return result(expression.value, ctx);
    case "ref": return pathValue(expression.scope === "game" ? ctx.state.variables : expression.scope === "event" ? ctx.event.payload : ctx.locals, expression.path);
    case "objectRef": { const id = evaluate(expression.objectId, ctx); string(id); const obj = ctx.state.objects[id]; if (!obj) fail("UNKNOWN_OBJECT"); return pathValue(obj, expression.path); }
    case "call": {
      if (expression.fn === "and" || expression.fn === "or") {
        const left = evaluate(expression.args[0], ctx); boolean(left);
        if (expression.fn === "and" && !left) return false;
        if (expression.fn === "or" && left) return true;
        const right = evaluate(expression.args[1], ctx); boolean(right); return right;
      }
      return call(expression.fn, expression.args.map(arg => evaluate(arg, ctx)), ctx);
    }
  }
}
