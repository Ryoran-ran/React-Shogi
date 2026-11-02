// The old chess codec is used only at the import boundary. Games produced here use the shared editor engine.
import { Chess, ChessGame, createChessSetup, loadChessSetup } from "./chesscore";
import type { ChessAction, ChessSetup } from "./chesscore";
import { CHESS_PIECES, createChessPreset } from "./presets";
import { createSetup } from "./setups";
import { ShogiGame } from "./shogi";
import type { GameMove } from "./shogi";
import { loadPieceRules } from "./pieces";
import type { PieceType,PieceRuleEntry } from "./pieces";
const index=(square:string)=>(8-Number(square[1]))*8+square.charCodeAt(0)-97;
export function legacyChessAction(move:ChessAction):GameMove{return {from:index(move.from),to:index(move.to),promote:false,...(move.promotion?{choices:[CHESS_PIECES[move.promotion]]}:{})};}
export function legacyChessSetup(raw:ChessSetup){
  const source=loadChessSetup(raw),preset=createChessPreset(),position=preset.position,fields=source.fen.split(' '),engine=new Chess(source.fen);
  const entries:Partial<Record<PieceType,PieceRuleEntry>>=structuredClone(preset.pieceRules!);
  entries[CHESS_PIECES.p]={...entries[CHESS_PIECES.p],initialData:{...entries[CHESS_PIECES.p]!.initialData,doubleStep:source.rules.pawnDouble,enPassant:source.rules.enPassant,promotions:source.rules.promotions.map(type=>CHESS_PIECES[type])}};
  entries[CHESS_PIECES.k]={...entries[CHESS_PIECES.k],initialData:{...entries[CHESS_PIECES.k]!.initialData,castling:source.rules.castling}};
  position.board=engine.board().flat().map(piece=>{
    if(!piece)return null;const side=piece.color==='w'?'sente':'gote',square=index(piece.square),row=Math.floor(square/8),home=side==='sente'?7:0;
    const rights=fields[2],kingSide=side==='sente'?'K':'k',queenSide=side==='sente'?'Q':'q';let data;
    if(piece.type==='k')data={moved:!rights.includes(kingSide)&&!rights.includes(queenSide)};
    if(piece.type==='r')data={moved:row!==home||!(square%8===0?rights.includes(queenSide):square%8===7?rights.includes(kingSide):false)};
    if(piece.type==='p')data={moved:row!==(side==='sente'?6:1)};
    return {type:CHESS_PIECES[piece.type],side,promoted:false,...(data?{data}:{})};
  });
  position.turn=engine.turn()==='w'?'sente':'gote';
  const target=fields[3]==='-'?null:index(fields[3]);
  position.ruleState={ply:0,seed:1,data:{chess:{halfmove:Number(fields[4]),ep:target===null?null:{target,pawn:target+(position.turn==='sente'?8:-8),side:position.turn==='sente'?'gote':'sente'}}}};
  const script=preset.ruleScript!.replace('const CLAIM_DRAWS=true, AUTO_REPETITION=5, AUTO_QUIET_MOVES=150;',`const CLAIM_DRAWS=${source.rules.drawClaims}, AUTO_REPETITION=${source.rules.automaticDraws?5:0}, AUTO_QUIET_MOVES=${source.rules.automaticDraws?150:0};`);
  return createSetup(position,0,source.name,loadPieceRules(entries),script);
}
export function importLegacyChess(raw:unknown):ShogiGame{
  const data=raw as any,source=data?.kind==='chess-game'?ChessGame.load(data):data?.kind==='chess-setup'?new ChessGame(loadChessSetup(data)):data?.version===1&&data.game?.kind==='chess-game'?ChessGame.load(data.game):null;
  if(!source)throw new Error("旧版のチェスの保存データではありません");
  const setup=legacyChessSetup(source.setup),game=new ShogiGame(setup.position,{passLimit:0,pieceRules:setup.pieceRules,ruleScript:setup.ruleScript});
  for(const move of source.save().moves)game.play(legacyChessAction(move));
  const ending=source.save().ending;
  if(ending&&!game.result){
    if(ending.result.reason==='threefold'||ending.result.reason==='fifty')game.claimDraw(ending.intended?legacyChessAction(ending.intended):undefined);
    else if(ending.result.winner===null)game.agreeDraw();
    else if(ending.result.winner===(game.position.turn==='sente'?'b':'w'))game.resign();
    else throw new Error("この棋譜の終局結果は自動で変換できません。元の保存データは保持しています。");
  }
  if(source.result&&(!game.result||game.result.winner!==(source.result.winner==='w'?'sente':source.result.winner==='b'?'gote':null)))throw new Error("旧版チェスの結果を再現できませんでした");
  return game;
}
export function importChessText(text:string):ShogiGame{
  const trimmed=text.trim();if(trimmed.startsWith('{'))return importLegacyChess(JSON.parse(trimmed));
  return importLegacyChess((/^[prnbqkPRNBQK1-8/]+\s+[wb]\s/.test(trimmed)?new ChessGame(createChessSetup(trimmed)):ChessGame.fromPGN(trimmed)).save());
}
