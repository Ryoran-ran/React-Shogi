import { expect, test } from "bun:test";
import { BoardEditor } from "../src/editor";
import { PieceEditor } from "../src/pieceeditor";
import { ScriptEditor } from "../src/scripteditor";
import { ShogiGame, emptyPosition, legalMoves, setupIssues, inCheck, positionKey } from "../src/shogi";
import { loadBoardSettings, configuredBoardSettings } from "../src/boardsettings";
import { updatePieceProperties, updatePieceScript, withInitialData, isRoyal } from "../src/pieces";
import { runRuleScript, RuleScriptError } from "../src/rulescript";
import { createSetup, loadSetup } from "../src/setups";
import { EDITOR_DRAFT_KEY, readEditorDraft, saveEditorDraft } from "../src/editordraft";
import { renderTestLog } from "../src/editorpanels";
import { chooseAIMove } from "../src/ai";

function kings() { const p=emptyPosition(); p.board[80]={type:"K",side:"sente",promoted:false}; p.board[0]={type:"K",side:"gote",promoted:false}; return p; }

test("basic settings control hands, double pawns, promotion and king safety and survive files and AI", () => {
  const p=kings(); p.board[40]={type:"P",side:"sente",promoted:false}; p.board[31]={type:"G",side:"gote",promoted:false}; p.hands.sente.P=1;
  const editor=new BoardEditor(p); expect(legalMoves(p).some(m=>m.drop==='P' && m.to===49)).toBe(false);
  editor.setSettings({nifu:false}); expect(legalMoves(editor.position).some(m=>m.drop==='P' && m.to===49)).toBe(true);
  editor.setSettings({useHands:false}); expect(legalMoves(editor.position).some(m=>m.drop)).toBe(false);
  const game=new ShogiGame(editor.position); game.play({from:40,to:31,promote:false}); expect(game.position.hands.sente.G).toBe(0);
  expect(game.save().version).toBe(8); expect(ShogiGame.load(game.save()).position).toEqual(game.position);
  const setup=createSetup(editor.position,0,'設定'); expect(setup.version).toBe(6); expect(loadSetup(setup)).toEqual(setup); expect(()=>loadSetup({...setup,version:5})).toThrow();
  const promotion=kings(); promotion.board[13]={type:'P',side:'sente',promoted:false}; const noPromotion=new BoardEditor(promotion); noPromotion.setSettings({promotionDepth:0});
  expect(legalMoves(noPromotion.position).find(m=>m.from===13 && m.to===4)?.promote).toBe(false);
  const checked=kings(); checked.board[8]={type:'R',side:'gote',promoted:false}; expect(inCheck(checked)).toBe(true);
  const unchecked=new BoardEditor(checked); unchecked.setSettings({selfCheck:false}); expect(inCheck(unchecked.position)).toBe(false); expect(new ShogiGame(unchecked.position).canPass).toBe(true);
  expect(chooseAIMove(editor.position,{maxDepth:1,maxNodes:300,maxTimeMs:5000}).move).toBeDefined();
  expect(configuredBoardSettings({})).toBeUndefined(); expect(()=>loadBoardSettings({promotionDepth:-1})).toThrow(); expect(()=>loadBoardSettings({selfCheck:'yes'})).toThrow();
  const mate=kings(); mate.board[0]=null;mate.board[4]={type:'K',side:'gote',promoted:false};mate.board[22]={type:'G',side:'sente',promoted:false};mate.board[21]={type:'R',side:'sente',promoted:false};mate.board[23]={type:'R',side:'sente',promoted:false};mate.hands.sente.P=1;
  expect(legalMoves(mate).some(m=>m.drop==='P' && m.to===13)).toBe(false);mate.settings=loadBoardSettings({pawnDropMate:false});expect(legalMoves(mate).some(m=>m.drop==='P' && m.to===13)).toBe(true);
  const noHands=new ShogiGame(editor.position,{ruleScript:'export default { afterCapture(ctx) { ctx.discardCapture(); } };'});noHands.play({from:40,to:31,promote:false});expect(noHands.position.hands.sente.G).toBe(0);
});

test("royal roles and initial data work for existing pieces, drops, scripted creation, capture and replay", () => {
  let rules=updatePieceProperties({},'K',{royal:false}); rules=updatePieceProperties(rules,'G',{royal:true}); rules=updatePieceProperties(rules,'P',{initialData:{hp:3,uses:2}});
  const p=emptyPosition(); p.board[80]={type:'G',side:'sente',promoted:false}; p.board[0]={type:'G',side:'gote',promoted:false}; p.board[40]={type:'P',side:'sente',promoted:false,data:{hp:9}}; p.hands.sente.P=1;
  expect(setupIssues(p,rules)).toEqual([]); expect(isRoyal('G',rules)).toBe(true); expect(isRoyal('K',rules)).toBe(false);
  const game=new ShogiGame(p,{pieceRules:rules}); expect(game.position.board[40]?.data).toEqual({hp:9,uses:2});
  game.play({drop:'P',to:50,promote:false}); expect(game.position.board[50]?.data).toEqual({hp:3,uses:2}); expect(ShogiGame.load(game.save()).position).toEqual(game.position);
  const source='export default { onStart(ctx) { ctx.spawn(45,"P","sente"); } };'; const spawn=new ShogiGame(p,{pieceRules:rules,ruleScript:source}); expect(spawn.position.board[45]?.data).toEqual({hp:3,uses:2});
  const capture=emptyPosition(); capture.board[80]={type:'G',side:'sente',promoted:false}; capture.board[31]={type:'G',side:'gote',promoted:false}; capture.board[40]={type:'R',side:'sente',promoted:false}; capture.settings=loadBoardSettings({selfCheck:false});
  const won=new ShogiGame(capture,{pieceRules:rules}); won.play({from:40,to:31,promote:false}); expect(won.result?.winner).toBe('sente'); expect(won.position.hands.sente.G).toBe(0);
  const noKings=updatePieceProperties({},'K',{royal:false}); expect(setupIssues(emptyPosition(),noKings)).toEqual([]);
  const withKingHand=structuredClone(p); withKingHand.hands.sente.K=1; expect(positionKey(withKingHand)).not.toBe(positionKey(p));
  const kingDrop=new ShogiGame(withKingHand,{pieceRules:rules}); kingDrop.play({drop:'K',to:50,promote:false}); expect(kingDrop.position.board[50]?.type).toBe('K'); expect(kingDrop.position.hands.sente.K).toBe(0); expect(ShogiGame.load(kingDrop.save()).position).toEqual(kingDrop.position);
  const base={type:'P' as const,data:{hp:7}}; expect(withInitialData(base,rules).data).toEqual({hp:7,uses:2}); expect(base.data).toEqual({hp:7});
});

test("board edits move, copy, mirror and swap independent data, with redo and correct branch invalidation", () => {
  const p=kings(); p.board[40]={type:'P',side:'sente',promoted:false,data:{hp:3}}; const editor=new BoardEditor(p);
  editor.move(40,41); expect(editor.position.board[40]).toBeNull(); expect(editor.position.board[41]?.data?.hp).toBe(3);
  editor.undo(); expect(editor.canRedo).toBe(true); expect(editor.position).toEqual(p); editor.redo(); expect(editor.position.board[41]?.type).toBe('P');
  const region=editor.copyRegion(41,41); editor.pasteRegion(42,region); region.cells[0]!.data!.hp=99; expect(editor.position.board[42]?.data?.hp).toBe(3);
  const before=editor.position; expect(()=>editor.pasteRegion(80,{width:2,height:2,cells:[null,null,null,null]})).toThrow(); expect(editor.position).toEqual(before);
  editor.mirror('horizontal'); expect(editor.position.board[0]?.side).toBeUndefined(); expect(editor.position.board[8]?.side).toBe('gote'); editor.undo(); expect(editor.position).toEqual(before);
  editor.swapSides(); expect(editor.position.turn).toBe('gote'); expect(editor.position.board[0]?.side).toBe('gote'); editor.undo(); expect(editor.position).toEqual(before);
  editor.setPieceData(41,{hp:5}); editor.undo(); expect(editor.position.board[41]?.data?.hp).toBe(3); editor.setHand('sente','P',2); expect(editor.canRedo).toBe(false);
  editor.setSettings({nifu:false}); const configured=editor.position; editor.clear(); expect(editor.position.settings).toEqual(configured.settings); editor.undo(); expect(editor.position).toEqual(configured);
});

test("piece and code editors redo changes and serialize nested drafts without applying them to their parent", () => {
  const editor=new BoardEditor(kings()), piece=new PieceEditor(); piece.handleClick({id:'piece-editor-add'}); const type=piece.view.piece;
  piece.handleChange({id:'piece-royal',checked:true}); piece.handleChange({id:'piece-initial-data',value:'{"hp":4}'}); piece.handleClick({id:'piece-initial-data-apply'});
  expect(piece.pieceRules[type]?.initialData).toEqual({hp:4}); piece.handleClick({id:'piece-editor-undo'}); expect(piece.view.canRedo).toBe(true); piece.handleClick({id:'piece-editor-redo'}); expect(piece.pieceRules[type]?.initialData).toEqual({hp:4}); expect(editor.pieceRules).toEqual({});
  piece.handleChange({id:'piece-initial-data',value:'{"hp":'}); const restored=PieceEditor.restore(piece.draft); expect(restored.view.initialDataText).toBe('{"hp":'); expect(restored.pieceRules).toEqual(piece.pieceRules);
  const source=new ScriptEditor('',kings(),{}); source.setSource('export default {};'); source.setSource('export default { afterMove(ctx) { ctx.log("a"); } };'); const final=source.source; source.undo(); expect(source.canRedo).toBe(true); source.redo(); expect(source.source).toBe(final); source.undo(); source.setSource('export default { onStart() {} };'); expect(source.canRedo).toBe(false);
});

test("autosaved drafts retain invalid code text and private piece changes without executing or corrupting prior saves", () => {
  const values=new Map<string,string>(), storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const editor=new BoardEditor(kings()), piece=new PieceEditor(); piece.setPieceScript('export default {};');
  const draft={version:1 as const,updatedAt:new Date().toISOString(),snapshot:editor.snapshot,meta:{name:'下書き',passLimitText:'',loadedId:null,returnTo:'workshop' as const},pieceDraft:piece.draft,codeDraft:{source:'export default { afterMove(',piece:'P' as const}};
  saveEditorDraft(storage,draft); const restored=readEditorDraft(storage)!; expect(restored.codeDraft?.source).toBe(draft.codeDraft.source); expect(restored.pieceDraft?.rules.P?.script).toBe('export default {};'); expect(restored.snapshot.rules).toEqual({});
  const saved=values.get(EDITOR_DRAFT_KEY); expect(()=>saveEditorDraft({...storage,setItem(){throw new Error('quota');}},draft)).toThrow('quota'); expect(values.get(EDITOR_DRAFT_KEY)).toBe(saved);
  storage.setItem(EDITOR_DRAFT_KEY,JSON.stringify({...draft,codeDraft:{source:'bad',piece:'R'}})); expect(()=>readEditorDraft(storage)).toThrow();
});

test("detailed traces identify the board and piece event and record data changes without changing ordinary records", () => {
  const p=kings(); p.board[40]={type:'P',side:'sente',promoted:false};
  const rules=updatePieceScript({},'P','export default { afterMove(ctx) { ctx.setPieceData(ctx.self.square,{hp:2}); ctx.log("<effect>"); } };');
  const source='export default { afterMove(ctx) { ctx.state.turns=(ctx.state.turns??0)+1; } };';
  const game=new ShogiGame(p,{pieceRules:rules,ruleScript:source,trace:true}); game.play({from:40,to:31,promote:false});
  expect(game.records[0].trace?.map(row=>[row.scope,row.event])).toEqual([['board','afterMove'],['piece','afterMove']]);
  expect(game.records[0].trace?.[1].changes.join(' ')).toContain('hp'); const log=renderTestLog(game,''); expect(log).toContain('&lt;effect&gt;'); expect(log).not.toContain('<effect>');
  expect(game.lastTrace).toEqual([]); expect(renderTestLog(game,'別の操作でエラー')).not.toContain('反映前に中断した処理');
  const ordinary=new ShogiGame(p,{pieceRules:rules,ruleScript:source}); ordinary.play({from:40,to:31,promote:false}); expect(ordinary.records[0].trace).toBeUndefined();
  const bad=updatePieceScript({},'P','export default { afterMove(ctx) { ctx.setPieceData(ctx.self.square,{hp:0}); throw new Error("失敗"); } };');
  try { runRuleScript('',p,bad,{from:40,to:31,promote:false},true); throw new Error('Expected error'); } catch(error) { expect(error).toBeInstanceOf(RuleScriptError); expect((error as RuleScriptError).trace[0].error).toBe('失敗'); }
  expect(p.board[40]?.data).toBeUndefined();
});
