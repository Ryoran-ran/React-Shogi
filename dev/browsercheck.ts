import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

/** Check the served module graph and run it with browser globals and no Node process object. */
export async function checkBrowserStartup(baseURL: string, brokenRuntime = false): Promise<{ title: boolean; error: boolean; script: boolean }> {
  const html = await (await fetch(baseURL)).text();
  const startup = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  if (!startup) throw new Error("起動処理が見つかりません");
  const cacheRoot = resolve(import.meta.dir, "../.check"); mkdirSync(cacheRoot, { recursive: true });
  const folder = mkdtempSync(resolve(cacheRoot, "browser-startup-"));
  const modules = new Set<string>(), scanner = new Bun.Transpiler({ loader: "js" });
  async function download(url: URL): Promise<void> {
    if (modules.has(url.href)) return; modules.add(url.href);
    if (url.origin !== new URL(baseURL).origin || !/^\/(src|web)\/[a-z]+\.js$/.test(url.pathname)) throw new Error(`想定外のモジュールURL：${url.href}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`読み込みエラー：${response.status} ${url.href}`);
    const source = brokenRuntime && url.pathname === "/src/scriptvm.js" ? 'export function evaluateRule() {} throw new Error("Startup runtime unavailable");' : await response.text();
    for (const dependency of scanner.scanImports(source)) {
      if (dependency.kind !== "import-statement" && dependency.kind !== "dynamic-import") continue;
      if (!dependency.path.startsWith(".") && !dependency.path.startsWith("/")) throw new Error(`ブラウザーでは解決できないimport：${dependency.path}`);
      await download(new URL(dependency.path, url));
    }
    const target = resolve(folder, url.pathname.slice(1)); mkdirSync(dirname(target), { recursive: true }); await Bun.write(target, source);
  }
  await download(new URL("/web/app.js", baseURL));
  const elements = new Map<string, any>();
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", classList: { add() {}, remove() {} }, addEventListener() {}, focus() {} });
    return elements.get(selector);
  };
  const replacements: Record<string, unknown> = {
    window: {}, self: {}, process: undefined,
    document: { querySelector: element, addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { href: baseURL, reload() {} },
  };
  const descriptors = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const bootstrap = resolve(folder, "bootstrap.js");
  await Bun.write(bootstrap, startup.replace('import("/web/app.js")', 'import("./web/app.js")'));
  try {
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    await import(pathToFileURL(bootstrap).href);
    const title = element("#app").innerHTML.includes("遊び方を選んでください"), error = element("#app").innerHTML.includes("画面を読み込めませんでした");
    if (brokenRuntime) {
      if (!error || !element("#boot-error").textContent.includes("Startup runtime unavailable")) throw new Error("起動エラーの表示を確認できませんでした");
      return { title, error, script: false };
    }
    if (!title) throw new Error(`タイトル画面が起動しません：${element("#boot-error").textContent}`);
    const shogi = await import(pathToFileURL(resolve(folder, "src/shogi.js")).href);
    const game = new shogi.ShogiGame(undefined, {
      ruleScript: "export default { afterMove(ctx) { ctx.state.count = (ctx.state.count ?? 0) + 1; }, checkResult(ctx) { if (ctx.board.at(47)?.data?.moves === 1) ctx.draw(); } };",
      pieceRules: { P: { script: "export default { afterMove(ctx) { ctx.setPieceData(ctx.self.square, { moves: 1 }); } };" } },
    });
    game.play({ from: 56, to: 47, promote: false });
    if (game.position.ruleState.data.count !== 1 || game.position.board[47]?.data?.moves !== 1 || game.result?.reason !== "script") throw new Error("ブラウザー用実行環境で盤面と駒のルールを実行できませんでした");
    return { title, error, script: true };
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
