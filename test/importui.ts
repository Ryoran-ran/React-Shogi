import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
let sequence=0;
/** A real module path avoids Windows/Bun resolution limits on large data: URLs. */
export async function importUI(source:string):Promise<unknown>{
  const folder=resolve(import.meta.dir,"../.check/ui-tests");mkdirSync(folder,{recursive:true});
  const path=resolve(folder,`ui-${process.pid}-${Date.now()}-${++sequence}.mjs`);
  source=source.replace(/import\(["'](\.\.\/src\/[a-z]+)\.js["']\)/g,(_match,relative)=>`import(${JSON.stringify(new URL(relative+".ts",import.meta.url).href)})`);
  await Bun.write(path,source);return import(pathToFileURL(path).href);
}
