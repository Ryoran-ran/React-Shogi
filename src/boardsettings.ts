import type { Side } from "./shogi";
export interface PlayerBoardSettings { selfCheck: boolean; nifu: boolean; pawnDropMate: boolean; useHands: boolean; promotionDepth: number | null; noMoves: "loss" | "draw"; perpetualCheckLoses: boolean }
export type PlayerRuleOverrides = Partial<PlayerBoardSettings> & { name?: string };
export interface BoardSettings extends PlayerBoardSettings { repetitionLimit: number | null; playerRules?: Partial<Record<Side,PlayerRuleOverrides>> }
export const PLAYER_RULE_KEYS = ["selfCheck","nifu","pawnDropMate","useHands","promotionDepth","noMoves","perpetualCheckLoses"] as const;
export const DEFAULT_BOARD_SETTINGS: Readonly<BoardSettings> = Object.freeze({ selfCheck: true, nifu: true, pawnDropMate: true, useHands: true, promotionDepth: null, noMoves: "loss", repetitionLimit: 4, perpetualCheckLoses: true });
export function loadBoardSettings(data: unknown = {}): BoardSettings {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("基本ルールの設定が壊れています");
  const raw = data as Record<string, unknown>;
  if (Object.keys(raw).some(key => key!=="playerRules"&&!Object.prototype.hasOwnProperty.call(DEFAULT_BOARD_SETTINGS,key))) throw new Error("不明な基本ルールです");
  for (const key of ["selfCheck", "nifu", "pawnDropMate", "useHands", "perpetualCheckLoses"] as const) if (raw[key] !== undefined && typeof raw[key] !== "boolean") throw new Error("基本ルールは有効・無効で設定してください");
  if (raw.noMoves !== undefined && !["loss","draw"].includes(raw.noMoves as string)) throw new Error("指せる手がない場合の勝敗を選んでください");
  if (raw.repetitionLimit !== undefined && raw.repetitionLimit !== null && (!Number.isInteger(raw.repetitionLimit) || Number(raw.repetitionLimit)<2 || Number(raw.repetitionLimit)>20)) throw new Error("同一局面の上限は2〜20回、または無効にしてください");
  if (raw.promotionDepth !== undefined && raw.promotionDepth !== null && (!Number.isInteger(raw.promotionDepth) || Number(raw.promotionDepth) < 0 || Number(raw.promotionDepth) > 15)) throw new Error("成り範囲は0〜15段、または標準にしてください");
  const settings = { ...DEFAULT_BOARD_SETTINGS, ...raw } as BoardSettings;
  delete settings.playerRules;
  if(raw.playerRules!==undefined){
    if(!raw.playerRules||typeof raw.playerRules!=="object"||Array.isArray(raw.playerRules)||Object.keys(raw.playerRules).some(side=>side!=="sente"&&side!=="gote"))throw new Error("先後別のルールが壊れています");
    const players:BoardSettings["playerRules"]={};
    for(const [side,value] of Object.entries(raw.playerRules)){
      if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>key!=="name"&&!(PLAYER_RULE_KEYS as readonly string[]).includes(key)))throw new Error("先後別のルールが壊れています");
      const {name,...rules}=value as PlayerRuleOverrides;
      const validated=loadBoardSettings(rules),overrides:PlayerRuleOverrides={};
      for(const key of PLAYER_RULE_KEYS)if(Object.prototype.hasOwnProperty.call(rules,key)&&rules[key]!==undefined)Object.assign(overrides,{[key]:validated[key]});
      if(name!==undefined){if(typeof name!=="string"||[...name.trim()].length>20)throw new Error("先後の名前は20文字以内で指定してください");if(name.trim())overrides.name=name.trim();}
      if(Object.keys(overrides).length)players[side as Side]=overrides;
    }
    if(Object.keys(players).length)settings.playerRules=players;
  }
  return settings;
}
export function hasPlayerBoardRules(position:{settings?:BoardSettings}):boolean{return !!position.settings?.playerRules&&Object.keys(position.settings.playerRules).length>0;}
export function hasExtendedBoardSettings(position: {settings?:BoardSettings}): boolean { const settings=boardSettings(position);return settings.noMoves!=="loss"||settings.repetitionLimit!==4||settings.perpetualCheckLoses!==true; }
export function boardSettings(position: { settings?: BoardSettings },side?:Side): BoardSettings { return position.settings ? { ...DEFAULT_BOARD_SETTINGS, ...position.settings, ...(side?position.settings.playerRules?.[side]:{}) } : DEFAULT_BOARD_SETTINGS; }
export function configuredBoardSettings(data: unknown): BoardSettings | undefined {
  const settings = loadBoardSettings(data);
  return !settings.playerRules&&Object.keys(DEFAULT_BOARD_SETTINGS).every(key => settings[key as keyof BoardSettings] === DEFAULT_BOARD_SETTINGS[key as keyof BoardSettings]) ? undefined : settings;
}
