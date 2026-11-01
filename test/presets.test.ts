import {expect,test} from "bun:test";
import {createChessPreset,CHESS_PIECES} from "../src/presets";
import {ShogiGame,legalMoves,isPassMove,positionKey} from "../src/shogi";
import type {GameMove} from "../src/shogi";
import {Chess,createChessSetup,ChessGame} from "../src/chesscore";
import {legacyChessSetup,legacyChessAction,importLegacyChess} from "../src/chesslegacy";
import {BoardEditor} from "../src/editor";
import {loadSetup,copySetup} from "../src/setups";
import {updatePieceMovements,updatePieceScript,addCustomPiece,updateSharedPieceMovements} from "../src/pieces";
import {chooseAIMove} from "../src/ai";

function fromFen(fen?:string){const setup=fen?legacyChessSetup(createChessSetup(fen)):createChessPreset();return new ShogiGame(setup.position,{pieceRules:setup.pieceRules,ruleScript:setup.ruleScript,passLimit:0,trace:true});}
const square=(index:number)=>String.fromCharCode(97+index%8)+(8-Math.floor(index/8));
const letter=Object.fromEntries(Object.entries(CHESS_PIECES).map(([key,value])=>[value,key]));
const lan=(move:GameMove)=>isPassMove(move)?'pass':square(move.from!)+square(move.to)+(move.choices?.[0]?letter[move.choices[0]]:'');
const moves=(game:ShogiGame)=>legalMoves(game.position,game.pieceRules,game.ruleScript);
function play(game:ShogiGame,text:string){const move=moves(game).find(move=>lan(move)===text);if(!move)throw new Error(`Missing ${text}`);game.play(move);}

test("the chess preset is ordinary editor data with six editable definitions and shared-engine saves",()=>{
  const setup=createChessPreset(),game=fromFen();expect(setup.kind).toBe('shogi-setup');expect(setup.version).toBe(9);expect(game.position.board.filter(Boolean)).toHaveLength(32);expect(moves(game)).toHaveLength(20);
  expect(Object.keys(setup.pieceRules!).filter(type=>type.startsWith('custom_'))).toHaveLength(6);expect(loadSetup(setup)).toEqual(setup);expect(copySetup(setup).pieceRules).toEqual(setup.pieceRules);
  play(game,'e2e4');expect(game.position.board[36]?.type).toBe(CHESS_PIECES.p);expect(ShogiGame.load(game.save()).position).toEqual(game.position);expect(game.save().version).toBe(11);
});
test("shared movement and piece scripts reproduce standard legal moves through opening play",()=>{
  const game=fromFen(),oracle=new Chess();
  for(const san of ['e4','e5','Nf3','Nc6','Bc4','Nf6','d3','Bc5','O-O']){
    expect(moves(game).map(lan).sort()).toEqual(oracle.moves({verbose:true}).map(move=>move.lan).sort());
    const move=oracle.move(san);play(game,move.lan);
  }
  expect(game.position.board[62]?.type).toBe(CHESS_PIECES.k);expect(game.position.board[61]?.type).toBe(CHESS_PIECES.r);
  game.undo();expect(moves(game).some(move=>lan(move)==='e1g1')).toBe(true);
},20000);
test("castling, pins, en passant and promotion use the configured pieces and generic rule APIs",()=>{
  for(const fen of ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1','r3kr1r/8/8/8/8/8/8/R3K2R w KQkq - 0 1','k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1','7k/8/8/3pP3/8/8/8/K7 w - d6 0 1','7k/P7/8/8/8/8/8/7K w - - 0 1']){
    const game=fromFen(fen),oracle=new Chess(fen);expect(moves(game).map(lan).sort()).toEqual(oracle.moves({verbose:true}).map(move=>move.lan).sort());
  }
  const ep=fromFen('7k/8/8/3pP3/8/8/8/K7 w - d6 0 1');play(ep,'e5d6');expect(ep.position.board[27]).toBeNull();expect(ep.position.board[19]?.side).toBe('sente');expect(ep.records[0].effects?.join(' ')).toContain('捕獲');ep.undo();expect(ep.position.board[27]?.type).toBe(CHESS_PIECES.p);
  const promotion=fromFen('7k/P7/8/8/8/8/8/7K w - - 0 1');play(promotion,'a7a8q');expect(promotion.position.board[0]?.type).toBe(CHESS_PIECES.q);expect(ShogiGame.load(promotion.save()).position).toEqual(promotion.position);
},20000);
test("shared board settings and board code handle mate, stalemate, draw claims and repetition",()=>{
  const mate=fromFen();for(const move of ['f2f3','e7e5','g2g4','d8h4'])play(mate,move);expect(mate.result).toEqual({reason:'mate',winner:'gote'});
  expect(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').result).toEqual({reason:'noMoves',winner:null});
  const repeated=fromFen(),initial=positionKey(repeated.position);for(let index=0;index<8;index++)play(repeated,['g1f3','g8f6','f3g1','f6g8'][index%4]);expect(positionKey(repeated.position)).toBe(initial);expect(repeated.canClaimDraw).toBe(true);repeated.claimDraw();expect(repeated.result?.reason).toBe('claim');expect(ShogiGame.load(repeated.save()).result).toEqual(repeated.result);repeated.undo();expect(repeated.result).toBeNull();
  const fifty=fromFen('7k/8/8/8/8/8/R7/K7 w - - 99 1');expect(fifty.claimableMoves.length).toBeGreaterThan(0);fifty.claimDraw(moves(fifty).find(move=>lan(move)==='a2b2'));expect(fifty.moveCount).toBe(0);expect(ShogiGame.load(fifty.save()).result?.reason).toBe('claim');
},20000);
test("editing the existing movement grid, piece code and library changes how the chess example plays",()=>{
  const setup=createChessPreset(),editor=new BoardEditor(setup.position,setup.pieceRules,setup.ruleScript),pawn=editor.pieceRules[CHESS_PIECES.p]!;
  editor.setPieceRules(updatePieceMovements(editor.pieceRules,CHESS_PIECES.p,false,'moves',pawn.definition!.moves.filter(move=>move.dy!==2)));
  let changed=new ShogiGame(editor.position,{pieceRules:editor.pieceRules,ruleScript:editor.ruleScript,passLimit:0});expect(moves(changed)).toHaveLength(12);
  editor.undo();editor.setPieceRules(updatePieceScript(editor.pieceRules,CHESS_PIECES.p,'export default { validateMove(ctx) { return Math.abs(ctx.event.to-ctx.event.from)!==2*ctx.board.width; } };'));
  changed=new ShogiGame(editor.position,{pieceRules:editor.pieceRules,ruleScript:editor.ruleScript,passLimit:0});expect(moves(changed).some(move=>lan(move)==='e2e4')).toBe(false);
  const added=addCustomPiece(editor.pieceRules);editor.setPieceRules(updateSharedPieceMovements(added.rules,added.type,false,[{dx:0,dy:1,range:1}]));editor.place(40,{type:added.type,side:'sente',promoted:false});expect(editor.position.board[40]?.type).toBe(added.type);expect(loadSetup({...setup,position:editor.position,pieceRules:editor.pieceRules}).pieceRules?.[added.type]).toBeDefined();
  const base=fromFen();setup.position.board[18]={type:'L',side:'gote',promoted:false};
  const withLance=new ShogiGame(setup.position,{pieceRules:setup.pieceRules,ruleScript:setup.ruleScript,passLimit:0});expect(positionKey(withLance.position)).not.toBe(positionKey(base.position));
  setup.position.board[18]!.promoted=true;const promoted=new ShogiGame(setup.position,{pieceRules:setup.pieceRules,ruleScript:setup.ruleScript,passLimit:0});expect(positionKey(promoted.position)).not.toBe(positionKey(withLance.position));
},15000);
test("previous dedicated chess records are converted to ordinary shared-engine records",()=>{
  const old=new ChessGame();for(const san of ['e4','a6','e5','d5','exd6']){const move=old.legalMoves().find(move=>move.san===san)!;old.play({from:move.from,to:move.to});}
  const imported=importLegacyChess(old.save());expect(imported.moveCount).toBe(5);expect(imported.position.board[19]?.type).toBe(CHESS_PIECES.p);expect(imported.position.board[27]).toBeNull();expect(imported.save().initialPosition?.width).toBe(8);expect(ShogiGame.load(imported.save()).position).toEqual(imported.position);
},15000);
test("the shared AI evaluates editable positional tables and returns a legal chess move",()=>{
  const game=fromFen(),before=game.position;const result=chooseAIMove(game.position,{pieceRules:game.pieceRules,ruleScript:game.ruleScript,passesRemaining:game.passesRemaining,maxDepth:1,maxNodes:10,maxTimeMs:1200});expect(result.move).not.toBeNull();expect(game.position).toEqual(before);expect(moves(game).some(move=>JSON.stringify(move)===JSON.stringify(result.move))).toBe(true);game.play(result.move!);expect(game.moveCount).toBe(1);
},10000);

test("automatic draws respect mate and king safety, and configurable promotion accepts added pieces",()=>{
  const repeated=fromFen();for(let i=0;i<16;i++)play(repeated,['g1f3','g8f6','f3g1','f6g8'][i%4]);expect(repeated.result).toEqual({reason:'script',winner:null});
  const mate=fromFen('7k/5Q2/6K1/8/8/8/8/8 w - - 149 1');play(mate,'f7g7');expect(mate.result).toEqual({reason:'mate',winner:'sente'});expect(ShogiGame.load(mate.save()).result).toEqual(mate.result);
  const pinned=fromFen('k3r3/8/8/8/8/8/4R3/4K3 w - - 149 1');expect(moves(pinned).some(move=>lan(move)==='e2a2')).toBe(false);
  const quiet=fromFen('7k/8/8/8/8/8/R7/K7 w - - 149 1');play(quiet,'a2b2');expect(quiet.result).toEqual({reason:'script',winner:null});
  const setup=legacyChessSetup(createChessSetup('7k/P7/8/8/8/8/8/7K w - - 0 1')),added=addCustomPiece(setup.pieceRules!);
  const rules={...added.rules,[CHESS_PIECES.p]:{...added.rules[CHESS_PIECES.p],initialData:{moved:false,promotions:[added.type]}}};
  const variant=new ShogiGame(setup.position,{pieceRules:rules,ruleScript:setup.ruleScript,passLimit:0});const promote=moves(variant).find(move=>move.choices?.[0]===added.type)!;expect(promote).toBeDefined();variant.play(promote);expect(variant.position.board[0]?.type).toBe(added.type);
},20000);

test("the shared AI progresses past the former early repetition using a full position history",()=>{
  const game=fromFen();
  for(let i=0;i<28&&!game.result;i++) {
    const result=chooseAIMove(game.position,{pieceRules:game.pieceRules,ruleScript:game.ruleScript,passesRemaining:game.passesRemaining,previousPositions:game.positionHistory,maxDepth:1,maxNodes:1,maxTimeMs:1});
    expect(result.claimDraw).not.toBe(true);expect(result.move).not.toBeNull();game.play(result.move!);
  }
  expect(game.moveCount).toBe(28);expect(game.result).toBeNull();expect(game.position.board.filter(Boolean).length).toBeLessThan(32);expect(new Set(game.positionHistory).size).toBeGreaterThan(24);
},20000);
