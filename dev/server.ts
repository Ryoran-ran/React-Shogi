import { resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { buildScriptVM } from "./bundles";
const root = resolve(import.meta.dir, "..");
const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
let scriptVM: Promise<string> | undefined, scriptVMTime = -1;
function currentScriptVM(): Promise<string> {
  const modified = statSync(resolve(root, "src/scriptvm.ts")).mtimeMs;
  if (!scriptVM || modified !== scriptVMTime) { scriptVMTime = modified; scriptVM = buildScriptVM(); }
  return scriptVM;
}
const server = Bun.serve({
  hostname: "127.0.0.1", port: Number(process.env.PORT || 5173),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/src/scriptvm.js") {
      try { return new Response(await currentScriptVM(), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } }); }
      catch (error) { return new Response(String(error), { status: 500 }); }
    }
    if (path === "/web/app.js" || /^\/src\/[a-z]+\.js$/.test(path)) {
      try {
        const source = readFileSync(resolve(root, path.slice(1).replace(/\.js$/, ".ts")), "utf8");
        const output = transpiler.transformSync(source).replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, "$1$2.js$3");
        return new Response(output, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
      } catch (e) { return new Response(String(e), { status: 500 }); }
    }
    const files: Record<string, string> = { "/": "web/index.html", "/style.css": "web/style.css" };
    if (!files[path]) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(resolve(root, files[path])), { headers: { "Cache-Control": "no-store" } });
  }
});
console.log(`Board Game Maker: http://localhost:${server.port}`);
