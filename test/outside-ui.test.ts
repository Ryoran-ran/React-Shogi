import { expect, test } from "bun:test";
import { importUI } from "./importui";
import { ShogiGame } from "../src/shogi";
import { EDITOR_DRAFT_KEY } from "../src/editordraft";
import { readLocalSetups } from "../src/setups";

test("outside settings, editing, round-trip play, flip, storage and recovery use the shared UI", async () => {
  const url = new URL("../web/app.ts", import.meta.url);
  const source = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(await Bun.file(url).text())
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, a, b, c) => `${a}${new URL(b, url).href}${c}`)
    .replaceAll("import.meta.url", JSON.stringify(url.href));
  const original = { document: globalThis.document, localStorage: globalThis.localStorage, confirm: globalThis.confirm, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const values = new Map<string, string>(), elements = new Map<string, any>();
  let listeners: Record<string, (event: any) => any> = {}, sequence = 0;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", value: "", dataset: {}, classList: { add() {}, remove() {} }, focus() {}, click() {}, scrollTop: 0 });
    return elements.get(selector);
  };
  Object.assign(globalThis, { document: { querySelector: element, addEventListener: (name: string, callback: any) => { listeners[name] = callback; } }, localStorage: storage, confirm: () => true, setTimeout: () => ++sequence, clearTimeout() {} });
  const click = (id = "", dataset = {}) => listeners.click({ target: { closest: () => ({ id, dataset, disabled: false }) } });
  const change = (id: string, value: string, dataset = {}, checked?: boolean) => listeners.change({ target: { id, value, dataset, checked } });
  const html = () => element("#app").innerHTML as string;
  const draft = () => JSON.parse(values.get(EDITOR_DRAFT_KEY)!);
  const storedGame = () => ShogiGame.load(JSON.parse(values.get("shogi-game.v1")!).game);
  const reload = async () => { elements.clear(); listeners = {}; await importUI(`${source}\n// outside-session ${++sequence}`); };
  try {
    await reload(); await click("title-workshop"); await click("workshop-new");
    await change("editor-width", "5"); await change("editor-height", "5");
    await click("", { editorPiece: "K" }); await click("", { editorSquare: "24" });
    await click("", { editorSide: "gote" }); await click("", { editorSquare: "0" });
    await click("", { editorSide: "sente" }); await click("", { editorPiece: "R" }); await click("", { editorSquare: "11" });
    await change("", "", { basicRule: "selfCheck" }, false); await change("editor-promotion-depth", "0");
    await change("editor-pass-limit", ""); await change("editor-outside-margin", "1");
    expect(draft().snapshot.position.board[23].type).toBe("R");
    expect(html()).toContain("5×5盤・場外1マス");
    expect((html().match(/class="square(?: |")/g) ?? []).length).toBe(25);
    expect((html().match(/class="outside-slot(?: |")/g) ?? []).length).toBe(24);
    expect(html()).toContain('aria-label="場外(0,3) 空きマス"');
    await click("editor-undo"); expect(draft().snapshot.position.outsideMargin).toBeUndefined();
    await click("editor-redo"); expect(draft().snapshot.position.outsideMargin).toBe(1);
    await change("editor-width", "6"); expect(draft().snapshot.position.width).toBe(8);
    await click("editor-undo");
    await click("editor-save-local"); expect(readLocalSetups(storage)[0].setup.version).toBe(12);
    await reload(); await click("editor-restore-draft"); expect(html()).toContain("5×5盤・場外1マス");
    await click("editor-apply");
    expect((html().match(/data-square=/g) ?? []).length).toBe(49);
    await click("", { square: "23" }); await click("", { square: "21" });
    expect(storedGame().position.board[21]?.type).toBe("R");
    expect(html()).toContain("場外(0,3)");
    await click("flip");
    expect(html().indexOf('data-square="48"')).toBeLessThan(html().indexOf('data-square="0"'));
    await click("pass"); await click("", { square: "21" }); await click("", { square: "23" });
    expect(storedGame().position.board[23]?.type).toBe("R");
    await click("undo"); expect(storedGame().position.board[21]?.type).toBe("R");
    await reload(); await click("title-continue");
    expect(html()).toContain("場外の駒は、駒置き場や他のUIに重なって表示されます。");
    expect(storedGame().position.board[21]?.type).toBe("R");
  } finally { Object.assign(globalThis, original); }
});
