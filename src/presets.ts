import {createChessBoardScript} from "./chessscript";
import { emptyPosition, initialPosition } from "./shogi";
import { createSetup } from "./setups";
import { loadPieceRules } from "./pieces";
import { loadBoardSettings } from "./boardsettings";
import type { PieceType, PieceMovement, PieceDefinition, PieceRuleEntry, PieceRules } from "./pieces";
import type { Position } from "./shogi";
import type { PieceIcon } from "./pieceicons";

export const CHESS_PIECES={k:"custom_king",q:"custom_queen",r:"custom_rook",b:"custom_bishop",n:"custom_knight",p:"custom_pawn"} as const;
const chessGlyphs={k:["♔","♚"],q:["♕","♛"],r:["♖","♜"],b:["♗","♝"],n:["♘","♞"],p:["♙","♟"]};
const chessIcons:Record<keyof typeof CHESS_PIECES,PieceIcon>={k:"king",q:"queen",r:"rook",b:"bishop",n:"knight",p:"pawn"};
export function canApplyChessAppearance(rules:PieceRules):boolean{return Object.values(CHESS_PIECES).every(type=>!!rules[type]?.definition);}
/** A visual preset applied through the common editor; movement, data and code remain editable. */
export function applyChessAppearance(position:Position,rules:PieceRules){
  const board=structuredClone(position),entries={...rules};board.boardTheme="chess";
  board.squareColors=board.board.map((_,index)=>(index%board.width+Math.floor(index/board.width))%2===0?"#eeeed2":"#7f9a7a");
  for(const kind of Object.keys(CHESS_PIECES) as Array<keyof typeof CHESS_PIECES>){
    const type=CHESS_PIECES[kind],entry=rules[type];if(!entry)continue;
    entries[type]={...entry,design:{...entry.design,normal:{
      sente:{text:chessGlyphs[kind][0],shape:"chess",icon:chessIcons[kind],fill:"#fff9e8",color:"#334a3c",upright:true},
      gote:{text:chessGlyphs[kind][1],shape:"chess",icon:chessIcons[kind],fill:"#2d4236",color:"#14281f",upright:true},
    }}};
  }
  return {position:board,rules:loadPieceRules(entries)};
}
const PAWN_SCRIPT=`const PAWN="custom_pawn";
export default {
  validateMove(ctx) {
    if(ctx.event.drop) return Math.floor(ctx.event.to/ctx.board.width)!==(ctx.side==="sente"?0:ctx.board.height-1);
    const {from,to}=ctx.event,w=ctx.board.width,dx=to%w-from%w;
    const dy=(Math.floor(from/w)-Math.floor(to/w))*(ctx.side==="sente"?1:-1);
    if(dx===0) {
      if(ctx.board.at(to)) return false;
      if(dy===1) return true;
      const home=ctx.side==="sente"?ctx.board.height-2:1;
      return dy===2&&ctx.self.data?.doubleStep!==false&&!ctx.self.data?.moved&&Math.floor(from/w)===home&&!ctx.board.at((from+to)/2);
    }
    if(Math.abs(dx)!==1||dy!==1) return false;
    if(ctx.board.at(to)) return true;
    const ep=ctx.state.chess?.ep,victim=ep&&ctx.board.at(ep.pawn);
    return ctx.self.data?.enPassant!==false&&!!ep&&ep.side!==ctx.side&&ep.target===to&&victim?.type===PAWN&&victim.side!==ctx.side;
  },
  beforeMove(ctx) {
    if(ctx.event.from!==undefined&&ctx.event.from%ctx.board.width!==ctx.event.to%ctx.board.width&&!ctx.board.at(ctx.event.to)) ctx.capturePiece(ctx.event.from,ctx.state.chess.ep.pawn);
  },
  afterMove(ctx) {
    ctx.setPieceData(ctx.self.square,{...ctx.self.data,moved:true});
    const row=Math.floor(ctx.self.square/ctx.board.width),last=ctx.side==="sente"?0:ctx.board.height-1;
    if(row===last) {
      const allowed=ctx.self.data?.promotions??["custom_queen","custom_rook","custom_bishop","custom_knight"];
      const labels={custom_queen:"クイーン",custom_rook:"ルーク",custom_bishop:"ビショップ",custom_knight:"ナイト"};
      const selected=ctx.choose("昇格する駒を選んでください",allowed.filter(type=>ctx.pieceTypes.includes(type)).map(value=>({value,label:labels[value]??value})));
      ctx.transform(ctx.self.square,selected);
    }
  }
};`;
const KING_SCRIPT=`export default {
  validateMove(ctx) {
    const {from,to}=ctx.event,w=ctx.board.width,dx=to%w-from%w;
    if(Math.abs(dx)!==2) return true;
    const home=ctx.side==="sente"?ctx.board.height-1:0,sign=dx>0?1:-1;
    if(ctx.self.data?.castling===false||ctx.self.data?.moved||Math.floor(from/w)!==home||Math.floor(to/w)!==home||from%w!==(ctx.self.data?.castleFile??4)) return false;
    const rookSquare=home*w+(sign>0?(ctx.self.data?.castleRookRight??w-1):(ctx.self.data?.castleRookLeft??0)),rook=ctx.board.at(rookSquare);
    if(rook?.type!==(ctx.self.data?.castlePartner??"custom_rook")||rook.side!==ctx.side||rook.data?.moved) return false;
    for(let square=Math.min(from,rookSquare)+1;square<Math.max(from,rookSquare);square++) if(ctx.board.at(square)) return false;
    const enemy=ctx.side==="sente"?"gote":"sente";
    for(let step=0;step<=2;step++) if(ctx.board.isAttacked(from+step*sign,enemy)) return false;
    return true;
  },
  beforeMove(ctx) {
    const {from,to}=ctx.event,w=ctx.board.width;
    if(Math.abs(to%w-from%w)===2) {
      const row=Math.floor(from/w),sign=to>from?1:-1;
      ctx.move(row*w+(sign>0?(ctx.self.data?.castleRookRight??w-1):(ctx.self.data?.castleRookLeft??0)),from+sign);
    }
  },
  afterMove(ctx) { ctx.setPieceData(ctx.self.square,{...ctx.self.data,moved:true}); }
};`;
const ROOK_SCRIPT=`export default { afterMove(ctx) { ctx.setPieceData(ctx.self.square,{...ctx.self.data,moved:true}); } };`;

export const CHESS_BOARD_SCRIPT=createChessBoardScript();

function table(kind:keyof typeof CHESS_PIECES):number[][]{
  return Array.from({length:8},(_,y)=>Array.from({length:8},(_,x)=>{
    const advance=7-y,center=7-Math.abs(3.5-x)-Math.abs(3.5-y);
    if(kind==='p')return advance*5+(3.5-Math.abs(3.5-x))*advance*4-(advance===1&&(x===3||x===4)?16:0);
    if(kind==='n')return center*10-(advance===0?14:0);
    if(kind==='b')return center*5-(advance===0?15:0);
    if(kind==='q')return center*2-(advance>1?12:0);
    if(kind==='r')return advance===6?22:advance>0&&advance<3?-14:0;
    return advance===0?(x===6||x===2?42:-12):-25-advance*12;
  }));
}
export function createChessPreset(){
  const ray=(dx:number,dy:number,range:number|null=1):PieceMovement=>({dx,dy,range});
  const king=[ray(-1,-1),ray(0,-1),ray(1,-1),ray(-1,0),ray(1,0),ray(-1,1),ray(0,1),ray(1,1)];
  const rook=[ray(1,0,null),ray(-1,0,null),ray(0,1,null),ray(0,-1,null)],bishop=[ray(1,1,null),ray(1,-1,null),ray(-1,1,null),ray(-1,-1,null)];
  const knight=[ray(-2,-1),ray(-2,1),ray(-1,-2),ray(-1,2),ray(1,-2),ray(1,2),ray(2,-1),ray(2,1)];
  const pawnCaptures=[ray(-1,1),ray(1,1)];
  const data:Record<keyof typeof CHESS_PIECES,{name:string;value:number;moves:PieceMovement[];captures:PieceMovement[];script?:string;initialData?:Record<string,string|number|boolean>}>= {
    k:{name:"キング",value:20000,moves:[...king,ray(-2,0),ray(2,0)],captures:king,script:KING_SCRIPT,initialData:{moved:false,castleFile:4,castlePartner:CHESS_PIECES.r}},
    q:{name:"クイーン",value:950,moves:[...rook,...bishop],captures:[...rook,...bishop]},
    r:{name:"ルーク",value:500,moves:rook,captures:rook,script:ROOK_SCRIPT,initialData:{moved:false}},
    b:{name:"ビショップ",value:335,moves:bishop,captures:bishop},
    n:{name:"ナイト",value:320,moves:knight,captures:knight},
    p:{name:"ポーン",value:100,moves:[ray(0,1),ray(0,2),...pawnCaptures],captures:pawnCaptures,script:PAWN_SCRIPT,initialData:{moved:false}},
  };
  const entries:Record<string,PieceRuleEntry>={K:{royal:false}};
  for(const kind of Object.keys(data) as Array<keyof typeof data>){
    const entry=data[kind],definition:PieceDefinition={name:entry.name,label:entry.name,description:`${entry.name}の移動・駒取りを設定します。特殊な条件はこの駒のルールコードに記述しています。`,value:entry.value,moves:entry.moves,captures:entry.captures};
    entries[CHESS_PIECES[kind]]={definition,royal:kind==='k',aiTable:table(kind),...(entry.script?{script:entry.script}:{}),...(entry.initialData?{initialData:entry.initialData}:{})};
  }
  const rules=loadPieceRules(entries),position=emptyPosition(8,8),back="rnbqkbnr" as const;
  for(let x=0;x<8;x++){
    const type=CHESS_PIECES[back[x] as keyof typeof CHESS_PIECES];
    position.board[x]={type,side:"gote",promoted:false};position.board[56+x]={type,side:"sente",promoted:false};
    position.board[8+x]={type:CHESS_PIECES.p,side:"gote",promoted:false};position.board[48+x]={type:CHESS_PIECES.p,side:"sente",promoted:false};
  }
  position.settings=loadBoardSettings({nifu:false,pawnDropMate:false,useHands:false,promotionDepth:0,noMoves:"draw",repetitionLimit:null,perpetualCheckLoses:false});
  const styled=applyChessAppearance(position,rules);
  return createSetup(styled.position,0,"チェス",styled.rules,CHESS_BOARD_SCRIPT);
}

/** Both armies use their own rules on one editable board. The ninth file starts empty for chess. */
export function createShogiChessPreset(){
  const chess=createChessPreset(),position=initialPosition(),entries={...chess.pieceRules};
  delete entries.K;
  entries[CHESS_PIECES.k]={...entries[CHESS_PIECES.k],initialData:{...entries[CHESS_PIECES.k]!.initialData,castleRookRight:7,castleRookLeft:0}};
  for(let index=0;index<position.board.length;index++)if(position.board[index]?.side==="gote")position.board[index]=null;
  for(let y=0;y<2;y++)for(let x=0;x<8;x++)position.board[y*9+x]=structuredClone(chess.position.board[y*8+x]);
  position.settings=loadBoardSettings({playerRules:{
    sente:{name:"将棋"},
    gote:{name:"チェス",nifu:false,pawnDropMate:false,useHands:false,promotionDepth:0,noMoves:"draw",perpetualCheckLoses:false},
  }});
  const styled=applyChessAppearance(position,loadPieceRules(entries));
  return createSetup(styled.position,0,"将棋VSチェス",styled.rules,createChessBoardScript(true));
}
