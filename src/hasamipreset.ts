import {emptyPosition} from "./shogi";
import {loadBoardSettings} from "./boardsettings";
import {loadPieceRules} from "./pieces";
import {createSetup} from "./setups";

export const HASAMI_PIECE = "custom_hasami";
export const HASAMI_BOARD_SCRIPT = `// この作例は5枚先取。枚数と端・角の包囲取りをここで変更できます。
const WIN_CAPTURE_COUNT = 5;
const CAPTURE_EDGE = true;
const CAPTURE_CORNER = true;
const DIRECTIONS = [[0,-1],[0,1],[-1,0],[1,0]];

function neighbors(square,w,h) {
  const x=square%w,y=Math.floor(square/w),result=[];
  for(const [dx,dy] of DIRECTIONS) {
    const nx=x+dx,ny=y+dy;
    if(nx>=0&&nx<w&&ny>=0&&ny<h)result.push(ny*w+nx);
  }
  return result;
}
function capturedSquares(board,to,side,w,h) {
  const taken=new Set(),x=to%w,y=Math.floor(to/w);
  // 縦横の連続した相手の列を、自分の駒で挟みます。
  for(const [dx,dy] of DIRECTIONS) {
    let nx=x+dx,ny=y+dy;const line=[];
    while(nx>=0&&nx<w&&ny>=0&&ny<h) {
      const square=ny*w+nx,piece=board[square];
      if(!piece)break;
      if(piece.side===side){for(const target of line)taken.add(target);break;}
      line.push(square);nx+=dx;ny+=dy;
    }
  }
  // 端・角に接する相手の一団を、空きマスへの出口がないように囲みます。
  // 角を含む一団にはCAPTURE_CORNER、それ以外の端の一団にはCAPTURE_EDGEを適用。
  // 移動した駒に隣接する一団だけを、除去前の同じ盤面で判定します。
  const visited=new Set();
  for(const start of neighbors(to,w,h)) {
    if(!board[start]||board[start].side===side||visited.has(start))continue;
    const group=[start];visited.add(start);let edge=false,corner=false,open=false;
    for(let i=0;i<group.length;i++) {
      const square=group[i],gx=square%w,gy=Math.floor(square/w);
      const atX=gx===0||gx===w-1,atY=gy===0||gy===h-1;
      edge=edge||atX||atY;corner=corner||(atX&&atY);
      for(const next of neighbors(square,w,h)) {
        const piece=board[next];
        if(!piece)open=true;
        else if(piece.side!==side&&!visited.has(next)){visited.add(next);group.push(next);}
      }
    }
    if(edge&&!open&&(corner?CAPTURE_CORNER:CAPTURE_EDGE))for(const square of group)taken.add(square);
  }
  return [...taken];
}

export default {
  onStart(ctx) { ctx.state.captured={sente:0,gote:0}; },
  validateMove(ctx) {
    return !ctx.event.pass&&!ctx.event.drop&&!ctx.board.at(ctx.event.to);
  },
  afterMove(ctx) {
    const taken=capturedSquares(ctx.board.snapshot(),ctx.event.to,ctx.side,ctx.board.width,ctx.board.height);
    for(const square of taken)ctx.destroy(square);
    ctx.state.captured??={sente:0,gote:0};
    ctx.state.captured[ctx.side]+=taken.length;
  },
  checkResult(ctx) {
    const pieces=ctx.board.pieces(),sente=pieces.filter(entry=>entry.piece.side==="sente").length,gote=pieces.length-sente;
    const captured=ctx.state.captured??(ctx.state.captured={sente:0,gote:0});
    ctx.setRepetitionKey(ctx.turn+"|"+ctx.board.snapshot().map(piece=>piece?(piece.side==="sente"?"s":"g"):".").join("")+"|"+captured.sente+","+captured.gote);
    if(!sente&&!gote)ctx.draw();
    else if(!gote||captured.sente>=WIN_CAPTURE_COUNT)ctx.win("sente");
    else if(!sente||captured.gote>=WIN_CAPTURE_COUNT)ctx.win("gote");
  }
};`;

/** A shared editor setup, with movement in piece data and capture/victory in board code. */
export function createHasamiPreset() {
  const rules=loadPieceRules({K:{royal:false},[HASAMI_PIECE]:{
    definition:{
      name:"はさみ駒",label:"歩",value:100,
      description:"縦横に、駒を飛び越えず空きマスへ進みます。相手の列を挟むか、端・角で囲むと取れます。この作例は5枚先取。取った駒は再使用しません。",
      moves:[{dx:0,dy:1,range:null},{dx:0,dy:-1,range:null},{dx:1,dy:0,range:null},{dx:-1,dy:0,range:null}],
      captures:[],
    },
    design:{normal:{sente:{text:"歩",fill:"#ddbb7d",color:"#4a3a25",shape:"shogi"},gote:{text:"と",fill:"#ddbb7d",color:"#a84634",shape:"shogi"}}},
    aiTable:Array.from({length:9},(_,y)=>Array.from({length:9},(_,x)=>Math.min(x,8-x,y,8-y)*3)),
  }});
  const position=emptyPosition(9,9);
  for(let x=0;x<9;x++) {
    position.board[x]={type:HASAMI_PIECE,side:"gote",promoted:false};
    position.board[72+x]={type:HASAMI_PIECE,side:"sente",promoted:false};
  }
  position.settings=loadBoardSettings({selfCheck:false,nifu:false,pawnDropMate:false,useHands:false,promotionDepth:0,repetitionLimit:4,perpetualCheckLoses:false,showPieceCounts:true});
  return createSetup(position,0,"はさみ将棋",rules,HASAMI_BOARD_SCRIPT);
}
