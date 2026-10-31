import { SCRIPT_EXAMPLES, PIECE_SCRIPT_EXAMPLES, SCRIPT_HOOKS, PIECE_SCRIPT_HOOKS, MAX_SCRIPT_LENGTH, loadRuleScript, validateRuleScript } from "./rulescript";
import { ShogiGame, legalActionIterator } from "./shogi";
import type { Position } from "./shogi";
import { updatePieceScript, pieceTypeLabel, hasRuleScripts } from "./pieces";
import type { PieceRules, PieceType } from "./pieces";
import { escapePieceText as esc } from "./pieceview";

/** Code stays in a private draft until applied to board-editor history. */
export class ScriptEditor {
  source: string;
  status = "コードを編集し、「実行確認」で現在の配置に対して検証できます。";
  error = false;
  private history: string[] = [];
  private future: string[] = [];
  get canUndo(): boolean { return this.history.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  constructor(source: string, private position: Position, private rules: PieceRules, readonly scope?: { piece: PieceType; boardScript: string }) { this.source = source; }
  setSource(source: string): void { if (source !== this.source) { this.history.push(this.source); if (this.history.length > 100) this.history.shift(); this.future = []; this.source = source; } this.error = false; this.status = "未検証の変更があります。"; }
  undo(): void { const source = this.history.pop(); if (source !== undefined) { this.future.push(this.source); this.source = source; this.error = false; this.status = "未検証の変更があります。"; } }
  redo(): void { const source = this.future.pop(); if (source !== undefined) { this.history.push(this.source); this.source = source; this.error = false; this.status = "未検証の変更があります。"; } }
  get configuration(): { rules: PieceRules; boardScript: string } { const source = loadRuleScript(this.source); return { rules: this.scope ? updatePieceScript(this.rules, this.scope.piece, source) : this.rules, boardScript: this.scope ? this.scope.boardScript : source }; }
  useExample(key: string): void { const example = (this.scope ? PIECE_SCRIPT_EXAMPLES : SCRIPT_EXAMPLES)[key]; if (example) this.setSource(example.source); }
  verify(): boolean {
    try {
      const source = loadRuleScript(this.source), rules = this.scope ? updatePieceScript(this.rules, this.scope.piece, source) : this.rules;
      const boardScript = this.scope ? this.scope.boardScript : source;
      validateRuleScript(boardScript, rules);
      if (!hasRuleScripts(boardScript, rules)) { this.status = "追加ルールは無効です。通常の対局ルールを使用します。"; this.error = false; return true; }
      const game = new ShogiGame(this.position, { pieceRules: rules, ruleScript: boardScript });
      let actions = 0;
      for (const _move of legalActionIterator(game.position, game.passesRemaining, rules, boardScript)) { if (++actions >= 64) break; }
      // Passing must also be checked when a large board reaches the move-preview limit first.
      game.passMoves;
      this.status = `構文・開始時の処理・合法な行動${actions}件${actions === 64 ? "まで" : ""}を実行確認しました。効果は対局開始後に適用されます。`;
      this.error = false; return true;
    } catch (error) { this.status = (error as Error).message; this.error = true; return false; }
  }
  render(): string {
    const piece = this.scope?.piece, title = piece ? `${pieceTypeLabel(piece, this.rules)}のルールコード` : "盤面のルールコード";
    const examples = piece ? PIECE_SCRIPT_EXAMPLES : SCRIPT_EXAMPLES, hooks = piece ? PIECE_SCRIPT_HOOKS : SCRIPT_HOOKS;
    return `<header class="site-header"><div class="brand"><span class="brand-icon">式</span><span>${esc(title)}<small>RULE SCRIPT</small></span></div><div class="header-tools"><button id="script-editor-cancel" class="text-button">変更せず戻る</button><button id="script-editor-back" class="editor-primary">設定を反映して戻る</button></div></header>
      <main class="script-editor-main"><div class="script-editor-heading"><div><span class="menu-eyebrow">${piece ? "駒の設定 / ルールコード" : "盤面編集 / ルールコード"}</span><h1 id="script-editor-title" tabindex="-1">${esc(title)}</h1></div><p>${piece ? "同じ種類の駒すべてに適用します。通常・成り後はctx.self.promotedで区別できます。" : "勝利・敗北条件や盤面全体のルールを設定します。駒ごとのコードと組み合わせて使えます。"}</p><span id="editor-draft-status" class="draft-status"></span></div>
      <div class="script-editor-layout"><section class="script-code-panel" aria-label="コード編集"><div class="script-code-toolbar"><label for="rule-script-source">${piece ? `piece-${esc(piece)}.js` : "board-rule.js"}</label><button id="script-editor-undo" ${this.canUndo ? "" : "disabled"}>↶ 戻す</button><button id="script-editor-redo" ${this.canRedo ? "" : "disabled"}>↷ やり直す</button><button id="editor-test-start">このコードでテスト</button><button id="script-editor-verify">実行確認（Ctrl+Enter）</button><button id="script-editor-disable">${piece ? "この駒のコードを無効にする" : "盤面のコードを無効にする"}</button></div><textarea id="rule-script-source" spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="${MAX_SCRIPT_LENGTH}" aria-describedby="script-editor-status" placeholder="export default { afterMove(ctx) { } };">${esc(this.source)}</textarea><p id="script-editor-status" tabindex="-1" class="script-editor-status ${this.error ? "has-error" : ""}" role="status">${esc(this.status)}</p></section>
      <aside class="script-help-panel"><section><h2>サンプルを読み込む</h2><p>コード欄を置き換えます。盤面への反映前に内容を編集できます。</p><div class="script-examples">${Object.entries(examples).map(([key, example]) => `<button data-script-example="${key}">${esc(example.name)}</button>`).join("")}</div></section>
      <section><h2>書き方と実行順序</h2><p><code>export default { イベント名(ctx) { … } }</code> の形式で、同期関数を記述します。if・for・関数・配列・オブジェクトなどJavaScriptの構文を利用できます。</p><p>開始時：onStart → turnStart。各手：validateMove → beforeMove → 捕獲・移動 → afterCapture → afterCaptured → afterMove → turnEnd → 次の側のturnStart → checkResult → 王手・勝敗判定。効果が追加したイベントは順に処理します。</p><details><summary>イベント一覧</summary><code>${hooks.join("<br>")}</code><p>validateMove で false を返すか、ctx.reject("理由") で、その手を禁止できます。</p></details></section>
      ${piece ? `<section><h2>この駒の発動対象</h2><p>ctx.self がコードを持つ駒です。square・side・type・promoted・data・aliveを参照できます。ctx.actor はイベントを起こした駒です。</p><p>afterCaptureはこの駒が取った後、afterCapturedはこの駒が取られた後、afterDestroyはこの駒が破壊された後に発動します。取り除かれた駒でもctx.selfに当時の情報が残ります。</p><p>turnStart・turnEndは、この駒の持ち主の手番に1回ずつ発動します。onStartは各駒の初期化に使います。各イベントでは盤面コード、対象の駒コードの順に処理し、効果と連鎖の解決後に盤面のcheckResultで勝敗を判定します。</p><p>各駒の状態はctx.setPieceData(ctx.self.square, データ)で保存します。ctx.stateは盤面・全駒で共有するデータです。先手・後手や通常・成り後の条件もコードで指定できます。</p></section>` : `<section><h2>盤面の勝利・敗北条件</h2><p>checkResultで盤面と独自データを調べ、ctx.win("sente")・ctx.win("gote")・ctx.draw()で結果を設定できます。駒のコードによる効果が解決してから呼び出します。</p></section>`}<section><h2>盤面とイベント</h2><p><code>ctx.event.from / to / captured / automatic</code><br><code>ctx.actor.type / side</code><br><code>ctx.side / turn / ply</code></p><p>マス番号は左上の0から横へ並びます。通常の移動と自動移動は ctx.event.automatic で区別できます。</p><details><summary>参照・操作API</summary><dl>
      <dt>ctx.board.at(マス)</dt><dd>駒またはnull。参照用のコピーです。</dd><dt>ctx.board.pieces(先後?)</dt><dd>{ square, piece } の配列。</dd><dt>ctx.board.neighbors(マス, 範囲=1)</dt><dd>周囲のマスと駒の配列。</dd><dt>ctx.board.forward(マス, 先後, 歩数=1)</dt><dd>前方のマス番号。場外はnull。</dd><dt>ctx.move(元, 先)</dt><dd>空きマスに自動移動。</dd><dt>ctx.capture(元, 先)</dt><dd>自動移動し、相手がいれば捕獲。</dd><dt>ctx.destroy(マス)</dt><dd>持ち駒にせず除去。afterDestroyが発生。</dd><dt>ctx.discardCapture()</dt><dd>afterCapture / afterCapturedで、捕獲した駒を持ち駒から除外。</dd><dt>ctx.spawn(マス, 種類, 先後, 成り=false)</dt><dd>空きマスに駒を生成。</dd><dt>ctx.transform(マス, 種類, 成り=false)</dt><dd>種類を変更。先後・独自データを引き継ぎます。</dd><dt>ctx.choose(見出し, 候補配列)</dt><dd>選択された文字列。候補は文字列、または{value,label}。</dd><dt>ctx.choosePiece(マス, 種類配列, 見出し?)</dt><dd>変身先を選択。対局中の選択とAIの探索に対応。</dd><dt>ctx.state</dt><dd>対局全体の独自データ。例：ctx.state.count = (ctx.state.count ?? 0) + 1。</dd><dt>ctx.setPieceData(マス, オブジェクト)</dt><dd>駒ごとの独自データを保存。参照は駒のdata。</dd><dt>ctx.hands / ctx.pieceTypes</dt><dd>持ち駒の参照用コピー／使用できる種類のID。</dd><dt>ctx.random()</dt><dd>再現可能な0以上1未満の乱数。</dd><dt>ctx.win("sente" / "gote") / ctx.draw()</dt><dd>勝利・引き分け。王が消滅した場合も自動で終局。</dd><dt>ctx.log(文字列)</dt><dd>棋譜の効果履歴に記録。</dd></dl></details></section>
      <section><h2>実行環境</h2><p>独立したJavaScript環境です。ブラウザ・通信・ファイル・外部importは使いません。状態はctx.stateと駒のdataに保持してください。モジュールの変数は手ごとに初期化します。</p><p>自動移動は駒の通常の動きを経由せず、指定先へ移します。効果による捕獲・移動もイベントを発生させるので、必要に応じてautomaticで条件を付けてください。</p><p>選択は指し手を行う側が行います。開始時には選択を要求できません。1手の効果256操作・イベント128件・選択4回まで。処理量を超えるコードやエラーは、その手全体を取り消します。</p></section></aside></div></main>`;
  }
}
