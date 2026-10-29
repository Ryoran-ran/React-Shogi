import { resolve } from "node:path";
import { readFileSync } from "node:fs";
const root = resolve(import.meta.dir, "..");
const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
const server = Bun.serve({
  hostname: "127.0.0.1", port: Number(process.env.PORT || 5173),
  async fetch(request) {
    const path = new URL(request.url).pathname;
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
