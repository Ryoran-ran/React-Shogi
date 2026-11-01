import type {SavedGame,Side} from "./shogi";
export interface SavedPreview { width:number; height:number; moves:number; turn:Side; finished:boolean }
export interface SavedSession { game:SavedGame; gameKind:"standard"|"custom"; gameName:string; preview:SavedPreview; flipped:boolean; aiPaused:boolean; aiMode?:string; aiStrength?:string }
/** Read only menu metadata. Legality, effects and complete history are checked on resume. */
export function readSavedSession(text:string):SavedSession{
  const data=JSON.parse(text),record=data?.game as SavedGame;
  if(!record||![1,2,3,4,5,6,7,8,9,10,11,12,13].includes(record.version)||!Array.isArray(record.moves)||record.moves.length>1024)throw new Error("保存済みの対局を確認できません");
  const position=record.initialPosition,width=position?.width??9,height=position?.height??9;
  if(![width,height].every(size=>Number.isInteger(size)&&size>=3&&size<=15))throw new Error("保存済みの盤面サイズが不正です");
  const custom=data.gameKind==="custom"||!!record.ruleScript||!!Object.keys(record.pieceRules??{}).length||!!position?.settings||!!position?.squareColors||!!position?.boardTheme||width!==9||height!==9||(record.version===1?0:record.passLimit)!==0;
  const first=position?.turn??"sente";
  if(first!=="sente"&&first!=="gote")throw new Error("保存済みの手番が不正です");
  return {game:record,gameKind:custom?"custom":"standard",gameName:custom?(typeof data.gameName==="string"&&data.gameName.trim()?data.gameName.slice(0,80):"エディット対局"):"普通の将棋",preview:{width,height,moves:record.moves.length,turn:record.moves.length%2?(first==="sente"?"gote":"sente"):first,finished:!!record.ending||data.summary?.finished===true},flipped:data.flipped===true,aiPaused:data.aiPaused===true,aiMode:data.aiMode,aiStrength:data.aiStrength};
}
export function dataUsesScripts(data:any):boolean{
  if(!data||typeof data!=="object")return false;
  if(data.game)return dataUsesScripts(data.game);
  return !!(typeof data.ruleScript==="string"&&data.ruleScript.trim())||Object.values(data.pieceRules??{}).some((entry:any)=>typeof entry?.script==="string"&&!!entry.script.trim());
}
