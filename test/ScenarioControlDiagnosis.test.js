import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scenarioControlDiagnostics,planScenarioControlProbes,rankScenarioPhysicalPackages,scenarioSearchRun,selectProgressiveBasicFinalists} from '../src/analysis/ScenarioSearch.js';
const sim=()=>JSON.parse(fs.readFileSync('test/fixtures/demo-b-case.json','utf8')).simulations[0];
test('sensor pulse and repeated ramps are diagnostic, with representative fallback',()=>{
 const equipment=[{id:'packer',type:'CASE_PACKER',name:'Packer'},{id:'belt',type:'CONVEYOR',name:'Belt',processData:{upstream:{packageLengthMm:310},accumulation:{blockedTimeDelaySeconds:.5}}},{id:'pal',type:'PALLETIZER',name:'Palletizer'}];
 const result={durationSeconds:900,summary:{},equipmentMetrics:{pal:{outputCount:150,startRampCount:151,startRampSeconds:302,failureCount:1,waitingForPrimeSeconds:200}},accumulationZoneMetrics:{zone:{id:'zone',ownerEquipmentId:'belt',upstreamControlEquipmentId:'packer',downstreamControlEquipmentId:'pal',conveyorSpeedMmPerSecond:541.5,backupTriggerCount:150,backupPassedUnits:150,primeTriggerCount:151,primePassedUnits:150}}};
 const d=scenarioControlDiagnostics(result,equipment);assert(d.zones[0].pulseConflict);assert.equal(d.zones[0].backupTriggersPerPass,1);assert.equal(d.machines[1].repeatedStarts,true);assert.equal(d.zones[0].counterBasis,'SINGLE_ROUND');
 result.batch={rounds:2,rows:[{conveyorResults:[{id:'zone',backupTriggerCount:0,backupPassedUnits:100,primeTriggerCount:100,primePassedUnits:100}]},{conveyorResults:[{id:'zone',backupTriggerCount:20,backupPassedUnits:100,primeTriggerCount:100,primePassedUnits:100}]}]};
 const avg=scenarioControlDiagnostics(result,equipment);assert.equal(avg.zones[0].counterBasis,'REPLICATION_MEAN');assert.equal(avg.zones[0].backupTriggersPerPass,.1);assert.equal(avg.machines[1].startRampCount,null);
});
test('Zero control probes stay bounded and do not alter original model',()=>{
 const s=sim(),b=s.equipment.find(e=>e.type==='CONVEYOR'),before=structuredClone(s),path='processData.accumulation.blockedTimeDelaySeconds';
 const current=b.processData.accumulation.blockedTimeDelaySeconds;
 const target={equipmentId:b.id,path,before:current,after:current+.3,originTier:'ZERO',unit:'s'};
 const plan=planScenarioControlProbes(s,[{change:target,priority:100}],{limit:3});
 assert(plan.probes.length>0);assert(plan.probes.length<=3);assert(plan.probes.every(p=>p.changes.every(c=>c.originTier==='ZERO'&&c.path===path)));assert.deepEqual(s,before);
 const run=scenarioSearchRun({...s.dynamicConfig,durationSeconds:28800},'MEDIUM','control-screen',3,{automaticBasic:true},s.equipment);
 assert.equal(run.scenarioFidelity,'PHYSICAL_FAST_V1');assert.equal(run.scenarioControlEvidenceVersion,1);assert.equal(run.durationSeconds,900);assert.equal(run.scenarioWarmupSeconds,undefined);
});
test('physical package ranking rejects incompatible fidelity and seed blocks',()=>{
 const values=(q,fidelity='PHYSICAL_FAST_V1',seed=7)=>({durationSeconds:900,unitOfFlow:'bottles',scenarioFidelity:fidelity,throughput:q,oee:q/2,roundMetrics:[0,1,2].map(i=>({seed:seed+i,durationSeconds:900,throughput:q,oee:q/2}))});
 const base=values(100),c={equipmentId:'belt',path:'processData.accumulation.blockedTimeDelaySeconds',before:.5,after:.8,originTier:'ZERO'};
 const row=(after,q,fidelity,seed)=>({packageId:'delay',priority:1,changes:[{...c,after}],result:values(q,fidelity,seed)});
 const report=rankScenarioPhysicalPackages([row(.8,104),row(1,103),row(1.1,199,'FLUID_SCREEN_V1'),row(1.2,200,'PHYSICAL_FAST_V1',9)],base);
 assert.equal(report.targets.length,1);assert.equal(report.targets[0].change.after,.8);
 const promoted=selectProgressiveBasicFinalists([{changes:[c],result:values(104)},{changes:[{...c,after:2}],result:values(199,'FLUID_SCREEN_V1')}],base,{durationSeconds:28800,reliabilityEnabled:false},[],3);
 assert.equal(promoted.evaluated,1);assert.equal(promoted.selected[0].result.throughput,104);
});
