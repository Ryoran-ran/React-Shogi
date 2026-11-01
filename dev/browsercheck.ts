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
  await download(new URL("/src/aiworker.js", baseURL));
  const elements = new Map<string, any>();
  const listeners = new Map<string, (event: any) => void>();
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", classList: { add() {}, remove() {} }, addEventListener() {}, focus() {} });
    return elements.get(selector);
  };
  const replacements: Record<string, unknown> = {
    window: {}, self: {}, process: undefined,
    document: { querySelector: element, addEventListener(name: string, callback: (event: any) => void) { listeners.set(name, callback); } },
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
    const click = (id: string, dataset = {}) => listeners.get("click")!({ target: { closest: () => ({ id, dataset, disabled: false }) } });
    click("title-special"); click("", {specialPlay:"chess"});
    if ((element("#app").innerHTML.match(/data-square=/g) ?? []).length !== 64) throw new Error("配信用モジュールで共通の対局画面を開けませんでした");
    click("", {square:"52"}); click("", {square:"36"});
    if (!element("#app").innerHTML.includes("2 手目")) throw new Error("配信用モジュールでチェスを指せませんでした");
    const {createChessPreset} = await import(pathToFileURL(resolve(folder, "src/presets.js")).href);
    const preset=createChessPreset(), options={passLimit:0,pieceRules:preset.pieceRules,ruleScript:preset.ruleScript};
    const legacy=await import(pathToFileURL(resolve(folder,"src/chesslegacy.js")).href);
    const converted=legacy.importChessText("7k/8/8/8/8/8/R7/K7 w - - 0 1");
    if(converted.save().version!==11||converted.position.board[48]?.type!=="custom_rook")throw new Error("配信用モジュールで旧形式を共通形式へ変換できませんでした");
    const match = new shogi.ShogiGame(preset.position,options);
    for (const move of [{from:53,to:45},{from:12,to:28},{from:54,to:38},{from:3,to:39}]) match.play({...move,promote:false});
    if (match.result?.reason !== "mate" || match.result.winner !== "gote") throw new Error("共通の実行環境でチェックメイトを判定できませんでした");
    let reply: any;
    const onmessage=Object.getOwnPropertyDescriptor(globalThis,"onmessage"),postMessage=Object.getOwnPropertyDescriptor(globalThis,"postMessage");
    const aiMatch = new shogi.ShogiGame(preset.position,options);
    try {
      // Keep the worker's callback on this test object; Bun's native onmessage setter starts a message port.
      Object.defineProperty(globalThis,"onmessage",{value:null,writable:true,configurable:true});
      Object.defineProperty(globalThis,"postMessage",{value:(value:any)=>{reply=value;},configurable:true});
      await import(pathToFileURL(resolve(folder, "src/aiworker.js")).href);
      await (globalThis as any).onmessage({data:{id:17,position:aiMatch.position,options:{pieceRules:preset.pieceRules,ruleScript:preset.ruleScript,passesRemaining:{sente:0,gote:0},maxDepth:1,maxNodes:1,maxTimeMs:5}}});
    } finally {
      if(onmessage)Object.defineProperty(globalThis,"onmessage",onmessage);else Reflect.deleteProperty(globalThis,"onmessage");
      if(postMessage)Object.defineProperty(globalThis,"postMessage",postMessage);else Reflect.deleteProperty(globalThis,"postMessage");
    }
    if (reply?.id !== 17 || !reply.result?.move) throw new Error("配信用のチェスAIから応答がありませんでした");
    aiMatch.play(reply.result.move);
    return { title, error, script: true };
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
