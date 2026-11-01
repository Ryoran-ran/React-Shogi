import {createChessPreset,createShogiChessPreset,CHESS_PIECES} from "../src/presets";
import type {Move,Side} from "../src/shogi";

/** Disjoint king circuits have different periods, yielding long legal runs without accidental repetitions. */
export function quietHistoryFixture(mixed=true,size=mixed?9:8){
  const setup=mixed?createShogiChessPreset():createChessPreset(),position=structuredClone(setup.position);
  position.width=size;position.height=size;position.board=Array(size*size).fill(null);delete position.squareColors;
  position.board[size*size-1]={type:mixed?"K":CHESS_PIECES.k,side:"sente",promoted:false};
  position.board[0]={type:CHESS_PIECES.k,side:"gote",promoted:false};
  if(!mixed)position.board[3*size+size-1]={type:CHESS_PIECES.r,side:"sente",promoted:false};
  const bottom=size-1,top=size-3,right=size-2;
  const paths={
    sente:[...Array.from({length:size},(_,x)=>bottom*size+bottom-x),(bottom-1)*size,top*size,...Array.from({length:size-1},(_,x)=>top*size+x+1),(bottom-1)*size+bottom],
    gote:[...Array.from({length:size-1},(_,x)=>x),size+right,2*size+right,...Array.from({length:size-2},(_,x)=>2*size+right-1-x),size],
  };
  const indices={sente:0,gote:0};
  const move=(side:Side):Move=>{const path=paths[side],from=path[indices[side]%path.length],to=path[++indices[side]%path.length];return {from,to,promote:false};};
  return {setup,position,move};
}
