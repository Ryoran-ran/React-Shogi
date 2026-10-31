import { expect, test } from "bun:test";
import { checkBrowserStartup } from "../dev/browsercheck";

test("served browser modules start the title and script engine, and show a recoverable loading error", async () => {
  const child = Bun.spawn([process.execPath, "dev/server.ts"], { env: { ...process.env, PORT: "0" }, stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader(), first = await reader.read();
    const port = new TextDecoder().decode(first.value).match(/localhost:(\d+)/)?.[1];
    if (!port) throw new Error("起動テスト用の開発サーバーを開始できませんでした");
    const url = `http://localhost:${port}/`;
    expect(await checkBrowserStartup(url)).toEqual({ title: true, error: false, script: true });
    expect(await checkBrowserStartup(url, true)).toEqual({ title: false, error: true, script: false });
  } finally { child.kill(); await child.exited; }
}, 10000);
