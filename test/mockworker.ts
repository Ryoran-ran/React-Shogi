import type { AIRequest, AIReply } from "../src/ai";
import { legalActionIterator } from "../src/shogi";
import type { GameMove } from "../src/shogi";

/** Record requests separately from threads, since one worker serves multiple turns. */
export function mockAIWorkers() {
  const requests:MockAIRequest[]=[],threads:MockAIWorker[]=[];
  class MockAIWorker {
    onmessage:((event:{data:AIReply})=>void)|null=null;
    onerror:(()=>void)|null=null;
    onmessageerror:(()=>void)|null=null;
    terminated=false;
    constructor(){threads.push(this);}
    postMessage(request:AIRequest){requests.push(new MockAIRequest(this,structuredClone(request),this.onmessage,this.onerror,this.onmessageerror));}
    terminate(){this.terminated=true;}
  }
  class MockAIRequest {
    constructor(readonly worker:MockAIWorker,readonly request:AIRequest,readonly onmessage:((event:{data:any})=>void)|null,readonly onerror:(()=>void)|null,readonly onmessageerror:(()=>void)|null){}
    get terminated(){return this.worker.terminated;}
    reply(move?:GameMove){
      move??=legalActionIterator(this.request.position,this.request.options.passesRemaining,this.request.options.pieceRules,this.request.options.ruleScript).next().value;
      this.onmessage?.({data:{id:this.request.id,result:{move:move??null,depth:1,nodes:1,score:0}}});
    }
  }
  return {Worker:MockAIWorker,requests,threads};
}
