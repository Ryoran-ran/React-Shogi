import { validatePassLimit, validatePosition } from "./shogi";
import type { Position } from "./shogi";
import { loadPieceRules, hasPieceLibrary } from "./pieces";
import type { PieceRules } from "./pieces";

export const SETUP_STORAGE_KEY = "shogi-setups.v1";
export const MAX_SETUP_NAME_LENGTH = 80;
export const MAX_LOCAL_SETUPS = 100;
export interface SavedSetup { kind: "shogi-setup"; version: 1 | 2 | 3; name: string; position: Position; passLimit: number | null; pieceRules?: PieceRules }
export interface LocalSetup { id: string; updatedAt: string; setup: SavedSetup }
type SetupStorage = Pick<Storage, "getItem" | "setItem">;

export function createSetup(position: Position, passLimit: number | null, name = "", pieceRules?: PieceRules): SavedSetup {
  const rules = loadPieceRules(pieceRules), custom = Object.keys(rules).length > 0;
  validatePosition(position, rules); validatePassLimit(passLimit);
  const title = name.trim() || `${position.width}×${position.height}の配置`;
  if (title.length > MAX_SETUP_NAME_LENGTH) throw new Error(`配置名は${MAX_SETUP_NAME_LENGTH}文字以内にしてください`);
  return { kind: "shogi-setup", version: hasPieceLibrary(rules) ? 3 : custom ? 2 : 1, name: title, position: structuredClone(position), passLimit, ...(custom ? { pieceRules: rules } : {}) };
}

export function loadSetup(data: unknown): SavedSetup {
  if (!data || typeof data !== "object") throw new Error("配置のJSONファイルではありません");
  const setup = data as SavedSetup;
  if (setup.kind !== "shogi-setup" || ![1, 2, 3].includes(setup.version) || typeof setup.name !== "string") throw new Error("対応していない配置データです。配置のJSONファイルを選んでください");
  if ((setup.version >= 2 && setup.pieceRules === undefined) || (setup.version === 1 && setup.pieceRules !== undefined)) throw new Error("駒の動きの保存形式が壊れています");
  if (setup.version < 3 && hasPieceLibrary(loadPieceRules(setup.pieceRules))) throw new Error("追加駒・デザインの保存形式が壊れています");
  return createSetup(setup.position, setup.passLimit, setup.name, setup.pieceRules);
}

export function availableSetupName(name: string, existingNames: readonly string[]): string {
  const base = (name.trim() || "新しい配置").slice(0, MAX_SETUP_NAME_LENGTH), used = new Set(existingNames);
  if (!used.has(base)) return base;
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? "のコピー" : `のコピー (${number})`;
    const candidate = `${base.slice(0, MAX_SETUP_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function copySetup(data: SavedSetup, existingNames: readonly string[] = []): SavedSetup {
  const source = loadSetup(data);
  return createSetup(source.position, source.passLimit, availableSetupName(source.name, [...existingNames, source.name]), source.pieceRules);
}

export function readLocalSetups(storage: SetupStorage): LocalSetup[] {
  try {
    const raw = storage.getItem(SETUP_STORAGE_KEY);
    if (raw === null) return [];
    const data = JSON.parse(raw);
    if (!data || data.kind !== "shogi-setup-library" || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > MAX_LOCAL_SETUPS) throw new Error("Invalid setup library");
    const ids = new Set<string>();
    return data.entries.map((entry: LocalSetup) => {
      if (!entry || typeof entry.id !== "string" || !entry.id || entry.id.length > 128 || ids.has(entry.id) || typeof entry.updatedAt !== "string" || !Number.isFinite(Date.parse(entry.updatedAt))) throw new Error("Invalid setup entry");
      ids.add(entry.id);
      return { id: entry.id, updatedAt: entry.updatedAt, setup: loadSetup(entry.setup) };
    });
  } catch { throw new Error("このブラウザの保存済み配置を読み込めません。ファイルへの出力・読み込みは利用できます。"); }
}

function writeLocalSetups(storage: SetupStorage, entries: LocalSetup[]): void {
  try { storage.setItem(SETUP_STORAGE_KEY, JSON.stringify({ kind: "shogi-setup-library", version: 1, entries })); }
  catch { throw new Error("このブラウザに配置を保存できません。ファイルに出力してください。"); }
}

export function saveLocalSetup(storage: SetupStorage, data: SavedSetup, id?: string): LocalSetup {
  const setup = loadSetup(data), entries = readLocalSetups(storage);
  if (id !== undefined && !entries.some(entry => entry.id === id)) throw new Error("上書き先の配置が見つかりません。「別名で保存」で新しく保存してください。");
  if (id === undefined && entries.length >= MAX_LOCAL_SETUPS) throw new Error(`ブラウザに保存できる配置は${MAX_LOCAL_SETUPS}件までです。不要な配置を削除するか、ファイルに出力してください。`);
  const entry = { id: id ?? crypto.randomUUID(), updatedAt: new Date().toISOString(), setup };
  writeLocalSetups(storage, [entry, ...entries.filter(previous => previous.id !== entry.id)]);
  return structuredClone(entry);
}

export function removeLocalSetup(storage: SetupStorage, id: string): void {
  const entries = readLocalSetups(storage);
  if (!entries.some(entry => entry.id === id)) throw new Error("削除する配置が見つかりません。");
  writeLocalSetups(storage, entries.filter(entry => entry.id !== id));
}

export function setupFilename(setup: SavedSetup): string {
  const name = setup.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[ .]+$/g, "").slice(0, MAX_SETUP_NAME_LENGTH) || "setup";
  return `shogi-setup-${name}.json`;
}
