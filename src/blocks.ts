import type { Action, Expression, GameDefinition, RuleDefinition } from "./types";
import { clone, validateDefinition } from "./validation";

export type BlockAction = Action | { kind: "flipStones"; position: Expression; ownerId: Expression; typeId: string };
export type BlockRule = Omit<RuleDefinition, "actions"> & { actions: BlockAction[] };

// Editor-only macro; the stored definition contains only the public Action AST.
function expandAction(action: BlockAction): Action {
  if (action.kind === "flipStones") {
    return {
      kind: "forEach",
      list: { kind: "call", fn: "flipTargets", args: [clone(action.position), clone(action.ownerId), { kind: "literal", value: action.typeId }] },
      as: "flipStoneId",
      actions: [{ kind: "setObject", objectId: { kind: "ref", scope: "local", path: ["flipStoneId"] }, field: "ownerId", value: clone(action.ownerId) }]
    };
  }
  return clone(action);
}
export function compileBlockRules(definition: Omit<GameDefinition, "rules">, rules: BlockRule[]): GameDefinition {
  return validateDefinition({ ...clone(definition), rules: rules.map(rule => ({ ...clone(rule), actions: rule.actions.map(expandAction) })) });
}
