/** Identical Chrome CPU benchmark for current engine or a frozen Git reference. */
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const reference=process.env.REFERENCE;
const directory=await mkdtemp(join(tmpdir(),'bne-generation-'));
try {
 let source=resolve('core/generator.ts');
 if(reference){
  for(const name of ['generator.ts','random.ts','constants.json'])await writeFile(join(directory,name),execFileSync('git',['show',`${reference}:web/src/core/${name}`]));
  source=join(directory,'generator.ts');
 }
 const bundle=await build({stdin:{contents:`import {generate} from ${JSON.stringify(source)};globalThis.generate=generate;`,resolveDir:process.cwd()},bundle:true,write:false,minify:true,format:'iife',platform:'browser'});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(()=>{
   const results=[];
   for(const count of [200,4000,10000]){
     generate({},count);const times=[];
     for(let i=0;i<5;i++){const start=performance.now();const names=generate({},count);times.push(performance.now()-start);if(names.length!==count||new Set(names).size!==count)throw new Error('Wrong generation count');}
     times.sort((a,b)=>a-b);results.push({count,medianMs:times[2],namesPerSecond:count/(times[2]/1000),times});
   }return results;
 });
 console.log(JSON.stringify({reference:reference||'working-tree',browser:await browser.version(),result},null,2));
 await browser.close();
}finally{await rm(directory,{recursive:true,force:true});}
