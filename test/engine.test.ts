import { describe, expect, test } from "bun:test";
import { GameRuleEngine } from "../src/engine";
import type { Action, Expression, GameDefinition, GameObject, RuleDefinition } from "../src/types";
import { validateDefinition } from "../src/validation";
import { countdownSample, stoneSample, walkerSample } from "../src/samples";
import { stateHash } from "../src/hash";
import { compileBlockRules } from "../src/blocks";
import { verifyReplay } from "../src/replay";

const L = (value: any): Expression => ({ kind: "literal", value });
const G = (key: string): Expression => ({ kind: "ref", scope: "game", path: [key] });
const E = (...path: string[]): Expression => ({ kind: "ref", scope: "event", path });
const X = (key: string): Expression => ({ kind: "ref", scope: "local", path: [key] });
const C = (fn: any, ...args: Expression[]): Expression => ({ kind: "call", fn, args });
const rule = (id: string, on: string, actions: Action[], priority = 0, order = 0, when?: Expression): RuleDefinition => ({ id, on, priority, order, actions, ...(when ? { when } : {}) });
const grid = (x: number, y: number) => ({ kind: "grid" as const, spaceId: "board", x, y });
const piece = (id: string, x: number, y: number, ownerId: string | null = "A", typeId = "stone"): GameObject => ({ id, typeId, ownerId, position: grid(x, y), properties: {} });
function definition(rules: RuleDefinition[] = [], initialObjects: GameObject[] = [], variables: Record<string, any> = {}): GameDefinition {
  return { schemaVersion: 1, engineVersion: "0.1", id: "game", stepMs: 100, spaces: [{ id: "board", kind: "squareGrid", width: 5, height: 5 }], zones: ["reserve"], players: ["A", "B"], objectTypes: [{ id: "stone", defaults: {} }, { id: "walker", defaults: {} }], initialObjects, initialVariables: variables, rules, limits: { maxEventsPerRoot: 1024, maxActionsPerRoot: 10000, maxEventDepth: 32, maxExpressionNodes: 50000, maxCollectionSize: 4096 } };
}
function run(d: GameDefinition, command?: { id: string; kind: string; payload?: Record<string, any>; expectedRevision?: number }) {
  const engine = new GameRuleEngine(d); engine.start();
  if (command) engine.submitCommand({ id: command.id, kind: command.kind, actorId: "A", payload: command.payload ?? {}, expectedRevision: command.expectedRevision });
  return { engine, outcomes: engine.advanceOneTick() };
}

describe("rule engine", () => {
  test("sorts rules and later conditions read earlier changes", () => {
    const d = definition([
      rule("last", "clock.tick", [{ kind: "setGameVar", key: "trace", value: C("add", G("trace"), L(100)) }], 20),
      rule("b", "clock.tick", [{ kind: "setGameVar", key: "trace", value: C("add", G("trace"), L(10)) }], 10, 0, C("eq", G("trace"), L(1))),
      rule("a", "clock.tick", [{ kind: "setGameVar", key: "trace", value: L(1) }], 10, 0)
    ], [], { trace: 0 });
    const { engine } = run(d);
    expect(engine.getSnapshot().variables.trace).toBe(111);
    expect(engine.getSession().executions[0].rules).toEqual(["a", "b", "last"]);
  });

  test("processes child events breadth first and root lanes in order", () => {
    const append = (value: number): Action => ({ kind: "setGameVar", key: "trace", value: C("add", G("trace"), L(value)) });
    const d = definition([
      rule("timer", "clock.tick", [{ kind: "emit", eventType: "later", payload: {}, delayTicks: 1 }]),
      rule("later", "later", [append(1)]),
      rule("input", "input.go", [append(2), { kind: "emit", eventType: "B", payload: {}, delayTicks: 0 }, { kind: "emit", eventType: "C", payload: {}, delayTicks: 0 }]),
      rule("b", "B", [append(3), { kind: "emit", eventType: "D", payload: {}, delayTicks: 0 }]),
      rule("c", "C", [append(4)]), rule("d", "D", [append(5)])
    ], [], { trace: 0 });
    const engine = new GameRuleEngine(d); engine.start(); engine.advanceOneTick();
    engine.submitCommand({ id: "one", actorId: "A", kind: "go", payload: {} });
    engine.advanceOneTick();
    expect(engine.getSnapshot().variables.trace).toBe(15);
    expect(engine.getSession().executions.slice(-3).map(x => x.rules[0])).toEqual(["later", "input", "timer"]);
    expect(engine.getSession().executions.at(-2)?.rules).toEqual(["input", "b", "c", "d"]);
  });

  test("reject rolls back child changes, random state, timers and numbering", () => {
    const d = definition([
      rule("go", "input.go", [{ kind: "setGameVar", key: "roll", value: C("randomInt", L(1), L(9)) }, { kind: "createObject", typeId: "stone", ownerId: L("A"), position: L(grid(1, 1)) }, { kind: "emit", eventType: "future", payload: {}, delayTicks: 2 }, { kind: "emit", eventType: "deny", payload: {}, delayTicks: 0 }]),
      rule("deny", "deny", [{ kind: "reject", code: "NO" }])
    ], [], { roll: 0 });
    const engine = new GameRuleEngine(d, 123); engine.start();
    const queued = engine.submitCommand({ id: "one", actorId: "A", kind: "go", payload: {} });
    const before = engine.getSnapshot();
    const outcomes = engine.advanceOneTick();
    expect(queued.status).toBe("queued"); expect(outcomes[0]).toMatchObject({ status: "rejected", code: "NO" });
    const after = engine.getSnapshot();
    expect(after.variables).toEqual(before.variables); expect(after.objects).toEqual(before.objects);
    expect(after.rngState).toBe(before.rngState); expect(after.nextObjectNumber).toBe(before.nextObjectNumber);
    expect(after.nextSequence).toBe(before.nextSequence + 1); // clock root is allocated outside the rejected transaction
    expect(after.pending).toEqual([]); expect(after.revision).toBe(1); // clock root commits
  });

  test("checks duplicate, stale and unhandled input at their specified stages", () => {
    const d = definition([rule("pass", "input.pass", [{ kind: "setGameVar", key: "passes", value: C("add", G("passes"), L(1)) }])], [], { passes: 0 });
    const engine = new GameRuleEngine(d); engine.start();
    expect(engine.submitCommand({ id: "a", actorId: "A", kind: "pass", payload: {}, expectedRevision: 0 }).status).toBe("queued");
    expect(engine.submitCommand({ id: "a", actorId: "A", kind: "pass", payload: {} })).toMatchObject({ status: "rejected", code: "DUPLICATE_COMMAND" });
    expect(engine.submitCommand({ id: "b", actorId: "A", kind: "missing", payload: {} }).status).toBe("queued");
    expect(engine.advanceOneTick().map(o => o.status)).toEqual(["applied", "rejected", "applied"]);
    expect(engine.getSnapshot().variables.passes).toBe(1);
    expect(engine.submitCommand({ id: "c", actorId: "A", kind: "pass", payload: {}, expectedRevision: 0 })).toMatchObject({ status: "rejected", code: "STALE_REVISION" });
    expect(engine.getSession().commands.at(-1)?.code).toBe("STALE_REVISION");
  });

  test("a timer commit makes a queued revision stale before execution", () => {
    const d = definition([
      rule("schedule", "clock.tick", [{ kind: "emit", eventType: "timer", payload: {}, delayTicks: 1 }]),
      rule("timer", "timer", [{ kind: "setGameVar", key: "n", value: L(1) }]),
      rule("input", "input.go", [{ kind: "setGameVar", key: "n", value: L(2) }])
    ], [], { n: 0 });
    const engine = new GameRuleEngine(d); engine.start(); engine.advanceOneTick();
    expect(engine.submitCommand({ id: "go", actorId: "A", kind: "go", payload: {}, expectedRevision: 1 }).status).toBe("queued");
    expect(engine.advanceOneTick().map(o => o.status)).toEqual(["applied", "rejected", "applied"]);
    expect(engine.getSnapshot().variables.n).toBe(1);
    expect(engine.getSession().commands[0].code).toBe("STALE_REVISION");
  });

  test("faults one root and preserves later roots", () => {
    const d = definition([rule("bad", "input.bad", [{ kind: "setObject", objectId: L("missing"), field: "ownerId", value: L("B") }]), rule("good", "input.good", [{ kind: "setGameVar", key: "x", value: L(1) }])], [], { x: 0 });
    const engine = new GameRuleEngine(d); engine.start();
    engine.submitCommand({ id: "bad", actorId: "A", kind: "bad", payload: {} });
    engine.submitCommand({ id: "good", actorId: "A", kind: "good", payload: {} });
    expect(engine.advanceOneTick()[0]).toMatchObject({ status: "faulted", code: "UNKNOWN_OBJECT" });
    expect(engine.getSnapshot().status).toBe("faulted");
    expect(engine.getSnapshot().pending.map(e => e.type)).toEqual(["input.good", "clock.tick"]);
    expect(engine.getSnapshot().variables.x).toBe(0);
  });

  test("supports pause, step, fixed ticks and finish", () => {
    const d = definition([
      rule("decrement", "clock.tick", [{ kind: "setGameVar", key: "countdown", value: C("sub", G("countdown"), L(1)) }], 0, 0, C("gt", G("countdown"), L(0))),
      rule("finish", "clock.tick", [{ kind: "finish", result: L({ reason: "timeUp" }) }], 0, 1, C("eq", G("countdown"), L(0)))
    ], [], { countdown: 3 });
    const engine = new GameRuleEngine(d); engine.start(); engine.advanceOneTick(); engine.pause();
    expect(engine.advanceOneTick()).toEqual([]); expect(engine.getSnapshot().tick).toBe(1);
    engine.step(); expect(engine.getSnapshot().status).toBe("paused");
    engine.resume(); engine.advanceOneTick();
    expect(engine.getSnapshot()).toMatchObject({ tick: 3, status: "finished", result: { reason: "timeUp" }, variables: { countdown: 0 } });
    expect(engine.getSnapshot().tick * d.stepMs).toBe(300);
  });

  test("allows stacking and zone movement; applies object change child in one commit", () => {
    const walker = piece("walker-1", 3, 0, "A", "walker");
    const d = definition([
      rule("move", "clock.tick", [{ kind: "setObject", objectId: L("walker-1"), field: "position", value: C("offset", L(grid(3, 0)), L(1), L(0)) }]),
      rule("owner", "object.changed", [{ kind: "setObject", objectId: E("objectId"), field: "ownerId", value: L("B") }], 0, 0, C("eq", E("field"), L("position")))
    ], [walker, piece("stone-1", 0, 0), piece("stone-2", 0, 0)]);
    const { engine } = run(d);
    expect(engine.getSnapshot().objects["walker-1"]).toMatchObject({ ownerId: "B", position: grid(4, 0) });
    expect(engine.getSnapshot().revision).toBe(1);
    expect(Object.values(engine.getSnapshot().objects).filter(o => o.position.kind === "grid" && o.position.x === 0 && o.position.y === 0)).toHaveLength(2);
    expect(validateDefinition({ ...d, initialObjects: [piece("zone-piece", 0, 0), ...d.initialObjects] })).toBeTruthy();
  });

  test("moving to a zone keeps the object identity", () => {
    const d = definition([rule("reserve", "input.reserve", [{ kind: "setObject", objectId: L("stone-1"), field: "position", value: L({ kind: "zone", zoneId: "reserve" }) }])], [piece("stone-1", 0, 0)]);
    const { engine } = run(d, { id: "reserve", kind: "reserve" });
    expect(engine.getSnapshot().objects["stone-1"].position).toEqual({ kind: "zone", zoneId: "reserve" });
    expect(Object.keys(engine.getSnapshot().objects)).toContain("stone-1");
  });

  test("loads saved sessions and gives deterministic state and event order", () => {
    const d = definition([rule("roll", "input.roll", [{ kind: "setGameVar", key: "n", value: C("randomInt", L(1), L(100)) }])], [], { n: 0 });
    const one = new GameRuleEngine(d, 77); one.start(); one.submitCommand({ id: "a", actorId: "A", kind: "roll", payload: {} });
    const saved = one.getSession(); const two = new GameRuleEngine(d, 1, saved);
    one.advanceOneTick(); two.advanceOneTick();
    expect(two.getSession()).toEqual(one.getSession());
    expect(stateHash(two.getSnapshot())).toBe(stateHash(one.getSnapshot()));
    expect(verifyReplay(d, 77, one.getSession())).toBe(true);
    expect(verifyReplay(d, 78, one.getSession())).toBe(false);
    const snapshot = one.getSnapshot(); snapshot.variables.n = 999; expect(one.getSnapshot().variables.n).not.toBe(999);
  });

  test("sample definitions load and stone rules flip before capture in one commit", () => {
    expect(validateDefinition(countdownSample())).toBeTruthy();
    expect(validateDefinition(walkerSample())).toBeTruthy();
    const d = stoneSample();
    d.initialObjects = [
      piece("a-left", 0, 1), piece("b-flip", 1, 1, "B"),
      piece("b-capture", 1, 2, "B"), piece("a-west", 0, 2),
      piece("a-east", 2, 2), piece("a-south", 1, 3)
    ];
    const { engine, outcomes } = run(d, { id: "place", kind: "placeStone", payload: { position: grid(2, 1) } });
    expect(outcomes[0].status).toBe("applied");
    expect(engine.getSnapshot().objects["b-flip"].ownerId).toBe("A");
    expect(engine.getSnapshot().objects["b-capture"]).toBeUndefined();
    expect(engine.getSnapshot().revision).toBe(2); // input root and clock root
    expect(engine.getSession().executions[0].rules).toEqual(["stone.place", "stone.flip", "stone.capture"]);
  });

  test("rejects unsafe AST, forbidden paths and nonfinite data", () => {
    expect(() => validateDefinition(definition([rule("bad", "clock.tick", [{ kind: "setGameVar", key: "x", value: C("eval", L(1)) }])]))).toThrow();
    expect(() => validateDefinition(definition([rule("bad", "clock.tick", [{ kind: "setGameVar", key: "x", value: { kind: "ref", scope: "game", path: ["__proto__"] } }])]))).toThrow();
    expect(() => validateDefinition(definition([], [], { bad: Infinity }))).toThrow();
  });

  test("bounds event chains and expands a block macro into ordinary AST", () => {
    const d = definition([rule("loop", "input.loop", [{ kind: "emit", eventType: "input.loop", payload: {}, delayTicks: 0 }])]);
    d.limits.maxEventsPerRoot = 3;
    const { engine, outcomes } = run(d, { id: "loop", kind: "loop" });
    expect(outcomes[0]).toMatchObject({ status: "faulted", code: "EVENT_LIMIT" });
    expect(engine.getSnapshot().revision).toBe(0);
    const blockDefinition = compileBlockRules({ ...stoneSample(), rules: undefined } as any, [
      { id: "flip", on: "stone.placed", priority: 0, order: 0, actions: [{ kind: "flipStones", position: E("position"), ownerId: E("ownerId"), typeId: "stone" }] }
    ]);
    expect(blockDefinition.rules[0].actions[0].kind).toBe("forEach");
    expect(JSON.stringify(blockDefinition)).not.toContain("flipStones");
  });
});
