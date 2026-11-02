// Keep the public repetition key exact. Store only changed cells/fields between positions.
// Field markers cannot occur in the key's ASCII metadata or its encoded piece/cell values.
const HISTORY_HELPERS=`function repetitions(state,key) {
  if(state.halfmove===0||!state.history) state.history={first:key,last:key,steps:[]};
  else {
    const before=state.history.last.split("|"),after=key.split("|");let step="";
    for(let field=0;field<after.length;field++) {
      if(before[field]===after[field]) continue;
      let change=after[field];
      if(field===1||field===5) {
        change="";
        for(let index=0;index<after[field].length;index++) if(before[field][index]!==after[field][index]) change+=String.fromCharCode(256+index)+after[field][index];
      }
      step+=String.fromCharCode(2048+field)+change;
    }
    state.history.steps.push(step);state.history.last=key;
  }
  const fields=state.history.first.split("|"),counts=Object.create(null);
  counts[state.history.first]=1;
  for(const step of state.history.steps) {
    for(let at=0;at<step.length;) {
      const field=step.charCodeAt(at++)-2048;let end=at;
      while(end<step.length&&step.charCodeAt(end)<2048) end++;
      const change=step.slice(at,end);
      if(field===1||field===5) {
        const cells=fields[field].split("");
        for(let index=0;index<change.length;index+=2) cells[change.charCodeAt(index)-256]=change[index+1];
        fields[field]=cells.join("");
      } else fields[field]=change;
      at=end;
    }
    const previous=fields.join("|");counts[previous]=(counts[previous]??0)+1;
  }
  return {count:counts[key],repeated:Object.values(counts).some(count=>count>=2)};
}
`;

function buildChessBoardScript(mixed=false,compact=true):string{return `// この作例の勝敗・引き分け条件です。数値や処理を編集できます。
const MIXED=${mixed}, CLAIM_DRAWS=true, AUTO_REPETITION=5, AUTO_QUIET_MOVES=150;
const PAWN="custom_pawn",KING="custom_king",ROOK="custom_rook";
function effectiveEP(ctx) {
  const ep=ctx.state.chess.ep,w=ctx.board.width;
  if(!ep||ep.side===ctx.turn||ctx.board.at(ep.target)||ctx.board.at(ep.pawn)?.type!==PAWN) return "-";
  for(const entry of ctx.board.pieces(ctx.turn)) {
    if(entry.piece.type!==PAWN||entry.piece.data?.enPassant===false||Math.abs(entry.square%w-ep.target%w)!==1||ctx.board.forward(entry.square,ctx.turn)!==ep.target+(entry.square%w-ep.target%w)) continue;
    const board=ctx.board.snapshot();board[entry.square]=null;board[ep.pawn]=null;board[ep.target]=entry.piece;
    const king=board.findIndex(piece=>piece?.side===ctx.turn&&ctx.royalTypes.includes(piece.type));
    if(king>=0&&!ctx.board.isAttacked(king,ctx.turn==="sente"?"gote":"sente",board)) return String(ep.target);
  }
  return "-";
}
function positionKey(ctx) {
  const w=ctx.board.width,board=ctx.board.snapshot();let rights="";
  for(const side of ["sente","gote"]) {
    const row=side==="sente"?ctx.board.height-1:0,king=board[row*w+4];
    if(king?.type!==KING||king.side!==side||king.data?.moved||king.data?.castling===false) continue;
    for(const file of [king.data?.castleRookLeft??0,king.data?.castleRookRight??w-1]) { const rook=board[row*w+file];if(rook?.type===ROOK&&rook.side===side&&!rook.data?.moved) rights+=side[0]+file; }
  }
  const pieces=board.map(piece=>piece?String.fromCharCode(256+ctx.pieceTypes.indexOf(piece.type)*4+(piece.side==="gote"?2:0)+(piece.promoted?1:0)):".").join("");
  const hands=MIXED?ctx.pieceTypes.map(type=>(ctx.hands.sente[type]??0)+","+(ctx.hands.gote[type]??0)).join(";"):"";
  const pawns=MIXED?board.map(piece=>piece?.type===PAWN&&piece.data?.moved?"1":"0").join(""):"";
  return ctx.turn+"|"+pieces+"|"+rights+"|"+effectiveEP(ctx)+"|"+hands+"|"+pawns;
}
${compact?HISTORY_HELPERS:""}export default {
  onStart(ctx) {
    const old=ctx.state.chess;
    ctx.state.chess={halfmove:old?.halfmove??0,ep:old?.ep??null,${compact?"history:null":"positions:{}"},captured:false};
  },
  beforeMove(ctx) { ctx.state.chess.captured=false; },
  afterCapture(ctx) { ctx.state.chess.captured=true; },
  afterMove(ctx) {
    if(ctx.event.automatic) return;
    const state=ctx.state.chess,{from,to}=ctx.event,w=ctx.board.width;
    state.halfmove=ctx.event.drop||ctx.actor.type===PAWN||MIXED&&ctx.actor.type==="P"&&!ctx.actor.promoted||state.captured?0:state.halfmove+1;
    state.ep=ctx.actor.type===PAWN&&Math.abs(to-from)===2*w?{target:(from+to)/2,pawn:to,side:ctx.side}:null;
  },
  checkResult(ctx) {
    const state=ctx.state.chess,key=positionKey(ctx);ctx.setRepetitionKey(key);
    ${compact?"const repetition=repetitions(state,key);":"if(state.halfmove===0) state.positions={};\n    state.positions[key]=(state.positions[key]??0)+1;"}
    if(CLAIM_DRAWS&&(!MIXED||ctx.board.pieces(ctx.turn).some(entry=>entry.piece.type===KING))) {
      if(${compact?"repetition.count":"state.positions[key]"}>=3||state.halfmove>=100) ctx.allowDrawClaim(${compact?"repetition.count":"state.positions[key]"}>=3?"同一局面3回":"50手ルール");
      if(state.halfmove>=99||${compact?"repetition.repeated":"Object.values(state.positions).some(count=>count>=2)"}) ctx.checkDrawClaimAfterMove();
    }
    const others=ctx.board.pieces().filter(entry=>entry.piece.type!==KING);
    const minor=type=>type==="custom_bishop"||type==="custom_knight";
    const bishops=others.length>0&&others.every(entry=>entry.piece.type==="custom_bishop")&&new Set(others.map(entry=>(entry.square%ctx.board.width+Math.floor(entry.square/ctx.board.width))%2)).size===1;
    if(!MIXED&&(!others.length||others.length===1&&minor(others[0].piece.type)||bishops)||AUTO_REPETITION&&${compact?"repetition.count":"state.positions[key]"}>=AUTO_REPETITION||AUTO_QUIET_MOVES&&state.halfmove>=AUTO_QUIET_MOVES) ctx.draw({unlessMate:true});
  }
};`;}

export function createChessBoardScript(mixed=false):string{return buildChessBoardScript(mixed,true);}
const upgrades=new Map([false,true].map(mixed=>[buildChessBoardScript(mixed,false),createChessBoardScript(mixed)]));
/** Only the exact shipped scripts are upgraded; user-edited code is preserved. */
export function upgradeChessBoardScript(source:string):string{return upgrades.get(source)??source;}
