import { canPromote, pieceState, movementOffsetLabel, MAX_PIECE_OFFSET, PIECE_TYPES, loadPieceRules, updatePieceMovements, updateSharedPieceMovements, pieceActionsSeparate, setPieceActionsSeparate, resetPieceMovements, pieceTypes, pieceTypeLabel, pieceDefinition, isBuiltinPiece, addCustomPiece, updateCustomPiece, pieceDesign, updatePieceDesign, resetPieceDesign, MAX_CUSTOM_PIECES, MAX_PIECE_NAME_LENGTH } from "./pieces";
import type { PieceType, PieceRules, PieceAction, PieceMovement } from "./pieces";
import { renderPiece } from "./pieceview";
import { updatePieceScript } from "./pieces";

const esc = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
interface PieceEditorControl { id: string; dataset?: Record<string, string | undefined>; value?: string; checked?: boolean }
export interface PieceEditorUpdate { render: boolean; focus?: string }
export interface PieceEditorView {
  piece: PieceType; promoted: boolean; action: PieceAction; rules: PieceRules;
  dx: number; dy: number; range: number | null; canUndo: boolean; changed: boolean;
  displayRadius: number;
  section: "movement" | "design";
  separateCapture: boolean;
}

/** A settings draft independent of the board, with its own selection and undo history. */
export class PieceEditor {
  private rules: PieceRules;
  private initialRules: string;
  private history: PieceRules[] = [];
  private piece: PieceType;
  private promoted: boolean;
  private action: PieceAction = "moves";
  private dx = 0;
  private dy = 1;
  private range: number | null = 1;
  private displayRadius = 2;
  private section: "movement" | "design" = "movement";
  constructor(rules: PieceRules = {}, piece: PieceType = "P", promoted = false) {
    this.rules = loadPieceRules(rules); this.initialRules = JSON.stringify(this.rules);
    this.piece = piece; this.promoted = promoted && canPromote(piece, this.rules);
  }
  get pieceRules(): PieceRules { return structuredClone(this.rules); }
  setPieceScript(source: string): void { this.commit(updatePieceScript(this.rules, this.piece, source)); }
  private get separateCapture(): boolean { return pieceActionsSeparate(this.piece, this.promoted, this.rules); }
  private get currentAction(): PieceAction { return this.separateCapture ? this.action : "moves"; }
  get view(): PieceEditorView { return { piece: this.piece, promoted: this.promoted, action: this.currentAction, separateCapture: this.separateCapture, rules: this.pieceRules, dx: this.dx, dy: this.dy, range: this.range, displayRadius: this.displayRadius, section: this.section, canUndo: this.history.length > 0, changed: JSON.stringify(this.rules) !== this.initialRules }; }
  private commit(rules: PieceRules): void {
    if (JSON.stringify(rules) === JSON.stringify(this.rules)) return;
    this.history.push(this.rules); if (this.history.length > 100) this.history.shift();
    this.rules = rules;
  }
  private setMovements(action: PieceAction, movements: readonly PieceMovement[]): void {
    this.commit(this.separateCapture
      ? updatePieceMovements(setPieceActionsSeparate(this.rules, this.piece, this.promoted, true), this.piece, this.promoted, action, movements)
      : updateSharedPieceMovements(this.rules, this.piece, this.promoted, movements));
  }
  handleClick(control: PieceEditorControl): PieceEditorUpdate | null {
    const data = control.dataset ?? {}, action = this.currentAction, movements = pieceState({ type: this.piece, promoted: this.promoted }, this.rules)[action];
    let focus = "#piece-editor-title";
    if (control.id === "piece-editor-add" || control.id === "piece-editor-copy") {
      const added = addCustomPiece(this.rules, control.id === "piece-editor-copy" ? this.piece : undefined);
      this.commit(added.rules); this.piece = added.type; this.promoted = false;
      focus = "#piece-name";
    } else if (data.pieceSection === "movement" || data.pieceSection === "design") {
      this.section = data.pieceSection; focus = `[data-piece-section="${this.section}"]`;
    } else if (data.designReset === "sente" || data.designReset === "gote") {
      this.commit(resetPieceDesign(this.rules, this.piece, this.promoted, data.designReset)); focus = `[data-design-reset="${data.designReset}"]`;
    } else if (data.designCopy === "sente" || data.designCopy === "gote") {
      const side = data.designCopy, other = side === "sente" ? "gote" : "sente";
      this.commit(updatePieceDesign(this.rules, this.piece, this.promoted, other, pieceDesign({ type: this.piece, promoted: this.promoted, side }, this.rules))); focus = `[data-design-copy="${side}"]`;
    } else if (control.id === "piece-grid-shrink") {
      this.displayRadius = Math.max(1, this.displayRadius - 1);
      focus = this.displayRadius === 1 ? "#piece-grid-size" : "#piece-grid-shrink";
    } else if (control.id === "piece-grid-expand") {
      this.displayRadius = Math.min(MAX_PIECE_OFFSET, this.displayRadius + 1);
      focus = this.displayRadius === MAX_PIECE_OFFSET ? "#piece-grid-size" : "#piece-grid-expand";
    } else if (control.id === "piece-grid-fit") {
      this.displayRadius = Math.max(1, ...movements.map(move => Math.max(Math.abs(move.dx), Math.abs(move.dy))));
      focus = "#piece-grid-fit";
    } else if (data.rulePiece && pieceTypes(this.rules).includes(data.rulePiece as PieceType)) {
      this.piece = data.rulePiece as PieceType;
      this.promoted = this.promoted && canPromote(this.piece, this.rules); focus = `[data-rule-piece="${this.piece}"]`;
    } else if (data.ruleAction === "moves" || data.ruleAction === "captures") {
      if (!this.separateCapture) return { render: false };
      this.action = data.ruleAction; focus = `[data-rule-action="${this.action}"]`;
    } else if (data.rulePromoted === "false" || data.rulePromoted === "true") {
      if (data.rulePromoted === "true" && !canPromote(this.piece, this.rules)) return { render: false };
      this.promoted = data.rulePromoted === "true"; focus = `[data-rule-promoted="${this.promoted}"]`;
    } else if (data.ruleOffset !== undefined) {
      const [dx, dy] = data.ruleOffset.split(",").map(Number), exists = movements.some(move => move.dx === dx && move.dy === dy);
      this.setMovements(action, exists ? movements.filter(move => move.dx !== dx || move.dy !== dy) : [...movements, { dx, dy, range: this.range }]);
      focus = `[data-rule-offset="${dx},${dy}"]`;
    } else if (data.ruleRemove !== undefined) {
      const removed = Number(data.ruleRemove);
      this.setMovements(action, movements.filter((_, index) => index !== removed));
      focus = movements.length > 1 ? `[data-rule-remove="${Math.min(removed, movements.length - 2)}"]` : "#piece-rule-clear";
    } else if (control.id === "piece-rule-add") {
      const move = { dx: this.dx, dy: this.dy, range: this.range }, index = movements.findIndex(item => item.dx === move.dx && item.dy === move.dy);
      this.setMovements(action, index < 0 ? [...movements, move] : movements.map((item, i) => i === index ? move : item)); focus = "#piece-rule-add";
    } else if (control.id === "piece-rule-clear") {
      this.setMovements(action, []); focus = "#piece-rule-clear";
    } else if (control.id === "piece-rule-copy") {
      if (!this.separateCapture) return { render: false };
      this.setMovements(action === "moves" ? "captures" : "moves", movements); focus = "#piece-rule-copy";
    } else if (control.id === "piece-rule-reset") {
      this.commit(resetPieceMovements(this.rules, this.piece, this.promoted)); focus = "#piece-rule-reset";
    } else if (control.id === "piece-editor-undo") {
      const previous = this.history.pop(); if (previous) this.rules = previous;
      if (!pieceTypes(this.rules).includes(this.piece)) this.piece = "P";
      this.promoted = this.promoted && canPromote(this.piece, this.rules);
    } else return null;
    return { render: true, focus };
  }
  handleChange(control: PieceEditorControl): PieceEditorUpdate | null {
    const data = control.dataset ?? {};
    if (control.id === "piece-rule-separate") {
      this.commit(setPieceActionsSeparate(this.rules, this.piece, this.promoted, control.checked === true));
      if (!this.separateCapture) this.action = "moves";
      return { render: true, focus: "#piece-rule-separate" };
    }
    if (control.id === "piece-name" || control.id === "piece-promotion") {
      this.commit(updateCustomPiece(this.rules, this.piece, control.id === "piece-name" ? { name: control.value } : { canPromote: control.checked === true }));
      this.promoted = this.promoted && canPromote(this.piece, this.rules);
      return { render: true, focus: `#${control.id}` };
    }
    if ((data.designSide === "sente" || data.designSide === "gote") && ["text", "fill", "color", "shape"].includes(data.designField ?? "")) {
      const current = pieceDesign({ type: this.piece, promoted: this.promoted, side: data.designSide }, this.rules);
      this.commit(updatePieceDesign(this.rules, this.piece, this.promoted, data.designSide, { ...current, [data.designField!]: control.value }));
      return { render: true, focus: `[data-design-side="${data.designSide}"][data-design-field="${data.designField}"]` };
    }
    if (control.id === "piece-rule-dx") { this.dx = Number(control.value); return { render: false }; }
    if (control.id === "piece-rule-dy") { this.dy = Number(control.value); return { render: false }; }
    if (control.id === "piece-rule-range") { this.range = control.value === "edge" ? null : Number(control.value); return { render: false }; }
    if (control.dataset?.ruleRange === undefined) return null;
    const index = Number(control.dataset.ruleRange), range = control.value === "edge" ? null : Number(control.value);
    const action = this.currentAction, movements = pieceState({ type: this.piece, promoted: this.promoted }, this.rules)[action];
    if (!movements[index]) throw new Error("変更する動きが見つかりません");
    this.setMovements(action, movements.map((move, i) => i === index ? { ...move, range } : move));
    return { render: true, focus: `[data-rule-range="${index}"]` };
  }
  render(): string { return renderPieceEditor(this.view); }
}

function rangeOptions(value: number | null): string {
  return Array.from({ length: MAX_PIECE_OFFSET }, (_, index) => `<option value="${index + 1}" ${value === index + 1 ? "selected" : ""}>${index + 1}回</option>`).join("") + `<option value="edge" ${value === null ? "selected" : ""}>盤端まで</option>`;
}
function renderMovementGrid(view: PieceEditorView): string {
  const state = pieceState({ type: view.piece, promoted: view.promoted }, view.rules), movements = state[view.action], actionName = !view.separateCapture ? "移動・駒取り" : view.action === "moves" ? "移動" : "駒取り";
  const radius = view.displayRadius, size = radius * 2 + 1;
  const outside = movements.filter(move => Math.abs(move.dx) > radius || Math.abs(move.dy) > radius).length;
  const squares = Array.from({ length: size * size }, (_, index) => {
    const dx = index % size - radius, dy = radius - Math.floor(index / size);
    if (!dx && !dy) return `<span class="piece-rule-origin" aria-label="現在のマス">${renderPiece({ type: view.piece, side: "sente", promoted: view.promoted }, view.rules, { compact: true })}</span>`;
    const move = movements.find(move => move.dx === dx && move.dy === dy), name = movementOffsetLabel({ dx, dy });
    return `<button data-rule-offset="${dx},${dy}" aria-pressed="${!!move}" aria-label="${esc(name)}の${actionName}を${move ? "外す" : "追加"}" title="${esc(name)}">${move ? `<span>●</span><small>${move.range === null ? "∞" : move.range}</small>` : "＋"}</button>`;
  }).join("");
  return `<section class="piece-editor-card piece-editor-canvas" aria-labelledby="piece-grid-title"><h2 id="piece-grid-title">${actionName}の方向・間隔</h2><p>マスを押して動きを追加・解除します。${view.separateCapture ? "空いているマスへの移動と、相手の駒を取る動きを別々に設定しています。" : "空いているマスへの移動と、相手の駒を取る動きに共通で適用します。"}</p>
    <div class="piece-grid-controls" role="group" aria-label="図の表示範囲"><span>表示範囲</span><div class="piece-grid-size-controls"><button id="piece-grid-shrink" aria-label="表示範囲を狭くする" ${radius === 1 ? "disabled" : ""}>−</button><span id="piece-grid-size" tabindex="-1" aria-live="polite">${size}×${size}</span><button id="piece-grid-expand" aria-label="表示範囲を広くする" ${radius === MAX_PIECE_OFFSET ? "disabled" : ""}>＋</button></div><button id="piece-grid-fit" title="選択中の駒・状態・動作の設定がすべて図に収まる範囲に調整">自動調整</button></div>
    <p class="piece-grid-outside ${outside ? "has-hidden" : ""}" role="status">${outside ? `範囲外に${outside}件の設定があります。縮小しても設定は保持されます。` : "すべての設定を図の範囲内に表示しています。"}</p>
    <div class="piece-rule-forward" aria-hidden="true">前方 ↑</div><div class="piece-rule-grid-viewport" data-grid-size="${size}" role="region" aria-label="${esc(state.label)}の${actionName}の図" tabindex="0"><div class="piece-rule-grid" style="--piece-grid-size:${size}" role="group" aria-label="${esc(state.label)}の${actionName}先">${squares}</div></div><p>表示範囲を変えても、駒の動きや進む回数は変わりません。大きい図はスクロールして確認できます。</p><p>図は先手の向きです。後手は前後が反転します。離れたマスへの移動は途中の駒を飛び越えます。</p></section>`;
}
function renderMovementSettings(view: PieceEditorView): string {
  const state = pieceState({ type: view.piece, promoted: view.promoted }, view.rules), movements = state[view.action], actionName = !view.separateCapture ? "移動・駒取り" : view.action === "moves" ? "移動" : "駒取り";
  const offsets = (value: number, positive: string, negative: string) => Array.from({ length: MAX_PIECE_OFFSET * 2 + 1 }, (_, index) => {
    const offset = index - MAX_PIECE_OFFSET;
    return `<option value="${offset}" ${value === offset ? "selected" : ""}>${offset === 0 ? "0" : `${offset > 0 ? positive : negative}${Math.abs(offset)}`}</option>`;
  }).join("");
  return `<section class="piece-editor-card piece-editor-settings" aria-labelledby="piece-settings-title"><h2 id="piece-settings-title">${actionName}の詳細</h2><p>${!view.separateCapture ? "移動と駒取りに同じ設定を使います。王手の判定にも使います。" : view.action === "moves" ? "空いているマスへ進む動きです。" : "相手の駒を取る動きです。王手の判定にも使います。"}</p>
    <ul class="piece-rule-list" aria-label="${actionName}の設定">${movements.length ? movements.map((move, index) => `<li><span>${esc(movementOffsetLabel(move))}</span><select data-rule-range="${index}" aria-label="${esc(movementOffsetLabel(move))}の${actionName}回数">${rangeOptions(move.range)}</select><button data-rule-remove="${index}" aria-label="${esc(movementOffsetLabel(move))}の${actionName}を削除">×</button></li>`).join("") : `<li class="piece-rule-empty">${actionName}できる方向がありません。</li>`}</ul>
    <p>回数は指定した方向・間隔で進める上限です。途中の駒にぶつかると止まります。</p><h3>動きを追加</h3>
    <div class="piece-rule-add"><label>横<select id="piece-rule-dx">${offsets(view.dx, "右", "左")}</select></label><label>縦<select id="piece-rule-dy">${offsets(view.dy, "前", "後")}</select></label><label>回数<select id="piece-rule-range">${rangeOptions(view.range)}</select></label><button id="piece-rule-add">追加・更新</button></div><p>図の外の移動先も、横・縦の指定で追加できます。</p>
    <div class="piece-rule-tools">${view.separateCapture ? `<button id="piece-rule-copy">${actionName}を${view.action === "moves" ? "駒取り" : "移動"}にコピー</button>` : ""}<button id="piece-rule-clear">${actionName}を空にする</button><button id="piece-rule-reset">この状態を標準に戻す</button></div></section>`;
}
function renderDesignSettings(view: PieceEditorView): string {
  return (["sente", "gote"] as const).map(side => {
    const design = pieceDesign({ type: view.piece, side, promoted: view.promoted }, view.rules), name = side === "sente" ? "先手" : "後手";
    return `<section class="piece-editor-card piece-design-card"><h2>${name}のデザイン</h2><div class="piece-design-preview" data-design-preview="${side}" aria-label="${name}のプレビュー">${renderPiece({ type: view.piece, side, promoted: view.promoted }, view.rules, { inverted: side === "gote" })}</div><div class="piece-design-fields"><label>表示文字<input data-design-side="${side}" data-design-field="text" maxlength="6" value="${esc(design.text)}" aria-label="${name}の表示文字"></label><label>駒の色<input type="color" data-design-side="${side}" data-design-field="fill" value="${design.fill}" aria-label="${name}の駒の色"></label><label>文字の色<input type="color" data-design-side="${side}" data-design-field="color" value="${design.color}" aria-label="${name}の文字の色"></label><label>形<select data-design-side="${side}" data-design-field="shape" aria-label="${name}の形">${([['shogi','将棋型'],['circle','丸'],['square','四角']] as const).map(([value,label]) => `<option value="${value}" ${design.shape === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div class="piece-rule-tools"><button data-design-copy="${side}">もう一方のデザインにコピー</button><button data-design-reset="${side}">${name}のデザインを標準に戻す</button></div><p>通常と成り後、先手と後手の見た目をそれぞれ設定できます。駒を取ると、取った側のデザインに変わります。</p></section>`;
  }).join("");
}
export function renderPieceEditor(view: PieceEditorView): string {
  const state = pieceState({ type: view.piece, promoted: view.promoted }, view.rules);
  return `<header class="site-header piece-editor-header"><div class="brand"><span class="brand-icon">駒</span><span>駒の設定<small>PIECE EDITOR</small></span></div><div class="header-tools"><button id="piece-editor-cancel" class="text-button">変更せず戻る</button><button id="piece-editor-back" class="editor-primary">設定を反映して戻る</button></div></header>
    <main class="piece-editor-main" aria-labelledby="piece-editor-title"><div class="piece-editor-intro"><span>盤面編集 / 駒の設定</span><p>設定を反映して盤面編集へ戻り、配置と一緒に保存できます。</p></div><div class="piece-editor-layout">
    <aside class="piece-editor-library" aria-label="編集する駒"><h2>駒一覧</h2><div class="piece-library-tools"><button id="piece-editor-add" ${pieceTypes(view.rules).length - PIECE_TYPES.length >= MAX_CUSTOM_PIECES ? "disabled" : ""}>＋ 駒を追加</button><button id="piece-editor-copy" ${pieceTypes(view.rules).length - PIECE_TYPES.length >= MAX_CUSTOM_PIECES ? "disabled" : ""}>選択中の駒をコピー</button></div><div class="piece-editor-piece-list">${pieceTypes(view.rules).map(type => `<button data-rule-piece="${type}" aria-pressed="${view.piece === type}"><strong>${esc(pieceTypeLabel(type, view.rules))}</strong><small>${view.rules[type] ? "設定あり" : "標準"}</small></button>`).join("")}</div></aside>
    <div class="piece-editor-workspace"><section class="piece-editor-card piece-editor-selection"><div class="piece-editor-title-row"><div><span class="menu-eyebrow">MOVEMENT</span><h1 id="piece-editor-title" tabindex="-1">${esc(pieceTypeLabel(view.piece, view.rules))}${view.promoted ? "（成り後）" : ""}の設定</h1></div><button id="piece-editor-undo" ${view.canUndo ? "" : "disabled"}>↶ 一つ戻す</button></div><p>同じ種類の駒すべてに適用します。通常と成り後は別々に設定できます。<span class="piece-editor-draft-status" role="status">${view.changed ? "反映前の変更があります" : "変更はありません"}</span></p>
    ${!isBuiltinPiece(view.piece) ? `<div class="piece-basic-fields"><label>駒の名前<input id="piece-name" maxlength="${MAX_PIECE_NAME_LENGTH}" value="${esc(pieceDefinition(view.piece, view.rules).name)}"></label><label class="piece-promotion-option"><input id="piece-promotion" type="checkbox" ${canPromote(view.piece, view.rules) ? "checked" : ""}>成り後を設定する</label></div>` : ""}<div class="piece-editor-categories"><button data-piece-section="movement" aria-pressed="${view.section === "movement"}">動き</button><button data-piece-section="design" aria-pressed="${view.section === "design"}">デザイン</button><button id="piece-editor-open-script">この駒のルールコード${view.rules[view.piece]?.script ? " ●" : ""}</button></div>
    <div class="piece-editor-switches"><div class="piece-rule-tabs" aria-label="編集する駒の状態"><button data-rule-promoted="false" aria-pressed="${!view.promoted}">通常</button><button data-rule-promoted="true" aria-pressed="${view.promoted}" ${canPromote(view.piece, view.rules) ? "" : "disabled"}>成り後</button></div>
    ${view.section === "movement" ? `<div class="piece-actions-mode"><label><input id="piece-rule-separate" type="checkbox" ${view.separateCapture ? "checked" : ""} aria-describedby="piece-actions-hint">移動と駒取りを別々に設定する</label><p id="piece-actions-hint">${view.separateCapture ? "共通に戻すと「移動」の設定を駒取りにも適用します。取り消しで元に戻せます。" : "方向・間隔・回数の変更を、移動と駒取りの両方に反映します。"}</p>${view.separateCapture ? `<div class="piece-rule-tabs" aria-label="編集する動作"><button data-rule-action="moves" aria-pressed="${view.action === "moves"}">移動</button><button data-rule-action="captures" aria-pressed="${view.action === "captures"}">駒取り</button></div>` : ""}</div>` : ""}</div></section>
    ${view.section === "design" ? renderDesignSettings(view) : renderMovementGrid(view) + renderMovementSettings(view)}</div></div></main>`;
}
