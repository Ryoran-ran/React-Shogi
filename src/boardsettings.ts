export interface BoardSettings { selfCheck: boolean; nifu: boolean; pawnDropMate: boolean; useHands: boolean; promotionDepth: number | null }
export const DEFAULT_BOARD_SETTINGS: Readonly<BoardSettings> = Object.freeze({ selfCheck: true, nifu: true, pawnDropMate: true, useHands: true, promotionDepth: null });
export function loadBoardSettings(data: unknown = {}): BoardSettings {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("基本ルールの設定が壊れています");
  const raw = data as Record<string, unknown>;
  if (Object.keys(raw).some(key => !Object.prototype.hasOwnProperty.call(DEFAULT_BOARD_SETTINGS,key))) throw new Error("不明な基本ルールです");
  for (const key of ["selfCheck", "nifu", "pawnDropMate", "useHands"] as const) if (raw[key] !== undefined && typeof raw[key] !== "boolean") throw new Error("基本ルールは有効・無効で設定してください");
  if (raw.promotionDepth !== undefined && raw.promotionDepth !== null && (!Number.isInteger(raw.promotionDepth) || Number(raw.promotionDepth) < 0 || Number(raw.promotionDepth) > 15)) throw new Error("成り範囲は0〜15段、または標準にしてください");
  return { ...DEFAULT_BOARD_SETTINGS, ...raw } as BoardSettings;
}
export function boardSettings(position: { settings?: BoardSettings }): BoardSettings { return position.settings ? { ...DEFAULT_BOARD_SETTINGS, ...position.settings } : DEFAULT_BOARD_SETTINGS; }
export function configuredBoardSettings(data: unknown): BoardSettings | undefined {
  const settings = loadBoardSettings(data);
  return Object.keys(DEFAULT_BOARD_SETTINGS).every(key => settings[key as keyof BoardSettings] === DEFAULT_BOARD_SETTINGS[key as keyof BoardSettings]) ? undefined : settings;
}
