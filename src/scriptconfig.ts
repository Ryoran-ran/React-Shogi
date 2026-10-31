export const MAX_SCRIPT_LENGTH = 30000;
export type ScriptValue = null | boolean | number | string | ScriptValue[] | { [key: string]: ScriptValue };
export type ScriptData = { [key: string]: ScriptValue };
export function validateScriptData(value: unknown): asserts value is ScriptData {
  let count = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++count > 4000 || depth > 12) throw new Error("ルールの独自データが大きすぎます");
    if (item === null || typeof item === "boolean" || typeof item === "string") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object") throw new Error("独自データにはJSONで保存できる値を使ってください");
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("独自データに使用できない名前です");
      visit(child, depth + 1);
    }
  };
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 20000) throw new Error("ルールの独自データが壊れています");
  visit(value, 0);
}
export const SCRIPT_HOOKS = ["onStart", "validateMove", "beforeMove", "beforeCapture", "afterCapture", "afterCaptured", "afterMove", "afterDestroy", "turnEnd", "turnStart", "checkResult"];
export const PIECE_SCRIPT_HOOKS = SCRIPT_HOOKS.filter(hook => hook !== "checkResult");
export function loadRuleScript(value: unknown = ""): string {
  if (typeof value !== "string" || value.length > MAX_SCRIPT_LENGTH) throw new Error(`ルールコードは${MAX_SCRIPT_LENGTH}文字以内で入力してください`);
  return value.trim() ? value : "";
}
