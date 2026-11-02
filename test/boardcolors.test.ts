import {expect,test} from "bun:test";
import {BoardEditor} from "../src/editor";
import {ShogiGame,initialPosition,emptyPosition,positionKey,validatePosition,legalMoves} from "../src/shogi";
import {createSetup,loadSetup,copySetup,saveLocalSetup,readLocalSetups} from "../src/setups";
import {chooseAIMove} from "../src/ai";
import {squareColorStyle} from "../src/boarddesign";

test("square colors survive placement, undo, resize, mirror and region copy with independent snapshots",()=>{
  const p=emptyPosition(5,4);p.board[6]={type:'P',side:'sente',promoted:false};const editor=new BoardEditor(p);
  editor.setSquareColor(6,'#AABBCC');expect(editor.position.squareColors?.[6]).toBe('#aabbcc');expect(editor.position.board[6]?.type).toBe('P');
  const before=editor.position;editor.setSquareColor(7,'#112233');editor.undo();expect(editor.position).toEqual(before);editor.redo();expect(editor.position.squareColors?.[7]).toBe('#112233');
  editor.resize(7,5);expect(editor.position.squareColors?.[8]).toBe('#aabbcc');expect(editor.position.squareColors?.[9]).toBe('#112233');expect(editor.position.squareColors?.[34]).toBeNull();
  editor.mirror('horizontal');expect(editor.position.squareColors?.[12]).toBe('#aabbcc');editor.mirror('vertical');expect(editor.position.squareColors?.[26]).toBe('#aabbcc');
  editor.undo();editor.undo();const copied=editor.copyRegion(8,9);editor.pasteRegion(22,copied);expect(editor.position.squareColors?.slice(22,24)).toEqual(['#aabbcc','#112233']);expect(editor.position.board[22]?.type).toBe('P');
  copied.squareColors![0]='#000000';expect(editor.position.squareColors?.[22]).toBe('#aabbcc');
  const original=editor.position;editor.swapSides();expect(editor.position.squareColors?.[34-22]).toBe('#aabbcc');editor.undo();expect(editor.position).toEqual(original);
  editor.clear();expect(editor.position.board.every(piece=>piece===null)).toBe(true);expect(editor.position.squareColors).toEqual(original.squareColors);editor.undo();
  editor.resize(3,3);expect(editor.position.squareColors?.[4]).toBe('#aabbcc');editor.undo();expect(editor.position).toEqual(original);
  expect(p.squareColors).toBeUndefined();
});

test("bulk paint, checkerboards and erasure remain undoable and validate imported colors",()=>{
  const editor=new BoardEditor(emptyPosition(4,3));editor.checkerboardColors('#FFFFFF','#000000');
  expect(editor.position.squareColors).toEqual(['#ffffff','#000000','#ffffff','#000000','#000000','#ffffff','#000000','#ffffff','#ffffff','#000000','#ffffff','#000000']);
  editor.fillSquareColor('#abcdef');expect(new Set(editor.position.squareColors)).toEqual(new Set(['#abcdef']));editor.fillSquareColor(null);expect(editor.position.squareColors).toBeUndefined();editor.undo();expect(editor.position.squareColors?.[0]).toBe('#abcdef');
  const before=editor.position;for(const color of ['red','#fff','#112233;display:none','',3])expect(()=>editor.setSquareColor(0,color as string)).toThrow();expect(editor.position).toEqual(before);
  for(const index of [-1,12,0.5])expect(()=>editor.setSquareColor(index,'#112233')).toThrow();
  for(const colors of [[],Array(12).fill('red'),Array(12).fill('#fff'),Array(12),{},null])expect(()=>validatePosition({...before,squareColors:colors})).toThrow();
  expect(squareColorStyle(before,0)).toContain('--square-color:#abcdef');expect(squareColorStyle({squareColors:['#000000']},0)).toContain('--square-mark:#fff6dc');
});

test("colored layouts round-trip through files, copies, local saves and game records",()=>{
  const editor=new BoardEditor(initialPosition());editor.setSquareColor(40,'#123456');const setup=createSetup(editor.position,0,'色付き');
  expect(setup.version).toBe(8);expect(setup.pieceRules).toEqual({});expect(loadSetup(JSON.parse(JSON.stringify(setup)))).toEqual(setup);
  const copy=copySetup(setup);copy.position.squareColors![40]='#000000';expect(setup.position.squareColors?.[40]).toBe('#123456');
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  saveLocalSetup(storage,setup);expect(readLocalSetups(storage)[0].setup.position.squareColors).toEqual(setup.position.squareColors);
  const game=new ShogiGame(setup.position,{passLimit:0});game.play({from:54,to:45,promote:false});expect(game.save().version).toBe(10);expect(game.save().pieceRules).toEqual({});expect(ShogiGame.load(game.save()).position).toEqual(game.position);
  game.undo();expect(game.position.squareColors?.[40]).toBe('#123456');expect(()=>loadSetup({...setup,version:7})).toThrow('保存形式');expect(()=>ShogiGame.load({...game.save(),version:9})).toThrow('保存形式');
});

test("colors do not change legal actions, AI evaluation or repetition, including scripted play",()=>{
  const base=initialPosition(),editor=new BoardEditor(base);editor.checkerboardColors('#ffffff','#000000');const colored=editor.position;
  expect(positionKey(colored)).toBe(positionKey(base));expect(legalMoves(colored)).toEqual(legalMoves(base));
  const options={maxDepth:1,maxTimeMs:5000,maxNodes:1000};expect(chooseAIMove(colored,options).move).toEqual(chooseAIMove(base,options).move);
  const game=new ShogiGame(colored,{passLimit:0,ruleScript:'export default { afterMove(ctx) { ctx.state.count=(ctx.state.count??0)+1; } };'});
  game.play({from:54,to:45,promote:false});expect(game.position.squareColors).toEqual(colored.squareColors);expect(game.position.ruleState?.data.count).toBe(1);expect(ShogiGame.load(game.save()).position).toEqual(game.position);
});
