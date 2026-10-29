import { chooseAIMove } from "./ai";
import type { AIRequest, AIReply } from "./ai";
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<AIRequest>) => void) | null; postMessage: (reply: AIReply) => void };
scope.onmessage = event => {
  const { id, position, options } = event.data;
  try { scope.postMessage({ id, result: chooseAIMove(position, options) }); }
  catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : "AI の処理に失敗しました" }); }
};
