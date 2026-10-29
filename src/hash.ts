import type { GameState, JsonValue } from "./types";
import { json } from "./validation";

export function canonical(value: JsonValue): string {
  json(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value)!;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}
export function hash(value: JsonValue): string {
  const data = new TextEncoder().encode(canonical(value));
  let h = 0xcbf29ce484222325n;
  for (const byte of data) { h ^= BigInt(byte); h = BigInt.asUintN(64, h * 0x100000001b3n); }
  return h.toString(16).padStart(16, "0");
}
export function stateHash(state: GameState): string { return hash(state as unknown as JsonValue); }
