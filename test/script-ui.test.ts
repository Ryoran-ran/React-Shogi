import { expect, test } from "bun:test";
import { ShogiGame, emptyPosition } from "../src/shogi";
import { createSetup, readLocalSetups, saveLocalSetup } from "../src/setups";
import { chooseAIMove } from "../src/ai";
import { PIECE_SCRIPT_EXAMPLES } from "../src/rulescript";
import type { AIRequest } from "../src/ai";

test("code editing, validation, apply/cancel, choices, persistence, AI and standard reset work through the UI", async () => {
  const entryURL = new URL("../web/app.ts", import.meta.url);
  const appSource = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(await Bun.file(entryURL).text())
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, path, suffix) => `${prefix}${new URL(path, entryURL).href}${suffix}`)
    .replaceAll("import.meta.url", JSON.stringify(entryURL.href));
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage, confirm: globalThis.confirm, Worker: globalThis.Worker, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const originalURLs = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  const values = new Map<string, string>(), elements = new Map<string, any>(), blobs = new Map<string, Blob>(), downloads: Blob[] = [];
  let listeners: Record<string, (event: any) => any> = {}, session = 0, timerID = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const p = emptyPosition(); p.board[80] = { type: "K", side: "sente", promoted: false }; p.board[0] = { type: "K", side: "gote", promoted: false }; p.board[22] = { type: "P", side: "sente", promoted: false };
  const saved = saveLocalSetup(storage, createSetup(p, 0, "変身テスト"));
  const workers: MockWorker[] = [];
  class MockWorker {
    request!: AIRequest; onmessage: ((event: any) => void) | null = null; onerror: (() => void) | null = null;
    constructor() { workers.push(this); }
    postMessage(request: AIRequest) { this.request = structuredClone(request); }
    terminate() {}
  }
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", value: "", dataset: {}, classList: { add() {}, remove() {} }, focus() {}, click() {}, select() {}, scrollTop: 0, scrollLeft: 0 });
    return elements.get(selector);
  };
  Object.assign(URL, { createObjectURL: (blob: Blob) => { const id = `blob:script-${blobs.size}`; blobs.set(id, blob); return id; }, revokeObjectURL: (id: string) => { blobs.delete(id); } });
  Object.assign(globalThis, {
    document: { querySelector: element, addEventListener: (name: string, fn: any) => { listeners[name] = fn; }, createElement() { const link = { href: "", download: "", click() { downloads.push(blobs.get(link.href)!); } }; return link; } },
    localStorage: storage, confirm: () => true, Worker: MockWorker,
    setTimeout: (callback: () => void, delay = 0) => { const id = ++timerID; timers.set(id, { callback, delay }); return id; }, clearTimeout: (id: number) => { timers.delete(id); }
  });
  const html = () => element("#app").innerHTML as string;
  const click = (id = "", dataset = {}) => listeners.click({ target: { closest: () => ({ id, dataset, disabled: false }) } });
  const input = (value: string) => listeners.input({ target: { id: "rule-script-source", value } });
  const change = (id: string, value: string) => listeners.change({ target: { id, value } });
  const stored = () => JSON.parse(values.get("shogi-game.v1")!).game;
  const reload = async () => { elements.clear(); listeners = {}; timers.clear(); await import(`data:text/javascript;base64,${Buffer.from(`${appSource}\n// script-session ${++session}`).toString("base64")}`); };
  const source = 'export default { afterMove(ctx) { if (ctx.actor.type === "P") { ctx.choosePiece(ctx.event.to, ["R", "B"], "変身先を選ぶ"); const power = ctx.choose("追加効果", ["弱", "強"]); ctx.setPieceData(ctx.event.to, { power }); ctx.state.transformed = (ctx.state.transformed ?? 0) + 1; ctx.log("<効果>"); } } };';
  try {
    await reload(); await click("title-workshop"); await click("workshop-edit"); await click("", { workshopEdit: saved.id });
    expect(html()).toContain('id="editor-open-script"');
    await click("editor-open-script"); expect(html()).toContain('id="rule-script-source"'); expect(html()).not.toContain("data-editor-square");
    await click("", { scriptExample: "vanish" }); expect(html()).toContain("discardCapture");
    await click("script-editor-verify"); expect(html()).toContain("実行確認しました");
    await click("script-editor-cancel"); await click("editor-save-local"); expect(readLocalSetups(storage)[0].setup.ruleScript).toBeUndefined();
    await click("editor-open-script"); input('export default { afterMove() { throw new Error("実行エラー"); } };');
    await click("script-editor-back"); expect(html()).toContain('id="rule-script-source"'); expect(html()).toContain("実行エラー");
    input(source); await click("script-editor-verify"); expect(html()).toContain("実行確認しました"); expect(html()).toContain("&lt;効果&gt;");
    await click("script-editor-back"); expect(html()).toContain("追加ルールを設定済み");
    await click("editor-undo"); await click("editor-open-script"); expect(html()).not.toContain("ctx.choosePiece(ctx.event.to");
    input(source); await click("script-editor-back"); await click("editor-save-local");
    expect(readLocalSetups(storage)[0].setup.ruleScript).toBe(source); expect(readLocalSetups(storage)[0].setup.version).toBe(4);
    await click("editor-export-setup"); expect(JSON.parse(await downloads.at(-1)!.text()).ruleScript).toBe(source);
    await click("editor-apply"); expect(stored().version).toBe(6); expect(stored().ruleScript).toBe(source);
    await click("", { square: "22" }); await click("", { square: "13" });
    expect(html()).toContain("歩を成りますか？"); await click("", { promote: "no" });
    expect(html()).toContain("変身先を選ぶ"); expect(html()).toContain('data-rule-choice="R"'); expect(html()).toContain('data-rule-choice="B"'); expect(stored().moves).toHaveLength(0);
    await click("cancel-promotion"); expect(stored().moves).toHaveLength(0);
    await click("", { square: "13" }); await click("", { promote: "yes" }); await click("", { ruleChoice: "B" });
    expect(html()).toContain("追加効果"); expect(stored().moves).toHaveLength(0); await click("", { ruleChoice: "強" });
    expect(stored().moves[0].choices).toEqual(["B", "強"]); expect(ShogiGame.load(stored()).position.board[13]?.type).toBe("B"); expect(html()).toContain("効果2件");
    await click("undo"); expect(stored().moves).toHaveLength(0);
    await change("ai-mode", "gote");
    const timer = [...timers.entries()].find(([, item]) => item.delay === 250)!; expect(timer).toBeDefined(); timers.delete(timer[0]); timer[1].callback();
    const worker = workers.at(-1)!; expect(worker.request.options.ruleScript).toBe(source);
    const result = chooseAIMove(worker.request.position, { ...worker.request.options, maxDepth: 1, maxTimeMs: 5000 });
    worker.onmessage!({ data: { id: worker.request.id, result } }); expect(stored().moves).toHaveLength(1);
    await change("ai-mode", "human"); await reload(); await click("title-continue"); expect(stored().ruleScript).toBe(source);
    await click("restart"); expect(stored().ruleScript).toBe(source); expect(stored().moves).toHaveLength(0);
    await click("edit-board"); await click("editor-open-script"); expect(html()).toContain("ctx.choosePiece");
    await click("script-editor-disable"); await click("script-editor-back"); await click("editor-undo"); await click("editor-save-local");
    await click("editor-standard"); await click("editor-save-as");
    await click("editor-cancel-save-as"); await click("editor-open-script"); expect(html()).not.toContain("ctx.choosePiece(ctx.event.to"); await click("script-editor-cancel");
    await click("editor-cancel"); await click("to-title"); await click("title-standard"); expect(stored().ruleScript).toBeUndefined(); expect(stored().version).toBe(3);

    // A piece's code has its own nested draft, while the board's code remains editable and saved.
    await click("to-title"); await click("title-workshop"); await click("workshop-edit"); await click("", { workshopEdit: saved.id });
    await click("editor-open-piece-settings"); await click("", { rulePiece: "P" }); await click("piece-editor-open-script");
    expect(html()).toContain("歩兵のルールコード"); expect(html()).toContain("ctx.self"); expect(html()).toContain("afterCaptured");
    await click("", { scriptExample: "counter" }); await click("script-editor-verify"); expect(html()).toContain("実行確認しました");
    await click("script-editor-cancel"); expect(html()).toContain('id="piece-editor-open-script"');
    await click("piece-editor-open-script"); input(PIECE_SCRIPT_EXAMPLES.counter.source); await click("script-editor-back"); await click("piece-editor-cancel");
    await click("editor-save-local"); expect(readLocalSetups(storage)[0].setup.pieceRules?.P?.script).toBeUndefined(); expect(readLocalSetups(storage)[0].setup.ruleScript).toBe(source);
    await click("editor-open-piece-settings"); await click("piece-editor-open-script"); input(PIECE_SCRIPT_EXAMPLES.counter.source); await click("script-editor-back");
    await click("piece-editor-undo"); await click("piece-editor-open-script"); expect(html()).not.toContain("moves: (data.moves ?? 0) + 1");
    input(PIECE_SCRIPT_EXAMPLES.counter.source); await click("script-editor-back");
    await click("", { rulePiece: "R" }); await click("piece-editor-open-script"); expect(html()).toContain("飛車のルールコード"); expect(html()).not.toContain("moves: (data.moves ?? 0) + 1"); await click("script-editor-cancel");
    await click("", { rulePiece: "P" }); await click("piece-editor-copy"); await click("piece-editor-open-script"); expect(html()).toContain("moves: (data.moves ?? 0) + 1");
    await click("", { scriptExample: "vanish" }); await click("script-editor-back"); await click("piece-editor-back"); await click("editor-save-local");
    const both = readLocalSetups(storage)[0].setup; expect(both.version).toBe(5); expect(both.ruleScript).toBe(source);
    expect(both.pieceRules?.P?.script).toBe(PIECE_SCRIPT_EXAMPLES.counter.source); expect(both.pieceRules?.custom_1?.script).toBe(PIECE_SCRIPT_EXAMPLES.vanish.source);
    await click("editor-open-script"); expect(html()).toContain("盤面のルールコード"); expect(html()).toContain("ctx.choosePiece(ctx.event.to");
    const victory = 'export default { checkResult(ctx) { const p = ctx.board.at(13); if (p?.data?.moves === 1) ctx.win(p.side); } };';
    input(victory); await click("script-editor-back"); await click("editor-export-setup"); const exported = JSON.parse(await downloads.at(-1)!.text());
    expect(exported.ruleScript).toBe(victory); expect(exported.pieceRules.P.script).toBe(PIECE_SCRIPT_EXAMPLES.counter.source);
    await click("editor-apply"); expect(stored().version).toBe(7); expect(stored().ruleScript).toBe(victory);
    await click("", { square: "22" }); await click("", { square: "13" }); await click("", { promote: "no" });
    expect(ShogiGame.load(stored()).position.board[13]?.data).toEqual({ moves: 1 }); expect(ShogiGame.load(stored()).result).toEqual({ reason: "script", winner: "sente" });
    await reload(); await click("title-continue"); expect(html()).toContain("追加ルール"); expect(stored().pieceRules.P.script).toBe(PIECE_SCRIPT_EXAMPLES.counter.source);
    await click("result-home"); await click("title-standard"); expect(stored().ruleScript).toBeUndefined(); expect(stored().pieceRules).toBeUndefined();
  } finally { timers.clear(); Object.assign(URL, originalURLs); Object.assign(globalThis, originals); }
});
