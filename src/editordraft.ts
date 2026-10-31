import { validatePosition } from "./shogi";
import { loadPieceRules, pieceTypes } from "./pieces";
import { loadRuleScript } from "./scriptconfig";
import { PieceEditor } from "./pieceeditor";
import type { PieceEditorDraft } from "./pieceeditor";
import type { EditorSnapshot } from "./editor";
import type { PieceType } from "./pieces";
export const EDITOR_DRAFT_KEY = "shogi-editor-draft.v1";
export interface EditorDraft {
  version: 1; updatedAt: string; snapshot: EditorSnapshot;
  meta: { name: string; passLimitText: string; loadedId: string | null; returnTo: "game" | "workshop" };
  pieceDraft?: PieceEditorDraft;
  codeDraft?: { source: string; piece?: PieceType };
  ui?: { tool: "place" | "select" | "move" | "copy"; square: number; dataText: string | null };
}
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readEditorDraft(storage: DraftStorage): EditorDraft | null {
  const raw = storage.getItem(EDITOR_DRAFT_KEY); if (raw === null) return null;
  if (raw.length > 2000000) throw new Error("編集の下書きが大きすぎます");
  const draft = JSON.parse(raw) as EditorDraft;
  if (draft.version !== 1 || !draft.snapshot || !draft.meta || typeof draft.updatedAt !== "string" || !Number.isFinite(Date.parse(draft.updatedAt)) || typeof draft.meta.name !== "string" || draft.meta.name.length > 1000 || typeof draft.meta.passLimitText !== "string" || draft.meta.passLimitText.length > 40 || !["game","workshop"].includes(draft.meta.returnTo) || (draft.meta.loadedId !== null && (typeof draft.meta.loadedId !== "string" || draft.meta.loadedId.length > 128))) throw new Error("編集の下書きが壊れています");
  draft.snapshot.rules = loadPieceRules(draft.snapshot.rules); draft.snapshot.script = loadRuleScript(draft.snapshot.script); validatePosition(draft.snapshot.position, draft.snapshot.rules);
  if (draft.pieceDraft) draft.pieceDraft = PieceEditor.restore(draft.pieceDraft).draft;
  if (draft.codeDraft) {
    draft.codeDraft.source = loadRuleScript(draft.codeDraft.source);
    if (draft.codeDraft.piece && (!draft.pieceDraft || draft.pieceDraft.piece !== draft.codeDraft.piece || !pieceTypes(draft.pieceDraft.rules).includes(draft.codeDraft.piece))) throw new Error("駒コードの下書きが壊れています");
  }
  if (draft.ui && (!["place","select","move","copy"].includes(draft.ui.tool) || !Number.isInteger(draft.ui.square) || draft.ui.square < -1 || draft.ui.square >= draft.snapshot.position.board.length || (draft.ui.dataText !== null && (typeof draft.ui.dataText !== "string" || draft.ui.dataText.length > 30000)))) throw new Error("配置編集の下書きが壊れています");
  return structuredClone(draft);
}
export function saveEditorDraft(storage: DraftStorage, draft: EditorDraft): void {
  const text = JSON.stringify(draft); if (text.length > 2000000) throw new Error("下書きが大きすぎます。配置をファイルに保存してください"); storage.setItem(EDITOR_DRAFT_KEY, text);
}
export function clearEditorDraft(storage: DraftStorage): void { storage.removeItem(EDITOR_DRAFT_KEY); }
