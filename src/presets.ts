import { emptyPosition } from "./shogi";
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
    if(ctx.event.from%ctx.board.width!==ctx.event.to%ctx.board.width&&!ctx.board.at(ctx.event.to)) ctx.capturePiece(ctx.event.from,ctx.state.chess.ep.pawn);
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
    const rookSquare=home*w+(sign>0?w-1:0),rook=ctx.board.at(rookSquare);
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
      ctx.move(row*w+(sign>0?w-1:0),from+sign);
    }
  },
  afterMove(ctx) { ctx.setPieceData(ctx.self.square,{...ctx.self.data,moved:true}); }
};`;
const ROOK_SCRIPT=`export default { afterMove(ctx) { ctx.setPieceData(ctx.self.square,{...ctx.self.data,moved:true}); } };`;

export const CHESS_BOARD_SCRIPT=`// この作例の勝敗・引き分け条件です。数値や処理を編集できます。
const CLAIM_DRAWS=true, AUTO_REPETITION=5, AUTO_QUIET_MOVES=150;
const PAWN="custom_pawn",KING="custom_king",ROOK="custom_rook";
function effectiveEP(ctx) {
  const ep=ctx.state.chess.ep,w=ctx.board.width;
  if(!ep||ep.side===ctx.turn||ctx.board.at(ep.target)||ctx.board.at(ep.pawn)?.type!==PAWN) return "-";
  for(const entry of ctx.board.pieces(ctx.turn)) {
    if(entry.piece.type!==PAWN||entry.piece.data?.enPassant===false||Math.abs(entry.square%w-ep.target%w)!==1||ctx.board.forward(entry.square,ctx.turn)!==ep.target+(entry.square%w-ep.target%w)) continue;
    const board=ctx.board.snapshot();board[entry.square]=null;board[ep.pawn]=null;board[ep.target]=entry.piece;
    const king=board.findIndex(piece=>piece?.side===ctx.turn&&piece.type===KING);
    if(king>=0&&!ctx.board.isAttacked(king,ctx.turn==="sente"?"gote":"sente",board)) return String(ep.target);
  }
  return "-";
}
function positionKey(ctx) {
  const w=ctx.board.width,board=ctx.board.snapshot();let rights="";
  for(const side of ["sente","gote"]) {
    const row=side==="sente"?ctx.board.height-1:0,king=board[row*w+4];
    if(king?.type!==KING||king.side!==side||king.data?.moved||king.data?.castling===false) continue;
    for(const file of [0,w-1]) { const rook=board[row*w+file];if(rook?.type===ROOK&&rook.side===side&&!rook.data?.moved) rights+=side[0]+file; }
  }
  const pieces=board.map(piece=>piece?String.fromCharCode(256+ctx.pieceTypes.indexOf(piece.type)*4+(piece.side==="gote"?2:0)+(piece.promoted?1:0)):".").join("");
  return ctx.turn+"|"+pieces+"|"+rights+"|"+effectiveEP(ctx);
}
export default {
  onStart(ctx) {
    const old=ctx.state.chess;
    ctx.state.chess={halfmove:old?.halfmove??0,ep:old?.ep??null,positions:{},captured:false};
  },
  beforeMove(ctx) { ctx.state.chess.captured=false; },
  afterCapture(ctx) { ctx.state.chess.captured=true; },
  afterMove(ctx) {
    if(ctx.event.automatic) return;
    const state=ctx.state.chess,{from,to}=ctx.event,w=ctx.board.width;
    state.halfmove=ctx.actor.type===PAWN||state.captured?0:state.halfmove+1;
    state.ep=ctx.actor.type===PAWN&&Math.abs(to-from)===2*w?{target:(from+to)/2,pawn:to,side:ctx.side}:null;
  },
  checkResult(ctx) {
    const state=ctx.state.chess,key=positionKey(ctx);ctx.setRepetitionKey(key);
    if(state.halfmove===0) state.positions={};
    state.positions[key]=(state.positions[key]??0)+1;
    if(CLAIM_DRAWS) {
      if(state.positions[key]>=3||state.halfmove>=100) ctx.allowDrawClaim(state.positions[key]>=3?"同一局面3回":"50手ルール");
      if(state.halfmove>=99||Object.values(state.positions).some(count=>count>=2)) ctx.checkDrawClaimAfterMove();
    }
    const others=ctx.board.pieces().filter(entry=>entry.piece.type!==KING);
    const minor=type=>type==="custom_bishop"||type==="custom_knight";
    const bishops=others.length>0&&others.every(entry=>entry.piece.type==="custom_bishop")&&new Set(others.map(entry=>(entry.square%ctx.board.width+Math.floor(entry.square/ctx.board.width))%2)).size===1;
    if(!others.length||others.length===1&&minor(others[0].piece.type)||bishops||AUTO_REPETITION&&state.positions[key]>=AUTO_REPETITION||AUTO_QUIET_MOVES&&state.halfmove>=AUTO_QUIET_MOVES) ctx.draw({unlessMate:true});
  }
};`;

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
