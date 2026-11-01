import {emptyPosition} from "./shogi";
import {loadBoardSettings} from "./boardsettings";
import {loadPieceRules} from "./pieces";
import {createSetup} from "./setups";

export const OTHELLO_STONE="custom_stone";
export const OTHELLO_BOARD_SCRIPT=`// 方向、反転条件、パス、終局条件を自由に編集できます。
const STONE="custom_stone";
const DIRECTIONS=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function flips(ctx,to,side) {
  const w=ctx.board.width,h=ctx.board.height,x=to%w,y=Math.floor(to/w),result=[];
  for(const [dx,dy] of DIRECTIONS) {
    let nx=x+dx,ny=y+dy;const line=[];
    while(nx>=0&&nx<w&&ny>=0&&ny<h) {
      const square=ny*w+nx,piece=ctx.board.at(square);
      if(!piece) break;
      if(piece.side===side){if(line.length)result.push(...line);break;}
      line.push(square);nx+=dx;ny+=dy;
    }
  }
  return result;
}
function canPlace(ctx,side) {
  for(let to=0;to<ctx.board.width*ctx.board.height;to++)if(!ctx.board.at(to)&&flips(ctx,to,side).length)return true;
  return false;
}
export default {
  validateMove(ctx) {
    if(ctx.event.pass)return !canPlace(ctx,ctx.side);
    return ctx.event.drop===STONE&&!ctx.board.at(ctx.event.to)&&flips(ctx,ctx.event.to,ctx.side).length>0;
  },
  afterMove(ctx) {
    for(const square of flips(ctx,ctx.event.to,ctx.side))ctx.changeSide(square,ctx.side);
  },
  checkResult(ctx) {
    const pieces=ctx.board.pieces(),black=pieces.filter(entry=>entry.piece.side==="sente").length,white=pieces.length-black;
    ctx.state.score={sente:black,gote:white};
    const board=ctx.board.snapshot();ctx.setRepetitionKey(ctx.turn+"|"+board.map(piece=>piece?(piece.side==="sente"?"b":"w"):".").join(""));
    if(!canPlace(ctx,"sente")&&!canPlace(ctx,"gote")){
      if(black===white)ctx.draw();else ctx.win(black>white?"sente":"gote");
    }
  }
};`;

/** Ordinary editor data: one custom piece, unlimited placement, and editable board code. */
export function createOthelloPreset(){
  const rules=loadPieceRules({K:{royal:false},[OTHELLO_STONE]:{
    definition:{name:"石",label:"石",description:"相手の石をはさめる空きマスに置きます。はさんだ石は自分の色に変わります。",value:100,moves:[],captures:[]},
    design:{normal:{sente:{text:"",fill:"#202922",color:"#202922",shape:"circle",upright:true},gote:{text:"",fill:"#fffdf2",color:"#fffdf2",shape:"circle",upright:true}}},
    aiTable:[ [120,-30,20,10,10,20,-30,120],[-30,-55,-5,-5,-5,-5,-55,-30],[20,-5,8,3,3,8,-5,20],[10,-5,3,0,0,3,-5,10],[10,-5,3,0,0,3,-5,10],[20,-5,8,3,3,8,-5,20],[-30,-55,-5,-5,-5,-5,-55,-30],[120,-30,20,10,10,20,-30,120] ],
  }});
  const position=emptyPosition(8,8);position.boardTheme="chess";position.squareColors=Array(64).fill("#387b55");
  for(const [square,side]of [[27,"gote"],[28,"sente"],[35,"sente"],[36,"gote"]] as const)position.board[square]={type:OTHELLO_STONE,side,promoted:false};
  position.settings=loadBoardSettings({selfCheck:false,nifu:false,pawnDropMate:false,useHands:false,promotionDepth:0,repetitionLimit:null,perpetualCheckLoses:false,placementTypes:[OTHELLO_STONE],showPieceCounts:true,playerRules:{sente:{name:"黒",mark:"●"},gote:{name:"白",mark:"○"}}});
  return createSetup(position,null,"オセロ",rules,OTHELLO_BOARD_SCRIPT);
}
