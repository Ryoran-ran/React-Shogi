import {expect,test} from "bun:test";
import {createHasamiPreset,HASAMI_PIECE} from "../src/hasamipreset";
import {ShogiGame,legalMoves,isPassMove} from "../src/shogi";
import type {Position,Side,Piece,Move,GameMove} from "../src/shogi";
import {pieceState} from "../src/pieces";
import {BoardEditor} from "../src/editor";
import {createSetup,loadSetup,copySetup,saveLocalSetup,readLocalSetups} from "../src/setups";
import {chooseAIMove} from "../src/ai";

const piece=(side:Side):Piece=>({type:HASAMI_PIECE,side,promoted:false});
const move=(from:number,to:number):Move=>({from,to,promote:false});
function match(position?:Position,script?:string){const s=createHasamiPreset();return new ShogiGame(position??s.position,{pieceRules:s.pieceRules,ruleScript:script??s.ruleScript,passLimit:s.passLimit});}
function board(sente:number[],gote:number[]):Position{const p=createHasamiPreset().position;p.board.fill(null);for(const i of sente)p.board[i]=piece("sente");for(const i of gote)p.board[i]=piece("gote");return p;}

test("Hasami is one editable piece and board script in a normal setup, with rook movement and no direct captures",()=>{
  const s=createHasamiPreset(),g=match();expect(s.kind).toBe("shogi-setup");expect(g.position.board.filter(Boolean)).toHaveLength(18);expect(g.canPass).toBe(false);expect(g.passLimit).toBe(0);
  expect(g.position.board.slice(0,9).every(p=>p?.side==="gote")).toBe(true);expect(g.position.board.slice(72).every(p=>p?.side==="sente")).toBe(true);
  const moves=legalMoves(g.position,g.pieceRules,g.ruleScript);expect(moves).toHaveLength(63);expect(moves).toContainEqual(move(72,9));expect(moves.some(m=>m.to===0)).toBe(false);expect(moves.some(m=>m.from===72&&m.to===64)).toBe(false);
  expect(legalMoves(s.position,s.pieceRules,s.ruleScript)).toEqual(moves);
  const state=pieceState(piece("sente"),g.pieceRules);expect(state.captures).toEqual([]);expect(state.moves).toHaveLength(4);
  const before=g.save();for(const action of [move(72,0),move(72,64),move(72,73),{pass:true},{drop:HASAMI_PIECE,to:40,promote:false}] as GameMove[])expect(()=>g.play(action)).toThrow();expect(g.save()).toEqual(before);
  expect(loadSetup(JSON.parse(JSON.stringify(s)))).toEqual(s);
});

test("a move takes a contiguous line, leaves gaps and diagonals alone, and preserves friendly pieces",()=>{
  const p=board([72,43,20],[41,42,50,60,0]);const g=match(p),before=g.position;
  g.play(move(72,36)); // 36 . 37 . 38 . 39 . 40 . 41 enemy ... cannot capture across the gap.
  expect(g.position.board[41]?.side).toBe("gote");g.undo();
  // Close the gap by approaching on the same row from 40.
  const e=new BoardEditor(p,g.pieceRules);e.place(72,null);e.place(49,piece("sente"));const captured=match(e.position);
  captured.play(move(49,40));expect(captured.position.board[41]).toBeNull();expect(captured.position.board[42]).toBeNull();expect(captured.position.board[43]?.side).toBe("sente");expect(captured.position.board[50]?.side).toBe("gote");
  expect(captured.position.ruleState?.data.captured).toEqual({sente:2,gote:0});expect(captured.position.hands).toEqual(before.hands);
  const direct=match(board([40],[41,0]));expect(()=>direct.play(move(40,41))).toThrow();expect(()=>direct.play(move(40,42))).toThrow();
});

test("simultaneous captures in several directions are atomic, do not include diagonal pieces, and undo/replay",()=>{
  const p=board([49,13,67,37,43],[31,22,41,42,39,38,58,50,0]),g=match(p),before=g.position;
  g.play(move(49,40));for(const i of [31,22,41,42,39,38])expect(g.position.board[i]).toBeNull();for(const i of [50,58])expect(g.position.board[i]?.side).toBe("gote");
  expect(g.position.ruleState?.data.captured).toEqual({sente:6,gote:0});expect(g.result).toEqual({reason:"script",winner:"sente"});
  expect(ShogiGame.load(JSON.parse(JSON.stringify(g.save()))).position).toEqual(g.position);g.undo();expect(g.position).toEqual(before);
});

test("moving between enemy pieces does not remove the moving piece or unrelated pre-existing sandwiches",()=>{
  const g=match(board([49,54,56],[39,41,55,0]));g.play(move(49,40));expect(g.position.board[40]?.side).toBe("sente");for(const i of [39,41,55])expect(g.position.board[i]?.side).toBe("gote");
});

test("edge and corner enclosure require no opening, and each rule can be switched off independently",()=>{
  const source=createHasamiPreset().ruleScript!;
  const edge=board([0,19,27,11],[9,18,80]),g=match(edge);g.play(move(11,10));expect(g.position.board[9]).toBeNull();expect(g.position.board[18]).toBeNull();
  const off=match(edge,source.replace("const CAPTURE_EDGE = true","const CAPTURE_EDGE = false"));off.play(move(11,10));expect(off.position.board[9]?.side).toBe("gote");expect(off.position.board[18]?.side).toBe("gote");
  const gap=structuredClone(edge);gap.board[19]=null;const open=match(gap);open.play(move(11,10));expect(open.position.board[9]?.side).toBe("gote");
  const corner=board([18,1,8],[0,80]),on=match(corner);on.play(move(18,9));expect(on.position.board[0]).toBeNull();
  const cornerOff=match(corner,source.replace("const CAPTURE_CORNER = true","const CAPTURE_CORNER = false"));cornerOff.play(move(18,9));expect(cornerOff.position.board[0]?.side).toBe("gote");
  const unrelated=match(board([1,9,72],[0,80]));unrelated.play(move(72,63));expect(unrelated.position.board[0]?.side).toBe("gote");
});

test("captures accrue to each mover, configurable target decides victory, and initial empty sides are terminal",()=>{
  const p=board([49,43,54,10],[41,42,0,45,67]);const g=match(p);g.play(move(49,40));expect(g.result).toBeNull();
  g.play(move(67,63));expect(g.position.board[54]).toBeNull();expect(g.position.ruleState?.data.captured).toEqual({sente:2,gote:1});expect(g.result).toBeNull();
  const custom=match(p,createHasamiPreset().ruleScript!.replace("const WIN_CAPTURE_COUNT = 5","const WIN_CAPTURE_COUNT = 2"));custom.play(move(49,40));expect(custom.result).toEqual({reason:"script",winner:"sente"});
  expect(match(board([],[])).result).toEqual({reason:"script",winner:null});expect(match(board([40],[])).result).toEqual({reason:"script",winner:"sente"});
});

test("all four corners work for either player and quiet loops terminate at the configured repetition limit",()=>{
  for(const flipX of [false,true])for(const flipY of [false,true]){
    const transform=(i:number)=>(flipY?8-Math.floor(i/9):Math.floor(i/9))*9+(flipX?8-i%9:i%9),p=board([],[]);p.turn="gote";
    for(const i of [18,1,8])p.board[transform(i)]=piece("gote");for(const i of [0,80])p.board[transform(i)]=piece("sente");
    const g=match(p);g.play(move(transform(18),transform(9)));expect(g.position.board[transform(0)]).toBeNull();expect(g.position.ruleState?.data.captured).toEqual({sente:0,gote:1});
  }
  const repeated=match();for(let cycle=0;cycle<3;cycle++)for(const action of [move(72,63),move(0,9),move(63,72),move(9,0)])repeated.play(action);
  expect(repeated.result).toEqual({reason:"repetition",winner:null});expect(ShogiGame.load(repeated.save()).result).toEqual(repeated.result);
});

test("shared copies, local saves, and editor undo keep configurable movement and board code",()=>{
  const s=createHasamiPreset(),e=new BoardEditor(s.position,s.pieceRules,s.ruleScript);e.resize(7,7);expect(e.position.width).toBe(7);e.undo();expect(e.position).toEqual(s.position);
  e.setRuleScript(s.ruleScript!.replace("const WIN_CAPTURE_COUNT = 5","const WIN_CAPTURE_COUNT = 3"));expect(e.ruleScript).toContain("WIN_CAPTURE_COUNT = 3");e.undo();expect(e.ruleScript).toEqual(s.ruleScript!);e.redo();
  const setup=createSetup(e.position,0,"はさみ改",e.pieceRules,e.ruleScript),copy=copySetup(loadSetup(JSON.parse(JSON.stringify(setup))));expect(copy.name).toBe("はさみ改のコピー");
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};saveLocalSetup(storage,copy);expect(readLocalSetups(storage)[0].setup).toEqual(copy);
});

test("the common AI recognizes an immediate winning sandwich and produces legal replies",()=>{
  const p=board([52,37],[38,39,40,41,42,0]),g=match(p);
  const result=chooseAIMove(g.position,{pieceRules:g.pieceRules,ruleScript:g.ruleScript,passesRemaining:g.passesRemaining,maxDepth:1,maxNodes:200,maxTimeMs:3000});expect(result.move).toEqual(move(52,43));g.play(result.move!);expect(g.result).toEqual({reason:"script",winner:"sente"});
  const opening=match(),options={pieceRules:opening.pieceRules,ruleScript:opening.ruleScript,passesRemaining:opening.passesRemaining,maxDepth:1,maxNodes:1,maxTimeMs:5};
  for(let i=0;i<4;i++){const chosen=chooseAIMove(opening.position,options).move!;if(isPassMove(chosen))throw new Error("Unexpected pass");expect(legalMoves(opening.position,opening.pieceRules,opening.ruleScript)).toContainEqual(chosen);opening.play(chosen);}expect(opening.moveCount).toBe(4);
},15000);
