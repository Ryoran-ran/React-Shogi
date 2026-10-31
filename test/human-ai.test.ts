import { expect, test } from "bun:test";
import { ShogiGame, emptyPosition, legalMoves, positionAfterLegalMove, positionKey } from "../src/shogi";
import type { GameMove, SavedGame } from "../src/shogi";
import type { AIRequest } from "../src/ai";

test("human-AI games automatically start, respond, reload, import and resume while explicit pauses persist", async () => {
  const entryURL = new URL("../web/app.ts", import.meta.url);
  // A fresh data module simulates reloads without Bun reusing the app module cache.
  const appSource = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(await Bun.file(entryURL).text())
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, path, suffix) => `${prefix}${new URL(path, entryURL).href}${suffix}`)
    .replaceAll("import.meta.url", JSON.stringify(entryURL.href));
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage, confirm: globalThis.confirm, Worker: globalThis.Worker, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let listeners: Record<string, (event: any) => any> = {}, stored = "", session = 0, nextTimer = 0;
  const elements = new Map<string, any>(), timers = new Map<number, { callback: () => void; delay: number }>();
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", classList: { add() {}, remove() {} }, focus() {}, scrollTop: 0, scrollHeight: 0 });
    return elements.get(selector);
  };
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
  Object.assign(globalThis, {
    document: { querySelector: element, addEventListener: (name: string, callback: any) => { listeners[name] = callback; } },
    localStorage: { getItem: (key: string) => key === "shogi-game.v1" ? stored : null, setItem: (key: string, value: string) => { if (key === "shogi-game.v1") stored = value; } },
    confirm: () => true, Worker: MockWorker,
    setTimeout: (callback: () => void, delay = 0) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); }
  });
  const html = () => element("#app").innerHTML as string;
  const count = () => JSON.parse(stored).game.moves.length;
  const change = (id: string, value: string) => listeners.change({ target: { id, value } });
  const click = (id: string, dataset = {}) => listeners.click({ target: { closest: () => ({ id, dataset, disabled: false }) } });
  const aiTimers = () => [...timers.entries()].filter(([, timer]) => timer.delay === 250);
  const tickAI = () => {
    expect(aiTimers()).toHaveLength(1);
    const [id, timer] = aiTimers()[0]; timers.delete(id); timer.callback();
  };
  const playHuman = async () => {
    const move = legalMoves(ShogiGame.load(JSON.parse(stored).game).position).find(move => move.from !== undefined && !move.promote);
    if (!move) throw new Error("No human board move");
    await click("", { square: String(move.from) }); await click("", { square: String(move.to) });
  };
  const load = async (data: { game: SavedGame; aiMode: string; aiPaused?: boolean }) => {
    if (listeners.change) await change("ai-mode", "human");
    timers.clear(); elements.clear(); workers.length = 0; listeners = {}; stored = JSON.stringify(data);
    await import(`data:text/javascript;base64,${Buffer.from(`${appSource}\n// session ${++session}`).toString("base64")}`);
    expect(aiTimers()).toHaveLength(0); expect(html()).toContain("遊び方を選んでください");
    await click("title-continue");
  };
  try {
    await load({ game: new ShogiGame().save(), aiMode: "gote" });
    tickAI(); expect(workers).toHaveLength(1); workers[0].reply();
    expect(count()).toBe(1); expect(aiTimers()).toHaveLength(0);
    expect(html()).toContain("自分の手番（AIは自動応手）");
    expect(html()).toMatch(/id="undo" disabled/); // No human move to take back yet.
    await playHuman(); tickAI(); workers[1].reply(); expect(count()).toBe(3);
    expect(html()).toContain("↶ 待った");
    await click("undo"); expect(count()).toBe(1); expect(aiTimers()).toHaveLength(0);

    await playHuman(); tickAI();
    await click("ai-toggle", { aiAction: "stop" });
    expect(html()).toContain("停止予約済み"); workers[2].reply();
    expect(count()).toBe(3); expect(JSON.parse(stored).aiPaused).toBe(true);
    await playHuman(); expect(count()).toBe(4); expect(aiTimers()).toHaveLength(0);
    const paused = JSON.parse(stored), aiTurn = paused.game;
    await load(paused); expect(aiTimers()).toHaveLength(0); expect(html()).toContain("▶ AIを再開");
    await click("edit-board"); await click("editor-cancel"); expect(aiTimers()).toHaveLength(0);
    await click("ai-toggle"); tickAI(); workers[0].reply(); expect(count()).toBe(5);

    await load({ game: aiTurn, aiMode: "gote" });
    tickAI(); const oldWorker = workers[0];
    await click("edit-board"); expect(oldWorker.terminated).toBe(true);
    oldWorker.reply(); expect(count()).toBe(4); expect(aiTimers()).toHaveLength(0);
    await click("editor-cancel"); tickAI(); workers[1].reply(); expect(count()).toBe(5);
    await listeners.change({ target: { id: "file-input", files: [{ text: async () => JSON.stringify(aiTurn) }], value: "" } });
    tickAI(); workers[2].reply(); expect(count()).toBe(5);

    await playHuman(); tickAI(); workers[3].onerror?.();
    expect(aiTimers()).toHaveLength(0); expect(JSON.parse(stored).aiPaused).toBe(true);
    await click("ai-toggle"); tickAI(); workers[4].reply(); expect(count()).toBe(7);
    await click("edit-board"); await click("editor-apply");
    expect(count()).toBe(0); tickAI(); workers[5].reply(); expect(count()).toBe(1);

    await load({ game: new ShogiGame().save(), aiMode: "sente" });
    expect(aiTimers()).toHaveLength(0); await playHuman(); tickAI(); workers[0].reply(); expect(count()).toBe(2);
    await click("undo"); expect(count()).toBe(0); expect(aiTimers()).toHaveLength(0);
    await playHuman(); tickAI(); const interrupted = workers[1];
    await click("undo"); expect(interrupted.terminated).toBe(true); expect(count()).toBe(0);
    interrupted.reply(); expect(count()).toBe(0); expect(aiTimers()).toHaveLength(0);

    const p = emptyPosition();
    p.board[80] = { type: "K", side: "sente", promoted: false }; p.board[0] = { type: "K", side: "gote", promoted: false };
    const mirror = new ShogiGame(p);
    await load({ game: mirror.save(), aiMode: "sente" });
    let seed = 12345;
    const nextMove = () => {
      const previous = mirror.positionHistory, position = mirror.position;
      const candidates = legalMoves(position).map(move => ({ move, visits: previous.filter(key => key === positionKey(positionAfterLegalMove(position, move))).length })).filter(candidate => candidate.visits < 3);
      const leastVisited = Math.min(...candidates.map(candidate => candidate.visits));
      const choices = candidates.filter(candidate => candidate.visits === leastVisited);
      if (!choices.length) throw new Error("No move avoiding repetition");
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return choices[(seed >>> 0) % choices.length].move;
    };
    for (let round = 0; round < 101; round++) {
      const human = nextMove(); await click("", { square: String(human.from) }); await click("", { square: String(human.to) }); mirror.play(human);
      tickAI(); const ai = nextMove(); workers.at(-1)!.reply(ai); mirror.play(ai);
    }
    expect(count()).toBe(202); expect(mirror.result).toBeNull(); expect(html()).not.toContain("停止中");

    await load({ game: aiTurn, aiMode: "both" }); expect(aiTimers()).toHaveLength(0);
    await click("ai-toggle"); tickAI(); workers[0].reply(); expect(aiTimers()).toHaveLength(1);
    const finished = new ShogiGame(); finished.resign();
    await load({ game: finished.save(), aiMode: "gote" });
    expect(aiTimers()).toHaveLength(0); expect(workers).toHaveLength(0); expect(html()).toContain('aria-labelledby="result-title"');
  } finally {
    if (listeners.change) await change("ai-mode", "human");
    timers.clear(); Object.assign(globalThis, originals);
  }
});
