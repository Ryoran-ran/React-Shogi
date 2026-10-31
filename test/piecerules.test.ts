import { describe, expect, test } from "bun:test";
import { loadPieceRules, pieceState, PIECE_DEFINITIONS, MAX_MOVEMENT_RULES } from "../src/pieces";
import type { PieceRules } from "../src/pieces";
import { BoardEditor } from "../src/editor";
import { ShogiGame, emptyPosition, legalMoves, inCheck, attacks } from "../src/shogi";
import { chooseAIMove } from "../src/ai";
import type { AIReply } from "../src/ai";
import { createSetup, copySetup, loadSetup, saveLocalSetup, readLocalSetups } from "../src/setups";

const pawn: PieceRules = { P: { normal: { moves: [{ dx: 0, dy: 1, range: 1 }], captures: [{ dx: -1, dy: 1, range: 1 }, { dx: 1, dy: 1, range: 1 }] } } };
function kings() {
  const position = emptyPosition();
  position.board[80] = { type: "K", side: "sente" as const, promoted: false };
  position.board[0] = { type: "K", side: "gote" as const, promoted: false };
  return position;
}

describe("editable piece rules", () => {
  test("imported rules are bounded, independently copied and normalized against the shogi preset", () => {
    const source = JSON.parse(JSON.stringify(pawn)), loaded = loadPieceRules(source);
    source.P.normal.captures[0].dy = -1;
    expect(loaded.P?.normal?.captures[0].dy).toBe(1);
    const standard = pieceState({ type: "P", promoted: false });
    expect(loadPieceRules({ P: { normal: { moves: standard.moves, captures: standard.captures } } })).toEqual({});
    for (const invalid of [null, [], { X: {} }, { K: { promoted: { moves: [], captures: [] } } }, { P: { other: {} } }, { P: { normal: { moves: [] } } }, { P: { normal: { moves: [], captures: [], name: "変更" } } }]) expect(() => loadPieceRules(invalid)).toThrow();
    for (const move of [
      { dx: 0, dy: 0, range: 1 }, { dx: 15, dy: 1, range: 1 }, { dx: 0.5, dy: 1, range: 1 },
      { dx: 1, dy: Infinity, range: 1 }, { dx: 0, dy: 1, range: 0 }, { dx: 0, dy: 1, range: 15 },
      { dx: 0, dy: 1, range: NaN }, { dx: 0, dy: 1, range: "1" },
    ]) expect(() => loadPieceRules({ P: { normal: { moves: [move], captures: [] } } })).toThrow();
    expect(() => loadPieceRules({ P: { normal: { moves: [standard.moves[0], standard.moves[0]], captures: [] } } })).toThrow("重複");
    expect(() => loadPieceRules({ P: { normal: { moves: Array(MAX_MOVEMENT_RULES + 1).fill(standard.moves[0]), captures: [] } } })).toThrow("方向以内");
    expect(loadPieceRules({ P: { normal: { moves: [{ dx: -14, dy: 14, range: null }], captures: [] } } }).P?.normal?.moves[0].range).toBeNull();
  });

  test("board editing keeps normal and promoted rules separate, with undo and standard restoration", () => {
    const editor = new BoardEditor(kings());
    editor.setPieceMovements("P", false, "captures", pawn.P!.normal!.captures);
    const customized = editor.pieceRules;
    expect(pieceState({ type: "P", promoted: false }, customized).moves).toEqual(PIECE_DEFINITIONS.P.moves);
    expect(pieceState({ type: "P", promoted: true }, customized).captures).toEqual(PIECE_DEFINITIONS.P.promotion!.captures);
    editor.setPieceMovements("P", true, "moves", []);
    expect(pieceState({ type: "P", promoted: true }, editor.pieceRules).moves).toEqual([]);
    editor.undo(); expect(editor.pieceRules).toEqual(customized);
    editor.resize(5, 7); editor.clear(); expect(editor.pieceRules).toEqual(customized);
    editor.resetPieceMovements("P", false); expect(editor.pieceRules).toEqual({});
    editor.undo(); expect(editor.pieceRules).toEqual(customized);
    editor.reset(undefined, {}); expect(editor.position.width).toBe(9); expect(editor.pieceRules).toEqual({});
    editor.undo(); expect(editor.position.width).toBe(5); expect(editor.pieceRules).toEqual(customized);
    expect(() => editor.setPieceMovements("K", true, "moves", [])).toThrow();
  });

  test("custom capture directions drive legal moves, king safety, AI, undo and game reload", () => {
    const position = kings(); position.board[40] = { type: "P", side: "sente", promoted: false };
    position.board[30] = { type: "R", side: "gote", promoted: false };
    position.board[31] = { type: "P", side: "gote", promoted: false };
    const source = JSON.parse(JSON.stringify(pawn)), game = new ShogiGame(position, { passLimit: 1, pieceRules: source });
    source.P.normal.captures = [];
    const capture = { from: 40, to: 30, promote: false };
    expect(legalMoves(position, game.pieceRules).filter(move => move.from === 40)).toEqual([capture]);
    expect(attacks(position, 40, game.pieceRules)).toEqual([30, 32]);
    expect(() => game.play({ from: 40, to: 31, promote: false })).toThrow();
    expect(chooseAIMove(position, { maxDepth: 1, maxNodes: 1000, maxTimeMs: 5000, pieceRules: game.pieceRules }).move).toEqual(capture);
    game.play(capture); expect(game.position.hands.sente.R).toBe(1);
    const saved = game.save(); expect(saved.version).toBe(4);
    const loaded = ShogiGame.load(JSON.parse(JSON.stringify(saved)));
    expect(loaded.position).toEqual(game.position); expect(loaded.pieceRules).toEqual(pawn);
    expect(loaded.records).toEqual(game.records); loaded.undo(); expect(loaded.position).toEqual(position);
    for (const invalid of [{ ...saved, pieceRules: undefined }, { ...saved, version: 3 }, { ...saved, pieceRules: null }]) expect(() => ShogiGame.load(invalid)).toThrow();

    const safety = kings(); safety.board[80] = null;
    safety.board[58] = { type: "K", side: "sente", promoted: false };
    safety.board[40] = { type: "P", side: "gote", promoted: false };
    const targets = legalMoves(safety, pawn).filter(move => move.from === 58).map(move => move.to);
    expect(targets).toContain(49); expect(targets).not.toContain(48); expect(targets).not.toContain(50);
    safety.board[58] = null; safety.board[49] = { type: "K", side: "sente", promoted: false };
    expect(inCheck(safety, "sente", pawn)).toBe(false);
    safety.board[49] = null; safety.board[48] = { type: "K", side: "sente", promoted: false };
    expect(inCheck(safety, "sente", pawn)).toBe(true);
  });

  test("custom setup files, local saves and copies preserve the rules without changing their source", () => {
    const source = createSetup(kings(), 2, "動きを変えた配置", pawn);
    expect(source.version).toBe(2);
    const copied = copySetup(source); expect(copied.pieceRules).toEqual(pawn);
    const changed = JSON.parse(JSON.stringify(copied)); changed.pieceRules.P.normal.captures = [];
    expect(source.pieceRules).toEqual(pawn);
    expect(loadSetup(JSON.parse(JSON.stringify(source)))).toEqual(source);
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    saveLocalSetup(storage, source); saveLocalSetup(storage, changed);
    expect(readLocalSetups(storage)[1].setup.pieceRules).toEqual(pawn);
    expect(readLocalSetups(storage)[0].setup.pieceRules?.P?.normal?.captures).toEqual([]);
    expect(() => loadSetup({ ...source, version: 1 })).toThrow();
    expect(() => loadSetup({ ...source, pieceRules: undefined })).toThrow();
    expect(loadSetup(createSetup(kings(), 0)).version).toBe(1);
    expect(new ShogiGame().save().version).toBe(3);
  });

  test("configured pawn capture rays permit a blocking drop while still forbidding drop mate", () => {
    const rules = loadPieceRules({ P: { normal: { moves: PIECE_DEFINITIONS.P.moves, captures: [{ dx: 0, dy: 1, range: null }] } } });
    const position = kings(); position.board[0] = null; position.board[4] = { type: "K", side: "gote", promoted: false };
    position.board[30] = { type: "R", side: "sente", promoted: false }; position.board[32] = { type: "R", side: "sente", promoted: false };
    position.hands.sente.P = 1;
    expect(legalMoves(position, rules).some(move => move.drop === "P" && move.to === 31)).toBe(false);
    position.hands.gote.G = 1;
    const game = new ShogiGame(position, { pieceRules: rules }); game.play({ drop: "P", to: 31, promote: false });
    expect(inCheck(game.position, "gote", rules)).toBe(true);
    game.play({ drop: "G", to: 13, promote: false }); expect(inCheck(game.position, "gote", rules)).toBe(false);
  });

  test("AI workers receive the custom rules with their request", async () => {
    const position = kings(); position.board[40] = { type: "P", side: "sente", promoted: false }; position.board[30] = { type: "R", side: "gote", promoted: false };
    const worker = new Worker(new URL("../src/aiworker.ts", import.meta.url).href, { type: "module" });
    let timeout: ReturnType<typeof setTimeout>;
    try {
      const reply = await new Promise<AIReply>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("AI worker timed out")), 4000);
        worker.onmessage = event => resolve(event.data as AIReply); worker.onerror = () => reject(new Error("AI worker failed"));
        worker.postMessage({ id: 91, position, options: { pieceRules: pawn, maxDepth: 1, maxNodes: 1000, maxTimeMs: 5000 } });
      });
      expect(reply.id).toBe(91); expect("result" in reply).toBe(true);
      if ("result" in reply) expect(reply.result.move).toEqual({ from: 40, to: 30, promote: false });
    } finally { clearTimeout(timeout!); worker.terminate(); }
  });
});
