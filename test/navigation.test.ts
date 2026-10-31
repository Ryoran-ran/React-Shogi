import { expect, test } from "bun:test";
import { ShogiGame, emptyPosition, legalMoves } from "../src/shogi";
import { createSetup, readLocalSetups, saveLocalSetup, SETUP_STORAGE_KEY } from "../src/setups";
import type { GameMove } from "../src/shogi";
import type { AIRequest } from "../src/ai";

test("title branches into standard shogi and a workshop for new, edit and play without running AI in menus", async () => {
  const entryURL = new URL("../web/app.ts", import.meta.url);
  const source = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(await Bun.file(entryURL).text())
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, path, suffix) => `${prefix}${new URL(path, entryURL).href}${suffix}`)
    .replaceAll("import.meta.url", JSON.stringify(entryURL.href));
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage, confirm: globalThis.confirm, Worker: globalThis.Worker, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let listeners: Record<string, (event: any) => any> = {}, sequence = 0, session = 0, approve = true;
  const values = new Map<string, string>(), elements = new Map<string, any>(), timers = new Map<number, { callback: () => void; delay: number }>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const p = emptyPosition(5, 7); p.board[34] = { type: "K", side: "sente", promoted: false }; p.board[0] = { type: "K", side: "gote", promoted: false };
  const ready = saveLocalSetup(storage, createSetup(p, 1, "小さな対局"));
  const draft = saveLocalSetup(storage, createSetup(emptyPosition(3, 5), null, "作成中の配置"));
  const workers: MockWorker[] = [];
  class MockWorker {
    request!: AIRequest;
    onmessage: ((event: any) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(request: AIRequest) { this.request = structuredClone(request); }
    terminate() { this.terminated = true; }
    reply(move: GameMove = legalMoves(this.request.position)[0]) { this.onmessage?.({ data: { id: this.request.id, result: { move, depth: 1, nodes: 1, score: 0 } } }); }
  }
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", value: "", classList: { add() {}, remove() {} }, focus() {}, click() {}, scrollTop: 0, scrollHeight: 0 });
    return elements.get(selector);
  };
  Object.assign(globalThis, {
    document: { querySelector: element, addEventListener: (name: string, callback: any) => { listeners[name] = callback; } },
    localStorage: storage, confirm: () => approve, Worker: MockWorker,
    setTimeout: (callback: () => void, delay = 0) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; }, clearTimeout: (id: number) => { timers.delete(id); }
  });
  const html = () => element("#app").innerHTML as string;
  const click = (id = "", dataset = {}) => listeners.click({ target: { closest: () => ({ id, dataset, disabled: false }) } });
  const change = (id: string, value: string) => listeners.change({ target: { id, value } });
  const aiTimers = () => [...timers.entries()].filter(([, timer]) => timer.delay === 250);
  const tickAI = () => { expect(aiTimers()).toHaveLength(1); const [id, timer] = aiTimers()[0]; timers.delete(id); timer.callback(); };
  const reload = async () => { elements.clear(); listeners = {}; timers.clear(); workers.length = 0; await import(`data:text/javascript;base64,${Buffer.from(`${source}\n// navigation-session ${++session}`).toString("base64")}`); };
  const importFile = (text: string) => listeners.change({ target: { id: "workshop-file-input", files: [{ text: async () => text }], value: "" } });
  try {
    await reload(); expect(html()).toContain("遊び方を選んでください");
    expect(html()).toContain('id="title-standard"'); expect(html()).toContain('id="title-workshop"');
    expect(html()).not.toContain('id="title-continue"'); expect(aiTimers()).toHaveLength(0);
    await click("title-standard");
    expect((html().match(/data-square=/g) ?? [])).toHaveLength(81);
    expect(JSON.parse(values.get("shogi-game.v1")!).gameKind).toBe("standard");
    expect(JSON.parse(values.get("shogi-game.v1")!).game.passLimit).toBe(0);
    expect(html()).not.toContain('id="pass"'); expect(html()).not.toContain('id="edit-board"');
    await change("pass-limit", "1"); expect(JSON.parse(values.get("shogi-game.v1")!).game.passLimit).toBe(0);

    await change("ai-mode", "gote"); tickAI(); const interrupted = workers[0];
    await click("to-title"); expect(interrupted.terminated).toBe(true); expect(aiTimers()).toHaveLength(0);
    interrupted.reply(); expect(JSON.parse(values.get("shogi-game.v1")!).game.moves).toHaveLength(0);
    await click("title-continue"); tickAI(); workers[1].reply();
    expect(JSON.parse(values.get("shogi-game.v1")!).game.moves).toHaveLength(1);
    await click("to-title"); const originalMatch = values.get("shogi-game.v1");
    await click("title-workshop"); expect(aiTimers()).toHaveLength(0);
    expect(html()).toContain('id="workshop-new"'); expect(html()).toContain('id="workshop-edit"'); expect(html()).toContain('id="workshop-play"');
    expect(html()).toContain("小さな対局"); expect(html()).toContain("作成途中");
    expect(html()).toContain(`data-workshop-play="${draft.id}" disabled`);
    await click("", { workshopPlay: draft.id }); expect(values.get("shogi-game.v1")).toBe(originalMatch);
    expect(element("#toast").textContent).toContain("王・玉");
    const beforeCopy = values.get(SETUP_STORAGE_KEY);
    expect(html()).toContain(`data-workshop-copy="${ready.id}"`);
    await click("", { workshopCopy: ready.id });
    expect(html()).toContain('value="小さな対局のコピー"'); expect(html()).not.toContain("上書き保存");
    expect(values.get(SETUP_STORAGE_KEY)).toBe(beforeCopy);
    await change("editor-width", "6"); await change("editor-pass-limit", "2");
    await click("editor-save-as"); await change("editor-save-as-name", "小さな対局 改"); await click("editor-confirm-save-as");
    const copied = readLocalSetups(storage).find(entry => entry.setup.name === "小さな対局 改")!;
    expect(copied.id).not.toBe(ready.id); expect(copied.setup.position.width).toBe(6); expect(copied.setup.passLimit).toBe(2);
    expect(readLocalSetups(storage).find(entry => entry.id === ready.id)).toEqual(ready);
    expect(values.get("shogi-game.v1")).toBe(originalMatch);
    await click("editor-cancel");
    const savedCount = readLocalSetups(storage).length;
    await click("", { workshopCopy: ready.id }); await click("editor-cancel");
    expect(readLocalSetups(storage)).toHaveLength(savedCount);
    await click("workshop-edit"); await click("", { workshopEdit: draft.id });
    expect((html().match(/data-editor-square=/g) ?? [])).toHaveLength(15);
    expect(html()).toContain('value="作成中の配置"'); expect(html()).toContain("上書き保存");
    await click("editor-cancel"); expect(html()).toContain("編集する配置を選ぶ");
    await click("workshop-new"); expect((html().match(/data-editor-square=/g) ?? [])).toHaveLength(81);
    expect(html()).toContain("先手の王・玉を1枚配置してください");
    await click("editor-cancel"); expect(values.get("shogi-game.v1")).toBe(originalMatch);

    await click("workshop-play"); await click("", { workshopPlay: ready.id });
    expect((html().match(/data-square=/g) ?? [])).toHaveLength(35);
    const custom = JSON.parse(values.get("shogi-game.v1")!);
    expect(custom.gameKind).toBe("custom"); expect(custom.gameName).toBe("小さな対局"); expect(custom.game.passLimit).toBe(1);
    expect(html()).toContain('id="pass"'); tickAI(); workers[2].reply();
    await click("to-title"); const customMatch = values.get("shogi-game.v1");
    approve = false; await click("title-standard"); expect(values.get("shogi-game.v1")).toBe(customMatch);
    expect(html()).toContain("遊び方を選んでください");
    approve = true; await click("title-standard"); await change("ai-mode", "human");
    expect(JSON.parse(values.get("shogi-game.v1")!).game.passLimit).toBe(0);
    expect((html().match(/data-square=/g) ?? [])).toHaveLength(81);

    let resolveMatch!: (text: string) => void;
    const readingMatch = listeners.change({ target: { id: "file-input", files: [{ text: () => new Promise<string>(resolve => { resolveMatch = resolve; }) }], value: "" } });
    const beforeLeaving = values.get("shogi-game.v1");
    await click("to-title"); resolveMatch(JSON.stringify(new ShogiGame(p, { passLimit: 1 }).save())); await readingMatch;
    expect(html()).toContain("遊び方を選んでください"); expect(values.get("shogi-game.v1")).toBe(beforeLeaving);
    await click("title-continue");

    const filePosition = emptyPosition(7, 5); filePosition.board[34] = { type: "K", side: "sente", promoted: false }; filePosition.board[0] = { type: "K", side: "gote", promoted: false };
    const setupFile = JSON.stringify(createSetup(filePosition, 3, "ファイルの配置"));
    await click("to-title"); await click("title-workshop"); await click("workshop-edit");
    const beforeFile = values.get("shogi-game.v1");
    await importFile(setupFile); expect(html()).toContain("7 × 5 マス"); expect(html()).toContain('value="ファイルの配置"');
    expect(values.get("shogi-game.v1")).toBe(beforeFile); await click("editor-cancel");
    await click("workshop-play"); await importFile(setupFile);
    expect(JSON.parse(values.get("shogi-game.v1")!).game.initialPosition.width).toBe(7);
    expect(JSON.parse(values.get("shogi-game.v1")!).game.passLimit).toBe(3);
    await click("to-title"); await click("title-workshop"); const beforeInvalid = values.get("shogi-game.v1");
    await importFile(JSON.stringify(draft.setup)); expect(values.get("shogi-game.v1")).toBe(beforeInvalid);
    expect(html()).toContain("遊ぶ配置を選ぶ");
    let resolveFile!: (text: string) => void;
    const pending = listeners.change({ target: { id: "workshop-file-input", files: [{ text: () => new Promise<string>(resolve => { resolveFile = resolve; }) }], value: "" } });
    await click("to-title"); resolveFile(setupFile); await pending;
    expect(html()).toContain("遊び方を選んでください"); expect(values.get("shogi-game.v1")).toBe(beforeInvalid);

    const finished = new ShogiGame(undefined, { passLimit: 0 }); finished.resign();
    values.set("shogi-game.v1", JSON.stringify({ game: finished.save(), aiMode: "gote" }));
    await reload(); expect(html()).toContain("前回の対局を見る"); expect(aiTimers()).toHaveLength(0);
    await click("title-continue"); expect(html()).toContain('aria-labelledby="result-title"'); expect(workers).toHaveLength(0);
    await click("result-home"); expect(html()).toContain("遊び方を選んでください");
    values.set(SETUP_STORAGE_KEY, "corrupt library"); await click("title-workshop");
    expect(html()).toContain("保存済み配置を読み込めません"); expect(html()).toContain('id="workshop-import-setup"');
    const ids = [...html().matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    await click("workshop-create-empty"); expect(html()).toContain("盤面エディット");
    await click("editor-cancel"); await listeners.keydown({ key: "Escape", preventDefault() {} });
    expect(html()).toContain("遊び方を選んでください"); expect(aiTimers()).toHaveLength(0);
  } finally { timers.clear(); Object.assign(globalThis, originals); }
});
