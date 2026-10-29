import type { CommandLogEntry, EngineSession, GameDefinition, JsonValue } from "./types";
import { GameRuleEngine } from "./engine";
import { hash } from "./hash";
import { fail } from "./validation";

export function replay(definition: GameDefinition, seed: number, commands: CommandLogEntry[], throughTick: number): EngineSession {
  if (!Number.isSafeInteger(throughTick) || throughTick < 0) fail("INVALID_TICK");
  const engine = new GameRuleEngine(definition, seed);
  engine.start();
  const sorted = [...commands].sort((a, b) => a.receivedTick - b.receivedTick || a.receivedSequence - b.receivedSequence);
  let index = 0;
  for (let tick = 0; tick <= throughTick; tick++) {
    while (index < sorted.length && sorted[index].receivedTick === tick) {
      engine.submitCommand(sorted[index].command); index++;
    }
    if (tick < throughTick && engine.getSnapshot().status === "running") engine.advanceOneTick();
  }
  if (index !== sorted.length) fail("REPLAY_INPUT_OUT_OF_RANGE");
  return engine.getSession();
}
export function verifyReplay(definition: GameDefinition, seed: number, session: EngineSession): boolean {
  if (session.definitionHash !== hash(definition as unknown as JsonValue)) return false;
  const rerun = replay(definition, seed, session.commands, session.state.tick);
  return rerun.executions.length === session.executions.length && rerun.executions.every((entry, i) => entry.stateHash === session.executions[i].stateHash && entry.rootId === session.executions[i].rootId);
}
