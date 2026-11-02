import {expect,test} from "bun:test";
import {ShogiGame,positionKey} from "../src/shogi";
import type {SavedGame} from "../src/shogi";
import {loadRuleScript,validateScriptData} from "../src/scriptconfig";
import {createChessBoardScript,upgradeChessBoardScript} from "../src/chessscript";
import {chooseAIMove} from "../src/ai";
import {copySetup,loadSetup,createSetup,saveLocalSetup,readLocalSetups} from "../src/setups";
import {BoardEditor} from "../src/editor";
import {quietHistoryFixture} from "./historyfixture";

const previous=await Bun.file(new URL('./fixtures/chess-history-v1.txt',import.meta.url)).text();

test("quiet chess and mixed games retain exact repetition history through the automatic 75-move draw",()=>{
  for(const mixed of [false,true]){
    const fixture=quietHistoryFixture(mixed),match=new ShogiGame(fixture.position,{pieceRules:fixture.setup.pieceRules,ruleScript:fixture.setup.ruleScript,passLimit:0});
    let largest=0;
    for(let ply=0;ply<150;ply++){
      expect(match.result).toBeNull();match.play(fixture.move(match.position.turn));
      const data=match.position.ruleState!.data;largest=Math.max(largest,JSON.stringify(data).length);validateScriptData(data);
    }
    expect(match.moveCount).toBe(150);expect(match.result).toEqual({reason:"script",winner:null});expect(largest).toBeLessThan(10000);
    expect(ShogiGame.load(match.save()).position).toEqual(match.position);
    const last=match.save().moves.at(-1)!;match.undo();expect(match.result).toBeNull();match.play(last);expect(match.result?.winner).toBeNull();
  }
},60000);

test("mixed play continues beyond 201 moves after an irreversible reset, including on a 15 by 15 editor board",()=>{
  for(const size of [9,15]){
    const fixture=quietHistoryFixture(true,size),pawn=(size-4)*size+size-1;
    fixture.position.board[pawn]={type:"P",side:"sente",promoted:false};
    const match=new ShogiGame(fixture.position,{pieceRules:fixture.setup.pieceRules,ruleScript:fixture.setup.ruleScript,passLimit:0});
    for(let ply=0;ply<120;ply++)match.play(fixture.move(match.position.turn));
    match.play({from:pawn,to:pawn-size,promote:false});
    expect((match.position.ruleState!.data.chess as any).history.steps).toHaveLength(0);
    for(let ply=0;ply<100;ply++){match.play(fixture.move(match.position.turn));expect(match.result).toBeNull();}
    expect(match.moveCount).toBe(221);expect(JSON.stringify(match.position.ruleState!.data).length).toBeLessThan(10000);
    expect(ShogiGame.load(JSON.parse(JSON.stringify(match.save()))).position).toEqual(match.position);
  }
},60000);

test("exact shipped old scripts upgrade on saved-game, setup, copy, local-library and editor reads",()=>{
  for(const mixed of [false,true]){
    const legacy=mixed?previous.replace("const MIXED=false","const MIXED=true"):previous;
    expect(upgradeChessBoardScript(legacy)).toBe(createChessBoardScript(mixed));
    const fixture=quietHistoryFixture(mixed),record:SavedGame={version:mixed?12:11,initialPosition:fixture.position,passLimit:0,pieceRules:fixture.setup.pieceRules,ruleScript:legacy,moves:Array.from({length:83},(_,ply)=>fixture.move(ply%2?"gote":"sente"))};
    const before=structuredClone(record),match=ShogiGame.load(record);
    expect(record).toEqual(before);expect(match.moveCount).toBe(83);expect(match.ruleScript).toBe(createChessBoardScript(mixed));
    for(let ply=0;ply<4;ply++)match.play(fixture.move(match.position.turn));
    expect(match.moveCount).toBe(87);expect(JSON.stringify(match.position.ruleState!.data).length).toBeLessThan(10000);
    const copied=loadSetup({...fixture.setup,position:fixture.position,ruleScript:legacy});expect(copySetup(copied).ruleScript).toBe(match.ruleScript);
    expect(new BoardEditor(fixture.position,fixture.setup.pieceRules,legacy).ruleScript).toBe(match.ruleScript);
    const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
    saveLocalSetup(storage,copied);expect(readLocalSetups(storage)[0].setup.ruleScript).toBe(match.ruleScript);
    expect(createSetup(fixture.position,0,'old',fixture.setup.pieceRules,legacy).ruleScript).toBe(match.ruleScript);
  }
},30000);

test("edited code remains unchanged and the independent data-size limit still applies",()=>{
  const edited=previous.replace("AUTO_QUIET_MOVES=150","AUTO_QUIET_MOVES=200");
  expect(loadRuleScript(edited)).toBe(edited);expect(loadRuleScript(previous+'\n// custom')).toBe(previous+'\n// custom');
  expect(()=>validateScriptData({large:'x'.repeat(20001)})).toThrow("20,000文字");
});

test("long-game history preserves repetition identity and the AI can finish a move after the former limit",()=>{
  const fixture=quietHistoryFixture(),match=new ShogiGame(fixture.position,{pieceRules:fixture.setup.pieceRules,ruleScript:fixture.setup.ruleScript,passLimit:0});
  for(let ply=0;ply<90;ply++)match.play(fixture.move(match.position.turn));
  const before=positionKey(match.position),result=chooseAIMove(match.position,{pieceRules:match.pieceRules,ruleScript:match.ruleScript,passesRemaining:match.passesRemaining,maxDepth:1,maxNodes:1,maxTimeMs:180,randomSeed:9,previousPositions:match.positionHistory});
  expect(result.move).not.toBeNull();expect(positionKey(match.position)).toBe(before);match.play(result.move!);expect(match.moveCount).toBe(91);
},15000);
