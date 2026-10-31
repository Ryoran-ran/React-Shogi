import { expect, test } from "bun:test";
import { PieceEditor } from "../src/pieceeditor";
import { BoardEditor } from "../src/editor";
import { ShogiGame, initialPosition } from "../src/shogi";
import { pieceState, loadPieceRules } from "../src/pieces";
import { createSetup, loadSetup, copySetup } from "../src/setups";

test("piece settings use an isolated draft and are applied to board history as one change", () => {
  const board = new BoardEditor(initialPosition()); board.setTurn("gote");
  const position = board.position, draft = new PieceEditor(board.pieceRules);
  draft.handleClick({ id: "piece-editor-undo" }); expect(board.position).toEqual(position);
  draft.handleChange({ id: "piece-rule-separate", checked: true });
  draft.handleClick({ id: "", dataset: { ruleAction: "captures" } });
  draft.handleClick({ id: "piece-rule-clear" });
  draft.handleClick({ id: "", dataset: { ruleOffset: "-1,1" } });
  draft.handleClick({ id: "", dataset: { ruleOffset: "1,1" } });
  draft.handleClick({ id: "", dataset: { rulePiece: "R" } });
  draft.handleClick({ id: "piece-rule-clear" });
  expect(draft.view.changed).toBe(true); expect(draft.view.canUndo).toBe(true);
  expect(board.pieceRules).toEqual({}); expect(board.position).toEqual(position);
  const cloned = JSON.parse(JSON.stringify(draft.pieceRules)); cloned.P.normal.captures = [];
  expect(draft.pieceRules.P?.normal?.captures).toHaveLength(2);
  board.setPieceRules(draft.pieceRules);
  expect(pieceState({ type: "R", promoted: false }, board.pieceRules).captures).toEqual([]);
  expect(board.position).toEqual(position);
  board.undo(); expect(board.pieceRules).toEqual({}); expect(board.position).toEqual(position);
  draft.handleClick({ id: "piece-editor-undo" });
  expect(draft.pieceRules.R).toBeUndefined(); expect(draft.pieceRules.P?.normal?.captures).toHaveLength(2);
});

test("piece selection, normal and promoted states, and invalid edits remain local to the settings screen", () => {
  const draft = new PieceEditor({}, "P", true);
  draft.handleChange({ id: "piece-rule-separate", checked: true });
  draft.handleClick({ id: "", dataset: { ruleAction: "captures" } }); draft.handleClick({ id: "piece-rule-clear" });
  expect(draft.pieceRules.P?.promoted?.captures).toEqual([]);
  draft.handleClick({ id: "", dataset: { rulePiece: "K" } });
  expect(draft.view.promoted).toBe(false);
  draft.handleClick({ id: "", dataset: { rulePromoted: "true" } }); expect(draft.view.promoted).toBe(false);
  draft.handleClick({ id: "", dataset: { rulePiece: "P" } });
  expect(draft.view.promoted).toBe(false); expect(draft.pieceRules.P?.normal).toBeUndefined();
  draft.handleChange({ id: "piece-rule-dx", value: "0" }); draft.handleChange({ id: "piece-rule-dy", value: "0" });
  const beforeInvalid = draft.pieceRules;
  expect(() => draft.handleClick({ id: "piece-rule-add" })).toThrow("現在のマス以外");
  expect(draft.pieceRules).toEqual(beforeInvalid);
  draft.handleClick({ id: "piece-editor-undo" });
  expect(draft.view.separateCapture).toBe(false);
  draft.handleClick({ id: "piece-editor-undo" });
  expect(draft.pieceRules).toEqual({}); expect(draft.view.changed).toBe(false); expect(draft.view.canUndo).toBe(false);
  expect(draft.handleClick({ id: "editor-clear" })).toBeNull();
});

test("movement edits are shared by default, including ranges, deletion, clearing and promoted states", () => {
  const draft = new PieceEditor();
  expect(draft.view.separateCapture).toBe(false);
  expect(draft.render()).toContain("移動・駒取りの方向・間隔");
  expect(draft.render()).not.toContain("data-rule-action=");
  expect(draft.render()).not.toContain('id="piece-rule-copy"');
  draft.handleClick({ id: "", dataset: { ruleOffset: "1,1" } });
  draft.handleChange({ id: "", dataset: { ruleRange: "1" }, value: "edge" });
  let state = pieceState({ type: "P", promoted: false }, draft.pieceRules);
  expect(state.moves).toEqual([{ dx: 0, dy: 1, range: 1 }, { dx: 1, dy: 1, range: null }]);
  expect(state.captures).toEqual(state.moves);
  draft.handleClick({ id: "", dataset: { ruleRemove: "0" } });
  state = pieceState({ type: "P", promoted: false }, draft.pieceRules);
  expect(state.moves).toEqual([{ dx: 1, dy: 1, range: null }]); expect(state.captures).toEqual(state.moves);
  draft.handleClick({ id: "piece-rule-clear" });
  state = pieceState({ type: "P", promoted: false }, draft.pieceRules);
  expect(state.moves).toEqual([]); expect(state.captures).toEqual([]);
  draft.handleClick({ id: "piece-editor-undo" });
  expect(pieceState({ type: "P", promoted: false }, draft.pieceRules).captures).toEqual([{ dx: 1, dy: 1, range: null }]);
  draft.handleClick({ id: "", dataset: { rulePromoted: "true" } });
  draft.handleChange({ id: "piece-rule-dx", value: "2" });
  draft.handleChange({ id: "piece-rule-dy", value: "3" });
  draft.handleClick({ id: "piece-rule-add" });
  state = pieceState({ type: "P", promoted: true }, draft.pieceRules);
  expect(state.moves).toContainEqual({ dx: 2, dy: 3, range: 1 }); expect(state.captures).toEqual(state.moves);
  draft.handleClick({ id: "", dataset: { rulePromoted: "false" } });
  draft.handleClick({ id: "piece-rule-reset" });
  expect(draft.pieceRules.P?.normal).toBeUndefined(); expect(draft.pieceRules.P?.promoted).toBeDefined();
});

test("separate actions keep their values until merged from movement, with undo and per-state selection", () => {
  const draft = new PieceEditor();
  draft.handleChange({ id: "piece-rule-separate", checked: true });
  expect(draft.view.separateCapture).toBe(true); expect(draft.view.changed).toBe(true);
  expect(draft.render()).toContain('data-rule-action="captures"');
  expect(new PieceEditor(draft.pieceRules).view.separateCapture).toBe(true);
  draft.handleClick({ id: "", dataset: { ruleAction: "captures" } });
  draft.handleClick({ id: "piece-rule-clear" });
  draft.handleClick({ id: "", dataset: { ruleOffset: "-1,1" } });
  const separate = draft.pieceRules;
  expect(pieceState({ type: "P", promoted: false }, separate).moves).toEqual([{ dx: 0, dy: 1, range: 1 }]);
  draft.handleClick({ id: "", dataset: { rulePromoted: "true" } });
  expect(draft.view.separateCapture).toBe(false); expect(draft.view.action).toBe("moves");
  draft.handleClick({ id: "", dataset: { rulePromoted: "false" } });
  expect(draft.view.separateCapture).toBe(true); expect(draft.view.action).toBe("captures");
  draft.handleChange({ id: "piece-rule-separate", checked: false });
  expect(draft.pieceRules).toEqual({}); expect(draft.view.action).toBe("moves");
  draft.handleClick({ id: "piece-editor-undo" });
  expect(draft.pieceRules).toEqual(separate); expect(draft.view.separateCapture).toBe(true);
  draft.handleClick({ id: "", dataset: { ruleAction: "moves" } });
  draft.handleClick({ id: "piece-rule-copy" });
  expect(draft.view.separateCapture).toBe(true);
  expect(pieceState({ type: "P", promoted: false }, draft.pieceRules).captures).toEqual([{ dx: 0, dy: 1, range: 1 }]);
  draft.handleClick({ id: "", dataset: { rulePiece: "R" } }); expect(draft.view.separateCapture).toBe(false);
  const legacy = new PieceEditor({ P: { normal: { moves: [{ dx: 0, dy: 1, range: 1 }], captures: [] } } });
  expect(legacy.view.separateCapture).toBe(true);
  legacy.handleClick({ id: "", dataset: { ruleAction: "moves" } }); legacy.handleClick({ id: "piece-rule-clear" });
  expect(legacy.view.separateCapture).toBe(true);
});

test("the separate setting survives files, copies and newly added pieces even with identical actions", () => {
  const draft = new PieceEditor();
  draft.handleChange({ id: "piece-rule-separate", checked: true });
  draft.handleClick({ id: "", dataset: { rulePromoted: "true" } });
  draft.handleChange({ id: "piece-rule-separate", checked: true });
  const setup = createSetup(initialPosition(), null, "個別設定", draft.pieceRules);
  for (const rules of [loadSetup(JSON.parse(JSON.stringify(setup))).pieceRules, copySetup(setup).pieceRules, ShogiGame.load(JSON.parse(JSON.stringify(new ShogiGame(initialPosition(), { pieceRules: draft.pieceRules }).save()))).pieceRules]) {
    expect(new PieceEditor(rules).view.separateCapture).toBe(true);
    expect(new PieceEditor(rules, "P", true).view.separateCapture).toBe(true);
  }
  draft.handleClick({ id: "piece-editor-copy" });
  expect(draft.view.separateCapture).toBe(true);
  draft.handleClick({ id: "", dataset: { rulePromoted: "true" } }); expect(draft.view.separateCapture).toBe(true);
  draft.handleClick({ id: "piece-editor-add" }); expect(draft.view.separateCapture).toBe(false);
  const reordered = new PieceEditor({ P: { normal: { moves: [{ dx: -1, dy: 1, range: 1 }, { dx: 1, dy: 1, range: 1 }], captures: [{ dx: 1, dy: 1, range: 1 }, { dx: -1, dy: 1, range: 1 }] } } });
  expect(reordered.view.separateCapture).toBe(false);
  expect(() => loadPieceRules({ P: { normal: { moves: [], captures: [], separateCapture: "yes" } } })).toThrow();
});

test("display resizing keeps off-grid settings and fits only the selected action without creating edits", () => {
  const draft = new PieceEditor({ P: { normal: {
    moves: [{ dx: 0, dy: 4, range: 2 }],
    captures: [{ dx: -1, dy: 1, range: 1 }, { dx: 1, dy: 1, range: 1 }],
  } } });
  const rules = draft.pieceRules;
  expect(draft.view.displayRadius).toBe(2);
  expect(draft.render()).toContain("範囲外に1件の設定");
  expect(draft.render()).not.toContain('data-rule-offset="0,4"');
  draft.handleClick({ id: "piece-grid-shrink" });
  expect(draft.render()).toContain("3×3"); expect(draft.pieceRules).toEqual(rules);
  draft.handleClick({ id: "piece-grid-fit" });
  expect(draft.render()).toContain("9×9");
  expect(draft.render()).toContain('data-rule-offset="0,4" aria-pressed="true"');
  draft.handleClick({ id: "piece-grid-shrink" });
  expect(draft.render()).toContain("範囲外に1件の設定");
  draft.handleClick({ id: "", dataset: { ruleAction: "captures" } });
  draft.handleClick({ id: "piece-grid-fit" });
  expect(draft.render()).toContain("3×3"); expect(draft.render()).not.toContain("範囲外に1件");
  expect(draft.pieceRules).toEqual(rules);
  expect(draft.view.changed).toBe(false); expect(draft.view.canUndo).toBe(false);
});

test("the full supported range remains editable and display changes never consume rule undo history", () => {
  const draft = new PieceEditor();
  for (let i = 0; i < 20; i++) draft.handleClick({ id: "piece-grid-expand" });
  expect(draft.render()).toContain("29×29");
  expect(draft.render()).toMatch(/id="piece-grid-expand"[^>]*disabled/);
  expect((draft.render().match(/data-rule-offset=/g) ?? [])).toHaveLength(840);
  expect((draft.render().match(/class="piece-rule-origin"/g) ?? [])).toHaveLength(1);
  draft.handleClick({ id: "", dataset: { ruleOffset: "-14,14" } });
  const rules = draft.pieceRules;
  draft.handleClick({ id: "piece-grid-shrink" });
  expect(draft.render()).toContain("範囲外に1件の設定"); expect(draft.pieceRules).toEqual(rules);
  draft.handleClick({ id: "piece-grid-fit" });
  expect(draft.render()).toContain('data-rule-offset="-14,14" aria-pressed="true"');
  draft.handleClick({ id: "piece-editor-undo" });
  expect(draft.pieceRules).toEqual({}); expect(draft.view.canUndo).toBe(false); expect(draft.view.displayRadius).toBe(14);
  for (let i = 0; i < 20; i++) draft.handleClick({ id: "piece-grid-shrink" });
  expect(draft.render()).toContain("3×3"); expect(draft.render()).toMatch(/id="piece-grid-shrink"[^>]*disabled/);
  draft.handleClick({ id: "piece-rule-clear" }); draft.handleClick({ id: "piece-grid-fit" });
  expect(draft.view.displayRadius).toBe(1); expect(draft.view.canUndo).toBe(true);
  draft.handleClick({ id: "piece-editor-undo" }); expect(draft.pieceRules).toEqual({});
});
