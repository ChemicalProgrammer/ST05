// Exact numerical throughput benchmark. No rendering, sparse-frame shortcuts,
// interpolation, reduced physics rate or wall-time performance assertions.
// Example: node scripts/benchmark-numerical-playback.mjs --seconds 3600 --baseline-root /path/to/old/checkout
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const seconds=Number(arg('--seconds','3600'));
assert(Number.isFinite(seconds)&&seconds>0&&seconds<=86400,'Use --seconds between 0 and 86400');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/ui-demo-case.json'),'utf8'));
const input={case:fixture,run:{...fixture.simulations[0].dynamicConfig,
  durationSeconds:86400,sampleEverySeconds:1,machineResidenceEnabled:true,calculationMode:'LIVE',rounds:1}};
const fingerprint=frame=>createHash('sha256').update(JSON.stringify(frame)).digest('hex');
async function measure(sourceRoot,label){
  const {createLinePlaybackSession}=await import(pathToFileURL(path.join(sourceRoot,'src/simulation/LineSimulationEngine.js')).href);
  const session=createLinePlaybackSession(structuredClone(input));
  const started=performance.now();
  while(!session.finished&&session.time+1e-8<seconds){
    session.advanceTo(seconds,{budgetMs:500,maxTicks:1000000});session.drainChartSamples();
  }
  const result={label,node:process.version,equipment:fixture.equipment.length,
    configuredHorizonSeconds:input.run.durationSeconds,measuredVirtualSeconds:session.time,
    physicalTickSeconds:session.tickSeconds,physicalTicks:Math.round(session.time/session.tickSeconds),
    wallMs:Number((performance.now()-started).toFixed(3)),output:session.snapshot().outputCount,
    frameSha256:fingerprint(session.snapshot())};
  console.log(JSON.stringify(result));return result;
}
const baselineRoot=arg('--baseline-root');
const before=baselineRoot?await measure(path.resolve(baselineRoot),'before'):null;
const after=await measure(root,'after');
if(before){
  assert.equal(after.frameSha256,before.frameSha256,'All terminal frame fields must remain identical');
  console.log(JSON.stringify({exactFrameMatch:true,speedup:Number((before.wallMs/after.wallMs).toFixed(3))}));
}
