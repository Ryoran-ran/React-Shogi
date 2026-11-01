import {expect,test,spyOn} from "bun:test";
import {initialPosition,legalMoves} from "../src/shogi";
import type {AIReply,AIRequest,AISearchResult} from "../src/ai";

async function delayedWorker() {
  const source=await Bun.file(new URL('../src/aiworker.ts',import.meta.url)).text();
  const code=new Bun.Transpiler({loader:'ts',target:'browser'}).transformSync(source).replace('import("./ai.js")','loadEngine()');
  let ready!:(engine:any)=>void,loads=0,searches=0;
  const engine=new Promise(resolve=>{ready=resolve;});
  const replies:AIReply[]=[],worker={onmessage:null as null|((event:{data:AIRequest})=>Promise<void>),postMessage:(reply:AIReply)=>replies.push(reply)};
  new Function('globalThis','loadEngine',code)(worker,()=>{loads++;return engine;});
  const move=legalMoves(initialPosition())[0];
  const initialize=(checkpoint=false)=>ready({chooseAIMove(_position:any,_options:any,publish:(result:AISearchResult,checkpoint?:boolean)=>void){searches++;const result={move,depth:0,nodes:0,score:0};publish(result);if(checkpoint){publish(result);publish({...result,score:1},true);}return result;}});
  return {worker,replies,initialize,get loads(){return loads;},get searches(){return searches;}};
}

test("a request arriving during engine initialization is retained and answered",async()=>{
  const fixture=await delayedWorker();expect(fixture.worker.onmessage).toBeFunction();
  const pending=fixture.worker.onmessage!({data:{id:1,position:initialPosition(),options:{}}});
  expect(fixture.replies).toHaveLength(0);fixture.initialize();await pending;
  expect(fixture.replies.map(reply=>reply.id)).toEqual([1,1]);
  expect(fixture.replies[0]).toHaveProperty('progress',true);expect(fixture.replies[1]).not.toHaveProperty('progress');
  await fixture.worker.onmessage!({data:{id:2,position:initialPosition(),options:{}}});
  expect(fixture.loads).toBe(1);expect(fixture.searches).toBe(2);expect(fixture.replies.at(-1)?.id).toBe(2);
});

test("superseded requests are discarded while an engine is still loading",async()=>{
  const fixture=await delayedWorker();
  const old=fixture.worker.onmessage!({data:{id:10,position:initialPosition(),options:{}}});
  const current=fixture.worker.onmessage!({data:{id:11,position:initialPosition(),options:{}}});
  fixture.initialize();await Promise.all([old,current]);
  expect(fixture.searches).toBe(1);expect(fixture.replies.every(reply=>reply.id===11)).toBe(true);
});

test("a completed candidate pool reaches the UI even inside the progress throttle interval",async()=>{
  const fixture=await delayedWorker(),clock=spyOn(performance,"now").mockReturnValue(0);
  try {
    fixture.initialize(true);await fixture.worker.onmessage!({data:{id:12,position:initialPosition(),options:{randomSeed:7,ply:0}}});
    const progress=fixture.replies.filter(reply=>"result" in reply&&reply.progress);
    expect(progress).toHaveLength(2);expect(progress.at(-1)).toHaveProperty("result.score",1);
    expect(fixture.replies.at(-1)).not.toHaveProperty("progress");
  } finally {clock.mockRestore();}
});
