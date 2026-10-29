import type { BuiltinFunction, Expression, GameDefinition, JsonValue, RuleDefinition } from "./types";

const L = (value: JsonValue): Expression => ({ kind: "literal", value });
const G = (key: string): Expression => ({ kind: "ref", scope: "game", path: [key] });
const E = (...path: string[]): Expression => ({ kind: "ref", scope: "event", path });
const X = (key: string): Expression => ({ kind: "ref", scope: "local", path: [key] });
const C = (fn: BuiltinFunction, ...args: Expression[]): Expression => ({ kind: "call", fn, args });
const O = (id: Expression, ...path: string[]): Expression => ({ kind: "objectRef", objectId: id, path });
const limits = { maxEventsPerRoot: 1024, maxActionsPerRoot: 10000, maxEventDepth: 32, maxExpressionNodes: 50000, maxCollectionSize: 4096 };
function base(id: string, width: number, height: number): GameDefinition {
  return { schemaVersion: 1, engineVersion: "0.1", id, stepMs: 100, spaces: [{ id: "board", kind: "squareGrid", width, height }], zones: ["reserve"], players: ["A", "B"], objectTypes: [], initialObjects: [], initialVariables: {}, rules: [], limits: { ...limits } };
}
export function countdownSample(): GameDefinition {
  const d = base("countdown", 1, 1); d.initialVariables = { countdown: 3 };
  d.rules = [
    { id: "clock.decrement", on: "clock.tick", priority: 0, order: 0, when: C("gt", G("countdown"), L(0)), actions: [{ kind: "setGameVar", key: "countdown", value: C("sub", G("countdown"), L(1)) }] },
    { id: "clock.finish", on: "clock.tick", priority: 0, order: 1, when: C("eq", G("countdown"), L(0)), actions: [{ kind: "finish", result: L({ reason: "timeUp" }) }] }
  ]; return d;
}
export function walkerSample(): GameDefinition {
  const d = base("walker", 5, 1); d.objectTypes = [{ id: "walker", defaults: {} }];
  d.initialObjects = [{ id: "walker-1", typeId: "walker", ownerId: "A", position: { kind: "grid", spaceId: "board", x: 3, y: 0 }, properties: {} }];
  d.rules = [
    { id: "walker.advance", on: "clock.tick", priority: 0, order: 0, actions: [{ kind: "forEach", list: C("objectsByType", L("walker")), as: "walkerId", actions: [{ kind: "if", condition: C("lt", O(X("walkerId"), "position", "x"), L(4)), then: [{ kind: "setObject", objectId: X("walkerId"), field: "position", value: C("offset", O(X("walkerId"), "position"), L(1), L(0)) }] }] }] },
    { id: "walker.changeOwner", on: "object.changed", priority: 0, order: 0, when: C("and", C("eq", E("field"), L("position")), C("eq", E("after", "x"), L(4))), actions: [{ kind: "setObject", objectId: E("objectId"), field: "ownerId", value: L("B") }] }
  ]; return d;
}
export function stoneSample(): GameDefinition {
  const d = base("stones", 5, 5); d.objectTypes = [{ id: "stone", defaults: {} }];
  d.rules = [
    { id: "stone.place", on: "input.placeStone", priority: 0, order: 0, actions: [
      { kind: "if", condition: C("eq", E("actorId"), L(null)), then: [{ kind: "reject", code: "ACTOR_REQUIRED" }] },
      { kind: "if", condition: C("gt", C("count", C("objectsAt", E("data", "position"))), L(0)), then: [{ kind: "reject", code: "OCCUPIED" }] },
      { kind: "createObject", typeId: "stone", ownerId: E("actorId"), position: E("data", "position") },
      { kind: "emit", eventType: "stone.placed", delayTicks: 0, payload: { position: E("data", "position"), ownerId: E("actorId"), spaceId: E("data", "position", "spaceId") } }
    ] },
    { id: "stone.flip", on: "stone.placed", priority: 10, order: 0, actions: [{ kind: "forEach", list: C("flipTargets", E("position"), E("ownerId"), L("stone")), as: "stoneId", actions: [{ kind: "setObject", objectId: X("stoneId"), field: "ownerId", value: E("ownerId") }] }] },
    { id: "stone.capture", on: "stone.placed", priority: 20, order: 0, actions: [{ kind: "forEach", list: C("groupsWithoutLiberties", E("spaceId"), L("stone")), as: "stoneId", actions: [{ kind: "removeObject", objectId: X("stoneId") }] }] }
  ]; return d;
}
