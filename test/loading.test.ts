import {expect,test} from "bun:test";
import {readSavedSession,dataUsesScripts} from "../src/savedpreview";
import {ShogiGame} from "../src/shogi";
import {quietHistoryFixture} from "./historyfixture";

test("saved menu metadata is read without replaying moves or executing rule code",()=>{
  const record={version:12,moves:Array.from({length:201},()=>({unvalidated:true})),passLimit:0,initialPosition:{width:9,height:9,turn:"sente",settings:{playerRules:{gote:{name:"チェス"}}}},ruleScript:'throw new Error("not for the title")'};
  const source=JSON.stringify({game:record,gameName:"将棋VSチェス",aiMode:"both"}),session=readSavedSession(source);
  expect(session.preview).toEqual({width:9,height:9,moves:201,turn:"gote",finished:false});expect(session.gameName).toBe("将棋VSチェス");expect(session.game as unknown).toEqual(record);
  expect(dataUsesScripts(record)).toBe(true);expect(dataUsesScripts({pieceRules:{P:{script:"export default {}"}}})).toBe(true);expect(dataUsesScripts(new ShogiGame().save())).toBe(false);
  expect(readSavedSession(JSON.stringify({game:new ShogiGame().save()})).gameKind).toBe("custom");
  expect(readSavedSession(JSON.stringify({game:new ShogiGame(undefined,{passLimit:0}).save()})).gameKind).toBe("standard");
});

test("incremental restore yields progress while keeping exactly the same game and undo history",async()=>{
  const fixture=quietHistoryFixture(),match=new ShogiGame(fixture.position,{pieceRules:fixture.setup.pieceRules,ruleScript:fixture.setup.ruleScript,passLimit:0});
  for(let ply=0;ply<25;ply++)match.play(fixture.move(match.position.turn));
  const record=match.save(),before=structuredClone(record),progress:number[]=[];let yields=0;
  const loaded=await ShogiGame.loadAsync(record,{onProgress:(completed,total)=>{expect(total).toBe(25);progress.push(completed);},yieldControl:async()=>{yields++;}});
  expect(progress).toEqual([0,8,16,24,25]);expect(yields).toBe(5);expect(loaded.position).toEqual(match.position);expect(record).toEqual(before);
  loaded.undo();match.undo();expect(loaded.position).toEqual(match.position);
  const controller=new AbortController(),cancelled:number[]=[];
  await expect(ShogiGame.loadAsync(record,{signal:controller.signal,onProgress:done=>{cancelled.push(done);if(done===8)controller.abort();},yieldControl:async()=>{}})).rejects.toHaveProperty("name","AbortError");
  expect(cancelled).toEqual([0,8]);expect(record).toEqual(before);
});
