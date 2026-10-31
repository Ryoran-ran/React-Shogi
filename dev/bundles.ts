import { resolve } from "node:path";
export async function buildScriptVM(): Promise<string> {
  const result = await Bun.build({ entrypoints: [resolve(import.meta.dir, "../src/scriptvm.ts")], target: "browser", format: "esm", minify: true });
  if (!result.success) throw new Error(result.logs.map(log => log.message).join("\n"));
  return result.outputs[0].text();
}
