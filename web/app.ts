import { ShogiGame, HAND_TYPES, PIECE_NAMES, PIECE_LABELS, SIDE_NAMES, pieceName, pieceLabel, legalMoves, inCheck, positionKey } from "../src/shogi";
import type { Move, HandType, Side, Piece } from "../src/shogi";
import type { AIReply, AIRequest } from "../src/ai";

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const storageKey = "shogi-game.v1";
let game = new ShogiGame(), selected: number | HandType | null = null, flipped = false, pending: Move[] = [], toastTimer: ReturnType<typeof setTimeout>;
let saved = true, loadWarning = "", historyOpen = false, selectedHandIndex = -1;
let resultOpen = false, resultAnimate = false;
type AIMode = "human" | "sente" | "gote" | "both";
type AIStrength = "fast" | "standard";
let aiMode: AIMode = "human", aiStrength: AIStrength = "fast", aiRunning = false, aiBusy = false, aiStopRequested = false, aiStartPly = 0;
let aiWorker: Worker | null = null, aiTimer: ReturnType<typeof setTimeout> | undefined, aiRequestId = 0;
try { const data = localStorage.getItem(storageKey); if (data) { const parsed = JSON.parse(data); game = ShogiGame.load(parsed.game); flipped = parsed.flipped === true; if (["human", "sente", "gote", "both"].includes(parsed.aiMode)) aiMode = parsed.aiMode; if (["fast", "standard"].includes(parsed.aiStrength)) aiStrength = parsed.aiStrength; } }
catch { loadWarning = "前回の保存データを読み込めなかったため、初期配置で開きました。"; }
resultOpen = game.result !== null;
const guides = { K: "縦・横・斜めに1マス進めます。", R: "縦・横に、駒にぶつかるまで進めます。", B: "斜めに、駒にぶつかるまで進めます。", G: "前と斜め前、横、真後ろに1マス進めます。", S: "前と斜め前、斜め後ろに1マス進めます。", N: "前に2マス、横に1マス跳びます。", L: "前に、駒にぶつかるまで進めます。", P: "前に1マス進めます。" };
function notify(message: string) { const t = $("#toast"); t.textContent = message; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500); }
function persist() { try { localStorage.setItem(storageKey, JSON.stringify({ game: game.save(), flipped, aiMode, aiStrength })); saved = true; } catch { saved = false; notify("自動保存できません。棋譜を保存してください。"); } }
function execute(move: Move) { game.play(move); selected = null; selectedHandIndex = -1; pending = []; if (game.result) presentResult(); persist(); render(); scheduleAI(); }
function presentResult(animate = true): void {
  if (!game.result) return;
  stopAI(); selected = null; pending = []; historyOpen = false; resultOpen = true; resultAnimate = animate;
}
function dismissResult(): void { resultOpen = false; resultAnimate = false; render(); $("#show-result").focus(); }
function restartGame(): void {
  stopAI(); game = new ShogiGame(); selected = null; selectedHandIndex = -1; pending = []; historyOpen = false; resultOpen = false; resultAnimate = false;
  aiRunning = aiMode === "sente" || aiMode === "gote"; aiStartPly = 0; persist(); render(); scheduleAI();
}
function isAITurn(): boolean { const turn = game.position.turn; return aiMode === "both" || (aiMode === "sente" && turn === "gote") || (aiMode === "gote" && turn === "sente"); }
function stopAI(): void {
  clearTimeout(aiTimer); aiTimer = undefined; aiRequestId++;
  aiWorker?.terminate(); aiWorker = null; aiBusy = false; aiRunning = false; aiStopRequested = false;
}
function requestAIStop(): void {
  if (aiStopRequested || (!aiRunning && !aiBusy)) return;
  clearTimeout(aiTimer); aiTimer = undefined;
  if (aiBusy) { aiRunning = false; aiStopRequested = true; }
  else stopAI();
  render();
}
function scheduleAI(): void {
  clearTimeout(aiTimer); aiTimer = undefined;
  if (!aiRunning || aiBusy || pending.length || game.result || !isAITurn()) return;
  if (game.moveCount - aiStartPly >= 200) { aiRunning = false; render(); notify("200手進めたので自動進行を停止しました。続ける場合は自動開始を押してください。"); return; }
  aiTimer = setTimeout(() => { aiTimer = undefined; if (aiRunning && isAITurn() && !game.result && !pending.length) requestAIMove(); }, 250);
}
function requestAIMove(): void {
  clearTimeout(aiTimer); aiTimer = undefined;
  if (aiBusy || pending.length || game.result) return;
  const position = game.position, key = positionKey(position), id = ++aiRequestId;
  try {
    const worker = new Worker(new URL("../src/aiworker.js", import.meta.url), { type: "module" });
    aiWorker = worker; aiBusy = true; selected = null; selectedHandIndex = -1; render();
    worker.onmessage = (event: MessageEvent<AIReply>) => {
      if (aiWorker !== worker || aiRequestId !== id || event.data.id !== id) return;
      worker.terminate(); aiWorker = null; aiBusy = false; aiStopRequested = false;
      if ("error" in event.data) { stopAI(); render(); notify(`AI を停止しました：${event.data.error}`); return; }
      if (game.result || positionKey(game.position) !== key) { stopAI(); render(); return; }
      const move = event.data.result.move;
      if (!move) { stopAI(); render(); notify("AI が指せる手を見つけられませんでした"); return; }
      try { execute(move); } catch (error) { stopAI(); render(); notify(`AI の手を適用できません：${(error as Error).message}`); }
    };
    worker.onerror = () => { if (aiWorker !== worker || aiRequestId !== id) return; stopAI(); render(); notify("AI を起動できませんでした。ページを再読み込みしてください。"); };
    const request: AIRequest = { id, position, options: { maxDepth: aiStrength === "fast" ? 2 : 3, maxNodes: aiStrength === "fast" ? 1600 : 8000, maxTimeMs: aiStrength === "fast" ? 180 : 700, previousPositions: game.positionHistory } };
    worker.postMessage(request);
  } catch (error) { stopAI(); render(); notify(`AI を起動できません：${(error as Error).message}`); }
}
function aiControls(): string {
  const modes: Array<[AIMode, string]> = [["human", "2人で指す"], ["sente", "自分：先手 / AI：後手"], ["gote", "自分：後手 / AI：先手"], ["both", "AI同士（動作確認）"]];
  const status = aiStopRequested ? "この1手の後に停止します" : aiBusy ? "AI 思考中…" : aiRunning ? isAITurn() ? "自動実行中" : "自分の手番" : aiMode === "human" ? "" : "停止中";
  return `<div class="ai-controls"><select id="ai-mode" aria-label="対局モード">${modes.map(([value, label]) => `<option value="${value}" ${aiMode === value ? "selected" : ""}>${label}</option>`).join("")}</select><select id="ai-strength" aria-label="AIの読み"><option value="fast" ${aiStrength === "fast" ? "selected" : ""}>速い</option><option value="standard" ${aiStrength === "standard" ? "selected" : ""}>じっくり</option></select><button id="ai-step" ${aiBusy || pending.length || game.result ? "disabled" : ""}>AIで1手</button><button id="ai-toggle" data-ai-action="${aiRunning || aiBusy ? "stop" : "start"}" ${aiStopRequested || (aiMode === "human" && !aiBusy) || pending.length || game.result ? "disabled" : ""}>${aiStopRequested ? "停止予約済み" : aiRunning || aiBusy ? "■ 停止" : "▶ 自動開始"}</button><span class="ai-status ${aiBusy ? "thinking" : ""}" role="status">${status}</span></div>`;
}
function resultText(): string {
  const r = game.result; if (!r) return "";
  if (r.reason === "repetition") return "千日手・指し直し";
  if (r.reason === "agreement") return "合意による引き分け";
  return `${SIDE_NAMES[r.winner!]}の勝ち`;
}
function resultReason(): string {
  const r = game.result; return r ? ({ mate: "詰みが成立しました", noMoves: "指せる手がなくなりました", repetition: "同じ局面が4回現れました", perpetualCheck: "連続王手の千日手です", resign: "投了によって対局が終了しました", agreement: "両者の合意で対局を終了しました" })[r.reason] : "";
}
function resultDialog(): string {
  const result = game.result; if (!result) return "";
  const humanSide = aiMode === "sente" || aiMode === "gote" ? aiMode : null;
  const variant = result.winner === null ? "draw" : humanSide && result.winner !== humanSide ? "loss" : "win";
  const title = humanSide && result.winner ? variant === "win" ? "あなたの勝ちです" : "あなたの負けです" : resultText();
  const stamp = variant === "win" ? "勝利" : variant === "loss" ? "敗北" : result.reason === "repetition" ? "再戦" : "引分";
  const tag = { mate: "詰み", noMoves: "指し手なし", repetition: "千日手", perpetualCheck: "連続王手の千日手", resign: "投了", agreement: "合意" }[result.reason];
  const particles = resultAnimate && variant === "win" ? `<div class="result-particles" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--particle:${i};--drift:${(i % 2 ? 1 : -1) * (22 + i * 9)}px;--delay:${i % 4 * 65}ms"></i>`).join("")}</div>` : "";
  return `<div class="result-backdrop ${resultAnimate ? "is-fresh" : ""}"><section class="result-dialog result-${variant}" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-describedby="result-description"><button id="result-close" class="result-close" aria-label="結果を閉じる">×</button>${particles}<p class="result-label">対局終了</p><div class="result-emblem" aria-hidden="true"><span>${stamp}</span></div><h2 id="result-title">${esc(title)}</h2><p id="result-description">${esc(resultReason())}</p><div class="result-players">${(["sente", "gote"] as Side[]).map(side => `<div class="${result.winner === side ? "winner" : ""}"><span>${side === "sente" ? "▲" : "△"} ${SIDE_NAMES[side]}</span><strong>${result.winner === null ? result.reason === "repetition" ? "指し直し" : "引き分け" : result.winner === side ? "勝ち" : "負け"}</strong></div>`).join("")}</div><div class="result-summary"><span>${esc(tag)}</span><span>${game.moveCount} 手で終局</span></div><div class="result-actions"><button id="result-restart" class="result-primary">もう一局</button><button id="result-export">棋譜を保存</button></div><button id="result-view-board" class="text-button result-view-board">終局した盤面を見る</button></section></div>`;
}
function pieceHTML(p: Piece): string { return `<span class="piece ${pieceLabel(p).length > 1 ? "long-name" : ""} ${p.side === (flipped ? "sente" : "gote") ? "inverted" : ""} ${p.promoted ? "promoted" : ""}"><span>${pieceLabel(p)}</span></span>`; }
function handHTML(side: Side): string {
  const position = game.position, active = position.turn === side && !game.result;
  const top = side === (flipped ? "sente" : "gote");
  const piles = HAND_TYPES.filter(type => position.hands[side][type] > 0).map((type, index) => {
    const count = position.hands[side][type];
    const piece = `<button class="hand-piece owned ${selected === type && active && selectedHandIndex === index ? "selected-hand" : ""}" data-hand="${type}" data-side="${side}" data-hand-index="${index}" ${!active ? "disabled" : ""} aria-label="${SIDE_NAMES[side]}の持ち駒 ${PIECE_NAMES[type]} ${count}枚"><span class="mini-piece ${top ? "inverted" : ""}">${PIECE_LABELS[type]}</span></button>`;
    return `<div class="hand-pile" data-hand-type="${type}">${piece}${count >= 2 ? `<span class="hand-count" aria-hidden="true">${count}</span>` : ""}</div>`;
  }).join("");
  return `<section class="hand-card hand-stand ${top ? "stand-upper-left" : "stand-lower-right"} ${active ? "active-player" : ""}" data-player="${side}" aria-label="${SIDE_NAMES[side]}の持ち駒"><div class="hand-pieces">${piles}</div></section>`;
}
function render() {
  const position = game.position, records = game.records, result = game.result, check = !result && inCheck(position);
  const targets = selected === null || result ? [] : legalMoves(position).filter(m => typeof selected === "number" ? m.from === selected : m.drop === selected);
  const destinations = new Set(targets.map(m => m.to));
  const indices = Array.from({ length: 81 }, (_, i) => flipped ? 80 - i : i), lastMove = records.at(-1)?.move;
  const selectedPiece = typeof selected === "number" ? position.board[selected] : null;
  const selectionName = selectedPiece ? pieceName(selectedPiece) : typeof selected === "string" ? PIECE_NAMES[selected] : "";
  const files = flipped ? "１２３４５６７８９" : "９８７６５４３２１", ranks = flipped ? "九八七六五四三二一" : "一二三四五六七八九";
  $("#app").innerHTML = `<header class="site-header" ${pending.length || resultOpen ? "inert" : ""}><a class="brand" href="/" aria-label="将棋のトップ"><span class="brand-icon">将</span><span>将棋<small>SHOGI / LOCAL PLAY</small></span></a><div class="header-tools"><button id="import" class="text-button">棋譜を開く</button><button id="export" class="text-button">棋譜を保存 ↗</button></div></header><main ${pending.length || resultOpen ? "inert" : ""}><div class="game-meta">${aiControls()}<span class="save-label ${saved ? "" : "unsaved"}"><i></i>${saved ? "対局を自動保存" : "保存できていません"}</span></div><div class="game-layout"><section class="board-section" aria-label="将棋盤"><div class="board-status"><span class="live-mark ${result ? "ended" : ""}"></span><strong>${result ? esc(resultText()) : `${position.turn === "sente" ? "▲" : "△"} ${SIDE_NAMES[position.turn]}の手番`}</strong>${result ? `<button id="show-result" class="text-button result-reopen">結果を見る</button>` : ""}<span class="move-number">${result ? `${records.length} 手で終局` : `${records.length + 1} 手目`}${check ? `<b class="check-label">王手</b>` : ""}</span></div><div class="board-viewport"><div class="board-arena">${handHTML(flipped ? "sente" : "gote")}<div class="board-surround"><div class="file-labels">${[...files].map(x => `<span>${x}</span>`).join("")}</div><div class="board-and-ranks"><div class="board">${indices.map(index => {
    const p = position.board[index], selectedSquare = selected === index, target = destinations.has(index), last = lastMove && (lastMove.to === index || lastMove.from === index), kingChecked = check && p?.type === "K" && p.side === position.turn;
    return `<button class="square ${selectedSquare ? "selected-square" : ""} ${target ? "legal-target" : ""} ${last ? "last-move" : ""} ${kingChecked ? "king-check" : ""}" data-square="${index}" aria-label="${9 - index % 9}筋${Math.floor(index / 9) + 1}段${p ? ` ${SIDE_NAMES[p.side]} ${pieceName(p)}` : " 空きマス"}${target ? " 移動可能" : ""}" ${result ? "disabled" : ""}>${p ? pieceHTML(p) : target ? `<span class="move-dot"></span>` : ""}${target && p ? `<span class="capture-ring"></span>` : ""}</button>`;
  }).join("")}<i class="star s1"></i><i class="star s2"></i><i class="star s3"></i><i class="star s4"></i></div><div class="rank-labels">${[...ranks].map(y => `<span>${y}</span>`).join("")}</div></div></div>${handHTML(flipped ? "gote" : "sente")}</div></div><div class="board-caption"><span><i class="legend-dot"></i>移動できるマス</span><span><i class="legend-square"></i>直前の一手</span><button id="open-history" class="text-button">棋譜を見る</button><button id="flip" class="text-button">↻ 盤面を反転</button></div><div class="instruction"><span class="instruction-icon">${result ? "結" : selectionName || "一"}</span><div><strong>${result ? esc(resultText()) : selected !== null ? `${esc(selectionName)}の${typeof selected === "string" ? "打つ" : "移動する"}場所を選んでください` : "手番の駒を選んでください"}</strong><p>${result ? esc(resultReason()) : selectedPiece ? selectedPiece.promoted ? "成った小駒は金と同じ動き。龍は飛車と斜め1マス、馬は角と縦横1マスに動けます。" : guides[selectedPiece.type] : selected !== null ? "点が表示されたマスに打てます。もう一度持ち駒を押すと選択を解除します。" : "駒をクリックすると、移動できるマスに印が付きます。"}</p></div></div></section><aside class="record-column"><section class="record-card ${historyOpen ? "history-open" : ""}" ${historyOpen ? 'role="dialog" aria-modal="true" aria-label="棋譜"' : ""}><div class="record-heading"><div><span class="eyebrow">MOVE RECORD</span><h2>これまでの一手</h2></div><span class="record-count">${records.length} 手</span><button id="close-history" class="text-button" aria-label="棋譜を閉じる">閉じる ×</button></div><div class="record-list" aria-live="polite">${records.length ? records.map((r, i) => `<div class="record-row ${i === records.length - 1 ? "latest" : ""}"><span>${String(i + 1).padStart(2, "0")}</span><strong>${esc(r.notation)}</strong><small>${r.check ? "王手" : ""}</small></div>`).join("") : `<div class="empty-record"><span>歩</span><h3>まだ、まっさらな盤面。</h3><p>先手から一手、指してみましょう。<br>ここに棋譜が積み重なります。</p></div>`}</div><div class="record-footer"><span>${result ? "対局終了" : "平手・時間制限なし"}</span><span>先手 ▲ / 後手 △</span></div></section><div class="game-controls"><button id="undo" ${!records.length && !result ? "disabled" : ""}>↶ 一手戻す</button><button id="restart">新しく始める</button><button id="resign" class="quiet" ${result || aiBusy || (aiRunning && isAITurn()) ? "disabled" : ""}>投了する</button><button id="draw" class="quiet" ${result ? "disabled" : ""}>合意で引き分け</button></div><details class="help"><summary>はじめての方へ <span>＋</span></summary><p>先手は上、後手は下へ進みます。相手の駒を取ると持ち駒になり、次の手番から盤面へ打てます。</p><p>敵陣の3段以内に入る・出る・中で動くとき、駒によっては「成る」を選べます。</p><p>王手を受けたら解消する手を指します。相手の王を逃げられなくすると勝ちです。</p><p>二歩・打ち歩詰め・王手放置など、指せない手は選択肢に表示しません。</p></details></aside></div></main><footer ${pending.length || resultOpen ? "inert" : ""}>将棋からはじまる、自分だけの遊び。<span>LOCAL TWO-PLAYER SHOGI</span></footer>${historyOpen ? `<button id="history-backdrop" class="history-backdrop" aria-label="棋譜を閉じる" tabindex="-1"></button>` : ""}<input id="file-input" type="file" accept=".json,application/json" hidden>${pending.length ? promotionDialog() : ""}${resultOpen ? resultDialog() : ""}`;
  const list = $(".record-list"); if (list) list.scrollTop = list.scrollHeight;
  if (resultOpen) $("#result-view-board").focus();
}
function promotionDialog() {
  const p = game.position.board[pending[0].from!]!;
  return `<div class="modal-backdrop"><section class="promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title"><span class="eyebrow">PROMOTION</span><h2 id="promotion-title">${PIECE_NAMES[p.type]}を成りますか？</h2><p>成ると、駒の動きが変わります。</p><div class="promotion-options"><button data-promote="yes">${pieceHTML({ ...p, promoted: true })}<strong>成る</strong></button><button data-promote="no">${pieceHTML(p)}<strong>成らない</strong></button></div><button id="cancel-promotion" class="text-button">戻る</button></section></div>`;
}
// Latch stop on press so a render between pointerdown and click cannot lose it.
document.addEventListener("pointerdown", e => {
  if (!e.isPrimary || e.button !== 0 || resultOpen || pending.length) return;
  const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (b?.id === "ai-toggle" && !b.disabled && b.dataset.aiAction === "stop") requestAIStop();
});
document.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null; if (!b || b.disabled) return;
  if (resultOpen && !["result-close", "result-view-board", "result-restart", "result-export"].includes(b.id)) return;
  if (pending.length && !b.dataset.promote && b.id !== "cancel-promotion") return;
  try {
    if (b.dataset.square !== undefined) {
      if (pending.length || game.result) return;
      if (aiBusy || (aiRunning && isAITurn())) { notify("AI の手番です。操作する場合は停止を押してください。"); return; }
      const to = Number(b.dataset.square), position = game.position, p = position.board[to];
      if (selected !== null) {
        const moves = legalMoves(position).filter(m => m.to === to && (typeof selected === "number" ? m.from === selected : m.drop === selected));
        if (moves.length === 1) return execute(moves[0]);
        if (moves.length > 1) { pending = moves; render(); $("[data-promote='yes']").focus(); return; }
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
    else if (b.dataset.promote) { const move = pending.find(m => m.promote === (b.dataset.promote === "yes")); if (move) execute(move); }
    else switch (b.id) {
      case "cancel-promotion": pending = []; render(); break;
      case "undo": stopAI(); game.undo(); selected = null; pending = []; resultOpen = false; resultAnimate = false; persist(); render(); break;
      case "result-close": case "result-view-board": dismissResult(); break;
      case "show-result": presentResult(false); render(); break;
      case "result-restart": restartGame(); break;
      case "ai-step": stopAI(); requestAIMove(); break;
      case "ai-toggle":
        // The original stop button may receive its click after the AI has stopped.
        if (b.dataset.aiAction === "stop" || aiRunning || aiBusy) requestAIStop();
        else { aiRunning = true; aiStartPly = game.moveCount; render(); scheduleAI(); }
        break;
      case "flip": flipped = !flipped; persist(); render(); break;
      case "open-history": historyOpen = true; render(); $("#close-history").focus(); break;
      case "close-history": case "history-backdrop": historyOpen = false; render(); $("#open-history").focus(); break;
      case "restart": if ((!game.moveCount && !game.result) || confirm("対局を初期配置に戻しますか？残しておきたい場合は、先に棋譜を保存してください。")) restartGame(); break;
      case "resign": if (confirm(`${SIDE_NAMES[game.position.turn]}が投了しますか？`)) { game.resign(); presentResult(); persist(); render(); } break;
      case "draw": if (confirm("先手・後手の両者が引き分けに同意していますか？")) { game.agreeDraw(); presentResult(); persist(); render(); } break;
      case "result-export": case "export": { const url = URL.createObjectURL(new Blob([JSON.stringify(game.save(), null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `shogi-${game.moveCount}moves.json`; a.click(); URL.revokeObjectURL(url); notify("棋譜を JSON ファイルに保存しました"); break; }
      case "import": $("#file-input").click(); break;
    }
  } catch (error) { notify((error as Error).message); }
});
document.addEventListener("keydown", e => {
  const key = e as KeyboardEvent;
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
document.addEventListener("change", async e => {
  const input = e.target as HTMLInputElement;
  if (input.id === "ai-mode" && ["human", "sente", "gote", "both"].includes(input.value)) {
    stopAI(); aiMode = input.value as AIMode; selected = null; selectedHandIndex = -1; aiRunning = !game.result && (aiMode === "sente" || aiMode === "gote"); aiStartPly = game.moveCount; persist(); render(); scheduleAI(); return;
  }
  if (input.id === "ai-strength" && ["fast", "standard"].includes(input.value)) {
    const resume = aiRunning; stopAI(); aiStrength = input.value as AIStrength; aiRunning = resume; persist(); render(); scheduleAI(); return;
  }
  if (input.id !== "file-input" || !input.files?.[0]) return;
  try { const next = ShogiGame.load(JSON.parse(await input.files[0].text())); if ((!game.moveCount && !game.result) || confirm("読み込んだ棋譜に切り替えますか？現在の対局は置き換わります。")) { stopAI(); game = next; selected = null; pending = []; historyOpen = false; resultOpen = game.result !== null; resultAnimate = false; persist(); render(); notify("棋譜を読み込みました"); } }
  catch (error) { notify(`読み込めませんでした：${(error as Error).message}`); }
  input.value = "";
});
render(); if (loadWarning) notify(loadWarning);
