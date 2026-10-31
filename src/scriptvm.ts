import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-cjs-release-sync";

// A fresh context for every simulation prevents module globals from leaking between turns or AI branches.
const quickJS = await newQuickJSWASMModuleFromVariant(variant);
export function evaluateRule(source: string, program: string, input: string, pieceSources: Record<string, string> = {}): string {
  const runtime = quickJS.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  let cycles = 0;
  const deadline = performance.now() + 150;
  runtime.setInterruptHandler(() => ++cycles > 256 || performance.now() > deadline);
  const vm = runtime.newContext();
  try {
    vm.unwrapResult(vm.evalCode('globalThis.Date = undefined; Math.random = () => { throw new Error("乱数は ctx.random() を使ってください"); };')).dispose();
    const runner = vm.unwrapResult(vm.evalCode(program, "rule-api.js"));
    try {
      const module = vm.unwrapResult(vm.evalCode(source || "export default {};", "board-rule.js", { type: "module" }));
      try {
        const rules = vm.getProp(module, "default"), payload = vm.newString(input), pieces = vm.newObject();
        try {
          for (const [type, code] of Object.entries(pieceSources)) {
            const pieceModule = vm.unwrapResult(vm.evalCode(code, `piece-${type}.js`, { type: "module" }));
            try { const handlers = vm.getProp(pieceModule, "default"); try { vm.setProp(pieces, type, handlers); } finally { handlers.dispose(); } }
            finally { pieceModule.dispose(); }
          }
          const result = vm.unwrapResult(vm.callFunction(runner, vm.undefined, rules, payload, pieces));
          try { return vm.getString(result); } finally { result.dispose(); }
        } finally { pieces.dispose(); payload.dispose(); rules.dispose(); }
      } finally { module.dispose(); }
    } finally { runner.dispose(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ルールスクリプト：${message.slice(0, 600)}`);
  } finally { vm.dispose(); runtime.dispose(); }
}
