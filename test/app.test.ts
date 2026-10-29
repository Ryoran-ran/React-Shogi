import { expect, test } from "bun:test";
import { legalMoves } from "../src/shogi";
import type { AIRequest } from "../src/ai";

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
  expect(html()).toContain('aria-labelledby="result-title"'); expect(html()).toContain("投了によって対局が終了しました");
  expect(html()).toContain('result-backdrop is-fresh');
  await click({}, "result-view-board"); expect(html()).not.toContain('aria-labelledby="result-title"');
  expect(html()).toContain('id="show-result"'); expect(JSON.parse(stored).game.moves).toHaveLength(4);
  await click({}, "show-result"); expect(html()).toContain('aria-labelledby="result-title"');
  expect(html()).not.toContain('result-backdrop is-fresh');
  await listeners.keydown({ key: "Escape", preventDefault() {} });
  expect(html()).not.toContain('aria-labelledby="result-title"');
  await click({}, "undo"); expect(html()).toContain("先手の手番"); expect(JSON.parse(stored).game.moves).toHaveLength(4);
  expect(html()).not.toContain('id="show-result"');
  await click({}, "draw"); expect(html()).toContain('result-dialog result-draw'); expect(html()).toContain("合意による引き分け");
  await click({}, "result-restart"); expect(html()).toContain("まだ、まっさらな盤面。");
  expect(html()).not.toContain('aria-labelledby="result-title"');
  await listeners.change({ target: { id: "file-input", files: [{ text: async () => JSON.stringify(backup) }], value: "" } });
  expect(html()).toContain("▲２二角成"); expect(JSON.parse(stored).game.moves).toHaveLength(4);
  await listeners.change({ target: { id: "file-input", files: [{ text: async () => "{}" }], value: "" } });
  expect(element("#toast").textContent).toContain("読み込めませんでした"); expect(JSON.parse(stored).game.moves).toHaveLength(4);
  const pawnCaptures = [
    [61, 52], [18, 27], [52, 43], [27, 36], [43, 34], [25, 34],
    [70, 34], [36, 45], [34, 33], [45, 54], [33, 24], [54, 63]
  ].map(([from, to]) => ({ from, to, promote: false }));
  await listeners.change({ target: { id: "file-input", files: [{ text: async () => JSON.stringify({ version: 1, moves: pawnCaptures }) }], value: "" } });
  expect((html().match(/data-hand="P" data-side="sente"/g) ?? [])).toHaveLength(1);
  expect((html().match(/class="hand-count"[^>]*>2<\/span>/g) ?? [])).toHaveLength(2);
  expect(html()).not.toContain("<b>2</b>");
  expect(html()).toMatch(/class="[^"]*stand-upper-left[^"]*" data-player="sente"/);
  await click({}, "flip");
  expect(html()).toMatch(/class="[^"]*stand-lower-right[^"]*" data-player="sente"/);
  await click({ hand: "P", side: "sente", handIndex: "0" });
  expect((html().match(/hand-piece owned selected-hand/g) ?? [])).toHaveLength(1);
  await square(43);
  expect((html().match(/data-hand="P" data-side="sente"/g) ?? [])).toHaveLength(1);
  expect((html().match(/class="hand-count"[^>]*>2<\/span>/g) ?? [])).toHaveLength(1);
  await click({}, "undo");
  expect((html().match(/data-hand="P" data-side="sente"/g) ?? [])).toHaveLength(1);
  expect((html().match(/class="hand-count"[^>]*>2<\/span>/g) ?? [])).toHaveLength(2);

  const nativeWorker = globalThis.Worker;
  const workers: MockWorker[] = [];
  class MockWorker {
    request!: AIRequest;
    onmessage: ((event: any) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(request: AIRequest) { this.request = structuredClone(request); }
    terminate() { this.terminated = true; }
    reply() { this.onmessage?.({ data: { id: this.request.id, result: { move: legalMoves(this.request.position)[0], depth: 1, nodes: 1, score: 0 } } }); }
  }
  Object.assign(globalThis, { Worker: MockWorker });
  const change = (id: string, value: string) => listeners.change({ target: { id, value } });
  try {
    const beforeAI = JSON.parse(stored).game.moves.length;
    await change("ai-mode", "gote"); // Human is gote; AI automatically plays sente.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(workers).toHaveLength(1); expect(html()).toContain("AI 思考中…");
    await square(61); expect(JSON.parse(stored).game.moves).toHaveLength(beforeAI);
    workers[0].reply(); expect(JSON.parse(stored).game.moves).toHaveLength(beforeAI + 1);
    await click({}, "undo"); expect(JSON.parse(stored).game.moves).toHaveLength(beforeAI);
    workers[0].reply(); expect(JSON.parse(stored).game.moves).toHaveLength(beforeAI); // Stale reply must be ignored.
    await click({}, "ai-step"); expect(workers).toHaveLength(2);
    await click({}, "restart"); expect(workers[1].terminated).toBe(true);
    workers[1].reply(); expect(JSON.parse(stored).game.moves).toHaveLength(0);
    await change("ai-mode", "both");
    await click({}, "ai-step"); expect(workers).toHaveLength(3);
    workers[2].reply(); expect(JSON.parse(stored).game.moves).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 300)); expect(workers).toHaveLength(3);
    await click({}, "ai-toggle");
    await new Promise(resolve => setTimeout(resolve, 300)); expect(workers).toHaveLength(4);
    workers[3].reply(); expect(JSON.parse(stored).game.moves).toHaveLength(2);
    await click({}, "ai-toggle");
    await new Promise(resolve => setTimeout(resolve, 300)); expect(workers).toHaveLength(4);
    expect(html()).toContain("停止中");
    await click({}, "ai-step"); workers[4].onerror?.();
    expect(element("#toast").textContent).toContain("AI を起動できませんでした");
    expect(JSON.parse(stored).game.moves).toHaveLength(2);
  } finally { await change("ai-mode", "human"); Object.assign(globalThis, { Worker: nativeWorker }); }
});
