import {expect,test} from "bun:test";
import {ShogiGame,initialPosition} from "../src/shogi";
import {EDITOR_DRAFT_KEY} from "../src/editordraft";
import {readLocalSetups} from "../src/setups";

test("per-square painting, patterns, recovery, exports and play work through the shared editor",async()=>{
  const url=new URL('../web/app.ts',import.meta.url);
  const source=new Bun.Transpiler({loader:'ts',target:'browser'}).transformSync(await Bun.file(url).text()).replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,a,b,c)=>`${a}${new URL(b,url).href}${c}`).replaceAll('import.meta.url',JSON.stringify(url.href));
  const original={document:globalThis.document,localStorage:globalThis.localStorage,confirm:globalThis.confirm,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const originalURLs={createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
  const values=new Map<string,string>(),elements=new Map<string,any>(),blobs=new Map<string,Blob>(),downloads:Blob[]=[];
  let listeners:Record<string,(e:any)=>any>={},session=0,timer=0;
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const old=new ShogiGame(undefined,{passLimit:0});old.play({from:56,to:47,promote:false});values.set('shogi-game.v1',JSON.stringify({game:old.save(),aiMode:'human'}));const originalGame=values.get('shogi-game.v1');
  const element=(selector:string)=>{if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',value:'',dataset:{},classList:{add(){},remove(){}},focus(){},click(){},select(){},scrollTop:0,scrollLeft:0});return elements.get(selector);};
  Object.assign(URL,{createObjectURL:(blob:Blob)=>{const id=`blob:colors-${blobs.size}`;blobs.set(id,blob);return id;},revokeObjectURL:(id:string)=>{blobs.delete(id);}});
  Object.assign(globalThis,{document:{querySelector:element,addEventListener:(name:string,fn:any)=>{listeners[name]=fn;},createElement:()=>{const link={href:'',download:'',click(){downloads.push(blobs.get(link.href)!);}};return link;}},localStorage:storage,confirm:()=>true,setTimeout:()=>++timer,clearTimeout(){}});
  const html=()=>element('#app').innerHTML as string,draft=()=>JSON.parse(values.get(EDITOR_DRAFT_KEY)!);
  const click=(id='',dataset={})=>listeners.click({target:{closest:()=>({id,dataset,disabled:false})}});
  const change=(id:string,value='',checked?:boolean)=>listeners.change({target:{id,value,checked,dataset:{}}});
  const input=(id:string,value:string)=>listeners.input({target:{id,value,dataset:{}}});
  const reload=async()=>{elements.clear();listeners={};await import(`data:text/javascript;base64,${Buffer.from(`${source}\n// colors-session ${++session}`).toString('base64')}`);};
  try {
    await reload();await click('title-workshop');await click('workshop-new');await click('editor-standard');
    expect(html()).toContain('id="editor-square-color"');input('editor-square-color','#112233');await change('editor-square-color','#112233');await click('',{editorSquare:'54'});
    expect(draft().snapshot.position.board[54].type).toBe('P');expect(draft().snapshot.position.squareColors[54]).toBe('#112233');expect(draft().ui.tool).toBe('color');
    expect(html()).toContain('data-editor-square="54" style="--square-color:#112233;--square-mark:#fff6dc"');
    await click('editor-undo');expect(draft().snapshot.position.squareColors).toBeUndefined();await click('editor-redo');expect(draft().snapshot.position.squareColors[54]).toBe('#112233');
    await change('editor-color-erase','',true);await click('',{editorSquare:'54'});expect(draft().snapshot.position.squareColors).toBeUndefined();expect(draft().snapshot.position.board[54].type).toBe('P');await click('editor-undo');
    await click('editor-flip');expect(html()).toContain('data-editor-square="54" style="--square-color:#112233;');await change('editor-square-color','#aabbcc');await click('',{editorSquare:'40'});expect(draft().snapshot.position.squareColors[40]).toBe('#aabbcc');
    await click('',{editorPiece:'G'});expect(draft().ui.tool).toBe('place');await click('',{editorSquare:'41'});expect(draft().snapshot.position.board[41].type).toBe('G');await click('editor-undo');
    await change('editor-square-color','#ffffff');await change('editor-square-color-alt','#000000');await click('editor-checker-colors');expect(draft().snapshot.position.squareColors.slice(0,2)).toEqual(['#ffffff','#000000']);expect(draft().snapshot.position.squareColors[9]).toBe('#000000');
    await click('editor-clear-colors');expect(draft().snapshot.position.squareColors).toBeUndefined();await click('editor-undo');
    await change('editor-square-color','#112233');await click('editor-fill-color');expect(new Set(draft().snapshot.position.squareColors)).toEqual(new Set(['#112233']));await click('editor-undo');
    input('editor-setup-name','色付きの盤');await click('editor-save-local');await click('editor-export-setup');const exported=JSON.parse(await downloads.at(-1)!.text());expect(exported.version).toBe(8);expect(exported.position.squareColors[1]).toBe('#000000');expect(values.get('shogi-game.v1')).toBe(originalGame);
    await click('editor-cancel');expect(html()).toContain('style="--square-color:#000000;');const entry=readLocalSetups(storage)[0];await click('',{workshopCopy:entry.id});await change('editor-width','8');expect(draft().snapshot.position.squareColors).toHaveLength(72);expect(draft().snapshot.position.squareColors[8]).toBe('#000000');
    await change('editor-square-color','#345678');await click('',{editorSquare:'10'});await reload();await click('editor-restore-draft');expect(draft().ui.color).toBe('#345678');expect(draft().snapshot.position.squareColors[10]).toBe('#345678');expect(html()).toContain('id="editor-square-color" type="color" value="#345678"');
    await click('editor-apply');const game=ShogiGame.load(JSON.parse(values.get('shogi-game.v1')!).game);expect(game.save().version).toBe(10);expect(game.position.squareColors?.[10]).toBe('#345678');expect(html()).toContain('data-square="10" style="--square-color:#345678;');
    const colors=game.position.squareColors;await click('',{square:'48'});await click('',{square:'40'});expect(ShogiGame.load(JSON.parse(values.get('shogi-game.v1')!).game).position.squareColors).toEqual(colors);
    const p=initialPosition();p.squareColors=exported.position.squareColors;const colored=new ShogiGame(p,{passLimit:0});
    await listeners.change({target:{id:'file-input',value:'',files:[{text:async()=>JSON.stringify(colored.save())}]}});expect(JSON.parse(values.get('shogi-game.v1')!).gameKind).toBe('custom');expect(html()).toContain('id="edit-board"');
  } finally {Object.assign(URL,originalURLs);Object.assign(globalThis,original);}
},15000);
