/** Fixed CPU workload; run node --expose-gc --import tsx scripts/benchmark-core.ts. */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { generate } from '../../core/generator';
import { installDictionary, readReference } from '../../core/pronunciation';
import { parseSpelling, fitProfiles } from '../../core/inverter';
const samples: Record<string, unknown>[] = [];
function bench(label: string, count: number, fn: () => unknown) {
  fn();
  const times = [];
  for (let i = 0; i < 5; i++) { const start = performance.now(); fn(); times.push(performance.now() - start); }
  times.sort((a,b) => a-b);
  samples.push({label, count, medianMs:times[2], perSecond:count/(times[2]/1000), times});
}
bench('generate-200',200,()=>generate({},200));
bench('generate-4000',4000,()=>generate({},4000));
bench('generate-10000',10000,()=>generate({},10000));
bench('inverter-1331',1331,()=>fitProfiles(parseSpelling('lemoru')));
global.gc?.();
const before = process.memoryUsage();
const start = performance.now();
installDictionary(readFileSync(new URL('../../data/cmudict.bin',import.meta.url)));
global.gc?.();
const after = process.memoryUsage();
const installMs = performance.now()-start;
const lookupStart = performance.now();
for(let i=0;i<10000;i++) await readReference('figma');
console.log(JSON.stringify({runtime:process.version,samples,dictionary:{installMs,lookup10000Ms:performance.now()-lookupStart,heapDelta:after.heapUsed-before.heapUsed,arrayBufferDelta:after.arrayBuffers-before.arrayBuffers}},null,2));
