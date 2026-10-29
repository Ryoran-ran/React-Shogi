import { resolve } from "node:path";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
const root = resolve(import.meta.dir, "..");
const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
for (const folder of ["src", "web"]) {
  mkdirSync(resolve(root, "dist", folder), { recursive: true });
  for (const name of readdirSync(resolve(root, folder)).filter(n => n.endsWith(".ts"))) {
    const js = transpiler.transformSync(readFileSync(resolve(root, folder, name), "utf8")).replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, "$1$2.js$3");
    writeFileSync(resolve(root, "dist", folder, name.replace(/\.ts$/, ".js")), js);
  }
}
copyFileSync(resolve(root, "web/index.html"), resolve(root, "dist/index.html"));
copyFileSync(resolve(root, "web/style.css"), resolve(root, "dist/style.css"));
console.log("Built dist/");
