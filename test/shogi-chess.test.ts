import {expect,test} from "bun:test";
import {CHESS_PIECES,createShogiChessPreset} from "../src/presets";
import {ShogiGame,legalMoves,inCheck,positionKey} from "../src/shogi";
import type {Position,Side} from "../src/shogi";
import {boardSettings,loadBoardSettings} from "../src/boardsettings";
import {BoardEditor} from "../src/editor";
import {loadSetup,copySetup,createSetup} from "../src/setups";
import {boardSideName} from "../src/boarddesign";
import {chooseAIMove} from "../src/ai";

const setup=createShogiChessPreset();
function game(position=setup.position){return new ShogiGame(position,{passLimit:0,pieceRules:setup.pieceRules,ruleScript:setup.ruleScript});}
function minimal(turn:Side="sente"):Position{const position=structuredClone(setup.position);position.board.fill(null);position.turn=turn;position.board[80]={type:"K",side:"sente",promoted:false};position.board[0]={type:CHESS_PIECES.k,side:"gote",promoted:false};return position;}
const moves=(match:ShogiGame)=>legalMoves(match.position,match.pieceRules,match.ruleScript);
const play=(match:ShogiGame,from:number,to:number)=>match.play(moves(match).find(move=>move.from===from&&move.to===to)!);

test("the editable mixed preset starts standard shogi against sixteen chess pieces on a 9 by 9 board",()=>{
  const match=game(),position=match.position;
  expect([position.width,position.height]).toEqual([9,9]);expect(position.board.filter(piece=>piece?.side==="sente")).toHaveLength(20);expect(position.board.filter(piece=>piece?.side==="gote")).toHaveLength(16);
  expect(position.board[8]).toBeNull();expect(position.board[17]).toBeNull();expect(position.board[76]?.type).toBe("K");expect(position.board[4]?.type).toBe(CHESS_PIECES.k);
  expect(boardSettings(position,"sente")).toMatchObject({useHands:true,nifu:true,pawnDropMate:true,noMoves:"loss"});
  expect(boardSettings(position,"gote")).toMatchObject({useHands:false,nifu:false,pawnDropMate:false,noMoves:"draw",promotionDepth:0,perpetualCheckLoses:false});
  expect(boardSideName(position,"sente")).toBe("将棋");expect(boardSideName(position,"gote")).toBe("チェス");
  expect(moves(match)).toContainEqual({from:54,to:45,promote:false});play(match,54,45);
  expect(moves(match)).toContainEqual({from:9,to:27,promote:false});expect(moves(match)).toContainEqual({from:1,to:18,promote:false});
  expect(match.save().version).toBe(12);expect(setup.version).toBe(10);expect(loadSetup(setup)).toEqual(setup);expect(copySetup(setup).position).toEqual(setup.position);
  expect(ShogiGame.load(match.save()).position).toEqual(match.position);
});

test("only shogi keeps captures and a captured chess pawn can be dropped and moved without regaining its first double step",()=>{
  const position=minimal();position.board[40]={type:"R",side:"sente",promoted:false};position.board[31]={type:CHESS_PIECES.p,side:"gote",promoted:false};
  const match=game(position);play(match,40,31);expect(match.position.hands.sente[CHESS_PIECES.p]).toBe(1);play(match,0,1);
  expect(moves(match).some(move=>move.drop===CHESS_PIECES.p&&move.to===8)).toBe(false);
  match.play({drop:CHESS_PIECES.p,to:63,promote:false});expect(match.position.board[63]?.data?.moved).toBe(true);expect(match.position.hands.sente[CHESS_PIECES.p]).toBe(0);play(match,1,0);
  expect(moves(match)).toContainEqual({from:63,to:54,promote:false});expect(moves(match).some(move=>move.from===63&&move.to===45)).toBe(false);
  expect(ShogiGame.load(match.save()).position).toEqual(match.position);match.undo();match.undo();expect(match.position.hands.sente[CHESS_PIECES.p]).toBe(1);
  const other=minimal("gote");other.board[31]={type:CHESS_PIECES.r,side:"gote",promoted:false};other.board[40]={type:"G",side:"sente",promoted:false};other.hands.gote.N=1;
  const chess=game(other);expect(moves(chess).every(move=>!move.drop)).toBe(true);play(chess,31,40);expect(chess.position.hands.gote.G).toBe(0);
});

test("shogi promotion and chess promotion coexist, and nine-file castling uses the original chess rook",()=>{
  const shogi=minimal();shogi.board[13]={type:"P",side:"sente",promoted:false};const promoted=game(shogi);
  expect(moves(promoted).filter(move=>move.from===13&&move.to===4).map(move=>move.promote)).toEqual([true]);play(promoted,13,4);expect(promoted.position.board[4]?.promoted).toBe(true);
  const chess=minimal("gote");chess.board[67]={type:CHESS_PIECES.p,side:"gote",promoted:false};const upgraded=game(chess);
  const choices=moves(upgraded).filter(move=>move.from===67&&move.to===76);expect(choices).toHaveLength(4);upgraded.play(choices.find(move=>move.choices?.[0]===CHESS_PIECES.q)!);expect(upgraded.position.board[76]?.type).toBe(CHESS_PIECES.q);
  const castle=structuredClone(setup.position);castle.turn="gote";castle.board[5]=null;castle.board[6]=null;
  const castled=game(castle);play(castled,4,6);expect(castled.position.board[5]?.type).toBe(CHESS_PIECES.r);expect(castled.position.board[7]).toBeNull();expect(ShogiGame.load(castled.save()).position).toEqual(castled.position);
  const attacked=minimal("gote");attacked.board[0]=null;attacked.board[4]={type:CHESS_PIECES.k,side:"gote",promoted:false};attacked.board[7]={type:CHESS_PIECES.r,side:"gote",promoted:false};attacked.board[59]={type:"R",side:"sente",promoted:false};
  expect(moves(game(attacked)).some(move=>move.from===4&&move.to===6)).toBe(false);
});

test("en passant observes the capturing player's hand rules on both sides",()=>{
  const position=minimal("gote");position.board[11]={type:CHESS_PIECES.p,side:"gote",promoted:false};position.board[30]={type:CHESS_PIECES.p,side:"sente",promoted:false};
  const match=game(position);play(match,11,29);play(match,30,20);expect(match.position.board[29]).toBeNull();expect(match.position.hands.sente[CHESS_PIECES.p]).toBe(1);expect(ShogiGame.load(match.save()).position).toEqual(match.position);
  const reverse=minimal();reverse.board[65]={type:CHESS_PIECES.p,side:"sente",promoted:false};reverse.board[46]={type:CHESS_PIECES.p,side:"gote",promoted:false};
  const chess=game(reverse);play(chess,65,47);play(chess,46,56);expect(chess.position.board[47]).toBeNull();expect(chess.position.hands.gote[CHESS_PIECES.p]??0).toBe(0);
});

test("side-specific rules survive edits, history and files, reject invalid data, and change position identity",()=>{
  const editor=new BoardEditor(setup.position,setup.pieceRules,setup.ruleScript),before=editor.snapshot;
  editor.setPlayerRule("gote","useHands",true);expect(boardSettings(editor.position,"gote").useHands).toBe(true);expect(positionKey(editor.position)).not.toBe(positionKey(before.position));
  editor.undo();expect(editor.snapshot).toEqual(before);editor.redo();editor.setPlayerRule("gote","useHands",undefined);expect(editor.position.settings?.playerRules?.gote?.useHands).toBeUndefined();
  editor.undo();editor.undo();editor.swapSides();expect(boardSideName(editor.position,"sente")).toBe("チェス");expect(boardSettings(editor.position,"sente").useHands).toBe(false);expect(boardSettings(editor.position,"gote").useHands).toBe(true);editor.undo();expect(editor.snapshot).toEqual(before);
  expect(()=>loadSetup({...setup,version:9})).toThrow("保存形式");expect(()=>ShogiGame.load({...game().save(),version:11})).toThrow("保存形式");
  for(const playerRules of [null,[],{bad:{}},{sente:{unknown:true}},{gote:{useHands:"false"}},{gote:{promotionDepth:-1}},{sente:{name:"x".repeat(21)}}])expect(()=>loadBoardSettings({playerRules})).toThrow();
  const plain=createSetup({...setup.position,settings:loadBoardSettings({})},0,"plain",setup.pieceRules,setup.ruleScript);expect(plain.version).toBe(9);
});

test("stalemate follows the stranded side's rule, while checkmate defeats either army",()=>{
  for(const side of ["sente","gote"] as const){
    const position=minimal(side),enemy=side==="sente"?"gote":"sente";
    position.board.fill(null);position.board[0]={type:side==="sente"?"K":CHESS_PIECES.k,side,promoted:false};
    position.board[20]={type:enemy==="sente"?"K":CHESS_PIECES.k,side:enemy,promoted:false};
    position.board[19]={type:CHESS_PIECES.q,side:enemy,promoted:false};
    const stale=game(position);expect(inCheck(stale.position,side,stale.pieceRules)).toBe(false);
    expect(stale.result).toEqual({reason:"noMoves",winner:side==="gote"?null:enemy});
    position.board[19]=null;position.board[10]={type:CHESS_PIECES.q,side:enemy,promoted:false};
    expect(game(position).result).toEqual({reason:"mate",winner:enemy});
  }
});

test("repetition includes captured reserves and gives chess its own claim before common fourfold repetition",()=>{
  const match=game(minimal()),cycle=[[80,79],[0,1],[79,80],[1,0]];
  for(let ply=0;ply<8;ply++)play(match,...cycle[ply%4] as [number,number]);
  expect(match.canClaimDraw).toBe(false);play(match,80,79);expect(match.canClaimDraw).toBe(true);
  const claimed=ShogiGame.load(match.save());claimed.claimDraw();expect(claimed.result?.reason).toBe("claim");
  for(let ply=9;ply<12;ply++)play(match,...cycle[ply%4] as [number,number]);
  expect(match.result).toEqual({reason:"repetition",winner:null});
  const held=minimal();held.hands.sente[CHESS_PIECES.p]=1;
  expect(positionKey(game(held).position)).not.toBe(positionKey(game(minimal()).position));
});

test("chess quiet-move claims and automatic draws work without treating mixed material as insufficient",()=>{
  const position=game(minimal("gote")).position;position.ruleState!.data.chess={halfmove:100,ep:null};
  expect(game(position).canClaimDraw).toBe(true);position.turn="sente";expect(game(position).canClaimDraw).toBe(false);
  position.ruleState!.data.chess={halfmove:150,ep:null};expect(game(position).result).toEqual({reason:"script",winner:null});
  const reset=game(minimal()).position;reset.ruleState!.data.chess={halfmove:99,ep:null};reset.hands.sente[CHESS_PIECES.p]=1;
  const match=game(reset);match.play({drop:CHESS_PIECES.p,to:63,promote:false});
  expect((match.position.ruleState!.data.chess as Record<string,unknown>).halfmove).toBe(0);expect(match.canClaimDraw).toBe(false);
  expect(game(minimal()).result).toBeNull();
});

test("both armies' AI can move and scripted play remains saveable",()=>{
  const match=game();
  for(let ply=0;ply<6&&!match.result;ply++){
    const result=chooseAIMove(match.position,{pieceRules:match.pieceRules,ruleScript:match.ruleScript,passesRemaining:match.passesRemaining,previousPositions:match.positionHistory,randomSeed:ply,ply,maxDepth:1,maxNodes:1,maxTimeMs:30});
    expect(result.move).not.toBeNull();match.play(result.move!);
  }
  expect(match.moveCount).toBe(6);expect(ShogiGame.load(match.save()).position).toEqual(match.position);
},15000);
