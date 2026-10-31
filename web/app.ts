import { ShogiGame, SIDE_NAMES, MIN_BOARD_SIZE, MAX_BOARD_SIZE, initialPosition, emptyPosition, setupIssues, fileLabel, rankLabel, promotionDepth, pieceName, legalMoves, inCheck, positionKey, isPassMove, ruleChoiceForMove } from "../src/shogi";
import type { GameMove, Move, HandType, Side, Piece, PieceType, Position } from "../src/shogi";
import { BoardEditor } from "../src/editor";
import type { PieceRegion } from "../src/editor";
import { boardSettings } from "../src/boardsettings";
import { renderEditorExtras, renderEditorHands, renderTestLog } from "../src/editorpanels";
import type { EditorTool } from "../src/editorpanels";
import { readEditorDraft, saveEditorDraft, clearEditorDraft, EDITOR_DRAFT_KEY } from "../src/editordraft";
import type { EditorDraft } from "../src/editordraft";
import { canPromote, pieceDescription, pieceTypes, handTypes, pieceTypeLabel, isRoyal } from "../src/pieces";
import type { PieceRules } from "../src/pieces";
import { renderPiece } from "../src/pieceview";
import { PieceEditor } from "../src/pieceeditor";
import { ScriptEditor } from "../src/scripteditor";
import { createSetup, copySetup, availableSetupName, loadSetup, readLocalSetups, saveLocalSetup, removeLocalSetup, setupFilename, MAX_SETUP_NAME_LENGTH } from "../src/setups";
import type { SavedSetup, LocalSetup } from "../src/setups";
import type { AIReply, AIRequest } from "../src/ai";

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const storageKey = "shogi-game.v1";
type Screen = "title" | "workshop" | "game";
type GameKind = "standard" | "custom";
let screen: Screen = "title", screenVersion = 0, workshopAction: "edit" | "play" = "play", editorReturn: "game" | "workshop" = "game";
let gameKind: GameKind = "standard", gameName = "普通の将棋", hasGameSession = false;
let game = new ShogiGame(undefined, { passLimit: 0 }), selected: number | HandType | null = null, flipped = false, pending: GameMove[] = [], toastTimer: ReturnType<typeof setTimeout>;
let saved = true, loadWarning = "", historyOpen = false, selectedHandIndex = -1;
let resultOpen = false, resultAnimate = false;
let editor: BoardEditor | null = null, editorPiece: PieceType | "erase" = "P", editorSide: Side = "sente", editorPromoted = false, editorSquare = -1;
let editorSetupName = "", editorPassLimitText = "", editorPassLimitBadInput = false, editorLoadedSetupId: string | null = null;
let editorSavedSetups: LocalSetup[] = [], editorStorageError = "";
let editorSaveAsOpen = false, editorSaveAsName = "";
let pieceEditor: PieceEditor | null = null;
let scriptEditor: ScriptEditor | null = null;
let composingField: EventTarget | null = null;
let editorBoardScroll: Array<readonly [string, number]> | null = null;
let editorTool: EditorTool = "place", editorCopyStart: number | null = null, editorClipboard: PieceRegion | null = null, editorDataText: string | null = null;
let editorHandSide: Side = "sente", editorHandType: PieceType = "P", editorHandCount = "0", editorHandEditing = false, editorHandBadInput = false;
let draftAvailable = false, draftStatus = "下書きをこのブラウザーに自動保存します。", lastDraftPayload = "";
type AIMode = "human" | "sente" | "gote" | "both";
type AIStrength = "fast" | "standard";
let aiMode: AIMode = "human", aiStrength: AIStrength = "fast", aiRunning = false, aiBusy = false, aiPaused = false, aiStopRequested = false, aiStartPly = 0;
let aiWorker: Worker | null = null, aiTimer: ReturnType<typeof setTimeout> | undefined, aiRequestId = 0;
let editorTest: { game: ShogiGame; kind: GameKind; name: string; editor: BoardEditor; piece: PieceEditor | null; code: ScriptEditor | null; mode: AIMode; strength: AIStrength; paused: boolean; flipped: boolean; error: string } | null = null;
try { draftAvailable = localStorage.getItem(EDITOR_DRAFT_KEY) !== null; } catch { /* The editor will show storage failures when used. */ }
try { const data = localStorage.getItem(storageKey); if (data) { const parsed = JSON.parse(data); game = ShogiGame.load(parsed.game); gameKind = parsed.gameKind === "custom" ? "custom" : inferGameKind(game); gameName = gameKind === "standard" ? "普通の将棋" : typeof parsed.gameName === "string" && parsed.gameName.trim() ? parsed.gameName.slice(0, MAX_SETUP_NAME_LENGTH) : "エディット対局"; hasGameSession = true; flipped = parsed.flipped === true; aiPaused = parsed.aiPaused === true; if (["human", "sente", "gote", "both"].includes(parsed.aiMode)) aiMode = parsed.aiMode; if (["fast", "standard"].includes(parsed.aiStrength)) aiStrength = parsed.aiStrength; } }
catch { loadWarning = "前回の保存データを読み込めなかったため、初期配置で開きました。"; }
function notify(message: string) { const t = $("#toast"); t.textContent = message; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500); }
function downloadJSON(data: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  try { const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function persist() { if (editorTest) return; try { localStorage.setItem(storageKey, JSON.stringify({ game: game.save(), gameKind, gameName, flipped, aiMode, aiStrength, aiPaused })); saved = true; } catch { saved = false; notify("自動保存できません。棋譜を保存してください。"); } }
function saveDraftNow(): void {
  if (!editor || editorTest) return;
  try {
    const draft: EditorDraft = { version: 1, updatedAt: new Date().toISOString(), snapshot: editor.snapshot, ui: {tool:editorTool,square:editorSquare,dataText:editorDataText}, meta: { name: editorSetupName, passLimitText: editorPassLimitText, loadedId: editorLoadedSetupId, returnTo: editorReturn }, ...(pieceEditor ? { pieceDraft: pieceEditor.draft } : {}), ...(scriptEditor ? { codeDraft: { source: scriptEditor.source, ...(scriptEditor.scope ? { piece: scriptEditor.scope.piece } : {}) } } : {}) };
    const payload = JSON.stringify({ ...draft, updatedAt: "" });
    if (payload !== lastDraftPayload) { saveEditorDraft(localStorage, draft); lastDraftPayload = payload; }
    draftAvailable = true; draftStatus = "下書きを自動保存しました。再読み込み後も編集を再開できます。";
  } catch (error) { draftStatus = `下書きを自動保存できません：${(error as Error).message}`; }
  const status = $("#editor-draft-status"); if (status) status.textContent = draftStatus;
}
function dropDraft(): void { try { clearEditorDraft(localStorage); } catch { /* Keep the game and explicit saves usable when storage is unavailable. */ } draftAvailable = false; lastDraftPayload = ""; }
function draftRecoveryHTML(): string { return draftAvailable ? `<section class="draft-recovery"><div><strong>編集中の下書きがあります</strong><p>配置・駒・未確定のコードの編集を再開できます。</p></div><button id="editor-restore-draft">編集を再開 →</button></section>` : ""; }
function restoreDraft(): void {
  const draft = readEditorDraft(localStorage); if (!draft) throw new Error("編集の下書きがありません");
  stopAI(); editor = new BoardEditor(draft.snapshot.position, draft.snapshot.rules, draft.snapshot.script); editorSetupName = draft.meta.name; editorPassLimitText = draft.meta.passLimitText; editorPassLimitBadInput = false; editorLoadedSetupId = draft.meta.loadedId; editorReturn = draft.meta.returnTo;
  pieceEditor = draft.pieceDraft ? PieceEditor.restore(draft.pieceDraft) : null; scriptEditor = null;
  if (draft.codeDraft) { const piece = draft.codeDraft.piece; scriptEditor = new ScriptEditor(draft.codeDraft.source, editor.position, pieceEditor?.pieceRules ?? editor.pieceRules, piece ? { piece, boardScript: editor.ruleScript } : undefined); }
  editorSquare = draft.ui?.square ?? -1; editorTool = draft.ui?.tool ?? "place"; editorClipboard = null; editorCopyStart = null; editorDataText = draft.ui?.dataText ?? null; editorSaveAsOpen = false; editorHandEditing = false; editorBoardScroll = null; selected = null; pending = []; resultOpen = false; lastDraftPayload = ""; refreshSavedSetups(); setScreen("game"); render();
}
function startEditorTest(): void {
  if (!editor) return;
  let setup = editorSetup();
  if (scriptEditor) { const config = scriptEditor.configuration; setup = createSetup(editor.position, setup.passLimit, setup.name, config.rules, config.boardScript); }
  else if (pieceEditor) setup = createSetup(editor.position, setup.passLimit, setup.name, pieceEditor.pieceRules, editor.ruleScript);
  const issues = setupIssues(setup.position, setup.pieceRules, setup.ruleScript); if (issues.length) throw new Error(issues[0]);
  const test = new ShogiGame(setup.position, { passLimit: setup.passLimit, pieceRules: setup.pieceRules, ruleScript: setup.ruleScript, trace: true });
  saveDraftNow(); stopAI(); editorTest = { game, kind: gameKind, name: gameName, editor, piece: pieceEditor, code: scriptEditor, mode: aiMode, strength: aiStrength, paused: aiPaused, flipped, error: "" };
  game = test; gameKind = "custom"; gameName = `テスト：${setup.name}`; editor = null; pieceEditor = null; scriptEditor = null; aiMode = "human"; aiPaused = true; selected = null; pending = []; resultOpen = false; historyOpen = false; setScreen("game"); render();
}
function returnFromEditorTest(): void {
  if (!editorTest) return; stopAI(); const original = editorTest; editorTest = null;
  game = original.game; gameKind = original.kind; gameName = original.name; editor = original.editor; pieceEditor = original.piece; scriptEditor = original.code; aiMode = original.mode; aiStrength = original.strength; aiPaused = original.paused; flipped = original.flipped;
  selected = null; pending = []; resultOpen = false; historyOpen = false; setScreen("game"); render();
}
function inferGameKind(match: ShogiGame): GameKind { return match.passLimit === 0 && !Object.keys(match.pieceRules).length && !match.ruleScript && positionKey(match.initialPosition) === positionKey(initialPosition()) ? "standard" : "custom"; }
function setScreen(next: Screen): void { screen = next; screenVersion++; composingField = null; }
function isHumanAIMode(): boolean { return aiMode === "sente" || aiMode === "gote"; }
function activateHumanAI(): void { if (isHumanAIMode()) aiRunning = screen === "game" && !aiPaused && !game.result && !editor; }
function execute(move: GameMove) { game.play(move); if (editorTest) editorTest.error = ""; selected = null; selectedHandIndex = -1; pending = []; if (game.result) presentResult(); else activateHumanAI(); persist(); render(); scheduleAI(); }
function presentResult(animate = true): void {
  if (!game.result) return;
  stopAI(); selected = null; pending = []; historyOpen = false; resultOpen = true; resultAnimate = animate;
}
function dismissResult(): void { resultOpen = false; resultAnimate = false; render(); $("#show-result").focus(); }
function restartGame(): void {
  stopAI(); game = new ShogiGame(game.initialPosition, { passLimit: game.passLimit, pieceRules: game.pieceRules, ruleScript: game.ruleScript, trace: !!editorTest }); if (editorTest) editorTest.error = ""; selected = null; selectedHandIndex = -1; pending = []; historyOpen = false; resultOpen = false; resultAnimate = false;
  aiPaused = false; activateHumanAI(); aiStartPly = 0; persist(); render(); scheduleAI();
}
function undoMove(): void {
  const automaticOpponent = isHumanAIMode() && !aiPaused;
  if (automaticOpponent && !game.result && !game.records.some(record => record.side === aiMode)) return;
  const before = game.moveCount;
  stopAI(); game.undo();
  if (editorTest) editorTest.error = "";
  if (automaticOpponent && game.moveCount < before && game.moveCount > 0 && isAITurn()) game.undo();
  selected = null; selectedHandIndex = -1; pending = []; resultOpen = false; resultAnimate = false;
  activateHumanAI(); persist(); render(); scheduleAI();
}
function isAITurn(): boolean { const turn = game.position.turn; return aiMode === "both" || (aiMode === "sente" && turn === "gote") || (aiMode === "gote" && turn === "sente"); }
function stopAI(): void {
  clearTimeout(aiTimer); aiTimer = undefined; aiRequestId++;
  aiWorker?.terminate(); aiWorker = null; aiBusy = false; aiRunning = false; aiStopRequested = false;
}
function requestAIStop(): void {
  if (aiStopRequested || (!aiRunning && !aiBusy)) return;
  aiPaused = true;
  clearTimeout(aiTimer); aiTimer = undefined;
  if (aiBusy) { aiRunning = false; aiStopRequested = true; }
  else stopAI();
  persist(); render();
}
function failAI(message?: string): void { stopAI(); aiPaused = true; if (editorTest && message) editorTest.error = message; persist(); render(); if (message) notify(message); }
function scheduleAI(): void {
  clearTimeout(aiTimer); aiTimer = undefined;
  if (screen !== "game" || !aiRunning || aiBusy || pending.length || game.result || editor || !isAITurn()) return;
  if (aiMode === "both" && game.moveCount - aiStartPly >= 200) { aiRunning = false; render(); notify("200手進めたので自動進行を停止しました。続ける場合は自動開始を押してください。"); return; }
  aiTimer = setTimeout(() => { aiTimer = undefined; if (screen === "game" && aiRunning && isAITurn() && !game.result && !pending.length && !editor) requestAIMove(); }, 250);
}
function requestAIMove(): void {
  clearTimeout(aiTimer); aiTimer = undefined;
  if (screen !== "game" || editor || aiBusy || pending.length || game.result) return;
  const position = game.position, key = positionKey(position), id = ++aiRequestId;
  try {
    const worker = new Worker(new URL("../src/aiworker.js", import.meta.url), { type: "module" });
    aiWorker = worker; aiBusy = true; selected = null; selectedHandIndex = -1; render();
    worker.onmessage = (event: MessageEvent<AIReply>) => {
      if (aiWorker !== worker || aiRequestId !== id || event.data.id !== id) return;
      worker.terminate(); aiWorker = null; aiBusy = false; aiStopRequested = false;
      if ("error" in event.data) { failAI(`AI を停止しました：${event.data.error}`); return; }
      if (game.result || positionKey(game.position) !== key) { failAI(); return; }
      const move = event.data.result.move;
      if (!move) { failAI("AI が指せる手を見つけられませんでした"); return; }
      try { execute(move); } catch (error) { failAI(`AI の手を適用できません：${(error as Error).message}`); }
    };
    worker.onerror = () => { if (aiWorker !== worker || aiRequestId !== id) return; failAI(`AI を起動できませんでした。「${isHumanAIMode() ? "AIを再開" : "自動開始"}」で再試行してください。`); };
    const request: AIRequest = { id, position, options: { maxDepth: aiStrength === "fast" ? 2 : 3, maxNodes: aiStrength === "fast" ? 1600 : 8000, maxTimeMs: aiStrength === "fast" ? 180 : 700, previousPositions: game.positionHistory, passesRemaining: game.passesRemaining, pieceRules: game.pieceRules, ruleScript: game.ruleScript } };
    worker.postMessage(request);
  } catch (error) { failAI(`AI を起動できません：${(error as Error).message}`); }
}
function passControls(): string {
  if (gameKind === "standard") return "";
  const remaining = game.passesRemaining, blocked = aiBusy || (aiRunning && isAITurn());
  let available = false, ruleError = "";
  try { available = game.canPass; } catch (error) { ruleError = (error as Error).message; }
  const reason = ruleError || (game.result ? "対局は終了しています" : blocked ? "AI の手番です" : inCheck(game.position, game.position.turn, game.pieceRules) ? "王手中はパスできません" : !available ? remaining[game.position.turn] === 0 ? "パスの残り回数がありません" : "追加ルールでパスが禁止されています" : "盤面を変えずに手番を相手に渡します");
  return `<div class="pass-controls" role="group" aria-label="パスの追加ルール"><button id="pass" ${blocked || pending.length || !available ? "disabled" : ""} title="${esc(reason)}">パスする</button><span class="pass-remaining" role="status">${(["sente", "gote"] as Side[]).map(side => `${SIDE_NAMES[side]}：${remaining[side] === null ? "無制限" : `残り${remaining[side]}回`}`).join(" / ")}</span><label class="pass-limit-label">パス上限（各自）<input id="pass-limit" type="number" min="0" step="1" value="${game.passLimit ?? ""}" placeholder="無制限" aria-label="各プレイヤーのパス上限" aria-describedby="pass-limit-hint" ${game.moveCount || game.result || aiBusy ? "disabled" : ""}></label><small id="pass-limit-hint">空欄＝無制限・0＝不可（開始前のみ変更）</small>${ruleError ? `<small class="pass-rule-error">${esc(ruleError)}。配置を編集してコードを修正できます。</small>` : ""}</div>`;
}
function aiControls(): string {
  const modes: Array<[AIMode, string]> = [["human", "2人で指す"], ["sente", "自分：先手 / AI：後手"], ["gote", "自分：後手 / AI：先手"], ["both", "AI同士（動作確認）"]];
  const status = aiStopRequested ? "この1手の後に停止します" : aiBusy ? "AI 思考中…" : aiRunning ? isAITurn() ? "自動実行中" : isHumanAIMode() ? "自分の手番（AIは自動応手）" : "自分の手番" : aiMode === "human" ? "" : "停止中";
  return `<div class="ai-controls"><select id="ai-mode" aria-label="対局モード">${modes.map(([value, label]) => `<option value="${value}" ${aiMode === value ? "selected" : ""}>${label}</option>`).join("")}</select><select id="ai-strength" aria-label="AIの読み"><option value="fast" ${aiStrength === "fast" ? "selected" : ""}>速い</option><option value="standard" ${aiStrength === "standard" ? "selected" : ""}>じっくり</option></select><button id="ai-step" ${aiBusy || pending.length || game.result ? "disabled" : ""}>AIで1手</button><button id="ai-toggle" data-ai-action="${aiRunning || aiBusy ? "stop" : "start"}" ${aiStopRequested || (aiMode === "human" && !aiBusy) || pending.length || game.result ? "disabled" : ""}>${aiStopRequested ? "停止予約済み" : aiRunning || aiBusy ? "■ 停止" : isHumanAIMode() ? "▶ AIを再開" : "▶ 自動開始"}</button><span class="ai-status ${aiBusy ? "thinking" : ""}" role="status">${status}</span>${passControls()}</div>`;
}
function resultText(): string {
  const r = game.result; if (!r) return "";
  if (r.reason === "repetition") return "千日手・指し直し";
  if (r.reason === "agreement") return "合意による引き分け";
  if (r.reason === "script" && r.winner === null) return "追加ルールによる引き分け";
  return `${SIDE_NAMES[r.winner!]}の勝ち`;
}
function resultReason(): string {
  const r = game.result; return r ? ({ mate: "詰みが成立しました", noMoves: "指せる手がなくなりました", repetition: "同じ局面が4回現れました", perpetualCheck: "連続王手の千日手です", resign: "投了によって対局が終了しました", agreement: "両者の合意で対局を終了しました", script: "追加ルールによって対局が終了しました" })[r.reason] : "";
}
function resultDialog(): string {
  const result = game.result; if (!result) return "";
  const humanSide = aiMode === "sente" || aiMode === "gote" ? aiMode : null;
  const variant = result.winner === null ? "draw" : humanSide && result.winner !== humanSide ? "loss" : "win";
  const title = humanSide && result.winner ? variant === "win" ? "あなたの勝ちです" : "あなたの負けです" : resultText();
  const stamp = variant === "win" ? "勝利" : variant === "loss" ? "敗北" : result.reason === "repetition" ? "再戦" : "引分";
  const tag = { mate: "詰み", noMoves: "指し手なし", repetition: "千日手", perpetualCheck: "連続王手の千日手", resign: "投了", agreement: "合意", script: "追加ルール" }[result.reason];
  const particles = resultAnimate && variant === "win" ? `<div class="result-particles" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--particle:${i};--drift:${(i % 2 ? 1 : -1) * (22 + i * 9)}px;--delay:${i % 4 * 65}ms"></i>`).join("")}</div>` : "";
  return `<div class="result-backdrop ${resultAnimate ? "is-fresh" : ""}"><section class="result-dialog result-${variant}" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-describedby="result-description"><button id="result-close" class="result-close" aria-label="結果を閉じる">×</button>${particles}<p class="result-label">対局終了</p><div class="result-emblem" aria-hidden="true"><span>${stamp}</span></div><h2 id="result-title">${esc(title)}</h2><p id="result-description">${esc(resultReason())}</p><div class="result-players">${(["sente", "gote"] as Side[]).map(side => `<div class="${result.winner === side ? "winner" : ""}"><span>${side === "sente" ? "▲" : "△"} ${SIDE_NAMES[side]}</span><strong>${result.winner === null ? result.reason === "repetition" ? "指し直し" : "引き分け" : result.winner === side ? "勝ち" : "負け"}</strong></div>`).join("")}</div><div class="result-summary"><span>${esc(tag)}</span><span>${game.moveCount} 手で終局</span></div><div class="result-actions"><button id="result-restart" class="result-primary">もう一局</button><button id="result-export">棋譜を保存</button></div><button id="result-view-board" class="text-button result-view-board">終局した盤面を見る</button><button id="result-home" class="text-button result-view-board">タイトルへ</button></section></div>`;
}
function pieceHTML(p: Piece, rules: PieceRules = editor?.pieceRules ?? game.pieceRules): string { return renderPiece(p, rules, { inverted: p.side === (flipped ? "sente" : "gote") }); }
function handHTML(side: Side): string {
  const position = game.position, rules = game.pieceRules, active = position.turn === side && !game.result && boardSettings(position).useHands;
  const top = side === (flipped ? "sente" : "gote");
  const piles = handTypes(rules).filter(type => boardSettings(position).useHands && position.hands[side][type] > 0).map((type, index) => {
    const count = position.hands[side][type];
    const piece = `<button class="hand-piece owned ${selected === type && active && selectedHandIndex === index ? "selected-hand" : ""}" data-hand="${type}" data-side="${side}" data-hand-index="${index}" ${!active ? "disabled" : ""} aria-label="${SIDE_NAMES[side]}の持ち駒 ${esc(pieceName({ type, side, promoted: false }, rules))} ${count}枚">${renderPiece({ type, side, promoted: false }, rules, { inverted: top, mini: true })}</button>`;
    return `<div class="hand-pile" data-hand-type="${type}">${piece}${count >= 2 ? `<span class="hand-count" aria-hidden="true">${count}</span>` : ""}</div>`;
  }).join("");
  return `<section class="hand-card hand-stand ${top ? "stand-upper-left" : "stand-lower-right"} ${active ? "active-player" : ""}" data-player="${side}" aria-label="${SIDE_NAMES[side]}の持ち駒"><div class="hand-pieces">${piles}</div></section>`;
}
function render() {
  if (editor) { if (scriptEditor) $("#app").innerHTML = scriptEditor.render(); else if (pieceEditor) renderPieceEditorScreen(); else renderEditor(); saveDraftNow(); return; }
  if (screen === "title") { renderTitle(); return; }
  if (screen === "workshop") { renderWorkshop(); return; }
  const position = game.position, rules = game.pieceRules, records = game.records, result = game.result, check = !result && inCheck(position, position.turn, rules);
  const automaticOpponent = isHumanAIMode() && !aiPaused;
  const undoDisabled = !records.length && !result || automaticOpponent && !result && !records.some(record => record.side === aiMode);
  let targets: Move[] = [];
  try { targets = selected === null || result ? [] : legalMoves(position, rules, game.ruleScript).filter(m => typeof selected === "number" ? m.from === selected : m.drop === selected); }
  catch (error) { selected = null; if (editorTest) editorTest.error = (error as Error).message; notify((error as Error).message); }
  const destinations = new Set(targets.map(m => m.to));
  const indices = Array.from({ length: position.board.length }, (_, i) => flipped ? position.board.length - 1 - i : i), lastAction = records.at(-1)?.move;
  const lastMove = lastAction && !isPassMove(lastAction) ? lastAction : undefined;
  const selectedPiece = typeof selected === "number" ? position.board[selected] : null;
  const selectionName = selectedPiece ? pieceName(selectedPiece, rules) : typeof selected === "string" ? pieceName({ type: selected, side: position.turn, promoted: false }, rules) : "";
  const files = Array.from({ length: position.width }, (_, i) => fileLabel(flipped ? i + 1 : position.width - i));
  const ranks = Array.from({ length: position.height }, (_, i) => rankLabel(flipped ? position.height - i : i + 1));
  $("#app").innerHTML = `<header class="site-header" ${pending.length || resultOpen ? "inert" : ""}><a class="brand game-brand" href="/" aria-label="タイトルへ"><span class="brand-icon">将</span><span>${esc(gameName)}<small>${gameKind === "standard" ? "STANDARD SHOGI" : "EDITED SHOGI"}</small></span></a><div class="header-tools"><button id="to-title" class="text-button">タイトルへ</button>${gameKind === "custom" ? `<button id="edit-board" class="text-button">配置を編集</button>` : ""}<button id="import" class="text-button">棋譜を開く</button><button id="export" class="text-button">棋譜を保存 ↗</button></div></header><main ${pending.length || resultOpen ? "inert" : ""}><div class="game-meta">${aiControls()}<span class="save-label ${saved ? "" : "unsaved"}"><i></i>${saved ? "対局を自動保存" : "保存できていません"}</span></div><div class="game-layout"><section class="board-section" aria-label="将棋盤"><div class="board-status"><span class="live-mark ${result ? "ended" : ""}"></span><strong>${result ? esc(resultText()) : `${position.turn === "sente" ? "▲" : "△"} ${SIDE_NAMES[position.turn]}の手番`}</strong>${result ? `<button id="show-result" class="text-button result-reopen">結果を見る</button>` : ""}<span class="move-number">${result ? `${records.length} 手で終局` : `${records.length + 1} 手目`}${check ? `<b class="check-label">王手</b>` : ""}</span></div><div class="board-viewport"><div class="board-arena" style="--board-width:${position.width};--board-height:${position.height}">${handHTML(flipped ? "sente" : "gote")}<div class="board-surround"><div class="file-labels">${[...files].map(x => `<span>${x}</span>`).join("")}</div><div class="board-and-ranks"><div class="board">${indices.map(index => {
    const p = position.board[index], selectedSquare = selected === index, target = destinations.has(index), last = lastMove && (lastMove.to === index || lastMove.from === index), kingChecked = check && p?.type === "K" && p.side === position.turn;
    return `<button class="square ${selectedSquare ? "selected-square" : ""} ${target ? "legal-target" : ""} ${last ? "last-move" : ""} ${kingChecked ? "king-check" : ""}" data-square="${index}" aria-label="${position.width - index % position.width}筋${Math.floor(index / position.width) + 1}段${p ? ` ${SIDE_NAMES[p.side]} ${esc(pieceName(p, rules))}` : " 空きマス"}${target ? " 移動可能" : ""}" ${result ? "disabled" : ""}>${p ? pieceHTML(p, rules) : target ? `<span class="move-dot"></span>` : ""}${target && p ? `<span class="capture-ring"></span>` : ""}</button>`;
  }).join("")}${position.width === 9 && position.height === 9 ? `<i class="star s1"></i><i class="star s2"></i><i class="star s3"></i><i class="star s4"></i>` : ""}</div><div class="rank-labels">${[...ranks].map(y => `<span>${y}</span>`).join("")}</div></div></div>${handHTML(flipped ? "gote" : "sente")}</div></div><div class="board-caption"><span><i class="legend-dot"></i>移動できるマス</span><span><i class="legend-square"></i>直前の一手</span><button id="open-history" class="text-button">棋譜を見る</button><button id="flip" class="text-button">↻ 盤面を反転</button></div><div class="instruction"><span class="instruction-icon">${result ? "結" : esc(selectionName || "一")}</span><div><strong>${result ? esc(resultText()) : selected !== null ? `${esc(selectionName)}の${typeof selected === "string" ? "打つ" : "移動する"}場所を選んでください` : "手番の駒を選んでください"}</strong><p>${result ? esc(resultReason()) : selectedPiece ? esc(pieceDescription(selectedPiece, rules)) : selected !== null ? "点が表示されたマスに打てます。もう一度持ち駒を押すと選択を解除します。" : "駒をクリックすると、移動できるマスに印が付きます。"}</p></div></div></section><aside class="record-column"><section class="record-card ${historyOpen ? "history-open" : ""}" ${historyOpen ? 'role="dialog" aria-modal="true" aria-label="棋譜"' : ""}><div class="record-heading"><div><span class="eyebrow">MOVE RECORD</span><h2>これまでの一手</h2></div><span class="record-count">${records.length} 手</span><button id="close-history" class="text-button" aria-label="棋譜を閉じる">閉じる ×</button></div><div class="record-list" aria-live="polite">${records.length ? records.map((r, i) => `<div class="record-row ${i === records.length - 1 ? "latest" : ""}"><span>${String(i + 1).padStart(2, "0")}</span><strong>${esc(r.notation)}</strong><small title="${esc(r.effects?.join("・") ?? "")}">${r.check ? "王手" : ""}${r.effects?.length ? ` 効果${r.effects.length}件` : ""}</small></div>`).join("") : `<div class="empty-record"><span>歩</span><h3>まだ、まっさらな盤面。</h3><p>先手から一手、指してみましょう。<br>ここに棋譜が積み重なります。</p></div>`}</div><div class="record-footer"><span>${result ? "対局終了" : `${position.width}×${position.height}盤・時間制限なし`}</span><span>先手 ▲ / 後手 △</span></div></section><div class="game-controls"><button id="undo" ${undoDisabled ? "disabled" : ""}>${automaticOpponent ? "↶ 待った" : "↶ 一手戻す"}</button><button id="restart">新しく始める</button><button id="resign" class="quiet" ${result || aiBusy || (aiRunning && isAITurn()) ? "disabled" : ""}>投了する</button><button id="draw" class="quiet" ${result ? "disabled" : ""}>合意で引き分け</button></div><details class="help"><summary>はじめての方へ <span>＋</span></summary><p>先手は上、後手は下へ進みます。相手の駒を取ると持ち駒になり、次の手番から盤面へ打てます。</p><p>敵陣の${promotionDepth(position.height,boardSettings(position).promotionDepth)}段以内に入る・出る・中で動くとき、駒によっては「成る」を選べます。</p><p>王手を受けたら解消する手を指します。相手の王を逃げられなくすると勝ちです。</p><p>二歩・打ち歩詰め・王手放置など、指せない手は選択肢に表示しません。</p></details></aside></div></main><footer ${pending.length || resultOpen ? "inert" : ""}>将棋からはじまる、自分だけの遊び。<span>LOCAL TWO-PLAYER SHOGI</span></footer>${historyOpen ? `<button id="history-backdrop" class="history-backdrop" aria-label="棋譜を閉じる" tabindex="-1"></button>` : ""}<input id="file-input" type="file" accept=".json,application/json" hidden>${pending.length ? promotionDialog() : ""}${resultOpen ? resultDialog() : ""}`;
  const list = $(".record-list"); if (list) list.scrollTop = list.scrollHeight;
  if (editorTest) {
    $(".site-header")?.classList.add("is-testing");
    const tools = $(".header-tools"); if (tools) tools.innerHTML = '<strong class="test-mode-label">編集用テスト</strong><button id="editor-test-back" class="editor-primary">編集に戻る</button>';
    const record = $(".record-column"); if (record) record.innerHTML = renderTestLog(game, editorTest.error);
    const status = $(".save-label"); if (status) status.textContent = "テスト中・本番の対局は保持しています";
  }
  if (resultOpen) $("#result-view-board").focus();
}
function goTitle(): void {
  stopAI(); editor = null; pieceEditor = null; scriptEditor = null; editorBoardScroll = null; selected = null; selectedHandIndex = -1; pending = []; historyOpen = false; resultOpen = false; resultAnimate = false;
  setScreen("title"); render(); $("#title-standard").focus();
}
function continueGame(): void {
  if (!hasGameSession) return;
  stopAI(); editor = null; pieceEditor = null; scriptEditor = null; editorBoardScroll = null; selected = null; selectedHandIndex = -1; pending = []; historyOpen = false;
  resultOpen = game.result !== null; resultAnimate = false; setScreen("game");
  activateHumanAI(); aiStartPly = game.moveCount; render(); scheduleAI();
}
function openWorkshop(action: "edit" | "play" = "play"): void {
  stopAI(); editor = null; pieceEditor = null; scriptEditor = null; editorBoardScroll = null; selected = null; pending = []; historyOpen = false; resultOpen = false;
  workshopAction = action; setScreen("workshop"); refreshSavedSetups(); render();
}
function startMatch(setup: SavedSetup, kind: GameKind): boolean {
  const issues = setupIssues(setup.position, setup.pieceRules, setup.ruleScript); if (issues.length) throw new Error(issues[0]);
  if (hasGameSession && (game.moveCount || game.result || gameKind === "custom") && !confirm("現在の対局を置き換えて、新しい対局を始めますか？")) return false;
  const next = new ShogiGame(setup.position, { passLimit: kind === "standard" ? 0 : setup.passLimit, pieceRules: kind === "standard" ? {} : setup.pieceRules, ruleScript: kind === "standard" ? "" : setup.ruleScript });
  stopAI(); game = next; gameKind = kind; gameName = kind === "standard" ? "普通の将棋" : setup.name; hasGameSession = true;
  editor = null; pieceEditor = null; scriptEditor = null; editorBoardScroll = null; selected = null; selectedHandIndex = -1; pending = []; historyOpen = false; resultOpen = false; resultAnimate = false;
  aiPaused = false; setScreen("game"); activateHumanAI(); aiStartPly = 0; persist(); render(); scheduleAI();
  return true;
}
function storedSetup(id: string): LocalSetup {
  editorSavedSetups = readLocalSetups(setupStorage());
  const entry = editorSavedSetups.find(entry => entry.id === id);
  if (!entry) { render(); throw new Error("保存済みの配置が見つかりません"); }
  return entry;
}
function handleMenuClick(button: HTMLButtonElement): void {
  if (button.id === "editor-restore-draft") { restoreDraft(); return; }
  if (button.id === "to-title") { goTitle(); return; }
  if (screen === "title") {
    if (button.id === "title-standard") startMatch(createSetup(initialPosition(), 0, "普通の将棋"), "standard");
    else if (button.id === "title-workshop") openWorkshop();
    else if (button.id === "title-continue") continueGame();
    return;
  }
  if (button.dataset.workshopEdit) { const entry = storedSetup(button.dataset.workshopEdit); openEditor(entry.setup, "workshop", entry.id); return; }
  if (button.dataset.workshopCopy) {
    const entry = storedSetup(button.dataset.workshopCopy);
    openEditor(copySetup(entry.setup, editorSavedSetups.map(entry => entry.setup.name)), "workshop");
    focusEditorName(); notify("コピーを編集しています。保存すると別の配置として追加されます。"); return;
  }
  if (button.dataset.workshopDelete) {
    const entry = storedSetup(button.dataset.workshopDelete);
    if (!confirm(`「${entry.setup.name}」をこのブラウザから削除しますか？`)) return;
    removeLocalSetup(setupStorage(), entry.id);
    refreshSavedSetups(); render(); notify("保存済みの配置を削除しました"); return;
  }
  if (button.dataset.workshopPlay) { startMatch(storedSetup(button.dataset.workshopPlay).setup, "custom"); return; }
  switch (button.id) {
    case "workshop-new": case "workshop-create-empty": openEditor(createSetup(emptyPosition(), null), "workshop"); break;
    case "workshop-edit": openWorkshop("edit"); break;
    case "workshop-play": openWorkshop("play"); break;
    case "workshop-import-setup": $("#workshop-file-input").click(); break;
  }
}
async function importWorkshopSetup(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0], version = screenVersion, action = workshopAction;
  if (!file) return;
  try {
    const text = await file.text(); if (screen !== "workshop" || version !== screenVersion) return;
    const setup = loadSetup(JSON.parse(text));
    if (action === "edit") openEditor(setup, "workshop");
    else startMatch(setup, "custom");
  } catch (error) { if (screen === "workshop" && version === screenVersion) notify(`配置を開けません：${(error as Error).message}`); }
  finally { input.value = ""; }
}
function renderTitle(): void {
  $("#app").innerHTML = `<header class="site-header menu-header"><div class="brand"><span class="brand-icon">将</span><span>将棋<small>BOARD GAME MAKER</small></span></div><span class="menu-header-note">いつもの一局から、自分だけの盤面まで。</span></header>
    <main class="title-main"><div class="title-heading"><p class="menu-eyebrow">SHOGI / LOCAL PLAY</p><h1>遊び方を選んでください</h1><p>普通の将棋を指す。盤面をつくって遊ぶ。</p></div>${draftRecoveryHTML()}<div class="title-choices">
    <section class="title-choice standard-choice"><span class="menu-emblem" aria-hidden="true">将</span><span class="menu-eyebrow">STANDARD</span><h2>普通の将棋</h2><p>9×9の平手で、新しい対局を始めます。<br>2人でも、AI相手でも遊べます。</p><button id="title-standard" class="menu-primary">普通の将棋で遊ぶ <span aria-hidden="true">→</span></button><small>通常のルール・パスなし</small></section>
    <section class="title-choice custom-choice"><span class="menu-emblem" aria-hidden="true">編</span><span class="menu-eyebrow">CREATE & PLAY</span><h2>エディットで遊ぶ</h2><p>盤面の大きさや駒の配置・動きを変えて、<br>自分だけの将棋をつくれます。</p><button id="title-workshop" class="menu-primary">エディットで遊ぶ <span aria-hidden="true">→</span></button><small>新規作成・保存した配置の編集・遊ぶ</small></section></div>
    ${hasGameSession ? `<section class="continue-card" aria-label="前回の対局"><div><span class="menu-eyebrow">CONTINUE</span><strong>${esc(gameName)}</strong><p>${game.position.width}×${game.position.height}盤・${game.moveCount}手${game.result ? "・終局済み" : `・${SIDE_NAMES[game.position.turn]}の手番`}</p></div><button id="title-continue">${game.result ? "前回の対局を見る" : "対局の続きから"} <span aria-hidden="true">→</span></button></section>` : ""}</main>`;
}
function setupPreview(position: Position, rules?: PieceRules): string {
  return `<div class="setup-preview" aria-hidden="true"><div class="setup-preview-board" style="--preview-width:${position.width};--preview-height:${position.height}">${position.board.map(piece => `<span>${piece ? renderPiece(piece, rules, { inverted: piece.side === "gote", compact: true }) : ""}</span>`).join("")}</div></div>`;
}
function renderWorkshop(): void {
  $("#app").innerHTML = `<header class="site-header menu-header"><div class="brand"><span class="brand-icon">編</span><span>エディットで遊ぶ<small>CREATE & PLAY</small></span></div><div class="header-tools"><button id="to-title" class="text-button">← タイトルへ</button></div></header>
    <main class="workshop-main">${draftRecoveryHTML()}<div class="workshop-heading"><div><p class="menu-eyebrow">YOUR SHOGI WORKSHOP</p><h1>つくる、直す、遊ぶ。</h1><p>保存した配置は、編集しても、そのまま対局しても使えます。</p></div></div>
    <nav class="workshop-actions" aria-label="エディットのメニュー"><button id="workshop-new"><span class="workshop-action-number">01</span><strong>新規</strong><span>空の盤面から、新しい配置をつくる</span><b aria-hidden="true">＋</b></button><button id="workshop-edit" aria-pressed="${workshopAction === "edit"}"><span class="workshop-action-number">02</span><strong>編集</strong><span>保存した配置やファイルを開いて直す</span><b aria-hidden="true">↗</b></button><button id="workshop-play" aria-pressed="${workshopAction === "play"}"><span class="workshop-action-number">03</span><strong>遊ぶ</strong><span>できあがった配置を選んで対局する</span><b aria-hidden="true">→</b></button></nav>
    <section class="workshop-library" aria-labelledby="workshop-library-title"><div class="workshop-library-heading"><div><h2 id="workshop-library-title">${workshopAction === "edit" ? "編集する配置を選ぶ" : "遊ぶ配置を選ぶ"}</h2><p>このブラウザに保存した配置 ${editorSavedSetups.length}件</p></div><button id="workshop-import-setup">ファイルから${workshopAction === "edit" ? "編集する" : "遊ぶ"}</button></div>
    ${editorStorageError ? `<p class="workshop-storage-error" role="alert">${esc(editorStorageError)}</p>` : ""}
    ${editorSavedSetups.length ? `<div class="workshop-setup-grid">${editorSavedSetups.map(entry => {
      const setup = entry.setup, issues = setupIssues(setup.position, setup.pieceRules, setup.ruleScript);
      return `<article class="workshop-setup-card">${setupPreview(setup.position, setup.pieceRules)}<div class="workshop-setup-body"><span class="setup-ready ${issues.length ? "is-draft" : ""}">${issues.length ? "作成途中" : "対局できます"}</span><h3>${esc(setup.name)}</h3><p>${setup.position.width}×${setup.position.height}盤・${SIDE_NAMES[setup.position.turn]}から</p><p>パス：${setup.passLimit === null ? "無制限" : setup.passLimit === 0 ? "なし" : `各自${setup.passLimit}回`}</p>${setup.pieceRules ? `<p>駒の設定：編集済み</p>` : ""}${setup.ruleScript ? `<p>盤面ルール：設定あり</p>` : ""}${issues.length ? `<p class="setup-issue">${esc(issues[0])}</p>` : ""}<div class="workshop-setup-buttons">${workshopAction === "edit" ? `<button data-workshop-edit="${esc(entry.id)}">編集する →</button>` : `<button data-workshop-play="${esc(entry.id)}" ${issues.length ? "disabled" : ""}>この配置で遊ぶ →</button><button class="text-button" data-workshop-edit="${esc(entry.id)}">編集</button>`}<button class="text-button" data-workshop-copy="${esc(entry.id)}">コピーして作成</button><button class="text-button" data-workshop-delete="${esc(entry.id)}" aria-label="${esc(setup.name)}を削除">削除</button></div></div></article>`;
    }).join("")}</div>` : `<div class="workshop-empty"><span aria-hidden="true">盤</span><h3>まだ配置が保存されていません</h3><p>「新規」から配置をつくるか、配置ファイルを開いてください。</p><button id="workshop-create-empty" class="menu-primary">新しい配置をつくる</button></div>`}</section><input id="workshop-file-input" type="file" accept=".json,application/json" hidden></main>`;
}
function openEditor(setup?: SavedSetup, returnTo: "game" | "workshop" = "game", loadedId: string | null = null): void {
  editorTool = "place"; editorCopyStart = null; editorClipboard = null; editorDataText = null; editorHandSide = "sente"; editorHandType = "P"; editorHandCount = "0"; editorHandEditing = false; editorHandBadInput = false; lastDraftPayload = "";
  stopAI(); selected = null; selectedHandIndex = -1; pending = []; historyOpen = false;
  editor = new BoardEditor(setup?.position ?? game.initialPosition, setup ? setup.pieceRules : game.pieceRules, setup ? setup.ruleScript : game.ruleScript); editorSquare = -1; editorReturn = returnTo; setScreen("game");
  editorSetupName = setup?.name ?? ""; editorPassLimitText = (setup ? setup.passLimit : game.passLimit)?.toString() ?? ""; editorPassLimitBadInput = false; editorLoadedSetupId = loadedId;
  editorSaveAsOpen = false; editorSaveAsName = "";
  pieceEditor = null; scriptEditor = null; editorBoardScroll = null;
  refreshSavedSetups();
  render(); $("#editor-width").focus();
}
function closeEditor(): void {
  dropDraft();
  editor = null; pieceEditor = null; scriptEditor = null; editorBoardScroll = null; editorSaveAsOpen = false;
  if (editorReturn === "workshop") { openWorkshop(workshopAction); return; }
  activateHumanAI(); render(); scheduleAI(); $("#edit-board").focus();
}
function setupStorage(): Storage {
  try { return localStorage; } catch { throw new Error("このブラウザの保存機能を利用できません。ファイルに出力してください。"); }
}
function refreshSavedSetups(): void {
  try { editorSavedSetups = readLocalSetups(setupStorage()); editorStorageError = ""; }
  catch (error) { editorSavedSetups = []; editorStorageError = (error as Error).message; }
}
function editorSetup(name = editorSetupName): SavedSetup {
  if (!editor) throw new Error("盤面エディターを開いてください");
  if (editorPassLimitBadInput) throw new Error("パス上限は0以上の整数、または無制限にしてください");
  return createSetup(editor.position, editorPassLimitText.trim() === "" ? null : Number(editorPassLimitText), name, editor.pieceRules, editor.ruleScript);
}
function useEditorSetup(setup: SavedSetup): void {
  if (!editor) return;
  editor.reset(setup.position, setup.pieceRules ?? {}, setup.ruleScript ?? ""); editorSquare = -1; editorSetupName = setup.name; editorHandEditing = false;
  editorPassLimitText = setup.passLimit?.toString() ?? ""; editorPassLimitBadInput = false; editorLoadedSetupId = null;
  editorSaveAsOpen = false; editorSaveAsName = "";
  render();
}
function focusEditorName(selector = "#editor-setup-name"): void {
  const input = $(selector) as HTMLInputElement; input.focus(); input.select?.();
}
function openSaveAs(): void {
  if (!editor) return;
  editorSaveAsName = availableSetupName(editorSetupName || `${editor.position.width}×${editor.position.height}の配置`, editorSavedSetups.map(entry => entry.setup.name));
  editorSaveAsOpen = true; render(); focusEditorName("#editor-save-as-name");
}
function closeSaveAs(): void { editorSaveAsOpen = false; render(); $("#editor-save-as").focus(); }
function saveEditorAs(destination: "browser" | "file"): void {
  if (!editor || !editorSaveAsOpen) return;
  if (!editorSaveAsName.trim()) throw new Error("新しい配置名を入力してください");
  const setup = editorSetup(editorSaveAsName);
  if (destination === "browser") {
    const entries = readLocalSetups(setupStorage());
    if (entries.some(entry => entry.setup.name === setup.name)) throw new Error("同じ名前の配置が保存されています。別の名前を入力してください。");
    const entry = saveLocalSetup(setupStorage(), setup);
    editorLoadedSetupId = entry.id; refreshSavedSetups();
  } else {
    downloadJSON(setup, setupFilename(setup)); editorLoadedSetupId = null;
  }
  editorSetupName = setup.name; editorSaveAsOpen = false; render();
  notify(`「${setup.name}」を${destination === "browser" ? "別の配置としてブラウザに保存しました" : "ファイルに出力しました"}`);
}
async function importEditorSetup(input: HTMLInputElement): Promise<void> {
  const current = editor, version = screenVersion, file = input.files?.[0];
  if (!current || !file) return;
  try {
    const text = await file.text(); if (editor !== current || screenVersion !== version || pieceEditor || scriptEditor) return;
    useEditorSetup(loadSetup(JSON.parse(text))); notify("配置ファイルを読み込みました");
  } catch (error) { if (editor === current && screenVersion === version && !pieceEditor && !scriptEditor) notify(`配置を読み込めません：${(error as Error).message}`); }
  finally { input.value = ""; }
}
function saveAsHTML(): string {
  if (!editorSaveAsOpen) return "";
  return `<div id="editor-save-as-panel" class="editor-save-as-panel" role="group" aria-labelledby="editor-save-as-heading"><h3 id="editor-save-as-heading">別名で保存</h3><p>新しい名前と保存先を選んでください。</p><label class="editor-setup-name">新しい配置名<input id="editor-save-as-name" type="text" maxlength="${MAX_SETUP_NAME_LENGTH}" value="${esc(editorSaveAsName)}"></label><div class="editor-save-as-actions"><button id="editor-confirm-save-as">ブラウザに保存</button><button id="editor-export-as">ファイルに出力</button><button id="editor-cancel-save-as" class="text-button">キャンセル</button></div></div>`;
}
function setupStorageHTML(): string {
  return `<section class="editor-section editor-setup-storage"><h2>配置の保存と読み込み</h2><label class="editor-setup-name">配置名<input id="editor-setup-name" type="text" maxlength="${MAX_SETUP_NAME_LENGTH}" value="${esc(editorSetupName)}" placeholder="${editor ? `${editor.position.width}×${editor.position.height}の配置` : "配置名"}"></label><div class="editor-save-actions"><button id="editor-save-local">${editorLoadedSetupId ? "上書き保存" : "ブラウザに保存"}</button><button id="editor-save-as" aria-expanded="${editorSaveAsOpen}" aria-controls="editor-save-as-panel">別名で保存</button><button id="editor-export-setup">ファイルに出力</button><button id="editor-import-setup">ファイルを開く</button></div>${saveAsHTML()}<p>作成途中の配置も保存できます。盤面・駒の配置と動き・持ち駒・最初の手番・パス上限を保存します。</p>${editorStorageError ? `<p class="editor-storage-error" role="alert">${esc(editorStorageError)}</p>` : ""}</section>`;
}
function openPieceSettings(): void {
  if (!editor) return;
  editorBoardScroll = [".editor-main", ".editor-panel"].map(selector => [selector, $(selector)?.scrollTop ?? 0] as const);
  pieceEditor = new PieceEditor(editor.pieceRules, editorPiece === "erase" ? "P" : editorPiece, editorPromoted);
  setScreen("game"); render(); $("#piece-editor-title").focus();
}
function closePieceSettings(apply: boolean): void {
  if (!editor || !pieceEditor) return;
  if (apply) editor.setPieceRules(pieceEditor.pieceRules);
  pieceEditor = null; setScreen("game"); render(); $("#editor-open-piece-settings").focus();
}
function renderPieceEditorScreen(): void {
  if (!pieceEditor) return;
  const scrollPositions = [".piece-editor-workspace", ".piece-editor-library", ".piece-editor-main", ".piece-rule-list"].map(selector => [selector, $(selector)?.scrollTop ?? 0] as const);
  const previousGrid = $(".piece-rule-grid-viewport");
  const gridScroll = previousGrid ? { size: previousGrid.dataset?.gridSize, top: previousGrid.scrollTop, left: previousGrid.scrollLeft } : null;
  $("#app").innerHTML = pieceEditor.render();
  for (const [selector, scrollTop] of scrollPositions) { const container = $(selector); if (container) container.scrollTop = scrollTop; }
  const grid = $(".piece-rule-grid-viewport");
  if (grid) {
    const resized = !gridScroll || gridScroll.size !== grid.dataset?.gridSize;
    grid.scrollTop = resized ? Math.max(0, (grid.scrollHeight - grid.clientHeight) / 2) : gridScroll.top;
    grid.scrollLeft = resized ? Math.max(0, (grid.scrollWidth - grid.clientWidth) / 2) : gridScroll.left;
  }
}
function handlePieceEditorClick(button: HTMLButtonElement): void {
  if (!pieceEditor) return;
  if (button.id === "editor-test-start") { startEditorTest(); return; }
  if (button.id === "piece-editor-open-script" && editor) {
    const piece = pieceEditor.view.piece, rules = pieceEditor.pieceRules;
    scriptEditor = new ScriptEditor(rules[piece]?.script ?? "", editor.position, rules, { piece, boardScript: editor.ruleScript });
    setScreen("game"); render(); $("#rule-script-source").focus(); return;
  }
  if (button.id === "piece-editor-back" || button.id === "piece-editor-cancel") { closePieceSettings(button.id === "piece-editor-back"); return; }
  const update = pieceEditor.handleClick(button);
  if (update?.render) { render(); if (update.focus) $(update.focus)?.focus(); }
}
function isPieceTextInput(input: HTMLInputElement): boolean { return input.id === "piece-name" || input.dataset?.designField === "text"; }
function updatePieceText(input: HTMLInputElement, reportError = false): void {
  if (!pieceEditor) return;
  try {
    pieceEditor.handleChange(input);
    const view = pieceEditor.view, name = pieceTypeLabel(view.piece, view.rules);
    // Keep the input node and focus intact so the IME can compose the next character.
    const title = $("#piece-editor-title"); if (title) title.textContent = `${name}${view.promoted ? "（成り後）" : ""}の設定`;
    const label = $(`[data-rule-piece="${view.piece}"] strong`); if (label) label.textContent = name;
    const state = $(`[data-rule-piece="${view.piece}"] small`); if (state) state.textContent = view.rules[view.piece] ? "設定あり" : "標準";
    const status = $(".piece-editor-draft-status"); if (status) status.textContent = view.changed ? "反映前の変更があります" : "変更はありません";
    const undo = $("#piece-editor-undo") as HTMLButtonElement | null; if (undo) undo.disabled = !view.canUndo;
    const redo = $("#piece-editor-redo") as HTMLButtonElement | null; if (redo) redo.disabled = !view.canRedo;
    const side = input.dataset?.designSide;
    if (side === "sente" || side === "gote") {
      const preview = $(`[data-design-preview="${side}"]`);
      if (preview) preview.innerHTML = renderPiece({ type: view.piece, side, promoted: view.promoted }, view.rules, { inverted: side === "gote" });
    }
  } catch (error) { if (reportError) notify((error as Error).message); }
  saveDraftNow();
}
function closeScriptEditor(apply: boolean): void {
  if (!editor || !scriptEditor) return;
  const pieceScope = scriptEditor.scope;
  if (apply) {
    if (!scriptEditor.verify()) { render(); $("#script-editor-status").focus(); return; }
    if (pieceScope && pieceEditor) pieceEditor.setPieceScript(scriptEditor.source);
    else editor.setRuleScript(scriptEditor.source);
  }
  scriptEditor = null; setScreen("game"); render(); $(pieceScope ? "#piece-editor-open-script" : "#editor-open-script").focus();
}
function handleScriptEditorClick(button: HTMLButtonElement): void {
  if (!scriptEditor) return;
  if (button.id === "editor-test-start") { startEditorTest(); return; }
  if (button.id === "script-editor-back" || button.id === "script-editor-cancel") { closeScriptEditor(button.id === "script-editor-back"); return; }
  if (button.id === "script-editor-verify") scriptEditor.verify();
  else if (button.id === "script-editor-undo") scriptEditor.undo();
  else if (button.id === "script-editor-redo") scriptEditor.redo();
  else if (button.id === "script-editor-disable") scriptEditor.setSource("");
  else if (button.dataset.scriptExample) scriptEditor.useExample(button.dataset.scriptExample);
  else return;
  render(); $(button.id === "script-editor-verify" ? "#script-editor-status" : "#rule-script-source").focus();
}
function closeEditorHandCount(): void {
  editorHandEditing = false; editorHandBadInput = false; render();
  ($(`[data-editor-hand-side="${editorHandSide}"][data-editor-hand-type="${editorHandType}"]`) ?? $(`[data-editor-add-hand="${editorHandSide}"]`))?.focus();
}
function applyEditorHandCount(): void {
  if (!editor || !editorHandEditing) return;
  if (editorHandBadInput || !editorHandCount.trim()) throw new Error("持ち駒は0〜225枚の整数で指定してください");
  editor.setHand(editorHandSide, editorHandType, Number(editorHandCount)); closeEditorHandCount();
}
function handleEditorClick(button: HTMLButtonElement): void {
  if (!editor) return;
  if (button.dataset.editorAddHand && ["sente", "gote"].includes(button.dataset.editorAddHand)) {
    if (editorPiece === "erase" || isRoyal(editorPiece, editor.pieceRules)) throw new Error("持ち駒にする駒を「置く駒」から選んでください");
    const side = button.dataset.editorAddHand as Side;
    editor.setHand(side, editorPiece, (editor.position.hands[side][editorPiece] ?? 0) + 1);
    editorHandEditing = false; render(); $(`[data-editor-add-hand="${side}"]`)?.focus(); return;
  }
  if (button.dataset.editorHandType && ["sente", "gote"].includes(button.dataset.editorHandSide ?? "")) {
    const side = button.dataset.editorHandSide as Side, type = button.dataset.editorHandType as PieceType;
    if (!handTypes(editor.pieceRules).includes(type) || isRoyal(type, editor.pieceRules) || !editor.position.hands[side][type]) return;
    editorHandSide = side; editorHandType = type; editorHandCount = String(editor.position.hands[side][type]); editorHandEditing = true; editorHandBadInput = false;
    render(); const field = $("#editor-hand-count") as HTMLInputElement; field.focus(); field.select?.(); return;
  }
  if (button.id === "editor-set-hand") { applyEditorHandCount(); return; }
  if (button.id === "editor-cancel-hand-count") { closeEditorHandCount(); return; }
  if (button.id === "editor-test-start") { startEditorTest(); return; }
  if (button.dataset.editorTool && ["place","select","move","copy"].includes(button.dataset.editorTool)) { editorTool = button.dataset.editorTool as EditorTool; editorSquare = -1; editorDataText = null; editorCopyStart = null; editorClipboard = null; render(); return; }
  if (button.id === "editor-open-script") { scriptEditor = new ScriptEditor(editor.ruleScript, editor.position, editor.pieceRules); setScreen("game"); render(); $("#rule-script-source").focus(); return; }
  if (button.id === "editor-open-piece-settings") { openPieceSettings(); return; }
  if (button.dataset.editorSquare !== undefined) {
    const index = Number(button.dataset.editorSquare);
    if (editorTool === "place") editor.place(index, editorPiece === "erase" ? null : { type: editorPiece, side: editorSide, promoted: editorPromoted });
    else if (editorTool === "move") {
      if (editorSquare < 0 || !editor.position.board[editorSquare]) { if (!editor.position.board[index]) throw new Error("移動する駒を選んでください"); editorSquare = index; render(); return; }
      editor.move(editorSquare, index);
      editorSquare = -1; editorDataText = null; render(); return;
    } else if (editorTool === "copy") {
      if (editorClipboard) editor.pasteRegion(index, editorClipboard);
      else if (editorCopyStart === null) editorCopyStart = index;
      else { editorClipboard = editor.copyRegion(editorCopyStart, index); editorCopyStart = null; }
    }
    editorSquare = index;
    editorDataText = null;
  } else if (button.dataset.editorPiece) {
    const type = button.dataset.editorPiece;
    if (type !== "erase" && !pieceTypes(editor.pieceRules).includes(type as PieceType)) return;
    editorPiece = type as PieceType | "erase";
    if (editorPiece === "erase" || !canPromote(editorPiece, editor.pieceRules)) editorPromoted = false;
  } else if (button.dataset.editorSide && ["sente", "gote"].includes(button.dataset.editorSide)) editorSide = button.dataset.editorSide as Side;
  else switch (button.id) {
    case "editor-cancel": closeEditor(); return;
    case "editor-save-local": {
      const entry = saveLocalSetup(setupStorage(), editorSetup(), editorLoadedSetupId ?? undefined);
      editorLoadedSetupId = entry.id; editorSetupName = entry.setup.name; editorSaveAsOpen = false; refreshSavedSetups(); render(); notify(`「${entry.setup.name}」をこのブラウザに保存しました`); return;
    }
    case "editor-save-as": openSaveAs(); return;
    case "editor-confirm-save-as": saveEditorAs("browser"); return;
    case "editor-export-as": saveEditorAs("file"); return;
    case "editor-cancel-save-as": closeSaveAs(); return;
    case "editor-export-setup": { const setup = editorSetup(); downloadJSON(setup, setupFilename(setup)); editorSetupName = setup.name; render(); notify("配置をJSONファイルに出力しました"); return; }
    case "editor-import-setup": $("#setup-file-input").click(); return;
    case "editor-undo": editor.undo(); editorSquare = -1; editorDataText = null; editorHandEditing = false; break;
    case "editor-redo": editor.redo(); editorSquare = -1; editorDataText = null; editorHandEditing = false; break;
    case "editor-mirror-horizontal": editor.mirror("horizontal"); editorSquare = -1; break;
    case "editor-mirror-vertical": editor.mirror("vertical"); editorSquare = -1; break;
    case "editor-swap-sides": editor.swapSides(); editorSquare = -1; editorHandEditing = false; break;
    case "editor-clear-clipboard": editorCopyStart = null; editorClipboard = null; break;
    case "editor-set-piece-data": editor.setPieceData(editorSquare, JSON.parse(editorDataText ?? ($("#editor-piece-data") as HTMLTextAreaElement).value)); break;
    case "editor-clear": editor.clear(); editorSquare = -1; editorHandEditing = false; break;
    case "editor-standard": editor.reset(initialPosition(), {}, ""); editorSquare = -1; editorHandEditing = false; break;
    case "editor-current": editor.reset(game.position, game.pieceRules, game.ruleScript); editorSquare = -1; editorHandEditing = false; break;
    case "editor-flip": flipped = !flipped; editorSquare = -1; break;
    case "editor-apply": {
      if (editor.issues.length) throw new Error(editor.issues[0]);
      const setup = editorSetup();
      if (startMatch(setup, "custom")) { dropDraft(); notify("編集した配置で対局を始めました"); } return;
    }
    default: return;
  }
  render();
}
function renderEditor(): void {
  if (!editor) return;
  const scrollPositions = editorBoardScroll ?? [".editor-main", ".editor-panel", ".editor-hand-racks"].map(selector => [selector, $(selector)?.scrollTop ?? 0] as const);
  editorBoardScroll = null;
  const position = editor.position, rules = editor.pieceRules, issues = editor.issues;
  if (!handTypes(rules).includes(editorHandType) || isRoyal(editorHandType, rules) || !position.hands[editorHandSide][editorHandType]) editorHandEditing = false;
  if (editorPiece !== "erase" && !pieceTypes(rules).includes(editorPiece)) editorPiece = "P";
  if (editorPiece === "erase" || !canPromote(editorPiece, rules)) editorPromoted = false;
  const sizes = (value: number) => Array.from({ length: MAX_BOARD_SIZE - MIN_BOARD_SIZE + 1 }, (_, i) => `<option value="${i + MIN_BOARD_SIZE}" ${value === i + MIN_BOARD_SIZE ? "selected" : ""}>${i + MIN_BOARD_SIZE}</option>`).join("");
  const indices = Array.from({ length: position.board.length }, (_, i) => flipped ? position.board.length - 1 - i : i);
  const files = Array.from({ length: position.width }, (_, i) => fileLabel(flipped ? i + 1 : position.width - i));
  const ranks = Array.from({ length: position.height }, (_, i) => rankLabel(flipped ? position.height - i : i + 1));
  const brush = editorPiece === "erase" ? "消しゴム" : `${SIDE_NAMES[editorSide]}の${pieceName({ type: editorPiece, side: editorSide, promoted: editorPromoted }, rules)}`;
  const handSummary = (["sente", "gote"] as Side[]).map(side => `${SIDE_NAMES[side]}：${handTypes(rules).filter(type => position.hands[side][type]).map(type => `${pieceName({ type, side, promoted: false }, rules)}${position.hands[side][type]}枚`).join("・") || "なし"}`).join(" / ");
  $("#app").innerHTML = `<header class="site-header"><div class="brand"><span class="brand-icon">編</span><span>盤面エディット<small>BOARD SETUP</small></span></div><div class="header-tools"><button id="editor-cancel" class="text-button">編集をやめる</button><button id="editor-apply" class="editor-primary" ${issues.length ? "disabled" : ""}>この配置で対局</button></div></header>
    <main class="editor-main"><div class="editor-intro"><strong>盤面と駒の配置・動き</strong><span>盤面の大きさと配置を編集します。駒の動きは専用画面で設定できます。</span></div>
    <div class="editor-layout"><section class="editor-preview" aria-label="配置のプレビュー"><div class="editor-board-caption"><strong>${position.width} × ${position.height} マス</strong><span>配置中：${esc(brush)}</span><button id="editor-flip" class="text-button">↻ 盤面を反転</button></div>
    <div class="editor-stage">${renderEditorHands(position, rules, editorPiece, editorHandEditing ? { side: editorHandSide, type: editorHandType, count: editorHandCount } : null)}<div class="editor-board-viewport"><div class="board-surround editor-board-frame" style="--board-width:${position.width};--board-height:${position.height}"><div class="file-labels">${files.map(x => `<span>${x}</span>`).join("")}</div><div class="board-and-ranks"><div class="board">${indices.map(index => {
      const piece = position.board[index];
      return `<button class="square ${editorSquare === index ? "editor-last" : ""}" data-editor-square="${index}" aria-label="${position.width - index % position.width}筋${Math.floor(index / position.width) + 1}段 ${piece ? `${SIDE_NAMES[piece.side]} ${esc(pieceName(piece, rules))}` : "空きマス"}">${piece ? pieceHTML(piece, rules) : ""}</button>`;
    }).join("")}</div><div class="rank-labels">${ranks.map(y => `<span>${y}</span>`).join("")}</div></div></div></div></div>
    <p class="editor-board-help">王・玉を置き直すと、同じ側の王・玉が移動します。消しゴムで駒を取り除けます。</p></section>
    <aside class="editor-panel">${setupStorageHTML()}<section class="editor-section"><h2>盤面の大きさ</h2><div class="editor-size-fields"><label>横のマス数<select id="editor-width">${sizes(position.width)}</select></label><span>×</span><label>縦のマス数<select id="editor-height">${sizes(position.height)}</select></label></div><p>縦・横それぞれ${MIN_BOARD_SIZE}〜${MAX_BOARD_SIZE}マス。縮小すると盤外の駒を取り除きます。</p></section>
    <section class="editor-section"><h2>置く駒</h2><div class="editor-side-buttons">${(["sente", "gote"] as Side[]).map(side => `<button data-editor-side="${side}" aria-pressed="${editorSide === side}">${side === "sente" ? "▲" : "△"} ${SIDE_NAMES[side]}</button>`).join("")}</div><div class="editor-palette">${pieceTypes(rules).map(type => `<button data-editor-piece="${type}" aria-pressed="${editorPiece === type}" aria-label="${esc(pieceTypeLabel(type, rules))}">${pieceHTML({ type, side: editorSide, promoted: editorPromoted && canPromote(type, rules) }, rules)}</button>`).join("")}</div><div class="editor-brush-options"><label><input id="editor-promoted" type="checkbox" ${editorPromoted ? "checked" : ""} ${editorPiece === "erase" || !canPromote(editorPiece, rules) ? "disabled" : ""}> 成った駒を置く</label><button data-editor-piece="erase" aria-pressed="${editorPiece === "erase"}">消しゴム</button></div></section>
    <section class="editor-section editor-piece-settings"><h2>駒の設定</h2><p>${Object.keys(editor.pieceRules).length ? `${Object.keys(editor.pieceRules).length}種類の駒を設定済みです。` : "標準の動きを使用しています。"}移動・駒取りは専用画面で設定します。</p><button id="editor-open-piece-settings">駒の設定画面を開く →</button></section><section class="editor-section"><h2>対局の開始設定</h2><label class="editor-turn-label">最初の手番<select id="editor-turn"><option value="sente" ${position.turn === "sente" ? "selected" : ""}>先手</option><option value="gote" ${position.turn === "gote" ? "selected" : ""}>後手</option></select></label><label class="editor-pass-limit">パス上限（各自）<input id="editor-pass-limit" type="number" min="0" step="1" value="${esc(editorPassLimitText)}" placeholder="無制限"></label><p>パス上限は空欄で無制限、0で使用不可です。</p><p>成れる範囲：相手側の端から${promotionDepth(position.height,boardSettings(position).promotionDepth)}段</p><p>持ち駒：${esc(handSummary)}</p><div class="editor-validation ${issues.length ? "has-issues" : ""}" role="status">${issues.length ? `<ul>${issues.map(issue => `<li>${esc(issue)}</li>`).join("")}</ul>` : "この配置で対局できます"}</div></section>
    <section class="editor-section editor-piece-settings"><h2>盤面のルールコード</h2><p>${editor.ruleScript ? "JavaScriptの追加ルールを設定済みです。" : "勝利・敗北条件や盤面全体の効果をプログラムできます。"}</p><button id="editor-open-script">盤面のルールコードを編集 →</button></section>${renderEditorExtras(position,rules,{tool:editorTool,square:editorSquare,clipboard:editorClipboard,copyStart:editorCopyStart,dataText:editorDataText,draftStatus})}<section class="editor-section editor-tools"><button id="editor-undo" ${editor.canUndo ? "" : "disabled"}>↶ 編集を一つ戻す</button><button id="editor-redo" ${editor.canRedo ? "" : "disabled"}>↷ やり直す</button><button id="editor-current">現在の対局の盤面を使う</button><button id="editor-clear">盤面を空にする</button><button id="editor-standard">平手に戻す（9×9）</button><p>「この配置で対局」で棋譜をリセットし、編集した配置から開始します。設定は棋譜の保存にも含まれます。</p></section></aside></div></main><input id="setup-file-input" type="file" accept=".json,application/json" hidden>`;
  for (const [selector, scrollTop] of scrollPositions) { const container = $(selector); if (container) container.scrollTop = scrollTop; }
}
function pendingRuleChoice() {
  const first = pending[0];
  let index = 0;
  while (first.choices?.[index] !== undefined && pending.every(move => move.choices?.[index] === first.choices![index])) index++;
  return ruleChoiceForMove(game.position, { ...first, choices: first.choices?.slice(0, index) ?? [] }, game.pieceRules, game.ruleScript);
}
function selectPending(moves: GameMove[]): void {
  if (!moves.length) throw new Error("指せる手がありません");
  if (moves.length === 1) { execute(moves[0]); return; }
  pending = moves; render(); $(".promotion-dialog button").focus();
}
function promotionDialog(): string {
  const move = pending[0];
  if (isPassMove(move) || !pending.some(candidate => !isPassMove(candidate) && candidate.promote !== move.promote)) {
    const choice = pendingRuleChoice();
    if (!choice) throw new Error("ルールの選択肢が見つかりません");
    const options = choice.options.filter(option => pending.some(candidate => candidate.choices?.[choice.index] === option.value));
    return `<div class="modal-backdrop"><section class="promotion-dialog rule-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title"><span class="eyebrow">RULE CHOICE</span><h2 id="promotion-title">${esc(choice.title)}</h2><p>追加ルールの効果を選んでください。</p><div class="rule-choice-options">${options.map(option => `<button data-rule-choice="${esc(option.value)}">${pieceTypes(game.pieceRules).includes(option.value as PieceType) ? pieceHTML({ type: option.value as PieceType, side: game.position.turn, promoted: false }) : ""}<strong>${esc(option.label)}</strong></button>`).join("")}</div><button id="cancel-promotion" class="text-button">戻る</button></section></div>`;
  }
  const p = game.position.board[move.from!]!;
  return `<div class="modal-backdrop"><section class="promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title"><span class="eyebrow">PROMOTION</span><h2 id="promotion-title">${esc(pieceName(p, game.pieceRules))}を成りますか？</h2><p>成ると、駒の動きが変わります。</p><div class="promotion-options"><button data-promote="yes">${pieceHTML({ ...p, promoted: true })}<strong>成る</strong></button><button data-promote="no">${pieceHTML(p)}<strong>成らない</strong></button></div><button id="cancel-promotion" class="text-button">戻る</button></section></div>`;
}
// Latch stop on press so a render between pointerdown and click cannot lose it.
document.addEventListener("pointerdown", e => {
  if (screen !== "game" || !e.isPrimary || e.button !== 0 || resultOpen || pending.length || editor) return;
  const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (b?.id === "ai-toggle" && !b.disabled && b.dataset.aiAction === "stop") requestAIStop();
});
document.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null; if (!b || b.disabled) return;
  try {
    if (editorTest) {
      if (["editor-test-back","to-title","result-home","edit-board"].includes(b.id)) { returnFromEditorTest(); return; }
      if (b.id === "editor-test-step") { stopAI(); requestAIMove(); return; }
      if (b.id === "editor-test-export") { downloadJSON({ kind: "editor-test-log", version: 1, game: game.save(), initialTrace: game.initialTrace, records: game.records, position: game.position, error: editorTest.error, interruptedTrace: editorTest.error ? game.lastTrace : [] }, "shogi-editor-test-log.json"); return; }
      if (b.id === "open-history") { $(".test-log-panel")?.scrollIntoView?.(); return; }
    }
    if (!editor && screen !== "game") { handleMenuClick(b); return; }
    if (resultOpen && !["result-close", "result-view-board", "result-restart", "result-export", "result-home"].includes(b.id)) return;
    if (pending.length && !b.dataset.promote && b.dataset.ruleChoice === undefined && b.id !== "cancel-promotion") return;
    if (editor) { if (scriptEditor) handleScriptEditorClick(b); else if (pieceEditor) handlePieceEditorClick(b); else handleEditorClick(b); return; }
    if (b.dataset.square !== undefined) {
      if (pending.length || game.result) return;
      if (aiBusy || (aiRunning && isAITurn())) { notify("AI の手番です。操作する場合は停止を押してください。"); return; }
      const to = Number(b.dataset.square), position = game.position, p = position.board[to];
      if (selected !== null) {
        const moves = legalMoves(position, game.pieceRules, game.ruleScript).filter(m => m.to === to && (typeof selected === "number" ? m.from === selected : m.drop === selected));
        if (moves.length === 1) return execute(moves[0]);
        if (moves.length > 1) { selectPending(moves); return; }
      }
      if (p?.side === position.turn) selected = selected === to ? null : to;
      else { selected = null; if (p) notify("手番の駒を選んでください"); }
      render();
    } else if (b.dataset.hand) {
      if (pending.length || game.result || b.dataset.side !== game.position.turn) return;
      if (aiBusy || (aiRunning && isAITurn())) return;
      const index = Number(b.dataset.handIndex ?? 0), samePiece = selected === b.dataset.hand && selectedHandIndex === index;
      selected = samePiece ? null : b.dataset.hand as HandType; selectedHandIndex = samePiece ? -1 : index; render();
    }
    else if (b.dataset.promote) selectPending(pending.filter(move => !isPassMove(move) && move.promote === (b.dataset.promote === "yes")));
    else if (b.dataset.ruleChoice !== undefined) { const choice = pendingRuleChoice(); if (choice) selectPending(pending.filter(move => move.choices?.[choice.index] === b.dataset.ruleChoice)); }
    else switch (b.id) {
      case "cancel-promotion": pending = []; render(); break;
      case "undo": undoMove(); break;
      case "result-close": case "result-view-board": dismissResult(); break;
      case "show-result": presentResult(false); render(); break;
      case "result-restart": restartGame(); break;
      case "to-title": case "result-home": goTitle(); break;
      case "edit-board": if (gameKind === "custom") openEditor(); else openWorkshop("edit"); break;
      case "pass":
        if (aiBusy || (aiRunning && isAITurn())) { notify("AI の手番です。操作する場合は停止を押してください。"); break; }
        { const moves = game.passMoves; if (moves.length) selectPending(moves); else game.pass(); } break;
      case "ai-step": stopAI(); activateHumanAI(); requestAIMove(); break;
      case "ai-toggle":
        // The original stop button may receive its click after the AI has stopped.
        if (b.dataset.aiAction === "stop" || aiRunning || aiBusy) requestAIStop();
        else { aiPaused = false; aiRunning = true; aiStartPly = game.moveCount; persist(); render(); scheduleAI(); }
        break;
      case "flip": flipped = !flipped; persist(); render(); break;
      case "open-history": historyOpen = true; render(); $("#close-history").focus(); break;
      case "close-history": case "history-backdrop": historyOpen = false; render(); $("#open-history").focus(); break;
      case "restart": if ((!game.moveCount && !game.result) || confirm("対局を初期配置に戻しますか？残しておきたい場合は、先に棋譜を保存してください。")) restartGame(); break;
      case "resign": if (confirm(`${SIDE_NAMES[game.position.turn]}が投了しますか？`)) { game.resign(); presentResult(); persist(); render(); } break;
      case "draw": if (confirm("先手・後手の両者が引き分けに同意していますか？")) { game.agreeDraw(); presentResult(); persist(); render(); } break;
      case "result-export": case "export": downloadJSON(game.save(), `shogi-${game.moveCount}moves.json`); notify("棋譜を JSON ファイルに保存しました"); break;
      case "import": $("#file-input").click(); break;
    }
  } catch (error) { if (editorTest) { editorTest.error = (error as Error).message; render(); } notify((error as Error).message); }
  finally { saveDraftNow(); }
});
document.addEventListener("keydown", e => {
  const key = e as KeyboardEvent;
  if (key.isComposing || key.keyCode === 229 || composingField) return;
  if (editorTest && key.key === "Escape" && !pending.length && !resultOpen) { key.preventDefault(); returnFromEditorTest(); return; }
  const textTarget = ["INPUT", "TEXTAREA"].includes((key.target as HTMLElement | null)?.tagName ?? "") || (key.target as HTMLElement | null)?.isContentEditable;
  if (editor && !textTarget && (key.ctrlKey || key.metaKey) && ["z","y"].includes(key.key.toLowerCase())) {
    key.preventDefault(); const redo = key.key.toLowerCase() === "y" || key.shiftKey;
    if (scriptEditor) { if (redo) scriptEditor.redo(); else scriptEditor.undo(); }
    else if (pieceEditor) pieceEditor.handleClick({ id: redo ? "piece-editor-redo" : "piece-editor-undo" });
    else { if (redo) editor.redo(); else editor.undo(); editorHandEditing = false; }
    render(); return;
  }
  if (editor) {
    if (scriptEditor) {
      if (key.key === "Escape") { key.preventDefault(); closeScriptEditor(false); }
      else if ((key.ctrlKey || key.metaKey) && key.key === "Enter") { key.preventDefault(); scriptEditor.verify(); render(); }
      else if (key.key === "Tab" && (key.target as HTMLElement | null)?.id === "rule-script-source") {
        key.preventDefault(); const field = key.target as HTMLTextAreaElement;
        field.setRangeText("  ", field.selectionStart, field.selectionEnd, "end"); updateCodeDraft(field.value);
      }
      return;
    }
    if (pieceEditor) { if (key.key === "Escape") { key.preventDefault(); closePieceSettings(true); } return; }
    if (key.key === "Escape") { key.preventDefault(); if (editorSaveAsOpen) closeSaveAs(); else if (editorHandEditing) closeEditorHandCount(); else closeEditor(); }
    else if (key.key === "Enter" && editorHandEditing && (key.target as HTMLElement | null)?.id === "editor-hand-count") {
      key.preventDefault(); try { applyEditorHandCount(); } catch (error) { notify((error as Error).message); }
    }
    else if (editorSaveAsOpen && key.key === "Enter" && (key.target as HTMLElement | null)?.id === "editor-save-as-name") {
      key.preventDefault(); try { saveEditorAs("browser"); } catch (error) { notify((error as Error).message); }
    }
    return;
  }
  if (screen !== "game") { if (screen === "workshop" && key.key === "Escape") { key.preventDefault(); goTitle(); } return; }
  if (resultOpen) {
    if (key.key === "Escape") { key.preventDefault(); dismissResult(); }
    else if (key.key === "Tab") {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".result-dialog button")];
      const index = buttons.findIndex(button => button === document.activeElement);
      key.preventDefault(); buttons[(index + (key.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
    return;
  }
  if (key.key === "Escape") { selected = null; pending = []; historyOpen = false; render(); }
  if (historyOpen && key.key === "Tab") { key.preventDefault(); $("#close-history").focus(); }
  if (pending.length && key.key === "Tab") {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".promotion-dialog button")];
    const index = buttons.findIndex(b => b === document.activeElement);
    key.preventDefault(); buttons[(index + (key.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }
});
document.addEventListener("compositionstart", e => { composingField = e.target; });
document.addEventListener("compositionend", e => {
  composingField = null;
  const input = e.target as HTMLInputElement;
  if (scriptEditor && input.id === "rule-script-source") updateCodeDraft(input.value);
  else if (editor && pieceEditor && isPieceTextInput(input)) updatePieceText(input);
});
function updateCodeDraft(value: string): void {
  if (!scriptEditor) return; scriptEditor.setSource(value); $("#script-editor-status").textContent = scriptEditor.status; $("#script-editor-status").classList.remove("has-error");
  const undo = $("#script-editor-undo") as HTMLButtonElement | null, redo = $("#script-editor-redo") as HTMLButtonElement | null;
  if (undo) undo.disabled = !scriptEditor.canUndo; if (redo) redo.disabled = !scriptEditor.canRedo; saveDraftNow();
}
document.addEventListener("input", e => {
  if (!editor) return;
  const input = e.target as HTMLInputElement;
  if (scriptEditor) { if (input.id === "rule-script-source" && !(e as InputEvent).isComposing && composingField !== input) updateCodeDraft(input.value); return; }
  if (pieceEditor) {
    if (input.id === "piece-initial-data") { pieceEditor.handleChange(input); saveDraftNow(); return; }
    if (isPieceTextInput(input) && !(e as InputEvent).isComposing && composingField !== input) updatePieceText(input);
    return;
  }
  if (input.id === "editor-setup-name") editorSetupName = input.value;
  if (input.id === "editor-save-as-name") editorSaveAsName = input.value;
  if (input.id === "editor-pass-limit") { editorPassLimitText = input.value; editorPassLimitBadInput = input.validity?.badInput === true; }
  if (input.id === "editor-piece-data") editorDataText = input.value;
  if (input.id === "editor-hand-count") { editorHandCount = input.value; editorHandBadInput = input.validity?.badInput === true; }
  saveDraftNow();
});
document.addEventListener("change", async e => {
  const input = e.target as HTMLInputElement;
  if (editor) {
    if (scriptEditor) { if (input.id === "rule-script-source" && composingField !== input) updateCodeDraft(input.value); return; }
    if (pieceEditor) {
      if (isPieceTextInput(input)) { if (composingField !== input && !(e as InputEvent).isComposing) updatePieceText(input, true); return; }
      try { const update = pieceEditor.handleChange(input); if (update?.render) { render(); if (update.focus) $(update.focus)?.focus(); } saveDraftNow(); }
      catch (error) { notify((error as Error).message); }
      return;
    }
    if (input.id === "setup-file-input") { await importEditorSetup(input); return; }
    if (input.id === "editor-setup-name") { editorSetupName = input.value; return; }
    if (input.id === "editor-save-as-name") { editorSaveAsName = input.value; return; }
    if (input.id === "editor-pass-limit") { editorPassLimitText = input.value; editorPassLimitBadInput = input.validity?.badInput === true; return; }
    try {
      const position = editor.position;
      if (input.dataset?.basicRule) editor.setSettings({ [input.dataset.basicRule]: input.checked });
      else if (input.id === "editor-promotion-depth") editor.setSettings({ promotionDepth: input.value === "default" ? null : Number(input.value) });
      else if (input.id === "editor-piece-data") { editorDataText = input.value; saveDraftNow(); return; }
      else if (input.id === "editor-hand-count") { editorHandCount = input.value; editorHandBadInput = input.validity?.badInput === true; return; }
      else if (input.id === "editor-width") editor.resize(Number(input.value), position.height);
      else if (input.id === "editor-height") editor.resize(position.width, Number(input.value));
      else if (input.id === "editor-turn" && ["sente", "gote"].includes(input.value)) editor.setTurn(input.value as Side);
      else if (input.id === "editor-promoted") editorPromoted = input.checked && editorPiece !== "erase" && canPromote(editorPiece, editor.pieceRules);
      else return;
      editorSquare = -1; render();
    } catch (error) { render(); notify((error as Error).message); }
    return;
  }
  if (screen !== "game") { if (screen === "workshop" && input.id === "workshop-file-input") await importWorkshopSetup(input); return; }
  if (input.id === "pass-limit") {
    try {
      if (gameKind === "standard") throw new Error("パス上限はエディットの対局で設定できます");
      if (aiBusy) throw new Error("パス上限は対局開始前に設定してください");
      if (input.validity?.badInput) throw new Error("パス上限は0以上の整数、または無制限にしてください");
      game.setPassLimit(input.value.trim() === "" ? null : Number(input.value)); persist(); render();
    } catch (error) { render(); notify((error as Error).message); }
    return;
  }
  if (input.id === "ai-mode" && ["human", "sente", "gote", "both"].includes(input.value)) {
    stopAI(); aiMode = input.value as AIMode; aiPaused = false; selected = null; selectedHandIndex = -1; activateHumanAI(); aiStartPly = game.moveCount; persist(); render(); scheduleAI(); return;
  }
  if (input.id === "ai-strength" && ["fast", "standard"].includes(input.value)) {
    const resume = aiRunning; stopAI(); aiStrength = input.value as AIStrength; aiRunning = resume; activateHumanAI(); persist(); render(); scheduleAI(); return;
  }
  if (input.id !== "file-input" || !input.files?.[0]) return;
  const current = game, version = screenVersion;
  try {
    const text = await input.files[0].text();
    if (screen !== "game" || editor || screenVersion !== version || game !== current) return;
    const next = ShogiGame.load(JSON.parse(text));
    if ((!game.moveCount && !game.result) || confirm("読み込んだ棋譜に切り替えますか？現在の対局は置き換わります。")) {
      stopAI(); game = next; gameKind = inferGameKind(game); gameName = gameKind === "standard" ? "普通の将棋" : "エディット対局"; hasGameSession = true;
      selected = null; pending = []; historyOpen = false; resultOpen = game.result !== null; resultAnimate = false;
      aiPaused = false; activateHumanAI(); aiStartPly = game.moveCount; persist(); render(); scheduleAI(); notify("棋譜を読み込みました");
    }
  } catch (error) { if (screen === "game" && !editor && screenVersion === version && game === current) notify(`読み込めませんでした：${(error as Error).message}`); }
  finally { input.value = ""; }
});
activateHumanAI(); aiStartPly = game.moveCount; render(); if (loadWarning) notify(loadWarning); scheduleAI();
