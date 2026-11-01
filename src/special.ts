import { MIN_BOARD_SIZE, MAX_BOARD_SIZE, validatePosition } from "./shogi";
import { MAX_CUSTOM_PIECES, MAX_PIECE_OFFSET, MAX_MOVEMENT_RULES, isBuiltinPiece, loadPieceRules } from "./pieces";
import { MAX_SCRIPT_LENGTH, loadRuleScript } from "./scriptconfig";
import type { SavedSetup } from "./setups";

export const EDITOR_GUIDELINES = Object.freeze({
  minBoardSize: MIN_BOARD_SIZE, maxBoardSize: MAX_BOARD_SIZE,
  maxAdditionalPieceTypes: MAX_CUSTOM_PIECES, maxPieceOffset: MAX_PIECE_OFFSET,
  maxMovementRules: MAX_MOVEMENT_RULES, maxScriptLength: MAX_SCRIPT_LENGTH,
});
export interface EditorRequirements {
  readonly width: number; readonly height: number; readonly additionalPieceTypes: number;
  readonly maxPieceOffset?: number; readonly maxMovementRules?: number; readonly maxScriptLength?: number;
}
export interface EditorAccess { readonly allowed: boolean; readonly reasons: readonly string[] }
export interface SpecialGameDefinition {
  readonly id: string; readonly name: string; readonly emblem: string; readonly description: string;
  readonly status: "planned" | "ready";
  readonly editor: { readonly policy: "guidelines"; readonly requirements: EditorRequirements; readonly ready?: boolean }
    | { readonly policy: "play-only"; readonly reason: string };
}

export const SPECIAL_GAMES: readonly SpecialGameDefinition[] = Object.freeze([
  Object.freeze({
    id: "chess", name: "チェス", emblem: "♞", status: "ready" as const,
    description: "既存エディターの駒・配置・ルールコードで作ったチェスの作例です。移動や効果を変えて、独自のゲームへ発展させられます。",
    editor: Object.freeze({ policy: "guidelines" as const, ready: true, requirements: Object.freeze({ width: 8, height: 8, additionalPieceTypes: 6 }) }),
  }),
  Object.freeze({
    id:"shogi-chess",name:"将棋VSチェス",emblem:"VS",status:"ready" as const,
    description:"9×9盤で先手は将棋、後手はチェス。将棋側だけが持ち駒を使い、取ったチェス駒も打てます。チェス側の初期配置は左から8列で、右端1列は空きです。",
    editor:Object.freeze({policy:"guidelines" as const,ready:true,requirements:Object.freeze({width:9,height:9,additionalPieceTypes:6})}),
  }),
  Object.freeze({
    id:"othello",name:"オセロ",emblem:"●",status:"ready" as const,
    description:"8×8盤で石を置き、相手の石をはさんで反転します。駒・配置・反転・パス・勝敗を共通エディターの設定とルールコードで作った作例です。",
    editor:Object.freeze({policy:"guidelines" as const,ready:true,requirements:Object.freeze({width:8,height:8,additionalPieceTypes:1})}),
  }),
]);

export function getSpecialGame(id: string): SpecialGameDefinition {
  const game = SPECIAL_GAMES.find(entry => entry.id === id);
  if (!game) throw new Error("Specialのゲームが見つかりません");
  return game;
}
export function checkEditorGuidelines(requirements: EditorRequirements): EditorAccess {
  const reasons: string[] = [], limits = EDITOR_GUIDELINES;
  const within = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
  if (!requirements || !within(requirements.width, limits.minBoardSize, limits.maxBoardSize) || !within(requirements.height, limits.minBoardSize, limits.maxBoardSize)) reasons.push(`編集できる盤面は縦・横それぞれ${limits.minBoardSize}〜${limits.maxBoardSize}マスです。`);
  if (!requirements || !within(requirements.additionalPieceTypes, 0, limits.maxAdditionalPieceTypes)) reasons.push(`追加できる駒は${limits.maxAdditionalPieceTypes}種類までです。`);
  for (const [key, max, label] of [
    ["maxPieceOffset", limits.maxPieceOffset, "移動先の指定は縦・横それぞれ"],
    ["maxMovementRules", limits.maxMovementRules, "各状態の移動・駒取りの設定はそれぞれ"],
    ["maxScriptLength", limits.maxScriptLength, "ルールコードは各欄"],
  ] as const) {
    const value = requirements?.[key];
    if (value !== undefined && !within(value, 0, max)) reasons.push(`${label}${max}${key === "maxPieceOffset" ? "マス" : key === "maxScriptLength" ? "文字" : "件"}までです。`);
  }
  return { allowed: reasons.length === 0, reasons };
}
export function specialEditorAccess(game: SpecialGameDefinition): EditorAccess {
  if (game.editor.policy === "play-only") return { allowed: false, reasons: [game.editor.reason] };
  if (game.editor.policy !== "guidelines") return { allowed: false, reasons: ["このゲームの編集方針を確認できません。"] };
  return checkEditorGuidelines(game.editor.requirements);
}
/** Gate the editor using both the game's policy and the actual configuration, before opening it. */
export function assertSpecialEditorAllowed(game: SpecialGameDefinition, setup?: SavedSetup): void {
  const access = specialEditorAccess(game);
  if (!access.allowed) throw new Error(`${game.name}は編集できません。${access.reasons.join("")}`);
  if (!setup) return;
  const actual = checkEditorGuidelines({ width: setup.position?.width, height: setup.position?.height, additionalPieceTypes: Object.keys(setup.pieceRules ?? {}).filter(type => !isBuiltinPiece(type)).length });
  if (!actual.allowed) throw new Error(`この配置は編集ガイドラインの対象外です。${actual.reasons.join("")}`);
  const rules = loadPieceRules(setup.pieceRules);
  validatePosition(setup.position, rules); loadRuleScript(setup.ruleScript);
}
export function assertSpecialActionAvailable(game: SpecialGameDefinition, action: "play" | "edit"): void {
  if (action === "edit") assertSpecialEditorAllowed(game);
  if (game.status === "ready" && (action === "play" || game.editor.policy === "guidelines" && game.editor.ready)) return;
  throw new Error(`${game.name}の${action === "edit" ? "編集用データ" : "対局機能"}は準備中です。`);
}
