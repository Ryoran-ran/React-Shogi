import { expect, test } from "bun:test";
import { ShogiGame, emptyPosition, legalMoves } from "../src/shogi";
import { createSetup, saveLocalSetup, readLocalSetups } from "../src/setups";
import { PIECE_DEFINITIONS } from "../src/pieces";
import type { AIRequest } from "../src/ai";
import type { GameMove } from "../src/shogi";

test("piece editing flows through undo, setup copies, files, custom games, AI and reload without changing standard shogi", async () => {
  const entryURL = new URL("../web/app.ts", import.meta.url);
  const source = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(await Bun.file(entryURL).text())
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, path, suffix) => `${prefix}${new URL(path, entryURL).href}${suffix}`)
    .replaceAll("import.meta.url", JSON.stringify(entryURL.href));
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage, confirm: globalThis.confirm, Worker: globalThis.Worker, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const originalURLs = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  const values = new Map<string, string>(), elements = new Map<string, any>(), blobs = new Map<string, Blob>();
  const timers = new Map<number, { callback: () => void; delay: number }>(), downloads: Blob[] = [];
  let listeners: Record<string, (event: any) => any> = {}, timerID = 0, session = 0, blobID = 0, renderedHTML = "";
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const position = emptyPosition();
  position.board[80] = { type: "K", side: "sente", promoted: false }; position.board[0] = { type: "K", side: "gote", promoted: false };
  position.board[40] = { type: "P", side: "sente", promoted: false }; position.board[30] = { type: "R", side: "gote", promoted: false };
  position.board[31] = { type: "P", side: "gote", promoted: false };
  const savedSetup = saveLocalSetup(storage, createSetup(position, 0, "動きのテスト"));
  const previous = new ShogiGame(); previous.play({ from: 56, to: 47, promote: false });
  values.set("shogi-game.v1", JSON.stringify({ game: previous.save(), gameKind: "standard", aiMode: "human" }));
  const previousMatch = values.get("shogi-game.v1");
  const workers: MockWorker[] = [];
  class MockWorker {
    request!: AIRequest; onmessage: ((event: any) => void) | null = null; onerror: (() => void) | null = null;
    constructor() { workers.push(this); }
    postMessage(request: AIRequest) { this.request = structuredClone(request); }
    terminate() {}
    reply(move: GameMove) { this.onmessage?.({ data: { id: this.request.id, result: { move, depth: 1, score: 0, nodes: 1 } } }); }
  }
  const element = (selector: string) => {
    if (!elements.has(selector)) {
      const node = { innerHTML: "", textContent: "", value: "", dataset: {} as Record<string, string>, classList: { add() {}, remove() {} }, focus() {}, select() {}, click() {}, scrollTop: 0, scrollLeft: 0, scrollWidth: 0, scrollHeight: 0, clientWidth: 0, clientHeight: 0 };
      if (selector === ".piece-rule-grid-viewport") {
        const size = Number(renderedHTML.match(/data-grid-size="(\d+)"/)?.[1] ?? 0);
        if (size) { node.dataset.gridSize = String(size); node.scrollWidth = node.scrollHeight = size * 42 - 4; node.clientWidth = node.clientHeight = 250; }
      }
      if (selector === "#app") Object.defineProperty(node, "innerHTML", { get: () => renderedHTML, set: (value: string) => { renderedHTML = value; for (const selector of [".editor-main", ".editor-panel", ".piece-rule-list", ".piece-editor-main", ".piece-editor-workspace", ".piece-editor-library", ".piece-rule-grid-viewport"]) elements.delete(selector); } });
      elements.set(selector, node);
    }
    return elements.get(selector);
  };
  Object.assign(URL, { createObjectURL: (blob: Blob) => { const id = `blob:piece-rules-${++blobID}`; blobs.set(id, blob); return id; }, revokeObjectURL: (id: string) => { blobs.delete(id); } });
  Object.assign(globalThis, {
    document: { querySelector: element, addEventListener: (name: string, callback: any) => { listeners[name] = callback; }, createElement() {
      const link = { href: "", download: "", click() { downloads.push(blobs.get(link.href)!); } }; return link;
    } },
    localStorage: storage, confirm: () => true, Worker: MockWorker,
    setTimeout: (callback: () => void, delay = 0) => { const id = ++timerID; timers.set(id, { callback, delay }); return id; }, clearTimeout: (id: number) => { timers.delete(id); }
  });
  const html = () => element("#app").innerHTML as string;
  const click = (id = "", dataset = {}) => listeners.click({ target: { closest: () => ({ id, dataset, disabled: false }) } });
  const change = (id: string, value: string, dataset = {}) => listeners.change({ target: { id, value, dataset } });
  const separate = (checked: boolean) => listeners.change({ target: { id: "piece-rule-separate", checked } });
  const input = (id: string, value: string, dataset = {}) => listeners.input({ target: { id, value, dataset, selectionStart: value.length, selectionEnd: value.length } });
  const importFile = (text: string) => listeners.change({ target: { id: "setup-file-input", files: [{ text: async () => text }], value: "" } });
  const reload = async () => { elements.clear(); listeners = {}; timers.clear(); await import(`data:text/javascript;base64,${Buffer.from(`${source}\n// piece-editor-session ${++session}`).toString("base64")}`); };
  try {
    await reload(); await click("title-workshop"); await click("workshop-edit"); await click("", { workshopEdit: savedSetup.id });
    await click("", { editorPiece: "P" });
    expect(html()).toContain('id="editor-open-piece-settings"'); expect(html()).not.toContain("data-rule-offset");
    element(".editor-panel").scrollTop = 315;
    let resolveSetup!: (text: string) => void;
    const pendingSetup = listeners.change({ target: { id: "setup-file-input", files: [{ text: () => new Promise<string>(resolve => { resolveSetup = resolve; }) }], value: "" } });
    await click("editor-open-piece-settings");
    resolveSetup(JSON.stringify({ ...savedSetup.setup, name: "遅れて読み込んだ配置" })); await pendingSetup;
    expect(html()).toContain("歩兵の設定"); expect(html()).toContain('class="piece-editor-main"');
    expect(html()).not.toContain("data-editor-square"); expect(html()).not.toContain('id="editor-save-local"');
    expect((html().match(/data-rule-piece=/g) ?? [])).toHaveLength(8);
    expect(html()).toContain('aria-live="polite">5×5');
    expect(html()).toContain("移動・駒取りの方向・間隔"); expect(html()).not.toContain("data-rule-action=");
    await click("piece-grid-shrink"); expect((html().match(/data-rule-offset=/g) ?? [])).toHaveLength(8);
    await click("piece-grid-expand"); await click("piece-grid-expand"); await click("piece-grid-expand");
    expect(html()).toContain('aria-live="polite">9×9'); expect(html()).toContain("変更はありません");
    expect(element(".piece-rule-grid-viewport").scrollLeft).toBeGreaterThan(0);
    expect(element(".piece-rule-grid-viewport").scrollTop).toBeGreaterThan(0);
    element(".piece-rule-grid-viewport").scrollLeft = 88; element(".piece-rule-grid-viewport").scrollTop = 99;
    await click("editor-save-local"); await click("editor-apply");
    expect(readLocalSetups(storage)[0].setup.version).toBe(1); expect(values.get("shogi-game.v1")).toBe(previousMatch);
    element(".piece-editor-workspace").scrollTop = 420;
    await separate(true);
    await click("", { ruleAction: "captures" }); await click("piece-rule-clear");
    expect(element(".piece-rule-grid-viewport").scrollLeft).toBe(88); expect(element(".piece-rule-grid-viewport").scrollTop).toBe(99);
    await click("piece-grid-shrink"); await click("piece-grid-shrink");
    expect(element(".piece-editor-workspace").scrollTop).toBe(420);
    expect(html()).toContain("駒取りできる方向がありません");
    await click("", { ruleOffset: "-1,1" }); await click("", { ruleOffset: "1,1" });
    expect(html()).toContain('data-rule-offset="-1,1" aria-pressed="true"');
    await click("", { rulePiece: "R" }); expect(html()).toContain("飛車の設定");
    await click("piece-rule-clear"); await click("piece-editor-undo");
    await click("", { rulePiece: "P" }); expect(html()).toContain('data-rule-offset="-1,1" aria-pressed="true"');
    await click("piece-rule-copy"); await click("piece-editor-undo");
    await click("", { ruleAction: "moves" }); await change("", "2", { ruleRange: "0" });
    await change("piece-rule-dx", "-3"); await change("piece-rule-dy", "1"); await click("piece-rule-add");
    expect(html()).toContain("左3・前1"); expect(html()).toContain("範囲外に1件の設定");
    await click("piece-grid-fit"); expect(html()).toContain('data-rule-offset="-3,1" aria-pressed="true"');
    await click("piece-grid-shrink"); expect(html()).toContain("範囲外に1件の設定");
    await click("", { ruleRemove: "1" });
    await change("piece-rule-dx", "0"); await change("piece-rule-dy", "0"); await click("piece-rule-add");
    expect(element("#toast").textContent).toContain("現在のマス以外");
    await click("", { rulePromoted: "true" }); await separate(true); await click("", { ruleAction: "captures" }); await click("piece-rule-clear");
    await click("piece-rule-reset"); expect(html()).not.toContain("駒取りできる方向がありません");
    await separate(true); await click("", { ruleAction: "captures" });
    await click("piece-rule-clear");
    await click("", { rulePiece: "S" }); await click("", { rulePromoted: "false" }); await click("", { ruleAction: "moves" });
    await change("piece-rule-dx", "0"); await change("piece-rule-dy", "4"); await click("piece-rule-add");
    expect(html()).toContain("範囲外に1件の設定"); expect(html()).not.toContain('data-rule-offset="0,4"');
    await click("piece-editor-back");
    expect(html()).toContain("data-editor-square"); expect(html()).not.toContain("data-rule-offset");
    expect(html()).toContain('value="動きのテスト"'); expect(html()).not.toContain("遅れて読み込んだ配置");
    expect(element(".editor-panel").scrollTop).toBe(315);
    expect(html()).not.toMatch(/id="editor-promoted"[^>]*checked/);
    await click("editor-save-local");
    const customized = readLocalSetups(storage)[0];
    const customRules = customized.setup.pieceRules;
    if (!customRules) throw new Error("Missing saved piece rules");
    expect(customized.setup.version).toBe(2);
    expect(JSON.stringify(customized.setup)).not.toContain("displayRadius");
    expect(customized.setup.pieceRules?.P?.normal?.moves).toEqual([{ dx: 0, dy: 1, range: 2 }]);
    expect(customized.setup.pieceRules?.P?.normal?.captures).toEqual([{ dx: -1, dy: 1, range: 1 }, { dx: 1, dy: 1, range: 1 }]);
    expect(customized.setup.pieceRules?.P?.promoted?.captures).toEqual([]);
    expect(customized.setup.pieceRules?.P?.promoted?.moves).toEqual(PIECE_DEFINITIONS.P.promotion!.moves);
    expect(customized.setup.pieceRules?.S?.normal?.moves).toContainEqual({ dx: 0, dy: 4, range: 1 });
    expect(customized.setup.pieceRules?.S?.normal?.captures).toEqual(customized.setup.pieceRules?.S?.normal?.moves);
    expect(customized.setup.pieceRules?.P?.normal?.separateCapture).toBe(true);
    expect(PIECE_DEFINITIONS.P.captures).toEqual([{ dx: 0, dy: 1, range: 1 }]);
    expect(values.get("shogi-game.v1")).toBe(previousMatch);

    await click("editor-cancel"); await click("", { workshopCopy: savedSetup.id });
    await click("editor-export-setup"); const exportedText = await downloads[0].text();
    expect(JSON.parse(exportedText).pieceRules).toEqual(customized.setup.pieceRules);
    await click("editor-open-piece-settings"); await click("", { rulePromoted: "false" }); await click("", { ruleAction: "captures" }); await click("piece-rule-clear");
    await click("piece-editor-cancel"); await click("editor-export-setup");
    expect(JSON.parse(await downloads.at(-1)!.text()).pieceRules).toEqual(customRules);
    await click("editor-open-piece-settings"); await click("", { ruleAction: "captures" }); await click("piece-rule-clear");
    await listeners.keydown({ key: "Escape", preventDefault() {} });
    expect(html()).toContain("data-editor-square"); expect(html()).not.toContain("data-rule-offset");
    await click("editor-save-as"); input("editor-save-as-name", "コピーの動き"); await click("editor-confirm-save-as");
    expect(readLocalSetups(storage)).toHaveLength(2);
    expect(readLocalSetups(storage).find(entry => entry.id === savedSetup.id)?.setup.pieceRules).toEqual(customized.setup.pieceRules);
    await importFile(exportedText);
    const beforeInvalid = html(), malformed = JSON.parse(exportedText); malformed.pieceRules.P.normal.moves = [{ dx: 0, dy: 0, range: 1 }];
    await importFile(JSON.stringify(malformed)); expect(html()).toBe(beforeInvalid);
    await click("editor-apply");
    const customGame = JSON.parse(values.get("shogi-game.v1")!).game;
    expect(customGame.version).toBe(4); expect(customGame.pieceRules).toEqual(customized.setup.pieceRules);
    await click("", { square: "40" });
    expect(html()).toContain("駒取り：左1・前1、右1・前1");
    expect(html()).toMatch(/class="square [^"]*legal-target[^>]*data-square="30"/);
    expect(html()).not.toMatch(/class="square [^"]*legal-target[^>]*data-square="31"/);
    await click("", { square: "30" });
    expect(ShogiGame.load(JSON.parse(values.get("shogi-game.v1")!).game).position.hands.sente.R).toBe(1);
    await click("undo"); await change("ai-mode", "gote");
    const aiTimer = [...timers.entries()].find(([, timer]) => timer.delay === 250)!;
    expect(aiTimer).toBeDefined(); timers.delete(aiTimer[0]); aiTimer[1].callback();
    const worker = workers.at(-1)!;
    expect(worker.request.options.pieceRules).toEqual(customized.setup.pieceRules);
    const capture = legalMoves(worker.request.position, worker.request.options.pieceRules).find(move => move.from === 40 && move.to === 30)!;
    worker.reply(capture);
    expect(JSON.parse(values.get("shogi-game.v1")!).game.moves).toHaveLength(1);
    await change("ai-mode", "human"); await reload(); await click("title-continue");
    expect(ShogiGame.load(JSON.parse(values.get("shogi-game.v1")!).game).pieceRules).toEqual(customRules);
    await click("restart"); expect(JSON.parse(values.get("shogi-game.v1")!).game.pieceRules).toEqual(customized.setup.pieceRules);
    await click("edit-board"); await click("editor-open-piece-settings"); await click("", { rulePiece: "P" });
    await click("", { rulePromoted: "false" }); await click("", { ruleAction: "captures" });
    expect(html()).toContain('data-rule-offset="-1,1" aria-pressed="true"');
    await separate(false);
    expect(html()).not.toContain("data-rule-action="); expect(html()).toContain('data-rule-offset="0,1" aria-pressed="true"');
    await click("piece-editor-undo");
    expect(html()).toMatch(/id="piece-rule-separate"[^>]*checked/);
    await click("", { ruleAction: "captures" }); expect(html()).toContain('data-rule-offset="-1,1" aria-pressed="true"');
    await click("piece-editor-back");
    await click("editor-standard"); await click("editor-undo"); await click("editor-export-setup");
    expect(JSON.parse(await downloads.at(-1)!.text()).pieceRules).toEqual(customized.setup.pieceRules);
    await click("editor-cancel"); await click("to-title"); await click("title-standard");
    expect(JSON.parse(values.get("shogi-game.v1")!).game.version).toBe(3);
    expect(JSON.parse(values.get("shogi-game.v1")!).game.pieceRules).toBeUndefined();

    await click("to-title"); await click("title-workshop"); await click("workshop-edit"); await click("", { workshopEdit: savedSetup.id });
    await click("editor-open-piece-settings"); await click("", { rulePiece: "P" }); await click("", { rulePromoted: "false" });
    await click("", { pieceSection: "design" });
    expect(html()).toContain("先手のデザイン"); expect(html()).toContain("後手のデザイン"); expect(html()).not.toContain("data-rule-offset");
    const frontInput = { id: "", value: "", dataset: { designSide: "sente", designField: "text" }, selectionStart: 0, selectionEnd: 0 };
    const beforeComposition = html(), oldPreview = element('[data-design-preview="sente"]').innerHTML;
    listeners.compositionstart({ target: frontInput });
    for (const value of ["n", "ね", "ねk", "ねこ"]) { frontInput.value = value; listeners.input({ target: frontInput, isComposing: true }); }
    await listeners.change({ target: frontInput });
    let interceptedIMEKey = false;
    await listeners.keydown({ key: "Escape", isComposing: true, preventDefault() { interceptedIMEKey = true; } });
    expect(interceptedIMEKey).toBe(false); expect(html()).toBe(beforeComposition); expect(element('[data-design-preview="sente"]').innerHTML).toBe(oldPreview);
    frontInput.value = "猫"; listeners.compositionend({ target: frontInput });
    listeners.input({ target: frontInput, isComposing: false });
    expect(html()).toBe(beforeComposition); expect(element('[data-design-preview="sente"]').innerHTML).toContain("猫"); expect(element("#piece-editor-undo").disabled).toBe(false);
    await click("piece-editor-undo"); expect(html()).toContain('value="歩兵"'); expect(html()).not.toContain('value="ねk"');
    const beforeUntrackedIME = html();
    listeners.input({ target: { ...frontInput, value: "k" }, isComposing: true });
    expect(html()).toBe(beforeUntrackedIME);
    await listeners.keydown({ key: "Escape", keyCode: 229, preventDefault() { interceptedIMEKey = true; } });
    expect(interceptedIMEKey).toBe(false); expect(html()).toBe(beforeUntrackedIME);
    input("", "猫", { designSide: "sente", designField: "text" });
    await change("", "#ccdd88", { designSide: "sente", designField: "fill" });
    await change("", "circle", { designSide: "sente", designField: "shape" });
    const backInput = { id: "", value: "", dataset: { designSide: "gote", designField: "text" } }, beforeHangul = html();
    listeners.compositionstart({ target: backInput });
    // Some IMEs do not set InputEvent.isComposing consistently; composition events must also protect the field.
    for (const value of ["ㅎ", "하", "한"]) { backInput.value = value; listeners.input({ target: backInput }); }
    expect(html()).toBe(beforeHangul);
    listeners.compositionend({ target: backInput });
    await listeners.change({ target: backInput });
    expect(html()).toBe(beforeHangul); expect(element('[data-design-preview="gote"]').innerHTML).toContain("한");
    await change("", "square", { designSide: "gote", designField: "shape" });
    await click("piece-editor-add");
    const nameInput = { id: "piece-name", value: "sh", dataset: {} }, beforeName = html();
    listeners.compositionstart({ target: nameInput }); listeners.input({ target: nameInput, isComposing: false });
    await listeners.keydown({ key: "Escape", preventDefault() { interceptedIMEKey = true; } });
    expect(interceptedIMEKey).toBe(false); expect(html()).toBe(beforeName);
    nameInput.value = "新駒"; listeners.compositionend({ target: nameInput }); expect(element("#piece-editor-title").textContent).toBe("新駒の設定"); expect(html()).toBe(beforeName);
    input("piece-name", "砲&玉");
    expect(element("#piece-editor-title").textContent).toBe("砲&玉の設定"); expect(html()).toContain('data-rule-piece="custom_1" aria-pressed="true"');
    input("", "砲", { designSide: "sente", designField: "text" });
    await change("", "#d0eeaa", { designSide: "sente", designField: "fill" });
    await change("", "#123456", { designSide: "sente", designField: "color" });
    await change("", "circle", { designSide: "sente", designField: "shape" });
    input("", "炮", { designSide: "gote", designField: "text" });
    await change("", "#223344", { designSide: "gote", designField: "fill" });
    await change("", "#ffffff", { designSide: "gote", designField: "color" });
    await change("", "square", { designSide: "gote", designField: "shape" });
    expect(html()).toContain("piece-shape-circle"); expect(html()).toContain("piece-shape-square");
    await click("", { pieceSection: "movement" }); await click("", { ruleAction: "moves" }); await click("", { ruleOffset: "0,1" });
    await separate(true); await click("", { ruleAction: "captures" }); await click("piece-rule-clear");
    await click("", { ruleAction: "captures" }); await click("", { ruleOffset: "-1,1" }); await click("", { ruleOffset: "1,1" });
    await listeners.change({ target: { id: "piece-promotion", checked: true } });
    await click("", { rulePromoted: "true" }); await click("", { pieceSection: "design" });
    input("", "成砲", { designSide: "sente", designField: "text" }); input("", "成炮", { designSide: "gote", designField: "text" });
    await click("piece-editor-back");
    expect(html()).toContain('data-editor-piece="custom_1"');
    await click("", { editorPiece: "custom_1" }); await click("", { editorSide: "sente" }); await click("", { editorSquare: "40" });
    await click("", { editorSide: "gote" }); await click("", { editorSquare: "30" });
    await click("editor-save-local");
    const librarySetup = readLocalSetups(storage).find(entry => entry.id === savedSetup.id)!.setup;
    expect(librarySetup.version).toBe(3); expect(librarySetup.pieceRules?.custom_1?.definition?.name).toBe("砲&玉");
    expect(librarySetup.pieceRules?.P?.design?.normal?.sente?.text).toBe("猫"); expect(librarySetup.pieceRules?.P?.design?.normal?.gote?.text).toBe("한");
    expect(librarySetup.pieceRules?.custom_1?.design?.normal?.sente?.text).toBe("砲");
    expect(librarySetup.pieceRules?.custom_1?.design?.normal?.gote?.text).toBe("炮");
    expect(readLocalSetups(storage).find(entry => entry.id !== savedSetup.id)?.setup.pieceRules?.custom_1).toBeUndefined();
    await click("editor-export-setup"); expect(JSON.parse(await downloads.at(-1)!.text()).pieceRules).toEqual(librarySetup.pieceRules);
    await click("editor-cancel"); expect(html()).toContain("piece-shape-circle"); expect(html()).toContain("piece-shape-square");
    await click("", { workshopEdit: savedSetup.id }); await click("editor-apply");
    expect(JSON.parse(values.get("shogi-game.v1")!).game.version).toBe(5);
    expect(html()).toContain("background:#d0eeaa"); expect(html()).toContain("background:#223344");
    await click("", { square: "40" }); await click("", { square: "30" });
    const capturedCustom = ShogiGame.load(JSON.parse(values.get("shogi-game.v1")!).game);
    expect(capturedCustom.position.hands.sente.custom_1).toBe(1); expect(html()).toContain('data-hand="custom_1"');
    await click("", { square: "0" }); await click("", { square: "1" });
    await click("", { hand: "custom_1", side: "sente", handIndex: "0" }); await click("", { square: "60" });
    expect(ShogiGame.load(JSON.parse(values.get("shogi-game.v1")!).game).position.board[60]).toEqual({ type: "custom_1", side: "sente", promoted: false });
    await reload(); await click("title-continue"); expect(html()).toContain("background:#d0eeaa");
    await click("edit-board"); await click("", { editorPiece: "custom_1" }); await click("editor-standard");
    expect(html()).not.toContain('data-editor-piece="custom_1"'); expect(html()).toContain('data-editor-piece="P" aria-pressed="true"');
    await click("editor-undo"); expect(html()).toContain('data-editor-piece="custom_1"');
    await click("editor-cancel"); await click("to-title"); await click("title-standard");
    expect(JSON.parse(values.get("shogi-game.v1")!).game.pieceRules).toBeUndefined();
  } finally { timers.clear(); blobs.clear(); Object.assign(URL, originalURLs); Object.assign(globalThis, originals); }
});
