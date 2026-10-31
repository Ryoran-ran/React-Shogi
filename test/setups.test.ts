import { expect, test } from "bun:test";
import { createSetup, copySetup, availableSetupName, loadSetup, readLocalSetups, saveLocalSetup, removeLocalSetup, setupFilename, SETUP_STORAGE_KEY, MAX_LOCAL_SETUPS } from "../src/setups";
import { emptyPosition, setupIssues } from "../src/shogi";

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("standalone setup files preserve unfinished rectangular layouts and settings without sharing mutable data", () => {
  const p = emptyPosition(5, 7); p.turn = "gote"; p.hands.sente.B = 2;
  p.board[19] = { type: "S", side: "gote", promoted: true };
  expect(setupIssues(p)).toHaveLength(2);
  const setup = createSetup(p, 2, "  小さい盤  ");
  const loaded = loadSetup(JSON.parse(JSON.stringify(setup)));
  expect(loaded).toEqual(setup); expect(loaded.name).toBe("小さい盤"); expect(loaded.position).toEqual(p);
  p.board.fill(null); loaded.position.hands.sente.B = 0;
  expect(setup.position.board[19]?.promoted).toBe(true); expect(setup.position.hands.sente.B).toBe(2);
  expect(createSetup(emptyPosition(3, 3), null).name).toBe("3×3の配置");
  expect(loadSetup(createSetup(emptyPosition(3, 3), 0)).passLimit).toBe(0);
});

test("setup files validate their format, dimensions, pieces, hands, name and pass limit", () => {
  const setup = createSetup(emptyPosition(5, 7), null);
  for (const invalid of [null, {}, { ...setup, kind: "other" }, { ...setup, version: 2 }, { ...setup, name: 3 }, { ...setup, name: "あ".repeat(81) }, { ...setup, passLimit: -1 }, { ...setup, passLimit: "1" }, { ...setup, passLimit: undefined }, { ...setup, position: { ...setup.position, width: 100 } }, { ...setup, position: { ...setup.position, board: [] } }, { ...setup, position: { ...setup.position, hands: {} } }, { ...setup, position: { ...setup.position, turn: "other" } }]) expect(() => loadSetup(invalid)).toThrow();
  const promotedKing = emptyPosition(5, 7); promotedKing.board[0] = { type: "K", side: "gote", promoted: true };
  expect(() => createSetup(promotedKing, null)).toThrow();
  expect(setupFilename({ ...setup, name: '小盤/試作:1?*"<>|\\' })).toBe("shogi-setup-小盤_試作_1_______.json");
});

test("copies preserve settings independently and suggest unique names within the name length limit", () => {
  const position = emptyPosition(5, 7); position.turn = "gote"; position.hands.sente.B = 2;
  position.board[19] = { type: "S", side: "gote", promoted: true };
  const source = createSetup(position, 2, "小盤");
  const copy = copySetup(source, ["小盤", "小盤のコピー", "小盤のコピー (2)"]);
  expect(copy.name).toBe("小盤のコピー (3)"); expect(copy.position).toEqual(source.position); expect(copy.passLimit).toBe(2);
  copy.position.board[19] = null; copy.position.hands.sente.B = 0;
  expect(source.position.board[19]?.promoted).toBe(true); expect(source.position.hands.sente.B).toBe(2);
  expect(copySetup(source).name).toBe("小盤のコピー");
  expect(availableSetupName("  新しい名前  ", ["小盤"])).toBe("新しい名前");
  const long = createSetup(position, null, "あ".repeat(80)), longCopy = copySetup(long);
  expect(longCopy.name).toHaveLength(80); expect(longCopy.name.endsWith("のコピー")).toBe(true);
  expect(loadSetup(longCopy).name).toBe(longCopy.name);
});

test("named local setups support independent copies, explicit overwrite, reopen and deletion", () => {
  const storage = memoryStorage(); storage.setItem("shogi-game.v1", "existing game");
  expect(readLocalSetups(storage)).toEqual([]);
  const first = saveLocalSetup(storage, createSetup(emptyPosition(5, 7), 1, "A"));
  const second = saveLocalSetup(storage, createSetup(emptyPosition(6, 8), 2, "B"));
  expect(first.id).not.toBe(second.id); expect(readLocalSetups(storage).map(entry => entry.setup.name)).toEqual(["B", "A"]);
  first.setup.position.width = 100;
  expect(readLocalSetups(storage)[1].setup.position.width).toBe(5);
  saveLocalSetup(storage, createSetup(emptyPosition(4, 7), 0, "A改"), first.id);
  const reopened = { getItem: storage.getItem, setItem: storage.setItem };
  expect(readLocalSetups(reopened).map(entry => [entry.id, entry.setup.name])).toEqual([[first.id, "A改"], [second.id, "B"]]);
  removeLocalSetup(reopened, first.id);
  expect(readLocalSetups(storage).map(entry => entry.id)).toEqual([second.id]);
  expect(() => removeLocalSetup(storage, first.id)).toThrow("見つかりません");
  expect(() => saveLocalSetup(storage, createSetup(emptyPosition(), null), first.id)).toThrow("新しく保存");
  expect(() => saveLocalSetup(storage, createSetup(emptyPosition(), null), "")).toThrow("新しく保存");
  expect(storage.getItem("shogi-game.v1")).toBe("existing game");
});

test("corrupt local setup data is reported and never overwritten during a failed save", () => {
  const storage = memoryStorage(), setup = createSetup(emptyPosition(), null);
  const entry = { id: "test", updatedAt: "2026-10-31T00:00:00.000Z", setup };
  for (const raw of ["broken JSON", "null", JSON.stringify({ version: 1, entries: [] }), JSON.stringify({ kind: "shogi-setup-library", version: 2, entries: [] }), JSON.stringify({ kind: "shogi-setup-library", version: 1, entries: [entry, entry] }), JSON.stringify({ kind: "shogi-setup-library", version: 1, entries: [{ ...entry, updatedAt: "invalid" }] }), JSON.stringify({ kind: "shogi-setup-library", version: 1, entries: [{ ...entry, setup: {} }] })]) {
    storage.setItem(SETUP_STORAGE_KEY, raw);
    expect(() => readLocalSetups(storage)).toThrow("読み込めません");
    expect(() => saveLocalSetup(storage, setup)).toThrow();
    expect(storage.getItem(SETUP_STORAGE_KEY)).toBe(raw);
  }
});

test("storage access and quota failures leave saved configurations intact", () => {
  const storage = memoryStorage(), setup = createSetup(emptyPosition(), null);
  const entry = saveLocalSetup(storage, setup), before = storage.getItem(SETUP_STORAGE_KEY);
  const blockedWrites = { getItem: storage.getItem, setItem() { throw new Error("quota exceeded"); } };
  expect(() => saveLocalSetup(blockedWrites, setup, entry.id)).toThrow("ファイルに出力");
  expect(() => removeLocalSetup(blockedWrites, entry.id)).toThrow("ファイルに出力");
  expect(storage.getItem(SETUP_STORAGE_KEY)).toBe(before);
  expect(() => readLocalSetups({ getItem() { throw new Error("access denied"); }, setItem() {} })).toThrow("読み込めません");
});

test("a full local library still supports replacing an existing setup", () => {
  const storage = memoryStorage(), setup = createSetup(emptyPosition(), null);
  const entries = Array.from({ length: MAX_LOCAL_SETUPS }, (_, i) => ({ id: String(i), updatedAt: "2026-10-31T00:00:00.000Z", setup }));
  storage.setItem(SETUP_STORAGE_KEY, JSON.stringify({ kind: "shogi-setup-library", version: 1, entries }));
  expect(() => saveLocalSetup(storage, setup)).toThrow(`${MAX_LOCAL_SETUPS}件`);
  saveLocalSetup(storage, { ...setup, name: "更新" }, "0");
  expect(readLocalSetups(storage)).toHaveLength(MAX_LOCAL_SETUPS); expect(readLocalSetups(storage)[0].setup.name).toBe("更新");
});
