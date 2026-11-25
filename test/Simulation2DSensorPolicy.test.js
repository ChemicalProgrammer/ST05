import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {advancePackagePositions} from '../src/simulation/DiscretePackageEngine.js';
const script=fs.readFileSync('apps-script/Simulation2DEngine.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const machine=id=>({id,kind:'machine',rate:1,batch:1,startDelay:0,rampSeconds:0,capacityBottles:30,residenceSeconds:0,inputBottleFactor:1,bottlesPerUnit:1});
const belt=(id,extra={})=>({id,kind:'belt',length:200,speed:20,packageLength:20,pitch:40,packedGap:0,prime:null,backup:null,blockDelay:.5,clearDelay:.5,responseDelay:0,residual:0,...extra});
function create(defs,shared=true,checkpoint){
 const w=shared?{SimulatorEngine:{advancePackagePositions}}:{};
 new Function('window',script)(w);
 const m=w.STSimulation2DEngine.create(defs,7,checkpoint);m.configure({failures:false});return m;
}
for(const shared of [true,false]){
 test('Prime uses numerical whole-package threshold and a packed outlet queue (shared='+shared+')',()=>{
  const defs=[machine('u'),belt('b',{length:100,packageLength:20,pitch:40,packedGap:10,prime:0}),machine('d')];
  const model=create(defs,shared),[u,b,d]=model.line;model.control('u','STOP');
  assert.equal(b.primeThresholdUnits,3);
  b.items=[{x:90},{x:60},{x:20}];model.step(.25);
  assert.equal(b.primeQueueUnits,2);assert.equal(d.state,'Waiting for Prime');assert.equal(b.primeTriggerCount,0);
  b.items=[{x:90},{x:60},{x:30}];model.step(.25);
  assert.equal(b.primeQueueUnits,3);assert.equal(d.awaitPrime,false);assert.equal(b.primeTriggerCount,1);assert.equal(b.primeSeen,true);
  model.control('d','STOP');model.control('d','AUTO');assert.equal(b.primeSeen,false);
 });
 test('Prime cannot authorize during an outgoing Back-up response (shared='+shared+')',()=>{
  const defs=[machine('u'),belt('in',{prime:140}),machine('m'),belt('out',{backup:100,blockDelay:0,clearDelay:0,responseDelay:2}),machine('d')];
  const model=create(defs,shared),[,incoming,m,outgoing]=model.line;
  model.control('u','STOP');model.control('d','STOP');
  incoming.items=[190,170,150].map(x=>({x}));outgoing.items=[{x:100}];
  model.step(.25);
  assert.equal(incoming.primeQueueUnits,3);assert.equal(outgoing.backupBlocked,true);
  assert.equal(m.state,'Waiting for Prime');assert.equal(m.awaitPrime,true);assert.equal(incoming.primeTriggerCount,0);
  outgoing.items=[];model.step(.25);assert.equal(outgoing.backupBlocked,false);assert.equal(m.awaitPrime,false);assert.equal(incoming.primeTriggerCount,1);
 });
 test('Back-up includes beam edges and packed gaps, requires uninterrupted timers, and restores counters (shared='+shared+')',()=>{
  const defs=[belt('b',{backup:146,pitch:50,packedGap:10,configuredBackupRelease:180})];
  let model=create(defs,shared),b=model.line[0];model.control('b','STOP');
  b.items=[{x:156+0.0000005}];model.step(.25);
  assert.equal(b.backupBeam,true);assert.equal(b.backupBlocked,false);
  b.items=[];model.step(.25);assert.equal(b.backupElapsed,0);
  b.items=[{x:160},{x:130}];model.step(.25);assert.equal(b.backupBeam,false);assert.equal(b.backupOccupied,true);
  model.step(.25);assert.equal(b.backupBlocked,true);assert.equal(b.backupTriggerCount,1);
  b.items=[];model.step(.25);assert.equal(b.backupBlocked,true);
  b.items=[{x:146}];model.step(.25);assert.equal(b.backupElapsed,0);
  b.items=[];model.step(.25);
  const restored=create(defs,shared,model.snapshot());
  model.step(.25);restored.step(.25);
  assert.equal(b.backupBlocked,false);assert.equal(b.backupClearCount,1);
  assert.deepEqual(restored.snapshot(),model.snapshot());
 });
}
test('missing delays default to immediate transitions, and zero-position sensor is valid',()=>{
 const model=create([belt('b',{backup:0,blockDelay:undefined,clearDelay:undefined})]),b=model.line[0];
 model.control('b','STOP');b.items=[{x:10}];model.step(.25);assert.equal(b.backupBlocked,true);
 b.items=[];model.step(.25);assert.equal(b.backupBlocked,false);assert.equal(b.backupClearCount,1);
 const absent=create([belt('none')]);absent.line[0].items=[{x:10}];absent.step(.25);assert.equal(absent.line[0].backupBlocked,false);assert.equal(absent.line[0].primeThresholdUnits,null);
});
test('export includes both sensor diagnostics and the new policy without changing bottle count',()=>{
 const source=fs.readFileSync('apps-script/Simulation2D.html','utf8');
 const code=source.slice(source.indexOf('  function summarize2DRun('),source.indexOf('  function capture(){',source.indexOf('  function summarize2DRun(')));
 const summarize=new Function(code+';return summarize2DRun;')();
 const model=create([belt('b',{prime:140,backup:100})]);const b=model.line[0];b.bottlesPerUnit=1;b.produced=42;
 model.step(.25);const summary=summarize(model,'Completed',7,'INDEPENDENT',null,.25,[]);
 assert.equal(summary.controlPolicy,'PHYSICAL_FLOW_8');assert.equal(summary.outputBottles,42);
 assert.equal(summary.equipment[0].sensors.prime.thresholdUnits,3);assert.equal(summary.equipment[0].sensors.backup.triggerCount,0);
});
