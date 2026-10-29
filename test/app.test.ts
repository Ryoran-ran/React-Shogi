import { expect, test } from "bun:test";

test("two players move, choose promotion, drop captures, undo, and restore a saved game through the UI", async () => {
  const listeners: Record<string, (e: any) => any> = {}, elements = new Map<string, any>();
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", value: "", classList: { add() {}, remove() {} }, focus() {}, scrollTop: 0, scrollHeight: 0 });
    return elements.get(selector);
  };
  let stored = "";
  Object.assign(globalThis, {
    document: { querySelector: element, addEventListener: (name: string, callback: any) => { listeners[name] = callback; } },
    localStorage: { getItem: () => null, setItem: (_key: string, value: string) => { stored = value; } },
    confirm: () => true
  });
  await import("../web/app");
  const click = async (data: Record<string, string> = {}, id = "") => listeners.click({ target: { closest: () => ({ dataset: data, id, disabled: false }) } });
  const square = (i: number) => click({ square: String(i) });
  const html = () => element("#app").innerHTML as string;
  expect((html().match(/data-square=/g) ?? [])).toHaveLength(81);
  expect(html()).toContain("先手の手番");
  await square(56); expect(html()).toContain("歩の移動する場所を選んでください"); expect(html()).toContain("move-dot");
  await square(47); expect(html()).toContain("後手の手番"); expect(html()).toContain("▲７六歩");
  await square(56); expect(JSON.parse(stored).game.moves).toHaveLength(1);
  await square(24); await square(33);
  await square(64); await square(16);
  expect(html()).toContain("角を成りますか？");
  expect(JSON.parse(stored).game.moves).toHaveLength(2);
  await click({ promote: "yes" });
  expect(html()).toContain("▲２二角成"); expect(html()).toContain("先手の持ち駒 角 1枚");
  await square(18); await square(27);
  await click({ hand: "B", side: "sente" }); await square(40);
  expect(html()).toContain("▲５五角打"); expect(JSON.parse(stored).game.moves).toHaveLength(5);
  await click({}, "undo"); expect(JSON.parse(stored).game.moves).toHaveLength(4); expect(html()).toContain("先手の持ち駒 角 1枚");
  await click({}, "flip"); expect(JSON.parse(stored).flipped).toBe(true);
  await click({}, "open-history"); expect(html()).toContain('role="dialog" aria-modal="true" aria-label="棋譜"');
  await click({}, "close-history"); expect(html()).not.toContain('role="dialog" aria-modal="true" aria-label="棋譜"');
  const backup = JSON.parse(stored).game;
  await click({}, "resign"); expect(html()).toContain("後手の勝ち");
  await click({}, "undo"); expect(html()).toContain("先手の手番"); expect(JSON.parse(stored).game.moves).toHaveLength(4);
  await click({}, "restart"); expect(html()).toContain("まだ、まっさらな盤面。");
  await listeners.change({ target: { id: "file-input", files: [{ text: async () => JSON.stringify(backup) }], value: "" } });
  expect(html()).toContain("▲２二角成"); expect(JSON.parse(stored).game.moves).toHaveLength(4);
  await listeners.change({ target: { id: "file-input", files: [{ text: async () => "{}" }], value: "" } });
  expect(element("#toast").textContent).toContain("読み込めませんでした"); expect(JSON.parse(stored).game.moves).toHaveLength(4);
  const pawnCaptures = [
    [61, 52], [18, 27], [52, 43], [27, 36], [43, 34], [25, 34],
    [70, 34], [36, 45], [34, 33], [45, 54], [33, 24], [54, 63]
  ].map(([from, to]) => ({ from, to, promote: false }));
  await listeners.change({ target: { id: "file-input", files: [{ text: async () => JSON.stringify({ version: 1, moves: pawnCaptures }) }], value: "" } });
  expect((html().match(/data-hand="P" data-side="sente"/g) ?? [])).toHaveLength(2);
  expect(html()).not.toContain("<b>2</b>");
  expect(html()).toMatch(/class="[^"]*stand-upper-left[^"]*" data-player="sente"/);
  await click({}, "flip");
  expect(html()).toMatch(/class="[^"]*stand-lower-right[^"]*" data-player="sente"/);
  await click({ hand: "P", side: "sente", handIndex: "1" });
  expect((html().match(/hand-piece owned selected-hand/g) ?? [])).toHaveLength(1);
  await square(43);
  expect((html().match(/data-hand="P" data-side="sente"/g) ?? [])).toHaveLength(1);
  await click({}, "undo");
  expect((html().match(/data-hand="P" data-side="sente"/g) ?? [])).toHaveLength(2);
});
