import type { Action, CommandLogEntry, EngineOutcome, EngineSession, ExecutionLogEntry, GameDefinition, GameEvent, GameObject, GameState, InputCommand, JsonValue, Position, RuleEngine } from "./types";
import { evaluate, type EvalContext } from "./evaluator";
import { hash, stateHash } from "./hash";
import { clone, deepFreeze, EngineError, equal, fail, json, jsonRecord, safeKey, validateDefinition, validateObject, validateOwner, validatePosition, validateState } from "./validation";

const laneRank = { timer: 0, input: 1, tick: 2 };
function order(a: GameEvent, b: GameEvent): number { return a.dueTick - b.dueTick || laneRank[a.lane] - laneRank[b.lane] || a.sequence - b.sequence; }
function sortedRules(d: GameDefinition, type: string) { return d.rules.filter(r => r.on === type).sort((a, b) => a.priority - b.priority || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); }
function assertId(v: JsonValue): asserts v is string { if (typeof v !== "string" || !v) fail("EXPRESSION_TYPE"); }
function nextEvent(state: GameState, type: string, payload: Record<string, JsonValue>, dueTick: number, lane: GameEvent["lane"], parent?: GameEvent): GameEvent {
  if (!Number.isSafeInteger(state.nextSequence + 1)) fail("SEQUENCE_LIMIT");
  if (!Number.isSafeInteger(dueTick) || dueTick < 0) fail("TICK_LIMIT");
  const sequence = state.nextSequence++, id = `evt-${sequence}`;
  return { id, type, payload: clone(payload), dueTick, lane, sequence, rootId: parent && lane !== "timer" ? parent.rootId : id, causationId: parent?.id ?? null, depth: parent && lane !== "timer" ? parent.depth + 1 : 0 };
}
export function initialState(definition: GameDefinition, seed = 1): GameState {
  if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffffffff) fail("INVALID_SEED");
  const objects: Record<string, GameObject> = Object.create(null);
  for (const raw of definition.initialObjects) {
    const type = definition.objectTypes.find(t => t.id === raw.typeId)!;
    objects[raw.id] = { ...clone(raw), properties: { ...clone(type.defaults), ...clone(raw.properties) } };
  }
  const nextObjectNumber = Math.max(0, ...definition.initialObjects.map(o => /^obj-(\d+)$/.exec(o.id)).filter((match): match is RegExpExecArray => !!match).map(match => Number(match[1]))) + 1;
  if (!Number.isSafeInteger(nextObjectNumber)) fail("OBJECT_NUMBER_LIMIT");
  return { status: "ready", tick: 0, revision: 0, objects, variables: clone(definition.initialVariables), pending: [], rngState: seed, nextSequence: 1, nextObjectNumber, result: null };
}
export class GameRuleEngine implements RuleEngine {
  readonly definition: GameDefinition;
  private state: GameState;
  private commands: CommandLogEntry[];
  private executions: ExecutionLogEntry[];
  private readonly definitionHash: string;
  constructor(definition: unknown, seed = 1, session?: EngineSession) {
    this.definition = deepFreeze(validateDefinition(definition));
    this.definitionHash = hash(this.definition as unknown as JsonValue);
    if (session) {
      if (session.definitionHash !== this.definitionHash) fail("DEFINITION_MISMATCH");
      validateState(session.state, this.definition);
      if (!Array.isArray(session.commands) || !Array.isArray(session.executions)) fail("INVALID_SESSION");
      this.state = clone(session.state); this.commands = clone(session.commands); this.executions = clone(session.executions);
    } else { this.state = initialState(this.definition, seed); this.commands = []; this.executions = []; }
  }
  getSnapshot(): GameState { return clone(this.state); }
  getSession(): EngineSession { return clone({ definitionHash: this.definitionHash, state: this.state, commands: this.commands, executions: this.executions }); }
  start(): void { if (this.state.status === "ready" || this.state.status === "paused") this.state.status = "running"; }
  pause(): void { if (this.state.status === "running") this.state.status = "paused"; }
  resume(): void { this.start(); }
  step(): EngineOutcome[] { if (this.state.status !== "paused") return []; this.state.status = "running"; const result = this.advanceOneTick(); if (this.state.status === "running") this.state.status = "paused"; return result; }
  submitCommand(command: InputCommand): EngineOutcome {
    if (this.state.status !== "running") return { status: "rejected", code: "NOT_RUNNING" };
    if (!command || typeof command !== "object") return { status: "rejected", code: "INVALID_COMMAND" };
    try {
      safeKey(command.id); safeKey(command.kind); if (command.actorId !== null) safeKey(command.actorId);
      jsonRecord(command.payload);
      if (command.expectedRevision !== undefined && (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0)) fail("INVALID_REVISION");
      if (this.commands.some(e => e.command.id === command.id)) fail("DUPLICATE_COMMAND");
      if (command.expectedRevision !== undefined && command.expectedRevision !== this.state.revision) {
        const receivedSequence = this.state.nextSequence++;
        this.commands.push({ command: clone(command), receivedSequence, receivedTick: this.state.tick, outcome: "rejected", code: "STALE_REVISION" });
        return { status: "rejected", code: "STALE_REVISION" };
      }
      const event = nextEvent(this.state, `input.${command.kind}`, { actorId: command.actorId, data: clone(command.payload) }, this.state.tick + 1, "input");
      this.state.pending.push(event);
      this.commands.push({ command: clone(command), receivedSequence: event.sequence, receivedTick: this.state.tick, outcome: "queued" });
      return { status: "queued", eventId: event.id };
    } catch (error) { return { status: "rejected", code: error instanceof EngineError ? error.code : "INVALID_COMMAND" }; }
  }
  advanceOneTick(): EngineOutcome[] {
    if (this.state.status !== "running") return [];
    if (!Number.isSafeInteger(this.state.tick + 1)) { this.state.status = "faulted"; return [{ status: "faulted", code: "TICK_LIMIT" }]; }
    this.state.tick++;
    const tickEvent = nextEvent(this.state, "clock.tick", {}, this.state.tick, "tick");
    this.state.pending.push(tickEvent);
    this.state.pending.sort(order);
    const outcomes: EngineOutcome[] = [];
    while (this.state.status === "running") {
      const index = this.state.pending.findIndex(e => e.dueTick <= this.state.tick);
      if (index < 0) break;
      const root = this.state.pending.splice(index, 1)[0];
      const outcome = this.processRoot(root); outcomes.push(outcome);
      if (outcome.status === "faulted" || outcome.status === "finished") break;
    }
    return outcomes;
  }
  private processRoot(root: GameEvent): EngineOutcome {
    const log: ExecutionLogEntry = { tick: this.state.tick, rootId: root.id, events: [], rules: [], changes: [], outcome: "applied" };
    const entry = root.lane === "input" ? this.commands.find(e => e.receivedSequence === root.sequence) : undefined;
    const rejectRoot = (code: string): EngineOutcome => { if (entry) { entry.outcome = "rejected"; entry.code = code; } log.outcome = "rejected"; log.code = code; log.stateHash = stateHash(this.state); this.executions.push(log); return { status: "rejected", rootId: root.id, code }; };
    if (entry?.command.expectedRevision !== undefined && entry.command.expectedRevision !== this.state.revision) return rejectRoot("STALE_REVISION");
    if (root.lane === "input" && !sortedRules(this.definition, root.type).length) return rejectRoot("UNHANDLED_INPUT");
    const draft = clone(this.state), queue = [root], nodes = { value: 0 }, budget = { events: 0, actions: 0 };
    let current = root;
    const enqueue = (type: string, payload: Record<string, JsonValue>, delay = 0) => {
      const timer = delay > 0;
      const ev = nextEvent(draft, type, payload, draft.tick + delay, timer ? "timer" : current.lane, current);
      if (timer) draft.pending.push(ev);
      else { if (ev.depth > this.definition.limits.maxEventDepth) fail("EVENT_DEPTH_LIMIT"); queue.push(ev); }
    };
    const execute = (actions: Action[], ctx: EvalContext): void => {
      for (const action of actions) {
        if (++budget.actions > this.definition.limits.maxActionsPerRoot) fail("ACTION_LIMIT");
        const evalValue = (expr: Parameters<typeof evaluate>[0]) => evaluate(expr, ctx);
        switch (action.kind) {
          case "if": { const cond = evalValue(action.condition); if (typeof cond !== "boolean") fail("EXPRESSION_TYPE"); execute(cond ? action.then : action.else ?? [], ctx); break; }
          case "forEach": {
            const list = evalValue(action.list); if (!Array.isArray(list) || list.length > this.definition.limits.maxCollectionSize) fail("COLLECTION_LIMIT");
            for (const item of list) { const prior = ctx.locals; ctx.locals = { ...prior, [action.as]: clone(item) }; try { execute(action.actions, ctx); } finally { ctx.locals = prior; } if (draft.status === "finished") break; }
            break;
          }
          case "setGameVar": { const value = evalValue(action.value); const before = draft.variables[action.key]; draft.variables[action.key] = clone(value); log.changes.push({ action: "setGameVar", before, after: value }); break; }
          case "setObject": {
            const id = evalValue(action.objectId); assertId(id); const obj = draft.objects[id]; if (!obj) fail("UNKNOWN_OBJECT");
            const value = evalValue(action.value);
            if (action.field === "ownerId") validateOwner(value, this.definition);
            else if (action.field === "position") validatePosition(value, this.definition);
            else json(value);
            const before = action.field === "property" ? obj.properties[action.key!] : obj[action.field];
            if (equal(before, value)) break;
            if (action.field === "property") obj.properties[action.key!] = clone(value);
            else if (action.field === "ownerId") obj.ownerId = value as string | null;
            else obj.position = clone(value as Position);
            const payload: Record<string, JsonValue> = { objectId: id, field: action.field, before: before === undefined ? null : clone(before) as JsonValue, after: clone(value) };
            if (action.field === "property") payload.key = action.key!;
            enqueue("object.changed", payload);
            log.changes.push({ action: "setObject", before: clone(before) as JsonValue | undefined, after: clone(value) }); break;
          }
          case "createObject": {
            const ownerId = evalValue(action.ownerId), position = evalValue(action.position);
            validateOwner(ownerId, this.definition); validatePosition(position, this.definition);
            const properties = clone(this.definition.objectTypes.find(t => t.id === action.typeId)!.defaults);
            for (const [key, expr] of Object.entries(action.properties ?? {})) properties[key] = evalValue(expr);
            const id = `obj-${draft.nextObjectNumber++}`; if (draft.objects[id]) fail("DUPLICATE_ID");
            const obj: GameObject = { id, typeId: action.typeId, ownerId, position: clone(position), properties };
            validateObject(obj, this.definition); draft.objects[id] = obj;
            enqueue("object.created", { objectId: id, object: clone(obj) as unknown as JsonValue }); log.changes.push({ action: "createObject", after: clone(obj) as unknown as JsonValue }); break;
          }
          case "removeObject": {
            const id = evalValue(action.objectId); assertId(id); const obj = draft.objects[id]; if (!obj) fail("UNKNOWN_OBJECT");
            delete draft.objects[id]; enqueue("object.removed", { objectId: id, object: clone(obj) as unknown as JsonValue }); log.changes.push({ action: "removeObject", before: clone(obj) as unknown as JsonValue }); break;
          }
          case "emit": { const payload: Record<string, JsonValue> = {}; for (const [key, expr] of Object.entries(action.payload)) payload[key] = evalValue(expr); enqueue(action.eventType, payload, action.delayTicks); break; }
          case "reject": throw new EngineError("REJECTED", action.code);
          case "finish": draft.result = evalValue(action.result); draft.status = "finished"; break;
        }
        if (draft.status === "finished") return;
      }
    };
    try {
      while (queue.length && draft.status !== "finished") {
        current = queue.shift()!;
        if (++budget.events > this.definition.limits.maxEventsPerRoot) fail("EVENT_LIMIT");
        if (current.depth > this.definition.limits.maxEventDepth) fail("EVENT_DEPTH_LIMIT");
        log.events.push(current.id);
        const rules = sortedRules(this.definition, current.type);
        const ctx: EvalContext = { definition: this.definition, state: draft, event: current, locals: {}, nodes };
        for (const rule of rules) {
          if (rule.when) { const condition = evaluate(rule.when, ctx); if (typeof condition !== "boolean") fail("EXPRESSION_TYPE"); if (!condition) continue; }
          log.rules.push(rule.id); execute(rule.actions, ctx); if (draft.status === "finished") break;
        }
      }
      draft.revision++; draft.pending.sort(order); this.state = draft;
      if (entry) entry.outcome = "applied";
      log.outcome = draft.status === "finished" ? "finished" : "applied"; log.stateHash = stateHash(this.state); this.executions.push(log);
      return { status: log.outcome, rootId: root.id, revision: draft.revision };
    } catch (error) {
      const code = error instanceof EngineError ? error.code === "REJECTED" ? error.message : error.code : "INTERNAL_ERROR";
      if (error instanceof EngineError && error.code === "REJECTED" && root.lane === "input") return rejectRoot(code);
      this.state.status = "faulted"; if (entry) { entry.outcome = "faulted"; entry.code = code; }
      log.outcome = "faulted"; log.code = code; log.stateHash = stateHash(this.state); this.executions.push(log);
      return { status: "faulted", rootId: root.id, code };
    }
  }
}
