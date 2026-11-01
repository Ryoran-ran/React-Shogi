import {expect,test} from 'bun:test';
import {createOthelloPreset,OTHELLO_STONE as STONE} from '../src/othellopreset';
import {ShogiGame,legalMoves,validatePosition} from '../src/shogi';
import type {Position,Side,Piece,Move,GameMove} from '../src/shogi';
import {loadSetup,copySetup} from '../src/setups';
import {BoardEditor} from '../src/editor';
import {loadBoardSettings} from '../src/boardsettings';
import {chooseAIMove} from '../src/ai';

function match(position?:Position){const s=createOthelloPreset();return new ShogiGame(position??s.position,{pieceRules:s.pieceRules,ruleScript:s.ruleScript,passLimit:s.passLimit});}
const stone=(side:Side):Piece=>({type:STONE,side,promoted:false});
const drop=(to:number):Move=>({drop:STONE,to,promote:false});
function counts(p:Position){return ['sente','gote'].map(side=>p.board.filter(piece=>piece?.side===side).length);}

test('Othello is editable shared setup data with four opening placements and atomic flips',()=>{
  const s=createOthelloPreset(),g=match();expect(s.kind).toBe('shogi-setup');expect(s.version).toBe(11);expect(g.save().version).toBe(13);
  expect(legalMoves(g.position,g.pieceRules,g.ruleScript)).toEqual([19,26,37,44].map(drop));expect(g.canPass).toBe(false);
  const before=g.position;for(const move of [drop(0),drop(27),{from:28,to:20,promote:false},{pass:true}] as GameMove[])expect(()=>g.play(move)).toThrow();expect(g.position).toEqual(before);
  g.play(drop(19));expect(counts(g.position)).toEqual([4,1]);expect(g.position.board[27]?.side).toBe('sente');expect(g.position.turn).toBe('gote');expect(g.position.hands).toEqual(before.hands);
  expect(g.position.ruleState?.data.score).toEqual({sente:4,gote:1});expect(g.records[0].effects).toHaveLength(1);
  expect(ShogiGame.load(JSON.parse(JSON.stringify(g.save()))).position).toEqual(g.position);
  g.undo();expect(g.position).toEqual(before);expect(copySetup(loadSetup(JSON.parse(JSON.stringify(s))))).toMatchObject({name:'オセロのコピー',position:s.position,pieceRules:s.pieceRules,ruleScript:s.ruleScript});
});

test('one placement flips all eight rays while preserving piece data and without capture/destruction events',()=>{
  const s=createOthelloPreset(),p=s.position;p.board.fill(null);
  for(const i of [9,11,13,25,29,41,43,45])p.board[i]=stone('sente');
  for(const i of [18,19,20,26,28,34,35,36])p.board[i]={...stone('gote'),data:{hp:i}};
  const g=new ShogiGame(p,{pieceRules:s.pieceRules,passLimit:null,ruleScript:s.ruleScript!.replace('checkResult(ctx) {','afterDestroy(ctx){ctx.reject("unexpected destruction");}, afterCaptured(ctx){ctx.reject("unexpected capture");}, checkResult(ctx) {')});
  g.play(drop(27));expect(counts(g.position)).toEqual([17,0]);expect(g.result).toEqual({reason:'script',winner:'sente'});
  for(const i of [18,19,20,26,28,34,35,36])expect(g.position.board[i]).toEqual({...stone('sente'),data:{hp:i}});
});

test('only a blocked player may pass, then the opponent can place; the final score decides the winner',()=>{
  const p=createOthelloPreset().position;p.board=p.board.map(()=>stone('sente'));p.board[0]=null;p.board[2]=stone('gote');
  const g=match(p);expect(g.result).toBeNull();expect(legalMoves(g.position,g.pieceRules,g.ruleScript)).toEqual([]);expect(g.canPass).toBe(true);
  const ai=chooseAIMove(g.position,{pieceRules:g.pieceRules,ruleScript:g.ruleScript,passesRemaining:g.passesRemaining,maxDepth:1,maxNodes:1,maxTimeMs:20});expect(ai.move).toEqual({pass:true});
  g.pass();expect(g.position.turn).toBe('gote');expect(g.canPass).toBe(false);expect(legalMoves(g.position,g.pieceRules,g.ruleScript)).toEqual([drop(0)]);
  g.play(drop(0));expect(counts(g.position)).toEqual([61,3]);expect(g.result).toEqual({reason:'script',winner:'sente'});
  expect(ShogiGame.load(JSON.parse(JSON.stringify(g.save()))).result).toEqual(g.result);
});

test('full-board ties and blocked boards with empty cells end without requiring two passes',()=>{
  const p=createOthelloPreset().position;p.board=p.board.map((_,i)=>stone(i%2?'gote':'sente'));
  expect(match(p).result).toEqual({reason:'script',winner:null});p.board=p.board.map(()=>stone('sente'));p.board[0]=null;
  expect(match(p).result).toEqual({reason:'script',winner:'sente'});
});

// Independent coordinate-based oracle used only in tests, with every legal square compared each turn.
function referenceFlips(p:Position,to:number,side:Side):number[]{
  if(p.board[to])return [];const result:number[]=[];
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
    if(!dx&&!dy)continue;const ray:number[]=[];
    for(let step=1;step<Math.max(p.width,p.height);step++){
      const x=to%p.width+dx*step,y=Math.floor(to/p.width)+dy*step;
      if(x<0||y<0||x>=p.width||y>=p.height)break;const i=y*p.width+x,q=p.board[i];if(!q)break;
      if(q.side===side){result.push(...ray);break;}ray.push(i);
    }
  }return result;
}
test('a complete game matches an independent reference for legal moves, every flip, passes and score',()=>{
  const g=match();let state=741,placements=0;
  while(!g.result){
    const p=g.position,options=p.board.flatMap((_,i)=>referenceFlips(p,i,p.turn).length?[i]:[]);
    expect(legalMoves(p,g.pieceRules,g.ruleScript).map(m=>m.to)).toEqual(options);
    if(!options.length){expect(g.canPass).toBe(true);g.pass();continue;}
    expect(g.canPass).toBe(false);state=(Math.imul(state,1664525)+1013904223)>>>0;const to=options[state%options.length];
    const expected=structuredClone(p.board);expected[to]=stone(p.turn);for(const i of referenceFlips(p,to,p.turn))expected[i]=stone(p.turn);
    g.play(drop(to));expect(g.position.board).toEqual(expected);expect(++placements).toBeLessThanOrEqual(60);
  }
  const [black,white]=counts(g.position);expect(g.result).toEqual({reason:'script',winner:black===white?null:black>white?'sente':'gote'});
  expect(placements).toBeGreaterThan(50);expect(ShogiGame.load(JSON.parse(JSON.stringify(g.save()))).position).toEqual(g.position);
},20000);

test('unlimited placement is reusable without Othello code, preserves stock, and is editable with undo',()=>{
  const s=createOthelloPreset(),p=s.position;p.hands.sente[STONE]=3;
  const g=new ShogiGame(p,{pieceRules:s.pieceRules,passLimit:0});expect(legalMoves(g.position,g.pieceRules)).toHaveLength(60);g.play(drop(0));expect(g.position.hands.sente[STONE]).toBe(3);expect(g.position.board[27]?.side).toBe('gote');
  const e=new BoardEditor(p,s.pieceRules);e.setSettings({placementTypes:[]});expect(legalMoves(e.position,e.pieceRules)).toEqual([]);e.undo();expect(e.position.settings?.placementTypes).toEqual([STONE]);e.redo();expect(e.position.settings?.placementTypes).toEqual([]);
});

test('placement and display data are validated, cloned, and require their new save versions',()=>{
  const s=createOthelloPreset(),g=match();expect(()=>loadSetup({...s,version:10})).toThrow();expect(()=>ShogiGame.load({...g.save(),version:12})).toThrow();
  for(const types of [[STONE,STONE],['custom_missing']] as const){const p=structuredClone(s.position);p.settings!.placementTypes=[...types];expect(()=>validatePosition(p,s.pieceRules)).toThrow();}
  const royal=structuredClone(s.position);royal.settings!.placementTypes=['K'];expect(()=>validatePosition(royal,{...s.pieceRules,K:{royal:true}})).toThrow();
  expect(()=>loadBoardSettings({showPieceCounts:'yes'})).toThrow();expect(()=>loadBoardSettings({playerRules:{sente:{mark:'abc'}}})).toThrow();
  const raw={placementTypes:[STONE]};const settings=loadBoardSettings(raw);raw.placementTypes.length=0;expect(settings.placementTypes).toEqual([STONE]);
});
