import { EDITOR_GUIDELINES, SPECIAL_GAMES, specialEditorAccess } from "./special";
import { escapePieceText as esc } from "./pieceview";

export function renderSpecialScreen(): string {
  const limits = EDITOR_GUIDELINES;
  return `<header class="site-header menu-header"><div class="brand"><span class="brand-icon special-brand-icon">S</span><span>Special<small>OTHER BOARD GAMES</small></span></div><div class="header-tools"><button id="to-title" class="text-button">← タイトルへ</button></div></header>
    <main class="special-main"><div class="special-heading"><p class="menu-eyebrow">SPECIAL GAMES</p><h1 tabindex="-1">将棋の外にも、遊びを広げる。</h1><p>チェスなど、専用のルールを持つゲームを追加していくモードです。</p></div>
    <p class="special-preparing" role="status">現在はモードと編集方針を用意した段階です。チェスの対局機能は準備中です。</p>
    <div class="special-game-grid">${SPECIAL_GAMES.map(game => {
      const access = specialEditorAccess(game), reasonId = `special-${game.id}-reason`;
      return `<article class="special-game-card" data-special-game="${esc(game.id)}"><div class="special-card-heading"><span class="special-game-emblem" aria-hidden="true">${esc(game.emblem)}</span><div><span class="special-status">準備中</span><h2>${esc(game.name)}</h2></div><span class="special-edit-badge ${access.allowed ? 'will-edit' : 'play-only'}">${access.allowed ? '編集対応予定' : '対局専用'}</span></div><p>${esc(game.description)}</p><div id="${reasonId}" class="special-editor-policy"><strong>${access.allowed ? 'ルールや配置を編集できる予定です' : '編集機能の対象外です'}</strong><p>${access.allowed ? `編集ガイドライン内の配置をコピーし、元のゲームを残して編集する形にします。` : esc(access.reasons.join(''))}</p></div><div class="special-card-actions"><button data-special-play="${esc(game.id)}" disabled aria-describedby="${reasonId}">遊ぶ（準備中）</button><button data-special-edit="${esc(game.id)}" disabled aria-describedby="${reasonId}">${access.allowed ? '編集する（準備中）' : '編集不可'}</button></div></article>`;
    }).join('')}</div>
    <section class="special-guidelines" aria-labelledby="special-guidelines-title"><h2 id="special-guidelines-title">編集できる範囲</h2><p>盤面は縦・横それぞれ${limits.minBoardSize}〜${limits.maxBoardSize}マス、追加駒は${limits.maxAdditionalPieceTypes}種類までです。上限を超えるゲームは、専用の対局機能で遊ぶ「対局専用」として追加します。</p><p>編集可能なゲームでも、読み込む配置と駒の設定が範囲内かを確認します。</p><details><summary>駒の動き・コードの上限</summary><ul><li>移動先の指定：縦・横それぞれ${limits.maxPieceOffset}マスまで</li><li>移動・駒取りの設定：各状態・各動作につき${limits.maxMovementRules}件まで</li><li>ルールコード：盤面・各駒それぞれ${limits.maxScriptLength.toLocaleString('ja-JP')}文字まで</li></ul></details></section></main>`;
}
