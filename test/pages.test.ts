import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { checkBrowserStartup } from "../dev/browsercheck";
import { buildSite } from "../dev/build";

test("the built site starts under a GitHub Pages project path with styles, Special and AI", async () => {
  await buildSite();
  const prefix = "/React-Shogi/", directory = resolve(import.meta.dir, "../dist");
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (!path.startsWith(prefix)) return new Response("Not found", { status: 404 });
      const file = Bun.file(resolve(directory, path.slice(prefix.length) || "index.html"));
      return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
    },
  });
  try {
    const url = `http://127.0.0.1:${server.port}${prefix}`;
    const html = await (await fetch(url)).text();
    const stylesheet = html.match(/rel="stylesheet" href="([^"]+)"/)?.[1];
    expect(stylesheet).toBe("./style.css");
    const css = await fetch(new URL(stylesheet!, url));
    expect(css.status).toBe(200); expect(await css.text()).toContain(".board");
    expect(await checkBrowserStartup(url)).toEqual({ title: true, error: false, script: true });
    expect(await Bun.file(resolve(directory, ".nojekyll")).exists()).toBe(true);
  } finally { server.stop(true); }
}, 15000);
