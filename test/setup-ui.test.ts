import { expect, test } from "bun:test";
import { ShogiGame } from "../src/shogi";
import { readLocalSetups, SETUP_STORAGE_KEY } from "../src/setups";

test("editor layouts can be saved locally, copied, overwritten, exported, reopened and applied without changing the current match", async () => {
  const entryURL = new URL("../web/app.ts", import.meta.url);
  const source = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(await Bun.file(entryURL).text())
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, path, suffix) => `${prefix}${new URL(path, entryURL).href}${suffix}`)
    .replaceAll("import.meta.url", JSON.stringify(entryURL.href));
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage, confirm: globalThis.confirm, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const originalURLs = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  const values = new Map<string, string>(), elements = new Map<string, any>();
  const urls = new Map<string, Blob>(), downloads: Array<{ name: string; blob: Blob }> = [];
  let listeners: Record<string, (event: any) => any> = {}, session = 0, timerId = 0, urlId = 0, pickerOpened = 0, approve = true, failWrites = false;
  const timers = new Map<number, () => void>();
  const game = new ShogiGame(); game.play({ from: 56, to: 47, promote: false });
  values.set("shogi-game.v1", JSON.stringify({ game: game.save(), aiMode: "human" }));
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (key === SETUP_STORAGE_KEY && failWrites) throw new Error("quota exceeded"); values.set(key, value); } };
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", value: "", classList: { add() {}, remove() {} }, focus() {}, click() { if (selector === "#setup-file-input") pickerOpened++; }, scrollTop: 0, scrollHeight: 0 });
    return elements.get(selector);
  };
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => { const url = `blob:setup-test-${++urlId}`; urls.set(url, blob); return url; },
    revokeObjectURL: (url: string) => { urls.delete(url); }
  });
  Object.assign(globalThis, {
    document: { querySelector: element, addEventListener: (name: string, callback: any) => { listeners[name] = callback; }, createElement: () => {
      const link = { href: "", download: "", click() { const blob = urls.get(link.href); if (!blob) throw new Error("Missing download blob"); downloads.push({ name: link.download, blob }); } }; return link;
    } },
    localStorage: storage, confirm: () => approve,
    setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: (id: number) => { timers.delete(id); }
  });
  const html = () => element("#app").innerHTML as string;
  const click = (id = "", dataset = {}) => listeners.click({ target: { closest: () => ({ id, dataset, disabled: false }) } });
  const change = (id: string, value: string) => listeners.change({ target: { id, value } });
  const input = (id: string, value: string) => listeners.input({ target: { id, value } });
  const importFile = (text: string) => listeners.change({ target: { id: "setup-file-input", files: [{ text: async () => text }], value: "" } });
  const reload = async () => { elements.clear(); listeners = {}; timers.clear(); await import(`data:text/javascript;base64,${Buffer.from(`${source}\n// setup-ui-session ${++session}`).toString("base64")}`); await click("title-continue"); };
  try {
    await reload(); const initialMatch = values.get("shogi-game.v1");
    await click("edit-board"); await change("editor-width", "5"); await change("editor-height", "7"); await click("editor-clear");
    await click("", { editorSide: "gote" }); await click("", { editorPiece: "S" });
    await listeners.change({ target: { id: "editor-promoted", checked: true } }); await click("", { editorSquare: "19" });
    await change("editor-turn", "gote"); input("editor-setup-name", "  小盤 <A>  "); input("editor-pass-limit", "2");
    expect(html()).toContain('id="editor-save-as"');
    await click("editor-save-as"); input("editor-save-as-name", "小盤 <A>"); await click("editor-confirm-save-as");
    const first = readLocalSetups(storage)[0];
    expect(first.setup.name).toBe("小盤 <A>"); expect(first.setup.passLimit).toBe(2);
    expect(first.setup.position.board[19]).toEqual({ type: "S", side: "gote", promoted: true });
    expect(html()).toContain("小盤 &lt;A&gt;"); expect(html()).toContain("上書き保存");
    expect(html()).toMatch(/id="editor-apply"[^>]*disabled/); expect(values.get("shogi-game.v1")).toBe(initialMatch);

    input("editor-setup-name", "小盤 B"); await change("editor-width", "6"); await click("editor-save-as");
    input("editor-save-as-name", ""); await click("editor-confirm-save-as"); expect(readLocalSetups(storage)).toHaveLength(1);
    expect(element("#toast").textContent).toContain("新しい配置名");
    input("editor-save-as-name", first.setup.name); await click("editor-confirm-save-as"); expect(readLocalSetups(storage)).toHaveLength(1);
    expect(element("#toast").textContent).toContain("別の名前");
    input("editor-save-as-name", "小盤 B");
    await listeners.keydown({ key: "Enter", target: { id: "editor-save-as-name" }, preventDefault() {} });
    const second = readLocalSetups(storage).find(entry => entry.id !== first.id)!;
    expect(second.setup.position.width).toBe(6); expect(readLocalSetups(storage)).toHaveLength(2);
    await click("editor-save-as"); await listeners.keydown({ key: "Escape", preventDefault() {} });
    expect(html()).toContain("盤面エディット"); expect(html()).not.toContain('id="editor-save-as-panel"');
    await click("", { setupLoad: first.id }); await change("editor-height", "6"); input("editor-setup-name", "A改"); await click("editor-save-local");
    const updated = readLocalSetups(storage);
    expect(updated).toHaveLength(2); expect(updated.find(entry => entry.id === first.id)?.setup.position.height).toBe(6);
    expect(updated.find(entry => entry.id === second.id)?.setup.position.height).toBe(7);
    const beforeFileCopy = values.get(SETUP_STORAGE_KEY);
    await click("editor-save-as"); input("editor-save-as-name", "A/修正"); await click("editor-export-as");
    expect(values.get(SETUP_STORAGE_KEY)).toBe(beforeFileCopy); expect(html()).not.toContain("上書き保存");
    expect(downloads).toHaveLength(1); expect(downloads[0].name).toBe("shogi-setup-A_修正.json");
    const fileText = await downloads[0].blob.text(), exported = JSON.parse(fileText);
    expect(exported.kind).toBe("shogi-setup"); expect(exported.position.width).toBe(5); expect(exported.position.height).toBe(6);
    expect(exported.position.board[19]?.promoted).toBe(true); expect(exported.passLimit).toBe(2);
    expect(values.get("shogi-game.v1")).toBe(initialMatch);
    await click("editor-clear"); await click("editor-import-setup"); expect(pickerOpened).toBe(1);
    await importFile(fileText); expect(html()).toContain("5 × 6 マス"); expect(html()).toContain('value="A/修正"');
    expect(html()).toContain('id="editor-pass-limit" type="number" min="0" step="1" value="2"');
    const beforeInvalid = html(); await importFile("{broken JSON");
    expect(html()).toBe(beforeInvalid); expect(element("#toast").textContent).toContain("配置を読み込めません");
    await importFile(JSON.stringify(game.save())); expect(html()).toBe(beforeInvalid);

    await reload(); await click("edit-board");
    expect(html()).toContain("A改"); expect(html()).toContain("小盤 B");
    const beforeCopy = values.get(SETUP_STORAGE_KEY);
    await click("", { setupCopy: first.id }); expect(html()).toContain('value="A改のコピー"');
    expect(html()).not.toContain("上書き保存"); expect(values.get(SETUP_STORAGE_KEY)).toBe(beforeCopy);
    await click("", { setupLoad: second.id }); expect(html()).toContain("6 × 7 マス");
    expect(html()).toContain('value="小盤 B"'); expect(values.get("shogi-game.v1")).toBe(initialMatch);
    await click("", { editorSide: "sente" }); await click("", { editorPiece: "K" }); await click("", { editorSquare: "41" });
    await click("", { editorSide: "gote" }); await click("", { editorPiece: "K" }); await click("", { editorSquare: "0" });
    await click("editor-apply");
    expect(JSON.parse(values.get("shogi-game.v1")!).game.initialPosition.width).toBe(6);
    expect(JSON.parse(values.get("shogi-game.v1")!).game.passLimit).toBe(2);
    expect(JSON.parse(values.get("shogi-game.v1")!).game.moves).toHaveLength(0);

    await click("edit-board");
    let resolveRead!: (text: string) => void;
    const pendingRead = listeners.change({ target: { id: "setup-file-input", files: [{ text: () => new Promise<string>(resolve => { resolveRead = resolve; }) }], value: "" } });
    await click("editor-cancel"); resolveRead(fileText); await pendingRead;
    expect(html()).not.toContain("盤面エディット"); expect((html().match(/data-square=/g) ?? [])).toHaveLength(42);
    await click("edit-board"); approve = false; await click("", { setupDelete: first.id }); expect(readLocalSetups(storage)).toHaveLength(2);
    approve = true; await click("", { setupDelete: first.id });
    expect(readLocalSetups(storage).map(entry => entry.id)).toEqual([second.id]);

    const goodLibrary = values.get(SETUP_STORAGE_KEY)!; values.set(SETUP_STORAGE_KEY, "corrupt library");
    await reload(); await click("edit-board"); expect(html()).toContain("保存済み配置を読み込めません");
    await click("editor-save-local"); expect(values.get(SETUP_STORAGE_KEY)).toBe("corrupt library");
    await click("editor-export-setup"); expect(downloads).toHaveLength(2);
    values.set(SETUP_STORAGE_KEY, goodLibrary); await reload(); await click("edit-board");
    failWrites = true; await click("editor-save-local");
    expect(element("#toast").textContent).toContain("ファイルに出力してください");
    expect(values.get(SETUP_STORAGE_KEY)).toBe(goodLibrary);
    await click("editor-save-as"); input("editor-save-as-name", "別名の持ち出し"); await click("editor-confirm-save-as");
    expect(values.get(SETUP_STORAGE_KEY)).toBe(goodLibrary); expect(html()).toContain('id="editor-save-as-panel"');
    await click("editor-export-as"); expect(downloads).toHaveLength(3);
    expect(JSON.parse(await downloads.at(-1)!.blob.text()).name).toBe("別名の持ち出し");
  } finally {
    timers.clear(); urls.clear(); Object.assign(URL, originalURLs); Object.assign(globalThis, originals);
  }
});
