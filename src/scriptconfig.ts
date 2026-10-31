export const MAX_SCRIPT_LENGTH = 30000;
export const SCRIPT_HOOKS = ["onStart", "validateMove", "beforeMove", "beforeCapture", "afterCapture", "afterCaptured", "afterMove", "afterDestroy", "turnEnd", "turnStart", "checkResult"];
export const PIECE_SCRIPT_HOOKS = SCRIPT_HOOKS.filter(hook => hook !== "checkResult");
export function loadRuleScript(value: unknown = ""): string {
  if (typeof value !== "string" || value.length > MAX_SCRIPT_LENGTH) throw new Error(`ルールコードは${MAX_SCRIPT_LENGTH}文字以内で入力してください`);
  return value.trim() ? value : "";
}
