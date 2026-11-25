import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {advancePackagePositions} from '../src/simulation/DiscretePackageEngine.js';
import {simulateLine} from '../src/simulation/LineSimulationEngine.js';
const script=name=>fs.readFileSync('apps-script/'+name+'.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const machine=(id,extra={})=>({id,name:id,kind:'machine',unit:'BOTTLES',rate:4,batch:1,startDelay:0,rampSeconds:0,capacityBottles:30,residenceSeconds:0,inputBottleFactor:1,bottlesPerUnit:1,...extra});
const belt=(id,extra={})=>({id,name:id,kind:'belt',unit:'BOTTLES',bottlesPerUnit:1,length:100,speed:100,packageLength:20,pitch:20,packedGap:0,prime:null,backup:10,blockDelay:0,clearDelay:Infinity,responseDelay:0,residual:2,...extra});
function create(defs,shared=true,checkpoint){
 const w=shared?{SimulatorEngine:{advancePackagePositions}}:{};
 new Function('window',script('Simulation2DEngine'))(w);
 const m=w.STSimulation2DEngine.create(defs,7,checkpoint);m.configure({failures:false});return m;
}
function summarize(model){
 const src=fs.readFileSync('apps-script/Simulation2D.html','utf8');
 const start=src.indexOf('  function summarize2DRun(');
 return new Function(src.slice(start,src.indexOf('  function capture(){',start))+';return summarize2DRun;')()(model,'Completed',7,'INDEPENDENT',null,model.time,[]);
}
for(const shared of [true,false]){
 test('normal blocked entry retains material; only actual residual can overflow, once per package ('+shared+')',()=>{
  const defs=[machine('source',{capacityBottles:3}),belt('b',{backup:null}),machine('sink')];
  const model=create(defs,shared),[m,b,d]=model.line;
  model.control('sink','STOP');model.control('b','STOP');
  m.resident=[0,0,0];m.admittedInputUnits=3;m.outletCredit=1;
  b.items=[90,70,50,30,10].map(x=>({x}));b.receivedUnits=5;m.produced=5;m.admittedInputUnits+=5;
  model.step(.25);
  assert.equal(m.produced,5);assert.equal(m.resident.length,3);assert.equal(b.overflowUnits,0);assert.equal(b.blockedEntryAttempts,1);
  b.backupBlocked=true;
  for(let i=0;i<3;i++)model.step(.25);
  assert.equal(m.produced,7);assert.equal(m.resident.length,1);assert.equal(m.residual,0);
  assert.equal(m.residualDischargedUnits,2);assert.equal(m.dischargeOverflowUnits,2);
  assert.equal(b.items.length,5);assert.equal(b.overflowUnits,2);assert.equal(b.overflowEvents,2);
  assert.equal(b.receivedUnits,5);assert.equal(m.state,'Back-up stop');
  const balance=summarize(model).materialBalance;
  assert.deepEqual(balance,{unit:'BOTTLES',inputBottles:8,outputBottles:0,inventoryBottles:6,overflowBottles:2,residualBottles:0});
  const restored=create(defs,shared,model.snapshot());restored.step(.25);model.step(.25);
  assert.deepEqual(restored.snapshot(),model.snapshot());
 });
 test('native residual cases enter an available physical gap and otherwise spill without dividing by pack size ('+shared+')',()=>{
  const source=machine('source',{unit:'CASES',inputUnit:'CASES',inputBottleFactor:12,bottlesPerUnit:12,capacityBottles:360});
  const out=belt('b',{unit:'CASES',bottlesPerUnit:12,length:100,packageLength:20,pitch:20,backup:null});
  const model=create([source,out,machine('sink',{unit:'CASES',inputBottleFactor:12,bottlesPerUnit:12,capacityBottles:360})],shared),[m,b]=model.line;
  model.control('sink','STOP');model.control('b','STOP');
  m.resident=[0,0];m.admittedInputUnits=6;m.produced=4;m.outletCredit=1;
  b.items=[90,70,50,30].map(x=>({x}));b.receivedUnits=4;b.backupBlocked=true;
  for(let i=0;i<4;i++)model.step(.25);
  assert.equal(m.residualDischargedUnits,2);assert.equal(m.produced,6);assert.equal(m.resident.length,0);
  assert.equal(b.receivedUnits,5);assert.equal(b.overflowUnits,1);assert.equal(b.items.length,5);
  const s=summarize(model);assert.equal(s.equipment[0].discharge.residualDischargedBottles,24);
  assert.equal(s.equipment[1].transport.configuredResidualUnits,2);assert.equal(s.equipment[1].transport.overflowBottles,12);
  assert.deepEqual(s.materialBalance,{unit:'BOTTLES',inputBottles:72,outputBottles:0,inventoryBottles:60,overflowBottles:12,residualBottles:0});
 });
}
test('partial case inventory is conserved as bottles, and legacy checkpoints cannot establish full accounting',()=>{
 const defs=[machine('source'),belt('b',{length:1000,backup:null,residual:0}),machine('packer',{unit:'CASES',bottlesPerUnit:12,batch:12,rate:1/3,inputUnit:'BOTTLES'}),belt('cases',{unit:'CASES',bottlesPerUnit:12,length:200,backup:null,residual:0}),machine('sink',{unit:'CASES',bottlesPerUnit:12,inputBottleFactor:12,capacityBottles:360,rate:1/3})];
 const model=create(defs);
 for(let i=0;i<1000;i++)model.step(.05);
 const s=summarize(model);assert.equal(s.controlPolicy,'PHYSICAL_FLOW_8');assert(s.outputBottles>0);
 assert.equal(s.materialBalance.residualBottles,0);
 assert.equal(s.equipment[2].inventoryBottles,model.line[2].resident.length);
 assert.equal(s.equipment[4].inventoryBottles,model.line[4].resident.length*12);
 const saved=model.snapshot();delete saved.materialAccountingComplete;
 const old=create(defs,true,saved);
 assert.equal(summarize(old).materialBalance,null);
});
test('no overflow before the configured stop response and no artificial residual when inventory is insufficient',()=>{
 const defs=[machine('source'),belt('b',{backup:null,responseDelay:1,residual:3}),machine('sink')];
 const model=create(defs),[m,b]=model.line;model.control('sink','STOP');model.control('b','STOP');
 m.resident=[0];m.admittedInputUnits=6;m.produced=5;m.outletCredit=1;
 b.items=[90,70,50,30,10].map(x=>({x}));b.receivedUnits=5;b.backupBlocked=true;
 for(let i=0;i<4;i++)model.step(.25);
 assert.equal(m.residual,1);assert.equal(b.overflowUnits,0);
 model.step(.25);assert.equal(m.residualDischargedUnits,1);assert.equal(b.overflowUnits,1);
 for(let i=0;i<12;i++)model.step(.25);
 assert.equal(b.overflowUnits,1);assert.equal(summarize(model).materialBalance.residualBottles,0);
});
test('numerical native-case residual releases actual packages, with bottle-equivalent overflow conserved',()=>{
 const unit=(id,rate)=>({id,name:id,type:'CUSTOM',initialMode:'AUTO',nominalRatePerSecond:rate,processData:{flowUnits:{input:'CASES',output:'CASES'},equipment:{internalCapacityBottles:30,residenceTimeSeconds:3}}});
 const source=unit('source',4);source.type='CASE_PACKER';source.processData.flowUnits.input='BOTTLES';source.processData.equipment.internalCapacityBottles=360;
 const conveyor={id:'belt',name:'Belt',type:'CONVEYOR',initialMode:'AUTO',nominalRatePerSecond:1,processData:{role:'CONVEYOR',flowUnits:{input:'CASES',output:'CASES'},accumulation:{speedMode:'MANUAL',usableLengthMm:620,productLengthMm:310,productPitchMm:310,gapMm:0,accumulatedGapMm:0,conveyorSpeedMmPerSecond:310,primeSensorPositionMm:465,backupSensorPositionMm:155,backupRestartPositionMm:155,blockedTimeDelaySeconds:.1,clearTimeDelaySeconds:.5,upstreamStopResponseSeconds:0,bottlesDischargedAtStop:2,downstreamRampUpSeconds:0}}};
 const sink={...unit('sink',1),initialMode:'STOP'};
 const format={id:'p',name:'12 pack',bottlesPerCase:12,bottleLengthMm:60,caseLengthMm:310};
 // Stop before the next sensor activation to isolate a single discharge.
 const response=simulateLine({case:{id:'case-residual',unitOfFlow:'bottles',equipment:[source,conveyor,sink]},run:{durationSeconds:4.1,tickSeconds:.05,sampleEverySeconds:.25,seed:7,machineResidenceEnabled:true,numericalResolution:'FAST',reliabilityEnabled:false,productCatalog:[format],initialProductId:format.id}});
 assert(response.ok,JSON.stringify(response.error));
 const r=response.result,m=r.equipmentMetrics.source;
 assert.equal(m.stopTransitionOutputUnits,2);assert.equal(m.stopTransitionBottleEquivalents,24);
 assert.equal(r.summary.materialBalance.overflowUnits,24);assert.equal(r.summary.materialBalance.residualUnits,0);
});
