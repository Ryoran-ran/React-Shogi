import {expect,test} from "bun:test";
import {chooseAIMove} from "../src/ai";
import {AI_MATE_SCORE,aiVariation,chooseAICandidate} from "../src/aichoice";
import type {AICandidate} from "../src/aichoice";
import {ShogiGame,initialPosition,emptyPosition,legalMoves,positionAfterLegalMove,isPassMove} from "../src/shogi";
import type {GameMove} from "../src/shogi";
import {createChessPreset} from "../src/presets";

const seeds=Array.from({length:16},(_,seed)=>seed);
const options={maxDepth:1,maxNodes:5000,maxTimeMs:5000};
const candidates=(scores:number[]):AICandidate[]=>scores.map((score,to)=>({move:{from:40,to,promote:false},score}));
const chosen=(pool:AICandidate[],position=initialPosition(),ply=0)=>seeds.map(seed=>chooseAICandidate(pool,aiVariation(position,{},seed,ply))!);

test("variety favors near-best moves and narrows after the opening and in sparse endgames",()=>{
  const position=initialPosition(),pool=candidates([100,90,50]);
  expect(new Set(chosen(pool).map(candidate=>candidate.score)).size).toBe(2);
  expect(chosen(pool).every(candidate=>candidate.score>=90)).toBe(true);
  expect(chosen(pool,position,16).every(candidate=>candidate.score===100)).toBe(true);
  const closer=candidates([100,96,70]);
  expect(new Set(chosen(closer,position,16).map(candidate=>candidate.score)).size).toBe(2);
  expect(chosen(closer,position,60).every(candidate=>candidate.score===100)).toBe(true);
  const end=emptyPosition();end.board[80]={type:"K",side:"sente",promoted:false};end.board[0]={type:"K",side:"gote",promoted:false};end.board[54]={type:"P",side:"sente",promoted:false};
  expect(chosen(closer,end).every(candidate=>candidate.score===100)).toBe(true);
});

test("known mates and major losses are never introduced for variety, and quiet play does not randomly pass",()=>{
  for(const scores of [[AI_MATE_SCORE-1,AI_MATE_SCORE-3,100],[-AI_MATE_SCORE+10,-AI_MATE_SCORE+9,-AI_MATE_SCORE+1],[500,100,0]]){
    expect(chosen(candidates(scores)).every(candidate=>candidate.score===scores[0])).toBe(true);
  }
  const pool=candidates([100,95]);pool.push({move:{pass:true},score:100});
  expect(chosen(pool).every(candidate=>!isPassMove(candidate.move))).toBe(true);
  expect(chooseAICandidate([{move:{pass:true},score:0}],{seed:1,tolerance:18})!.move).toEqual({pass:true});
  expect(chooseAICandidate(pool)).toBe(pool[0]);
});

test("seeded shogi choices differ while repeating the same seed reproduces the exact result",()=>{
  const position=initialPosition(),before=structuredClone(position),legal:GameMove[]=legalMoves(position);
  const results=seeds.slice(0,8).map(randomSeed=>chooseAIMove(position,{...options,randomSeed,ply:0}));
  expect(new Set(results.map(result=>JSON.stringify(result.move))).size).toBeGreaterThan(1);
  for(const result of results){expect(result.depth).toBe(1);expect(legal).toContainEqual(result.move!);}
  const first=chooseAIMove(position,{...options,randomSeed:5}),second=chooseAIMove(position,{...options,randomSeed:5});
  expect(first).toEqual(second);expect(position).toEqual(before);
  expect(results.every(result=>result.score>=chooseAIMove(position,options).score-18)).toBe(true);
});

test("the shared chess AI also varies opening moves and retains scripted move data in saves",()=>{
  const setup=createChessPreset(),game=new ShogiGame(setup.position,{pieceRules:setup.pieceRules,ruleScript:setup.ruleScript,passLimit:0});
  const config={...options,pieceRules:game.pieceRules,ruleScript:game.ruleScript,passesRemaining:game.passesRemaining};
  const legal:GameMove[]=legalMoves(game.position,game.pieceRules,game.ruleScript);
  const results=seeds.slice(0,6).map(randomSeed=>chooseAIMove(game.position,{...config,randomSeed,ply:0}));
  expect(new Set(results.map(result=>JSON.stringify(result.move))).size).toBeGreaterThan(1);
  for(const result of results)expect(legal).toContainEqual(result.move!);
  game.play(results[0].move!);expect(ShogiGame.load(game.save()).position).toEqual(game.position);
},15000);

test("root alternatives use exact evaluations, not alpha-beta upper bounds, and respect node limits",()=>{
  const position=emptyPosition(5,5);position.board[24]={type:"K",side:"sente",promoted:false};position.board[0]={type:"K",side:"gote",promoted:false};
  position.board[17]={type:"P",side:"sente",promoted:false};position.board[7]={type:"S",side:"gote",promoted:false};position.board[18]={type:"G",side:"sente",promoted:false};
  const best=chooseAIMove(position,{...options,maxDepth:2});
  for(const randomSeed of seeds.slice(0,8)){
    const result=chooseAIMove(position,{...options,maxDepth:2,randomSeed});expect(result.depth).toBe(2);
    const next=positionAfterLegalMove(position,result.move!);
    const exact=-chooseAIMove(next,options).score;
    expect(result.score).toBe(exact);expect(exact).toBeGreaterThanOrEqual(best.score-2);
  }
  const progress:any[]=[];
  const limited=chooseAIMove(initialPosition(),{maxDepth:5,maxTimeMs:5000,maxNodes:1,randomSeed:9},(result,checkpoint)=>{if(checkpoint)progress.push(result);});
  expect(limited.nodes).toBeLessThanOrEqual(1);expect(legalMoves(initialPosition()) as GameMove[]).toContainEqual(limited.move!);
  expect(progress.at(-1)?.move).toEqual(limited.move);
});

test("seeded searches keep a forced capture and a one-move mate",()=>{
  const position=emptyPosition();position.board[80]={type:"K",side:"sente",promoted:false};position.board[0]={type:"K",side:"gote",promoted:false};
  position.board[40]={type:"P",side:"sente",promoted:false};position.board[31]={type:"R",side:"gote",promoted:false};
  for(const randomSeed of [0,2,9])expect(chooseAIMove(position,{...options,randomSeed}).move).toEqual({from:40,to:31,promote:false});
  position.board[0]=null;position.board[4]={type:"K",side:"gote",promoted:false};position.board[40]=null;position.board[31]=null;
  for(const [index,type] of [[22,"P"],[21,"G"],[11,"B"],[23,"R"]] as const)position.board[index]={type,side:"sente",promoted:false};
  for(const randomSeed of [0,2,9]){const game=new ShogiGame(position);game.play(chooseAIMove(position,{...options,randomSeed}).move!);expect(game.result).toEqual({reason:"mate",winner:"sente"});}
});
