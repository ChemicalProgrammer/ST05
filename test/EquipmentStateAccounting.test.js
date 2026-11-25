import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateLine} from '../src/simulation/LineSimulationEngine.js';
import {advancePackagePositions} from '../src/simulation/DiscretePackageEngine.js';
const load=path=>fs.readFileSync(path,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const w={SimulatorEngine:{advancePackagePositions}};
new Function('window',load('apps-script/Simulation2DEngine.html'))(w);
new Function('window',load('apps-script/EquipmentEfficiency.html'))(w);
const create=w.STSimulation2DEngine.create;
const m=(id,extra={})=>({id,kind:'machine',unit:'BOTTLES',rate:4,batch:1,startDelay:0,rampSeconds:0,capacityBottles:30,residenceSeconds:0,inputBottleFactor:1,bottlesPerUnit:1,...extra});
const b=(id,extra={})=>({id,kind:'belt',unit:'BOTTLES',bottlesPerUnit:1,length:100,speed:20,packageLength:20,pitch:20,packedGap:0,prime:null,backup:null,blockDelay:0,clearDelay:Infinity,responseDelay:0,residual:0,...extra});
function near(a,b,tolerance=1e-5){assert(Math.abs(a-b)<tolerance,JSON.stringify({actual:a,expected:b}));}
function reconcile(a,elapsed,output){
  assert.equal(a.schema,'ST_EXCLUSIVE_STATES_V1');
  near(Object.values(a.stateSeconds).reduce((n,v)=>n+v,0),elapsed);
  near(Object.values(a.outputUnitsByState).reduce((n,v)=>n+v,0),output);
  near(a.timeResidualSeconds,0);near(a.outputResidualUnits,0);
}
test('2D exclusive counters distinguish Prime, residual discharge, completed Back-up and stopped conveyor',()=>{
 const model=create([m('source',{capacityBottles:3}),b('belt',{prime:40,residual:2}),m('sink')],7);
 const [source,belt,sink]=model.line;
 model.configure({failures:false});model.control('belt','STOP');
 source.resident=[0,0,0];source.admittedInputUnits=3;source.outletCredit=1;
 belt.items=[90,70,50,30,10].map(x=>({x}));belt.backupBlocked=true;
 for(let i=0;i<4;i++)model.step(.25);
 const a=model.accountingSnapshot(source),c=model.accountingSnapshot(belt);
 reconcile(a,1,source.produced);reconcile(c,1,belt.produced);
 assert.equal(a.stateSeconds.DISCHARGING,.5);assert.equal(a.stateSeconds.BACKUP_STOP,.5);
 assert.equal(a.outputUnitsByState.DISCHARGING,2);assert.equal(a.backup.observedEpisodes,1);assert.equal(a.backup.observedStops,1);
 assert.equal(a.reliabilityChargedSeconds,0);assert.equal(a.reliabilityExposureSeconds,.5);
 assert.equal(c.stateSeconds.STOPPED,1);assert.equal(c.efficiency,null);
 assert.equal(model.accountingSnapshot(sink).stateSeconds.WAITING_FOR_PRIME,1);
});
test('2D short Back-up pulse and repair remain distinct from an observed complete stop',()=>{
 const defs=[m('source',{rate:1,failures:[{rate:.001,repairSeconds:.5}]}),b('belt',{responseDelay:2,residual:1})];
 const model=create(defs,7),[source,belt]=model.line;
 source.exposure=100;source.resident=[0,0];belt.backupBlocked=true;
 model.step(.25);belt.backupBlocked=false;model.step(.25);
 let a=model.accountingSnapshot(source);
 assert.equal(a.backup.observedEpisodes,1);assert.equal(a.backup.observedStops,0);
 assert.equal(a.backup.endedWithoutObservedStop,1);assert.equal(a.stateSeconds.RAMP_DOWN,.25);
 source.exposure=0;model.step(.25);model.step(.25);model.step(.25);
 a=model.accountingSnapshot(source);
 assert(a.stateSeconds.FAILURE>0);reconcile(a,model.time,source.produced);
 const restored=create(defs,7,model.snapshot());
 restored.step(.25);model.step(.25);
 assert.deepEqual(restored.snapshot(),model.snapshot());
 const old=model.snapshot();delete old.counterAccountingComplete;
 const legacy=create(defs,7,old);assert.equal(legacy.accountingSnapshot(legacy.line[0]),null);
});
function numericalInput(extra={}){
 const machine=(id,rate)=>({id,name:id,type:'CUSTOM',initialMode:'AUTO',nominalRatePerSecond:rate,processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'},equipment:{internalCapacityBottles:30,residenceTimeSeconds:0}}});
 const source=machine('source',4);
 const belt={id:'belt',name:'Belt',type:'CONVEYOR',initialMode:'AUTO',nominalRatePerSecond:4,processData:{role:'CONVEYOR',flowUnits:{input:'BOTTLES',output:'BOTTLES'},accumulation:{speedMode:'MANUAL',usableLengthMm:400,productLengthMm:20,productPitchMm:30,gapMm:10,accumulatedGapMm:0,conveyorSpeedMmPerSecond:120,primeSensorPositionMm:380,backupSensorPositionMm:100,backupRestartPositionMm:100,blockedTimeDelaySeconds:.25,clearTimeDelaySeconds:.25,upstreamStopResponseSeconds:0,bottlesDischargedAtStop:2,downstreamRampUpSeconds:0}}};
 return {case:{id:'counters',unitOfFlow:'bottles',equipment:[source,belt,machine('sink',4)]},run:{durationSeconds:30,tickSeconds:.05,sampleEverySeconds:1,seed:7,machineResidenceEnabled:true,numericalResolution:'FAST',reliabilityEnabled:false,...extra}};
}
test('numerical exclusive accounting conserves time and output in every machine and conveyor, including commanded stops',()=>{
 const i=numericalInput({commands:[{equipmentId:'sink',atVirtualSecond:5,action:'STOP'},{equipmentId:'sink',atVirtualSecond:20,action:'RUN'},{equipmentId:'belt',atVirtualSecond:23,action:'STOP'},{equipmentId:'belt',atVirtualSecond:25,action:'RUN'}]});
 const response=simulateLine(i);assert(response.ok,JSON.stringify(response.error));const r=response.result;
 assert.equal(r.summary.outputCount,33,'Corrected discrete service fixture');
 for(const item of Object.values(r.equipmentMetrics))reconcile(item.stateAccounting,r.durationSeconds,item.outputCount);
 const a=r.equipmentMetrics.source.stateAccounting,c=r.equipmentMetrics.belt.stateAccounting;
 assert(a.stateSeconds.DISCHARGING>0);assert(a.stateSeconds.BACKUP_STOP>0);assert.equal(a.stateSeconds.RAMP_DOWN,undefined);
 assert.equal(c.stateSeconds.STOPPED,2);assert.equal(c.efficiency,null);
 near(a.productiveSeconds,a.reliabilityExposureSeconds);
 assert.equal(a.reliabilityChargedSeconds,0);
 const sample=r.samples.at(-1).equipment[0];assert.equal(sample.stateAccounting.schema,a.schema);
 assert.deepEqual(sample.stateAccounting.stateSeconds,a.stateSeconds);
});
test('numerical stop response is reported separately from residual discharge, not falsely labeled deceleration',()=>{
 const i=numericalInput();i.case.equipment[1].processData.accumulation.upstreamStopResponseSeconds=.5;
 i.case.equipment[2].initialMode='STOP';
 const r=simulateLine(i);assert(r.ok,JSON.stringify(r.error));
 const item=r.result.equipmentMetrics.source,a=item.stateAccounting;
 assert(a.stateSeconds.STOP_RESPONSE>0);
 near((a.stateSeconds.STOP_RESPONSE||0)+(a.stateSeconds.DISCHARGING||0),item.stateSeconds.BACKUP_STOPPING);
 reconcile(a,30,item.outputCount);
});
test('shared efficiency basis is uncapped, separates internal from external losses, and uses native case rate',()=>{
 const model=create([m('source',{rate:2,unit:'CASES',bottlesPerUnit:12,inputBottleFactor:12,capacityBottles:360})]);
 const item=model.line[0];
 Object.assign(item.stateAccounting,{accountedSeconds:5,productiveSeconds:2,productiveDesignOutputUnits:4,outputUnits:6,stateSeconds:{RUNNING:1,DISCHARGING:1,FAILURE:1,BLOCKED:2},outputUnitsByState:{RUNNING:3,DISCHARGING:3}});
 item.produced=6;const a=w.STSimulation2DEngine.accountingSnapshot(item,5);
 assert.equal(a.efficiency.availability,.666667);assert.equal(a.efficiency.runtimeEfficiency,1.5);
 assert.equal(a.efficiency.operationalEfficiency,1);assert.equal(a.efficiency.throughput,2);
 assert.equal(a.efficiency.intrinsicOee,1.2);assert.equal(a.outputAboveDesignUnits,2);
 assert.equal(a.exceedsDesignBeyondOnePackage,true);
 assert.deepEqual(w.STEquipmentEfficiency.fromNumerical({stateAccounting:a},{}),a.efficiency);
 reconcile(a,5,6);
});
test('2D export keeps exclusive counters and old checkpoints do not fabricate them',()=>{
 const source=fs.readFileSync('apps-script/Simulation2D.html','utf8');
 const start=source.indexOf('  function summarize2DRun(');
 const summarize=new Function(source.slice(start,source.indexOf('  function capture(){',start))+';return summarize2DRun;')();
 const model=create([m('source')],7);for(let i=0;i<20;i++)model.step(.05);
 let summary=summarize(model,'Completed',7,'INDEPENDENT',null,1,[]);
 assert.equal(summary.controlPolicy,'PHYSICAL_FLOW_8');assert.equal(summary.counterPolicy,'ST_EXCLUSIVE_STATES_V1');
 reconcile(summary.equipment[0].stateAccounting,model.time,model.line[0].produced);
 const cp=model.snapshot();delete cp.counterAccountingComplete;
 const restored=create([m('source')],7,cp);
 summary=summarize(restored,'Completed',7,'INDEPENDENT',null,1,[]);
 assert.equal(summary.equipment[0].stateAccounting,null);
});
test('numerical reliability exposure and actual charge are observed without changing the failure stream',()=>{
 const i=numericalInput({reliabilityEnabled:true});
 i.case.equipment[0].noiseProfile={reliability:{mtbfMinutes:.05,mttrMinutes:.02}};
 const r=simulateLine(i);assert(r.ok,JSON.stringify(r.error));
 const source=r.result.equipmentMetrics.source,a=source.stateAccounting;
 assert(source.failureCount>0);assert(a.stateSeconds.FAILURE>0);
 near(a.reliabilityExposureSeconds,a.reliabilityChargedSeconds);
 near(a.ownDowntimeSeconds,source.failureSeconds+source.microStopSeconds);
 reconcile(a,30,source.outputCount);
});
