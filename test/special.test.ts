import { expect, test } from "bun:test";
import { SPECIAL_GAMES, EDITOR_GUIDELINES, getSpecialGame, checkEditorGuidelines, specialEditorAccess, assertSpecialEditorAllowed, assertSpecialActionAvailable } from "../src/special";
import { emptyPosition } from "../src/shogi";
import { createSetup } from "../src/setups";
import { MAX_CUSTOM_PIECES, MAX_PIECE_OFFSET, MAX_MOVEMENT_RULES } from "../src/pieces";
import { MAX_SCRIPT_LENGTH } from "../src/scriptconfig";
import { renderSpecialScreen } from "../src/specialview";

test("Special exposes the implemented chess game while planned games remain unavailable", () => {
  expect(SPECIAL_GAMES.map(game => [game.id, game.status])).toEqual([["chess", "ready"],["shogi-chess","ready"],["othello","ready"]]);
  expect(specialEditorAccess(getSpecialGame("chess")).allowed).toBe(true);
  expect(Object.isFrozen(SPECIAL_GAMES)).toBe(true); expect(Object.isFrozen(getSpecialGame("chess").editor)).toBe(true);
  expect(() => getSpecialGame("unknown")).toThrow("見つかりません");
  expect(() => assertSpecialActionAvailable(getSpecialGame("chess"), "play")).not.toThrow();
  expect(() => assertSpecialActionAvailable(getSpecialGame("chess"), "edit")).not.toThrow();
  expect(() => assertSpecialActionAvailable({...getSpecialGame("chess"),status:"planned"}, "play")).toThrow("準備中");
});

test("editor guidelines share the actual editor limits, allow boundary values and reject unsupported configurations", () => {
  expect(EDITOR_GUIDELINES.maxAdditionalPieceTypes).toBe(MAX_CUSTOM_PIECES);
  expect(EDITOR_GUIDELINES.maxPieceOffset).toBe(MAX_PIECE_OFFSET); expect(EDITOR_GUIDELINES.maxMovementRules).toBe(MAX_MOVEMENT_RULES); expect(EDITOR_GUIDELINES.maxScriptLength).toBe(MAX_SCRIPT_LENGTH);
  const maximum = { width: 15, height: 15, additionalPieceTypes: MAX_CUSTOM_PIECES, maxPieceOffset: MAX_PIECE_OFFSET, maxMovementRules: MAX_MOVEMENT_RULES, maxScriptLength: MAX_SCRIPT_LENGTH };
  expect(checkEditorGuidelines(maximum).allowed).toBe(true); expect(checkEditorGuidelines({width:3,height:3,additionalPieceTypes:0}).allowed).toBe(true);
  for (const override of [{width:16}, {height:16}, {width:2}, {height:3.5}, {width:NaN}, {additionalPieceTypes:33}, {additionalPieceTypes:-1}, {maxPieceOffset:15}, {maxMovementRules:65}, {maxScriptLength:MAX_SCRIPT_LENGTH+1}]) {
    const result=checkEditorGuidelines({...maximum,...override}); expect(result.allowed).toBe(false); expect(result.reasons.length).toBeGreaterThan(0);
  }
  const oversized={...getSpecialGame("chess"),editor:{policy:"guidelines" as const,requirements:{width:36,height:36,additionalPieceTypes:33}}};
  expect(specialEditorAccess(oversized).allowed).toBe(false);
  expect(() => assertSpecialEditorAllowed(oversized)).toThrow("編集できません");
});

test("Special's editor gate checks the actual setup and never treats play-only as editable", () => {
  const chess=getSpecialGame("chess"), locked={...chess,id:"play-only-fixture",name:"対局専用テスト",editor:{policy:"play-only" as const,reason:"編集対象外です。"}}, setup=createSetup(emptyPosition(8,8),0,"編集用データ");
  expect(specialEditorAccess(locked).allowed).toBe(false);
  expect(() => assertSpecialEditorAllowed(chess,setup)).not.toThrow();
  expect(() => assertSpecialEditorAllowed(locked,setup)).toThrow("編集できません");
  expect(() => assertSpecialEditorAllowed(chess,{...setup,position:{...setup.position,width:16}})).toThrow("ガイドライン");
  expect(() => assertSpecialEditorAllowed(chess,{...setup,pieceRules:Object.fromEntries(Array.from({length:33},(_,index)=>[`custom_${index}`,{}]))})).toThrow("ガイドライン");
  expect(() => assertSpecialEditorAllowed(chess,{...setup,pieceRules:{P:{normal:{moves:[{dx:15,dy:0,range:1}],captures:[]}}}})).toThrow();
  expect(() => assertSpecialEditorAllowed(chess,{...setup,ruleScript:'x'.repeat(MAX_SCRIPT_LENGTH+1)})).toThrow();
  const before=structuredClone(setup); assertSpecialEditorAllowed(chess,setup); expect(setup).toEqual(before);
  // Checking whether editing is permitted must not execute an unfinished script.
  expect(() => assertSpecialEditorAllowed(chess,{...setup,ruleScript:'export default { afterMove('})).not.toThrow();
});

test("Special's catalog enables chess and its editor and explains the editing guidelines", () => {
  const html=renderSpecialScreen(); expect(html).toContain("オセロで遊べます"); expect(html).toContain("編集できます"); expect(html).not.toContain("大局将棋");
  for (const id of ["chess","shogi-chess","othello"]) {
    expect(html).toContain(`data-special-play="${id}"`); expect(html).not.toContain(`data-special-play="${id}" disabled`); expect(html).toContain(`data-special-edit="${id}"`); expect(html).not.toContain(`data-special-edit="${id}" disabled`);
  }
  expect(html).toContain("3〜15マス"); expect(html).toContain("追加駒は32種類");
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]); expect(new Set(ids).size).toBe(ids.length);
});
