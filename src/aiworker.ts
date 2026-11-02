import type { AIRequest, AIReply } from "./ai";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AIRequest>) => Promise<void>) | null;
  postMessage: (reply: AIReply) => void;
};
let engine: Promise<typeof import("./ai")> | undefined;
const prepare = () => engine ??= import("./ai.js");
let latestRequest = 0;

// Install the handler before asynchronous WASM/module initialization. Module workers can
// otherwise dispatch the parent's first message while top-level await is still pending.
scope.onmessage = async event => {
  const { id, position, options } = event.data;
  latestRequest = id;
  try {
    const engine = await prepare();
    await engine.prepareAI?.(options);
    if(id!==latestRequest)return;
    const {chooseAIMove}=engine;
    let lastUpdate = -Infinity;
    const result = chooseAIMove(position, options, (candidate,checkpoint) => {
      const now = performance.now();
      if (!checkpoint && now - lastUpdate < 25) return;
      lastUpdate = now;
      scope.postMessage({id,result:candidate,progress:true});
    });
    scope.postMessage({ id, result });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : "AI の処理に失敗しました" });
  }
};
// Warm up without blocking registration or emitting an unhandled startup rejection.
void prepare().catch(() => {});
