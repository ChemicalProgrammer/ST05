import test from 'node:test';
import assert from 'node:assert/strict';
import {screenFlowFactors} from '../src/analysis/FlowFactorScreening.js';
const model={equipment:[{id:'a'},{id:'b'}]},c=(id,path,after=20)=>({equipmentId:id,path,before:10,after}),targets=[{change:c('a','speed'),priority:70},{change:c('b','sensor'),priority:60}];
function value(run,gains,overflow=0){const rows=Array.from({length:3},(_,i)=>({seed:run.seed+i,throughput:100+gains[i],oee:50+gains[i]/10}));return {throughput:rows.reduce((s,r)=>s+r.throughput,0)/3,oee:rows.reduce((s,r)=>s+r.oee,0)/3,overflowUnits:overflow,roundMetrics:rows,warnings:overflow?[{equipmentId:'LINE',rule:'SIMULATED_OVERFLOW'}]:[]};}
test('clear conditional gains use three seeds and detect pairs with no isolated benefit',async()=>{
 const fixed=[{...c('a','noiseProfile.reliability.mttrMinutes',5),analysisOnly:true}],calls=[];
 const report=await screenFlowFactors(model,{targets,fixedChanges:fixed,run:{seed:10,durationSeconds:900},measure:async(s,changes,run)=>{assert.deepEqual(changes[0],fixed[0]);calls.push(run);return value(run,Array(3).fill(changes.length===3?20:0));}});
 assert.equal(calls.length,4);assert(calls.every(r=>r.rounds===3));assert.equal(report.selectedFactors.length,2);assert(report.observations.every(o=>o.selectionReason==='Suggested through a stable pair'));
});
test('uncertain candidates add distinct seeds and reuse the extra baseline without repeating initial seeds',async()=>{
 const calls=[];const report=await screenFlowFactors(model,{targets,maximumPairs:0,run:{seed:10,durationSeconds:900},measure:async(s,changes,run)=>{calls.push({run,changes});return value(run,changes.length?(run.seed===10?[0,10,20]:[10,10,10]):[0,0,0]);}});
 assert.equal(report.selectedFactors.length,2);assert(report.observations.every(o=>o.extended&&o.paired.rounds===6));assert.equal(calls.filter(c=>!c.changes.length&&c.run.seed===13).length,1);assert.equal(calls.filter(c=>c.changes.length&&c.run.seed===10).length,2);assert.equal(calls.length,6);
});
test('baseline spill is tolerated but increasing spill cannot qualify a speed factor',async()=>{
 const report=await screenFlowFactors(model,{targets:[targets[0]],run:{seed:1},measure:async(s,changes,run)=>value(run,Array(3).fill(changes.length?20:0),changes.length?11:10)});
 assert.equal(report.selectedFactors.length,0);assert.equal(report.observations[0].reason,'ENGINEERING_REVIEW_REQUIRED');
});
test('automatic suggestions default to three factors, cap screening and disclose omitted targets',async()=>{
 const many=Array.from({length:12},(_,i)=>({change:c(i%2?'a':'b','p'+i),priority:12-i}));
 const report=await screenFlowFactors(model,{targets:many,maximumTargets:8,maximumPairs:6,run:{seed:1},measure:async(s,changes,run)=>value(run,Array(3).fill(changes.length*10))});
 assert.equal(report.selectedFactors.length,3);assert.equal(report.screened,8);assert.equal(report.omitted,4);assert.equal(report.pairs.length,6);assert.equal(report.pairsOmitted,22);
});
test('cancellation cannot return partial suggestions',async()=>{
 let calls=0;await assert.rejects(()=>screenFlowFactors(model,{targets,run:{seed:1},cancelled:()=>calls>1,measure:async(s,changes,run)=>{calls++;return value(run,[10,10,10]);}}),/BATCH_CANCELLED/);
});

test('bounded shortlist covers conveyor speeds and sensors before repeated high-priority Prime reserves',async()=>{
 const diverse=[...Array.from({length:8},(_,i)=>({change:c('a'+i,'processData.geometry.lpPrimeMm'),priority:100-i})),{change:c('b','processData.accumulation.conveyorSpeedMmPerSecond'),priority:5},{change:c('b','processData.accumulation.backupSensorPositionMm'),priority:4},{change:c('b','processData.geometry.lactMm'),priority:3}];
 const report=await screenFlowFactors(model,{targets:diverse,maximumTargets:8,maximumPairs:0,run:{seed:1},measure:async(s,changes,run)=>value(run,[0,0,0])});
 assert.equal(report.screened,8);assert(report.observations.some(o=>o.path.endsWith('conveyorSpeedMmPerSecond')));assert(report.observations.some(o=>o.path.endsWith('backupSensorPositionMm')));assert(report.observations.some(o=>o.path.endsWith('lactMm')));
});

test('parallel screening preserves serial evidence and shares one extra baseline',async()=>{
 const many=Array.from({length:16},(_,i)=>({change:c(i%2?'a':'b','p'+i),priority:16-i}));
 async function screen(concurrency){let active=0,peak=0,extraBaselines=0;
 const report=await screenFlowFactors(model,{targets:many,concurrency,run:{seed:10},measure:async(s,changes,run)=>{
   active++;peak=Math.max(peak,active);if(!changes.length&&run.seed===13)extraBaselines++;
   await new Promise(resolve=>setTimeout(resolve,changes[0]?.path==='p0'?8:1));active--;
   return value(run,changes.length?(run.seed===10?[0,10,20]:[10,10,10]):[0,0,0]);
 }});return {report,peak,extraBaselines};}
 const serial=await screen(1),parallel=await screen(3);
 assert.deepEqual(parallel.report,serial.report);assert(parallel.peak>1);assert(parallel.peak<=3);assert.equal(parallel.extraBaselines,1);
 assert.equal(parallel.report.screened,16);assert.equal(parallel.report.omitted,0);
 assert.equal(new Set(parallel.report.pairs.flatMap(pair=>pair.keys)).size,16,'pair coverage includes each screened factor');
});

test('High screening can retain four factors while descriptive reproduction supplies no fictitious interval',async()=>{
 const many=Array.from({length:5},(_,i)=>({change:c('a','p'+i),priority:5-i}));
 const report=await screenFlowFactors(model,{targets:many,maxFactors:4,maximumPairs:0,run:{seed:10},measure:async(s,changes,run)=>value(run,Array(3).fill(changes.length?10:0))});
 assert.equal(report.method,'ADAPTIVE_CONDITIONAL_FLOW_V4');assert.equal(report.maximumFactors,4);assert.equal(report.selectedFactors.length,4);
 for(const observation of report.observations){
  assert.equal(observation.paired.kind,'DESCRIPTIVE_REPRODUCTION');assert.equal(observation.paired.lower,null);assert.equal(observation.paired.upper,null);
  assert.equal(observation.paired.inferenceAvailable,false);assert.equal(observation.paired.selectionScore,10);assert(observation.paired.stable);
 }
});

test('screening uses its configured Student confidence level in initial and extended batches',async()=>{
 const measure=async(s,changes,run)=>value(run,changes.length?[4,5,6]:[0,0,0]);
 const normal=await screenFlowFactors(model,{targets:[targets[0]],maximumPairs:0,run:{seed:10},measure});
 const strict=await screenFlowFactors(model,{targets:[targets[0]],maximumPairs:0,run:{seed:10},measure,confidenceLevel:.99});
 assert.equal(normal.calculations,2);assert.equal(normal.observations[0].paired.rounds,3);assert.equal(normal.observations[0].paired.confidenceLevel,.95);
 assert.equal(strict.calculations,4);assert.equal(strict.observations[0].paired.rounds,6);assert.equal(strict.observations[0].paired.confidenceLevel,.99);assert.equal(strict.confidenceLevel,.99);
 assert(strict.observations[0].extended);assert.equal(strict.selectedFactors.length,1);
});

test('screening pairs observations by seed and rejects duplicate evidence without relabeling it no gain',async()=>{
 async function screen(damage){return screenFlowFactors(model,{targets:[targets[0]],maximumPairs:0,run:{seed:10},measure:async(s,changes,run)=>{
  const result=value(run,changes.length?[8,10,12]:[0,0,0]);if(changes.length)damage(result.roundMetrics);return result;
 }});}
 const normal=await screen(()=>{}),reordered=await screen(rows=>rows.reverse());
 assert.deepEqual(reordered.observations[0].paired,normal.observations[0].paired);assert.equal(reordered.calculations,normal.calculations);
 const damaged=await screen(rows=>{rows[1].seed=rows[0].seed;});
 assert.equal(damaged.selectedFactors.length,0);assert.equal(damaged.observations[0].reason,'INVALID_REPLICATION_EVIDENCE');assert.equal(damaged.observations[0].paired.reason,'DUPLICATE_SEED_IDS');
 assert.equal(damaged.outcome,'INCOMPLETE_SCREENING_EVIDENCE');assert.equal(damaged.calculations,2);
});

test('screening validates confidence and the one-to-four-factor limit before measuring',async()=>{
 let calls=0;const options={targets,run:{seed:1},measure:async(s,changes,run)=>{calls++;return value(run,[0,0,0]);}};
 for(const confidenceLevel of [0,1,NaN,null])await assert.rejects(()=>screenFlowFactors(model,{...options,confidenceLevel}),/INVALID_FLOW_SCREEN_CONFIDENCE/);
 for(const maxFactors of [0,5,2.5,NaN])await assert.rejects(()=>screenFlowFactors(model,{...options,maxFactors}),/INVALID_FLOW_SCREEN_LIMITS/);
 assert.equal(calls,0);
});
