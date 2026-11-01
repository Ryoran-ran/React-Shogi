import {expect,test} from "bun:test";
import {chooseAIMove} from "../src/ai";
import {ShogiGame,emptyPosition,isPassMove,legalMoves} from "../src/shogi";
import type {PieceType,Position} from "../src/shogi";

// Closed 40-piece position reconstructed from the reported screenshot.
function closedPosition():Position {
  const p=emptyPosition();
  const rows=[
    ". n . . . . . k l", ". . . s r g . . .", "l . b g p p s . n",
    "p p . p p . p . .", ". . P . . P . p p", "P P S P P B P . .",
    "L . N R G G N P P", ". . . . . . . S L", ". . . . . . K . .",
  ];
  rows.flatMap(row=>row.split(" ")).forEach((token,i)=>{if(token!==".")p.board[i]={type:token.toUpperCase() as PieceType,side:token===token.toUpperCase()?"sente":"gote",promoted:false};});
  return p;
}
const options={maxDepth:1,maxNodes:2000,maxTimeMs:5000};

test("the closed position opens the rook's lines instead of shuffling the king",()=>{
  const position=closedPosition(),before=structuredClone(position);
  const result=chooseAIMove(position,{...options,maxDepth:2});expect(result.move).not.toBeNull();
  if(!result.move||isPassMove(result.move))throw new Error("Expected a board move");
  expect(result.move.from).toBe(57);expect([66,75]).toContain(result.move.to);expect(position).toEqual(before);
});

test("self-play in the reported closed structure makes captures without repeated king shuffling",()=>{
  const game=new ShogiGame(closedPosition(),{passLimit:0});let seed=41,captures=0,kingMoves=0;
  for(let ply=0;ply<20&&!game.result;ply++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const p=game.position,result=chooseAIMove(p,{...options,randomSeed:seed,ply:166+ply,previousPositions:game.positionHistory,recentMoves:game.records.slice(-12).map(record=>record.move),passesRemaining:game.passesRemaining});
    if(!result.move||isPassMove(result.move))throw new Error("Expected a board move");
    expect(legalMoves(p)).toContainEqual(result.move);expect(result.nodes).toBeLessThanOrEqual(options.maxNodes);
    if(p.board[result.move.to])captures++;if(p.board[result.move.from!]?.type==="K")kingMoves++;game.play(result.move);
  }
  expect(captures).toBeGreaterThan(0);expect(kingMoves).toBeLessThan(8);
  expect(ShogiGame.load(game.save()).position).toEqual(game.position);
},15000);

test("a quiet reversal is discouraged even when the opponent changed the position",()=>{
  const p=emptyPosition();p.board[80]={type:"K",side:"sente",promoted:false};p.board[0]={type:"K",side:"gote",promoted:false};
  const history=[{from:79,to:80,promote:false},{from:1,to:0,promote:false}];
  const before=chooseAIMove(p,options),withHistory=chooseAIMove(p,{...options,recentMoves:history});
  if(!withHistory.move||isPassMove(withHistory.move))throw new Error("Expected a board move");
  expect(before.move).toEqual({from:80,to:79,promote:false});expect(withHistory.move).not.toEqual(before.move);expect(legalMoves(p)).toContainEqual(withHistory.move!);
});

test("reversal avoidance never penalizes a capture or a forced check evasion",()=>{
  const p=emptyPosition();p.board[80]={type:"K",side:"sente",promoted:false};p.board[0]={type:"K",side:"gote",promoted:false};
  p.board[40]={type:"G",side:"sente",promoted:false};p.board[31]={type:"R",side:"gote",promoted:false};
  const capture=chooseAIMove(p,options),withHistory=chooseAIMove(p,{...options,recentMoves:[{from:31,to:40,promote:false},{from:32,to:31,promote:false}]});
  expect(capture.move).toEqual({from:40,to:31,promote:false});expect(withHistory).toEqual(capture);
  p.board[40]=null;p.board[31]=null;p.board[8]={type:"R",side:"gote",promoted:false};p.board[60]={type:"B",side:"gote",promoted:false};
  expect(legalMoves(p)).toEqual([{from:80,to:79,promote:false}]);
  expect(chooseAIMove(p,{...options,recentMoves:[{from:79,to:80,promote:false},{from:7,to:8,promote:false}]})).toEqual(chooseAIMove(p,options));
});
