import {importUI} from "./importui";
import { expect, test, spyOn } from "bun:test";
import { ShogiGame } from "../src/shogi";
import type { AIRequest } from "../src/ai";
import { chooseAIMove } from "../src/ai";
import { CHESS_PIECES } from "../src/presets";
import { ChessGame, createChessSetup } from "../src/chesscore";
import { legacyChessSetup } from "../src/chesslegacy";
import { EDITOR_DRAFT_KEY } from "../src/editordraft";
import { readLocalSetups, saveLocalSetup } from "../src/setups";
import {quietHistoryFixture} from "./historyfixture";
import {OTHELLO_STONE} from "../src/othellopreset";
import {createHasamiPreset,HASAMI_PIECE} from "../src/hasamipreset";

async function withUI(run:(ui:any)=>Promise<void>) {
  const url=new URL("../web/app.ts",import.meta.url);
  const source=new Bun.Transpiler({loader:"ts",target:"browser"}).transformSync(await Bun.file(url).text())
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,b,c)=>`${a}${new URL(b,url).href}${c}`)
    .replaceAll('import("../src/chesslegacy.js")',`import(${JSON.stringify(new URL('../src/chesslegacy.ts',url).href)})`)
    .replaceAll("import.meta.url",JSON.stringify(url.href));
  const original={document:globalThis.document,localStorage:globalThis.localStorage,confirm:globalThis.confirm,Worker:globalThis.Worker,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const urls={createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
  const values=new Map<string,string>(),elements=new Map<string,any>(),blobs=new Map<string,Blob>(),downloads:Blob[]=[];
  let listeners:Record<string,(e:any)=>any>={},timer=0,session=0;
  const timers=new Map<number,{callback:()=>void;delay:number}>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const element=(selector:string)=>{if(!elements.has(selector))elements.set(selector,{innerHTML:"",textContent:"",value:"",dataset:{},classList:{add(){},remove(){}},focus(){},click(){},scrollTop:0,scrollLeft:0});return elements.get(selector);};
  const workers:MockWorker[]=[];
  class MockWorker {request!:AIRequest;onmessage:((e:any)=>void)|null=null;onerror:any;constructor(){workers.push(this);}postMessage(request:AIRequest){this.request=structuredClone(request);}terminate(){} }
  Object.assign(URL,{createObjectURL:(blob:Blob)=>{const id=`blob:preset-${blobs.size}`;blobs.set(id,blob);return id;},revokeObjectURL:(id:string)=>{blobs.delete(id);}});
  Object.assign(globalThis,{document:{querySelector:element,addEventListener:(name:string,fn:any)=>{listeners[name]=fn;},createElement:()=>{const link={href:"",download:"",click(){downloads.push(blobs.get(link.href)!);}};return link;}},localStorage:storage,confirm:()=>true,Worker:MockWorker,setTimeout:(callback:()=>void,delay=0)=>{const id=++timer;timers.set(id,{callback,delay});return id;},clearTimeout:(id:number)=>{timers.delete(id);}});
  const click=(id="",dataset={})=>listeners.click({target:{closest:()=>({id,dataset,disabled:false})}});
  const input=(id:string,value:string)=>listeners.input({target:{id,value,dataset:{}}});
  const change=(id:string,value="",dataset={},checked?:boolean)=>listeners.change({target:{id,value,dataset,checked}});
  const reload=async()=>{elements.clear();listeners={};timers.clear();await importUI(`${source}\n// shared-preset-ui ${Date.now()} ${++session}`);};
  try {await run({values,storage,element,downloads,workers,click,input,change,reload,html:()=>element("#app").innerHTML as string,draft:()=>JSON.parse(values.get(EDITOR_DRAFT_KEY)!),tickAI:()=>{const entry=[...timers].find(([,t])=>t.delay===250);expect(entry).toBeDefined();timers.delete(entry![0]);entry![1].callback();},importFile:(text:string)=>listeners.change({target:{id:"file-input",files:[{text:async()=>text}],value:""}})});}
  finally {Object.assign(URL,urls);Object.assign(globalThis,original);}
}

test('Hasami uses shared piece/code editing, draft recovery, saves, test play, AI and capture rendering',async()=>withUI(async ui=>{
  const {click,input,change,reload,html,draft,values,storage,downloads,tickAI,workers}=ui;
  await reload();await click('title-special');await click('',{specialEdit:'hasami'});
  expect(html()).toContain('value="はさみ将棋"');expect(draft().snapshot.position.width).toBe(9);expect(draft().snapshot.rules[HASAMI_PIECE].definition.captures).toEqual([]);
  await click('editor-open-script');expect(html()).toContain('WIN_CAPTURE_COUNT = 5');
  const source=draft().snapshot.script.replace('const WIN_CAPTURE_COUNT = 5','const WIN_CAPTURE_COUNT = 2');input('rule-script-source',source);await click('script-editor-back');expect(draft().snapshot.script).toContain('WIN_CAPTURE_COUNT = 2');
  await reload();await click('editor-restore-draft');expect(draft().snapshot.script).toContain('WIN_CAPTURE_COUNT = 2');
  await click('editor-open-piece-settings');await click('',{rulePiece:HASAMI_PIECE});await click('',{pieceSection:'design'});expect(html()).toContain('value="歩"');expect(html()).toContain('value="と"');await click('piece-editor-back');
  await click('editor-save-local');const saved=readLocalSetups(storage).find(entry=>entry.setup.name==='はさみ将棋')!;expect(saved.setup.ruleScript).toBe(source);
  await click('editor-export-setup');const exported=JSON.parse(await downloads.at(-1).text());expect(exported.kind).toBe('shogi-setup');expect(exported.pieceRules[HASAMI_PIECE].definition.moves).toHaveLength(4);
  const before=values.get('shogi-game.v1');await click('editor-test-start');await click('',{square:'72'});await click('',{square:'63'});expect(values.get('shogi-game.v1')).toBe(before);await click('editor-test-back');await click('editor-apply');
  expect(html().match(/data-square=/g)).toHaveLength(81);expect(html()).not.toContain('data-player="sente"');expect(html()).toContain('id="pass" disabled');
  await click('',{square:'72'});await click('',{square:'63'});await change('ai-mode','sente');tickAI();const worker=workers.at(-1);expect(worker.request.options.ruleScript).toBe(source);
  const result=chooseAIMove(worker.request.position,{...worker.request.options,maxDepth:1,maxNodes:1,maxTimeMs:5});worker.onmessage({data:{id:worker.request.id,result}});expect(JSON.parse(values.get('shogi-game.v1')).game.moves).toHaveLength(2);
  await change('ai-mode','human');await click('to-title');await reload();await click('title-continue');expect(JSON.parse(values.get('shogi-game.v1')).game.moves).toHaveLength(2);
  const setup=createHasamiPreset();setup.position.board.fill(null);for(const i of [18,1,8])setup.position.board[i]={type:HASAMI_PIECE,side:'sente',promoted:false};for(const i of [0,80])setup.position.board[i]={type:HASAMI_PIECE,side:'gote',promoted:false};
  const game=new ShogiGame(setup.position,{pieceRules:setup.pieceRules,ruleScript:setup.ruleScript,passLimit:0});await ui.importFile(JSON.stringify(game.save()));await click('',{square:'18'});await click('',{square:'9'});
  const captured=ShogiGame.load(JSON.parse(values.get('shogi-game.v1')).game);expect(captured.position.board[0]).toBeNull();expect(captured.position.ruleState?.data.captured).toEqual({sente:1,gote:0});expect(html()).toContain('data-piece-count="gote"');
  await click('undo');expect(ShogiGame.load(JSON.parse(values.get('shogi-game.v1')).game).position.board[0]?.side).toBe('gote');
  await click('to-title');await click('title-special');await click('',{specialPlay:'hasami'});expect(html()).toContain('はさみ将棋');expect(ShogiGame.load(JSON.parse(values.get('shogi-game.v1')).game).position.board.filter(Boolean)).toHaveLength(18);
}),15000);

test('Othello uses direct placement, shared editing, local/JSON saves, undo, reload and the common AI',async()=>withUI(async ui=>{
  const {click,change,reload,html,draft,values,downloads,storage,tickAI,workers}=ui;
  await reload();await click('title-special');await click('',{specialPlay:'othello'});
  expect(html()).toContain('● 黒の手番');expect(html().match(/data-square=/g)).toHaveLength(64);expect(html().match(/piece-shape-circle/g)).toHaveLength(4);
  expect(html()).toContain('data-piece-count="sente"');expect(html()).not.toContain('data-player="sente"');expect(html()).toContain('id="pass" disabled');expect(html()).toContain('印のあるマスを押して配置');
  await click('',{square:'19'});let record=JSON.parse(values.get('shogi-game.v1')).game;expect(record.version).toBe(13);expect(record.moves).toHaveLength(1);expect(ShogiGame.load(record).position.ruleState?.data.score).toEqual({sente:4,gote:1});expect(html()).toContain('○ 白の手番');
  await click('undo');expect(JSON.parse(values.get('shogi-game.v1')).game.moves).toHaveLength(0);await click('',{square:'19'});
  await click('to-title');await reload();await click('title-continue');expect(html()).toContain('○ 白の手番');
  await change('ai-mode','sente');tickAI();const worker=workers.at(-1);expect(worker.request.options.pieceRules[OTHELLO_STONE]).toBeDefined();expect(worker.request.options.ruleScript).toContain('changeSide');
  const result=chooseAIMove(worker.request.position,{...worker.request.options,maxDepth:1,maxNodes:1,maxTimeMs:5});worker.onmessage({data:{id:worker.request.id,result}});expect(JSON.parse(values.get('shogi-game.v1')).game.moves).toHaveLength(2);
  await change('ai-mode','human');await click('edit-board');expect(html()).toContain('盤外からの配置');expect(html()).toContain(`data-placement-type="${OTHELLO_STONE}" checked`);
  await change('','<',{ruleSide:'sente',playerRule:'mark'});expect(draft().snapshot.position.settings.playerRules.sente.mark).toBe('<');expect(html()).toContain('value="&lt;"');
  await click('editor-undo');expect(draft().snapshot.position.settings.playerRules.sente.mark).toBe('●');
  await change('','',{placementType:OTHELLO_STONE},false);expect(draft().snapshot.position.settings.placementTypes).toEqual([]);await click('editor-undo');
  await click('editor-open-piece-settings');await click('',{rulePiece:OTHELLO_STONE});await click('',{pieceSection:'design'});expect(html()).toContain('黒のデザイン');expect(html()).toContain('白のデザイン');await click('piece-editor-back');
  ui.input('editor-setup-name','オセロ');await click('editor-save-local');const saved=readLocalSetups(storage).find(entry=>entry.setup.name==='オセロ');expect(saved?.setup.version).toBe(11);
  await click('editor-export-setup');const exported=JSON.parse(await downloads.at(-1).text());expect(exported.kind).toBe('shogi-setup');expect(exported.position.settings.placementTypes).toEqual([OTHELLO_STONE]);expect(exported.ruleScript).toContain('changeSide');
  await click('editor-test-start');expect(html()).toContain('印のあるマスを押して配置');await click('editor-test-back');await click('editor-apply');expect(JSON.parse(values.get('shogi-game.v1')).game.version).toBe(13);
}),15000);

test("Special chess uses the existing piece/code editor, shared saves, test sessions and AI worker",async()=>withUI(async ui=>{
  const {values,storage,element,downloads,workers,click,input,change,reload,html,draft,tickAI}=ui;
  const original=new ShogiGame(undefined,{passLimit:0});original.play({from:56,to:47,promote:false});
  values.set("shogi-game.v1",JSON.stringify({game:original.save(),gameKind:"standard",aiMode:"human"}));const before=values.get("shogi-game.v1");
  await reload();await click("title-special");await click("",{specialEdit:"chess"});
  expect(html()).toContain('id="editor-width"');expect(html()).toContain('id="editor-no-moves"');expect(html()).toContain('value="チェス"');expect(draft().meta.returnTo).toBe("special");
  await change("editor-repetition-limit","3");expect(draft().snapshot.position.settings.repetitionLimit).toBe(3);await change("editor-repetition-limit","off");
  await change("editor-no-moves","loss");expect(draft().snapshot.position.settings.noMoves).toBe("loss");await change("editor-no-moves","draw");
  await click("editor-open-piece-settings");await click("",{rulePiece:CHESS_PIECES.p});expect(html()).toContain('data-rule-offset="0,2" aria-pressed="true"');
  input("piece-initial-data",'{"moved":false,"doubleStep":false}');await click("piece-initial-data-apply");
  await change("piece-value","150");input("piece-ai-table","[[1,2],[3,4]]");await click("piece-ai-table-apply");expect(draft().pieceDraft.rules[CHESS_PIECES.p].aiTable).toEqual([[1,2],[3,4]]);
  input("piece-ai-table","[");await reload();await click("editor-restore-draft");expect(html()).toContain('aria-label="AIの配置評価">[</textarea>');await click("piece-ai-table-apply");expect(element("#toast").textContent).toBeTruthy();
  input("piece-ai-table","[[1,2],[3,4]]");await click("piece-ai-table-apply");
  await click("",{pieceSection:"design"});await change("","",{designSide:"gote",designField:"upright"},false);expect(draft().pieceDraft.rules[CHESS_PIECES.p].design.normal.gote.upright).toBeUndefined();await change("","",{designSide:"gote",designField:"upright"},true);
  await click("piece-editor-open-script");expect(html()).toContain("ctx.capturePiece");
  const code=draft().pieceDraft.rules[CHESS_PIECES.p].script.replace('afterMove(ctx) {','afterMove(ctx) { ctx.log("編集したポーン");');input("rule-script-source",code);await click("script-editor-back");
  await click("piece-editor-add");const added=draft().pieceDraft.piece;input("piece-name","追加駒");await click("",{pieceSection:"movement"});await click("",{ruleOffset:"0,1"});expect(draft().pieceDraft.rules[added].normal.moves).toContainEqual({dx:0,dy:1,range:1});
  await click("piece-editor-back");await click("editor-save-local");const saved=readLocalSetups(storage).find(entry=>entry.setup.name==="チェス")!;expect(saved.setup.kind).toBe("shogi-setup");expect(saved.setup.pieceRules?.[added]).toBeDefined();
  await click("editor-export-setup");const exported=JSON.parse(await downloads.at(-1).text());expect(exported.kind).toBe("shogi-setup");expect(exported.ruleScript).toContain("checkResult");
  await click("editor-test-start");await click("",{square:"52"});await click("",{square:"36"});expect(element(".record-column").innerHTML).not.toContain("編集したポーン");
  await click("",{square:"52"});await click("",{square:"44"});expect(element(".record-column").innerHTML).toContain("編集したポーン");expect(values.get("shogi-game.v1")).toBe(before);
  await click("editor-test-back");await click("editor-apply");expect(JSON.parse(values.get("shogi-game.v1")).game.version).toBe(11);
  await click("",{square:"52"});await click("",{square:"44"});await change("ai-mode","sente");tickAI();const worker=workers.at(-1);expect(worker.request.options.pieceRules[CHESS_PIECES.p].initialData.doubleStep).toBe(false);
  const result=chooseAIMove(worker.request.position,{...worker.request.options,maxDepth:1,maxNodes:1,maxTimeMs:5});worker.onmessage({data:{id:worker.request.id,result}});expect(ShogiGame.load(JSON.parse(values.get("shogi-game.v1")).game).moveCount).toBe(2);
  await click("to-title");await click("title-workshop");await click("workshop-edit");await click("",{workshopCopy:saved.id});expect(html()).toContain('value="チェスのコピー"');expect(draft().snapshot.rules[added]).toBeDefined();
}),15000);

test("Special mixed play keeps faction rules, hand visibility, editor recovery and shared saves",async()=>withUI(async ui=>{
  const {click,change,reload,html,draft,values,storage}=ui;
  await reload();await click("title-special");expect(html()).toContain('data-special-play="shogi-chess"');
  await click("",{specialPlay:"shogi-chess"});expect(html()).toContain("将棋の手番");
  expect((html().match(/data-square=/g)??[])).toHaveLength(81);expect(html().match(/class="piece-icon"/g)).toHaveLength(16);
  expect(html()).toContain('data-player="sente"');expect(html()).not.toContain('data-player="gote"');
  await click("",{square:"54"});await click("",{square:"45"});expect(html()).toContain("チェスの手番");
  await click("",{square:"9"});await click("",{square:"27"});expect(JSON.parse(values.get("shogi-game.v1")).game.moves).toHaveLength(2);
  await click("edit-board");expect(html()).toContain('data-player-rule="useHands"');expect(html()).toContain('value="チェス"');
  await change("","true",{ruleSide:"gote",playerRule:"useHands"});expect(draft().snapshot.position.settings.playerRules.gote.useHands).toBe(true);
  await click("editor-undo");expect(draft().snapshot.position.settings.playerRules.gote.useHands).toBe(false);
  await change("","将棋軍",{ruleSide:"sente",playerRule:"name"});expect(draft().snapshot.position.settings.playerRules.sente.name).toBe("将棋軍");
  await reload();await click("editor-restore-draft");expect(html()).toContain("将棋軍");
  await click("editor-save-local");expect(readLocalSetups(storage)[0]?.setup.version).toBe(10);
  await click("editor-apply");const saved=JSON.parse(values.get("shogi-game.v1")).game;
  expect(saved.version).toBe(12);expect(ShogiGame.load(saved).position.settings?.playerRules?.sente?.name).toBe("将棋軍");expect(html()).not.toContain('data-player="gote"');
  await click("edit-board");await change("","<b>&将棋",{ruleSide:"sente",playerRule:"name"});await click("editor-apply");
  expect(html()).toContain("&lt;b&gt;&amp;将棋");expect(html()).not.toContain("<b>&将棋");
}),15000);

test("shared draw-claim controls and legacy imports keep chess in the common game format",async()=>withUI(async ui=>{
  const {values,storage,click,reload,html,importFile}=ui;
  const setup=legacyChessSetup(createChessSetup('7k/8/8/8/8/8/R7/K7 w - - 99 1'));
  const saved=saveLocalSetup(storage,setup);await reload();await click("title-workshop");await click("",{workshopPlay:saved.id});
  await click("claim-draw");expect(html()).toContain("申請する予定の手を選ぶ");expect(html()).toContain('data-draw-claim="0"');await click("",{drawClaim:"0"});
  let game=ShogiGame.load(JSON.parse(values.get("shogi-game.v1")).game);expect(game.result?.reason).toBe("claim");expect(game.moveCount).toBe(0);
  await click("result-close");await click("undo");expect(ShogiGame.load(JSON.parse(values.get("shogi-game.v1")).game).result).toBeNull();
  const old=new ChessGame();old.play({from:"e2",to:"e4"});await importFile(JSON.stringify(old.save()));game=ShogiGame.load(JSON.parse(values.get("shogi-game.v1")).game);expect(game.moveCount).toBe(1);expect(game.position.board[36]?.type).toBe(CHESS_PIECES.p);
  await click("to-title");values.set("special-chess.v1",JSON.stringify({version:1,game:old.save()}));await click("title-special");expect(html()).toContain('id="special-import-legacy"');await click("special-import-legacy");
  for(let i=0;i<30&&!html().includes('data-square="0"');i++)await Bun.sleep(10);
  expect(html()).toContain('data-square="0"');expect(values.get("special-chess.v1")).toBeTruthy();expect(JSON.parse(values.get("shogi-game.v1")).game.version).toBe(11);
}),15000);

test("an old long mixed autosave resumes with bounded history and accepts the next AI move",async()=>withUI(async ui=>{
  const fixture=quietHistoryFixture(),legacy=(await Bun.file(new URL('./fixtures/chess-history-v1.txt',import.meta.url)).text()).replace('const MIXED=false','const MIXED=true');
  const record={version:12,initialPosition:fixture.position,passLimit:0,pieceRules:fixture.setup.pieceRules,ruleScript:legacy,moves:Array.from({length:83},(_,ply)=>fixture.move(ply%2?'gote':'sente'))};
  ui.values.set('shogi-game.v1',JSON.stringify({game:record,gameKind:'custom',gameName:'将棋VSチェス',aiMode:'human'}));
  const replay=spyOn(ShogiGame,"load");
  try {await ui.reload();expect(replay).not.toHaveBeenCalled();expect(ui.html()).toContain('83手');await ui.click('title-continue');expect(replay).toHaveBeenCalledTimes(1);}finally{replay.mockRestore();}
  expect(ui.html()).toContain('84 手目');
  await ui.click('ai-step');const worker=ui.workers.at(-1),options=worker.request.options;
  expect(options.ruleScript).toContain('history:null');expect(JSON.stringify(worker.request.position.ruleState.data).length).toBeLessThan(10000);
  const result=chooseAIMove(worker.request.position,{...options,maxDepth:1,maxNodes:1,maxTimeMs:5});
  worker.onmessage({data:{id:worker.request.id,result}});
  const saved=JSON.parse(ui.values.get('shogi-game.v1')).game;
  expect(saved.moves).toHaveLength(84);expect(saved.moves.slice(0,83)).toEqual(record.moves);expect(saved.ruleScript).toContain('history:null');
  expect(ui.element('#toast').textContent).not.toContain('壊れています');
}),15000);

test("requesting the current board from a fresh editor restores a pending saved game only at that point",async()=>withUI(async ui=>{
  const match=new ShogiGame(undefined,{passLimit:0});match.play({from:54,to:45,promote:false});
  ui.values.set('shogi-game.v1',JSON.stringify({game:match.save(),gameKind:'standard',aiMode:'human'}));
  const replay=spyOn(ShogiGame,'load');
  try {
    await ui.reload();await ui.click('title-workshop');await ui.click('workshop-new');expect(replay).not.toHaveBeenCalled();
    await ui.click('editor-current');expect(replay).toHaveBeenCalledTimes(1);expect(ui.draft().snapshot.position).toEqual(match.position);
    await ui.click('editor-cancel');await ui.click('to-title');await ui.click('title-continue');expect(replay).toHaveBeenCalledTimes(1);expect(ui.html()).toContain('2 手目');
  }finally{replay.mockRestore();}
}));

test("chess coordinates, side labels and editable appearance use the common game and editor screens",async()=>withUI(async ui=>{
  const {click,change,reload,html,draft,values}=ui;
  await reload();await click("title-special");await click("",{specialPlay:"chess"});
  expect(html()).toContain("○ 白の手番");expect(html()).toContain("自分：白 / AI：黒");
  expect(html()).toContain('<div class="file-labels"><span>a</span><span>b</span>');
  expect(html()).toContain('<div class="rank-labels"><span>8</span><span>7</span>');
  expect(html().match(/class="piece-icon"/g)).toHaveLength(32);expect(html()).not.toContain('id="pass"');
  await click("",{square:"52"});await click("",{square:"36"});expect(html()).toContain("e2 → e4");expect(html()).toContain("● 黒の手番");
  await click("flip");expect(html()).toContain('<div class="file-labels"><span>h</span><span>g</span>');
  expect(html()).toContain('aria-label="e4 白 ポーン');
  await click("edit-board");expect(html()).toContain('id="editor-chess-appearance"');
  await change("editor-board-theme","shogi");expect(draft().snapshot.position.boardTheme).toBeUndefined();
  const before=draft().snapshot;await click("editor-chess-appearance");expect(draft().snapshot.position.boardTheme).toBe("chess");
  expect(draft().snapshot.position.board).toEqual(before.position.board);expect(draft().snapshot.script).toBe(before.script);
  await click("editor-undo");expect(draft().snapshot).toEqual(before);await click("editor-redo");
  await click("editor-open-piece-settings");await click("",{rulePiece:CHESS_PIECES.n});await click("",{pieceSection:"design"});
  expect(html()).toContain("白のデザイン");expect(html()).toContain("黒のデザイン");
  await change("","queen",{designSide:"sente",designField:"icon"});await click("piece-editor-back");await click("editor-apply");
  const saved=JSON.parse(values.get("shogi-game.v1")).game;
  expect(saved.pieceRules[CHESS_PIECES.n].design.normal.sente.icon).toBe("queen");expect(saved.pieceRules[CHESS_PIECES.n].design.normal.gote.icon).toBe("knight");
}),15000);
