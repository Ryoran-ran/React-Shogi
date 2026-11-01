type Engine = typeof import("./scriptengine");
let engine: Engine | undefined, loading: Promise<void> | undefined, attempts=0;
export function ruleEngineReady(): boolean { return engine !== undefined; }
export function prepareRuleEngine(): Promise<void> {
  if(engine)return Promise.resolve();
  if(!loading){
    const attempt=attempts++;
    const imported=attempt===0?import("./scriptengine.js"):import(new URL(`./scriptengine.js?retry=${attempt}`,import.meta.url).href);
    loading=imported.then(module=>{engine=module;}).catch(error=>{loading=undefined;throw error;});
  }
  return loading;
}
export function evaluateRule(...args: Parameters<Engine["evaluateRule"]>): string {
  if(!engine)throw new Error("追加ルールの実行環境を読み込んでから再試行してください");
  return engine.evaluateRule(...args);
}
// CLI consumers retain the synchronous rules API after module initialization.
// Browser pages and workers explicitly prepare it only when a game uses scripts.
if(typeof window==="undefined"&&!("WorkerGlobalScope" in globalThis))await prepareRuleEngine();
