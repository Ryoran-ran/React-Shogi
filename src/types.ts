export type Id = string;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Position = { kind: "grid"; spaceId: Id; x: number; y: number } | { kind: "zone"; zoneId: Id };
export interface SquareGrid { id: Id; kind: "squareGrid"; width: number; height: number; blocked?: Array<{ x: number; y: number }> }
export interface ObjectTypeDefinition { id: Id; defaults: Record<string, JsonValue> }
export interface GameObject { id: Id; typeId: Id; ownerId: Id | null; position: Position; properties: Record<string, JsonValue> }
export interface EngineLimits { maxEventsPerRoot: number; maxActionsPerRoot: number; maxEventDepth: number; maxExpressionNodes: number; maxCollectionSize: number }
export interface GameDefinition {
  schemaVersion: 1; engineVersion: "0.1"; id: Id; stepMs: number; spaces: SquareGrid[]; zones: Id[];
  players: Id[]; objectTypes: ObjectTypeDefinition[]; initialObjects: GameObject[];
  initialVariables: Record<string, JsonValue>; rules: RuleDefinition[]; limits: EngineLimits;
}
export type RootLane = "timer" | "input" | "tick";
export interface GameEvent { id: Id; type: string; payload: Record<string, JsonValue>; dueTick: number; lane: RootLane; sequence: number; rootId: Id; causationId: Id | null; depth: number }
export interface GameState {
  status: "ready" | "running" | "paused" | "finished" | "faulted"; tick: number; revision: number;
  objects: Record<Id, GameObject>; variables: Record<string, JsonValue>; pending: GameEvent[];
  rngState: number; nextSequence: number; nextObjectNumber: number; result: JsonValue | null;
}
export interface InputCommand { id: Id; actorId: Id | null; kind: string; payload: Record<string, JsonValue>; expectedRevision?: number }
export interface CommandLogEntry { command: InputCommand; receivedSequence: number; receivedTick: number; outcome: "queued" | "applied" | "rejected" | "faulted"; code?: string }
export type EngineOutcome = { status: "queued"; eventId: Id } | { status: "applied" | "finished"; rootId: Id; revision: number } | { status: "rejected" | "faulted"; rootId?: Id; code: string };
export interface RuleEngine { getSnapshot(): GameState; submitCommand(command: InputCommand): EngineOutcome; advanceOneTick(): EngineOutcome[]; start(): void; pause(): void; resume(): void; step(): EngineOutcome[] }
export type BuiltinFunction = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "and" | "or" | "not" | "add" | "sub" | "mod" | "count" | "objectsAt" | "offset" | "neighbors4" | "objectsByType" | "flipTargets" | "groupsWithoutLiberties" | "randomInt";
export type Expression = { kind: "literal"; value: JsonValue } | { kind: "ref"; scope: "game" | "event" | "local"; path: string[] } | { kind: "objectRef"; objectId: Expression; path: string[] } | { kind: "call"; fn: BuiltinFunction; args: Expression[] };
export type Action =
  | { kind: "if"; condition: Expression; then: Action[]; else?: Action[] }
  | { kind: "forEach"; list: Expression; as: string; actions: Action[] }
  | { kind: "setGameVar"; key: string; value: Expression }
  | { kind: "setObject"; objectId: Expression; field: "ownerId" | "position" | "property"; key?: string; value: Expression }
  | { kind: "createObject"; typeId: Id; ownerId: Expression; position: Expression; properties?: Record<string, Expression> }
  | { kind: "removeObject"; objectId: Expression }
  | { kind: "emit"; eventType: string; payload: Record<string, Expression>; delayTicks: number }
  | { kind: "reject"; code: string }
  | { kind: "finish"; result: Expression };
export interface RuleDefinition { id: Id; on: string; priority: number; order: number; when?: Expression; actions: Action[] }
export interface ExecutionLogEntry { tick: number; rootId: Id; events: Id[]; rules: Id[]; changes: Array<{ action: string; before?: JsonValue; after?: JsonValue }>; outcome: "applied" | "finished" | "rejected" | "faulted"; code?: string; stateHash?: string }
export interface EngineSession { definitionHash: string; state: GameState; commands: CommandLogEntry[]; executions: ExecutionLogEntry[] }
