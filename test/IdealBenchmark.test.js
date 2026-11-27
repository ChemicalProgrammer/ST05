import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('apps-script/IdealBenchmark.html','utf8');
const window={};
vm.runInNewContext(source.slice(source.indexOf('<script>')+8,source.lastIndexOf('</script>')),{window,setTimeout,Date});
const api=window.STIdealBenchmark;
const machine=(id,rate)=>({id,name:id,type:'MACHINE',nominalRatePerSecond:rate/60,processData:{equipment:{maximumSpeedBpm:rate},flowUnits:{input:'BOTTLES',output:'BOTTLES'}}});
function fixture(){
  return {simulationId:'s',caseId:'x',equipment:[machine('in',226),{id:'belt',name:'belt',type:'CONVEYOR',processData:{geometry:{lactMm:10000,lpPrimeMm:500},upstream:{packageLengthMm:60},accumulation:{speedMode:'MANUAL',conveyorSpeedMmPerSecond:500,blockedTimeDelaySeconds:.5,downstreamRampUpSeconds:2}}},machine('ref',220)],sourceRun:{seed:23,durationSeconds:28800,engineId:'ST_CURRENT',reliabilityEnabled:true,machineResidenceEnabled:true},sourceSignature:'sig',unitOfFlow:'bottles',outputUnit:'bottles',referenceMachine:'ref',referenceRate:220,geometry:{belt:{speed:500,length:10000,packageLength:60,primeReserve:500,backupPosition:1000}},original:{durationSeconds:28800,rounds:1,oee:65,throughput:143,attainment:65}};
}
function simulator({overflow=false}={}){
  return async (input,options)=>{
    const r=input.run,ref=input.case.equipment[2].nominalRatePerSecond*60;
    let q=ref*(r.reliabilityEnabled?.8:.95);
    if(input.case.equipment[1].processData.geometry.lactMm>=20000)q-=10;
    const rows=Array.from({length:r.rounds},(_,i)=>({seed:(r.seed+i)>>>0,summary:{outputCount:q*r.durationSeconds/60,lineOeePercent:q/ref*100,totalOverflowUnits:overflow?1:0},equipmentMetrics:{}}));
    options.progress?.(1);return {ok:true,result:{...rows[0],batch:{rows},accumulationZoneMetrics:{}}};
  };
}
test('ideal benchmark changes only the copy and keeps the original target denominator',()=>{
  const ctx=fixture(),before=JSON.stringify(ctx);
  const built=api.makeInput(ctx,{pacemaker:1.5,length:2,beltSpeed:1.5,control:2,ramp:0,mtbf:4,mttr:.25});
  assert.equal(JSON.stringify(ctx),before);
  assert.equal(built.input.case.equipment[2].nominalRatePerSecond*60,330);
  assert.equal(built.input.case.equipment[1].processData.geometry.lactMm,20000);
  assert.equal(built.input.case.equipment[1].processData.accumulation.conveyorSpeedMmPerSecond,750);
  assert.equal(built.input.run.reliabilityEnabled,false);
  assert.equal(ctx.referenceRate,220);
  const metrics=api.metrics({seed:23,summary:{outputCount:6600,lineOeePercent:66.666667,totalOverflowUnits:0}},ctx,{durationSeconds:1800,rounds:1,seed:23});
  assert.equal(metrics.throughput,220);assert.equal(metrics.attainment,100);assert(metrics.oee<67);
});
test('benchmark searches, preserves a fixed-pacemaker branch and verifies with independent seeds and original horizon',async()=>{
  const ctx=fixture(),study=await api.runStudy(ctx,{durationSeconds:900,target:99,simulate:simulator(),verifyOriginal:true});
  assert.equal(study.status,'COMPLETE');
  assert.equal(study.factorial.effects.length,7);
  assert.equal(study.experiments.filter(r=>r.stage==='FACTORIAL').length,8);
  assert.equal(study.final.ideal.run.numericalResolution,'PRECISE');
  assert.equal(study.final.status,'IDEAL_TARGET_REPRODUCED');
  assert.equal(study.fixedPacemaker.confirmation.parameters.pacemaker,1);
  assert.equal(study.final.preciseReliability.run.rounds,3);
  assert.notEqual(study.final.preciseReliability.run.seed,study.final.restoredReliability.run.seed);
  assert.equal(study.final.originalHorizon.candidate.run.durationSeconds,28800);
  assert.equal(study.final.originalHorizon.candidate.run.seed,23);
});
test('overflow is never a demonstrated target, and cancellation stops the search',async()=>{
  const ctx=fixture(),study=await api.runStudy(ctx,{durationSeconds:900,target:99,simulate:simulator({overflow:true})});
  assert.equal(study.status,'COMPLETE');assert.equal(study.final,null);
  assert(study.thresholds.every(t=>t.status==='NOT_DEMONSTRATED'));
  let cancelled=false;const run=simulator(),stop=await api.runStudy(ctx,{durationSeconds:900,target:99,simulate:async (input,options)=>{const result=await run(input,options);cancelled=true;return result;},stop:()=>cancelled});
  assert.equal(stop.status,'CANCELLED');
});
test('statistical report is available exclusively in common Settings',()=>{
  const workspace=fs.readFileSync('apps-script/MinimalWorkspace.html','utf8'),mode=fs.readFileSync('apps-script/MinimalMode.html','utf8'),web=fs.readFileSync('apps-script/WebApp.html','utf8'),settings=fs.readFileSync('apps-script/Settings.html','utf8');
  assert(!workspace.includes('minimal-export-minitab'));
  assert(!mode.includes('minimal-export-minitab'));
  assert(!web.includes('export-minitab-results'));
  assert(!web.includes('export-minitab-whatif'));
  assert.match(web,/<button id="settings-export-statistical-report"/);
  assert.match(settings,/STStatExport\.download\(simulationProvider\(\),activeCase\(\)\)/);
});
