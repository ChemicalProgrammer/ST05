import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateLine,simulateLineAsync,createLinePlaybackSession} from '../src/simulation/LineSimulationEngine.js';
import {canonicalSimulationInputSignature} from '../src/simulation/SimulationProvenance.js';
import {simulateBatch,replicationView} from '../src/simulation/SimulationBatch.js';
import {createEquipmentRandom,equipmentRandomSeed,seededRandomStep} from '../src/simulation/SeededRandom.js';
import {stopReliabilityProfile,createFailureHistory,startFailureEpisode,closeFailureEpisode,chargeFailureEpisode,snapshotFailureHistory,summarizeFailureOverlap} from '../src/simulation/StopReliability.js';
import {advancePackagePositions} from '../src/simulation/DiscretePackageEngine.js';

const read=p=>fs.readFileSync('apps-script/'+p+'.html','utf8');
const host={SimulatorEngine:{advancePackagePositions}};
const script=read('Simulation2DEngine').match(/<script>([\s\S]*?)<\/script>/)[1];
new Function('window',script)(host);
const core=host.STSimulation2DEngine;
const format={id:'s',name:'S',bottlesPerCase:12,bottleLengthMm:60,caseLengthMm:310};
const machine=(id,rate,output='BOTTLES',input=output,rel=null,capacity=30)=>({
  id,name:id,type:input!==output?'CASE_PACKER':'CUSTOM',unitOfFlow:output.toLowerCase(),
  initialMode:'AUTO',nominalRatePerSecond:rate,
  noiseProfile:rel?{reliability:{mtbfMinutes:rel[0],mttrMinutes:rel[1]}}:{},
  processData:{flowUnits:{input,output},equipment:{internalCapacityBottles:capacity,residenceTimeSeconds:0,occupancyMode:'STORAGE'}}
});
const belt=(id,rate,length,speed,pkg,pitch,prime,backup,residual=0,restart=0,ramp=0,unit='BOTTLES')=>({
  id,name:id,type:'CONVEYOR',unitOfFlow:unit.toLowerCase(),initialMode:'AUTO',nominalRatePerSecond:rate,
  processData:{role:'CONVEYOR',flowUnits:{input:unit,output:unit},accumulation:{
    speedMode:'MANUAL',usableLengthMm:length,productLengthMm:pkg,productPitchMm:pitch,gapMm:pitch-pkg,accumulatedGapMm:0,
    conveyorSpeedMmPerSecond:speed,primeSensorPositionMm:prime,backupSensorPositionMm:backup,backupRestartPositionMm:backup,
    blockedTimeDelaySeconds:.5,clearTimeDelaySeconds:.5,upstreamStopResponseSeconds:0,bottlesDischargedAtStop:residual,
    upstreamRestartDelaySeconds:restart,downstreamRampUpSeconds:ramp}}
});
function definitions(eq,categories={}){
 return eq.map((item,i)=>{
  const {input,output}=item.processData.flowUnits,a=item.processData.accumulation;
  const fac=output==='CASES'?12:1,inf=input==='CASES'?12:1;
  if(item.type==='CONVEYOR')return {id:item.id,kind:'belt',unit:output,bottlesPerUnit:fac,length:a.usableLengthMm,
    speed:a.conveyorSpeedMmPerSecond,packageLength:a.productLengthMm,pitch:a.productPitchMm,packedGap:a.accumulatedGapMm,
    prime:a.primeSensorPositionMm,backup:a.backupSensorPositionMm,blockDelay:a.blockedTimeDelaySeconds,
    clearDelay:a.clearTimeDelaySeconds,responseDelay:a.upstreamStopResponseSeconds,residual:a.bottlesDischargedAtStop,
    upstreamRestartDelaySeconds:a.upstreamRestartDelaySeconds};
  const profile=stopReliabilityProfile(item,categories);
  const classes=profile?(profile.stopClasses||[{stopClass:'GENERAL',...profile,rate:1/profile.mtbfMinutes}]):[];
  return {id:item.id,kind:'machine',unit:output,inputUnit:input,rate:item.nominalRatePerSecond,
    designSpeedPerSecond:item.nominalRatePerSecond,batch:fac/inf,capacityBottles:item.processData.equipment.internalCapacityBottles*inf,
    residenceSeconds:0,occupancyMode:'STORAGE',inputBottleFactor:inf,bottlesPerUnit:fac,
    ...(item.processData.equipment.macroStopScrapBottles>0?{macroStopScrapBottles:item.processData.equipment.macroStopScrapBottles}:{}),
    startDelay:0,rampSeconds:0,primeRampSeconds:eq[i-1]?.processData?.accumulation?.downstreamRampUpSeconds??0,
    failures:classes.map(c=>({stopClass:c.stopClass,rate:c.rate/60,ratePerMinute:c.rate,repairSeconds:c.mttrMinutes*60,meanExposureSeconds:profile.mtbfMinutes*60}))};
 });
}
function input(eq,durationSeconds=120,extra={}){
 return {case:{id:'matched',unitOfFlow:'bottles',equipment:eq},run:{durationSeconds,tickSeconds:.25,
   sampleEverySeconds:5,seed:7,machineResidenceEnabled:true,numericalResolution:'PRECISE',
   reliabilityEnabled:false,productCatalog:[format],initialProductId:format.id,commands:[],...extra}};
}
const packing=()=>[machine('source',4),belt('bottles',4,1000,240,60,60,880,120,2),
 machine('packer',1/3,'CASES','BOTTLES'),belt('cases',1/3,3100,541.5,310,310,2600,979,2,0,0,'CASES'),machine('sink',1/3,'CASES')];
const timing=()=>[machine('source',2,'BOTTLES','BOTTLES',null,1),belt('belt',4,600,240,60,120,540,120),machine('sink',2,'BOTTLES','BOTTLES',null,1)];
function balance2D(model){
 const inputUnits=model.line[0].admittedInputUnits*model.line[0].inputBottleFactor;
 const outputUnits=model.line.at(-1).produced*model.line.at(-1).bottlesPerUnit;
 const inventoryUnits=model.line.reduce((n,item)=>n+(item.kind==='belt'?item.items.length*item.bottlesPerUnit:item.resident.length*item.inputBottleFactor),0);
 const overflowUnits=model.line.reduce((n,item)=>n+(item.kind==='belt'?item.overflowUnits*item.bottlesPerUnit:0),0);
 const configured=model.line.some(item=>item.macroScrap),scrapUnits=model.line.reduce((sum,item)=>sum+(item.macroScrap?.actualBottles||0),0);
 return {inputUnits,outputUnits,inventoryUnits,overflowUnits,clearoutUnits:0,...(configured?{scrapUnits}:{}),residualUnits:inputUnits-outputUnits-inventoryUnits-overflowUnits-scrapUnits};
}
function paired(eq,seconds,extra={}){
 const data=input(eq,seconds,extra),r=simulateLine(data);assert(r.ok,JSON.stringify(r.error));
 const n=r.result,dt=n.numerics.effectiveTickSeconds;
 const defs=definitions(eq,data.run.reliabilityCategories),d=core.create(defs,data.run.seed,undefined,{commands:data.run.commands});
 d.configure({failures:data.run.reliabilityEnabled,calendar:false,events:true});
 for(let i=0;i<Math.round(seconds/dt);i++)d.step(dt);
 assert.equal(n.summary.materialBalance.residualUnits,0);assert.equal(balance2D(d).residualUnits,0);
 for(const item of d.line){const a=d.accountingSnapshot(item);assert(Math.abs(a.timeResidualSeconds)<1e-4);assert.equal(a.outputResidualUnits,0);}
 for(const item of Object.values(n.equipmentMetrics)){assert(Math.abs(item.stateAccounting.timeResidualSeconds)<1e-4);assert.equal(item.stateAccounting.outputResidualUnits,0);}
 return {n,d,dt,defs};
}
function near(a,b,tolerance=1e-5){assert(Math.abs(a-b)<=tolerance,JSON.stringify({a,b,tolerance}));}
function stop(id,t,action){return {equipmentId:id,atVirtualSecond:t,action};}
for(const resolution of ['FAST','BALANCED','PRECISE']){
 test('matched case packing and exclusive states at '+resolution,()=>{
  const {n,d}=paired(packing(),180,{numericalResolution:resolution});
  assert.equal(n.summary.outputCount,312);assert.deepEqual(n.summary.materialBalance,balance2D(d));
  const a=n.equipmentMetrics.packer.stateAccounting,b=d.accountingSnapshot(d.line[2]);
  assert.deepEqual(a.stateSeconds,b.stateSeconds);assert.equal(a.stateSeconds.BLOCKED??0,0);
  assert.equal(a.efficiency.runtimeEfficiency,b.efficiency.runtimeEfficiency);
 });
}
test('identical commanded downtime has different line loss when stops are separated',()=>{
 const overlap=[stop('source',30,'STOP'),stop('sink',30,'STOP'),stop('source',50,'RUN'),stop('sink',50,'RUN')];
 const separate=[stop('source',30,'STOP'),stop('source',50,'RUN'),stop('sink',70,'STOP'),stop('sink',90,'RUN')];
 const outputs=[];
 for(const commands of [[],overlap,separate]){
  const {n,d}=paired(timing(),120,{commands});assert.deepEqual(n.summary.materialBalance,balance2D(d));
  outputs.push(n.summary.outputCount);
  for(const id of ['source','sink']){
   const a=n.equipmentMetrics[id].stateAccounting,b=d.accountingSnapshot(d.line.find(x=>x.id===id));
   assert.deepEqual(a.stateSeconds,b.stateSeconds);assert.equal(a.stateSeconds.STOPPED??0,commands.length?20:0);
  }
 }
 assert.deepEqual(outputs,[234,194,154]);
});
test('fractional credits at a non-divisor rate do not invent above-design capacity',()=>{
 const eq=[machine('source',4.25),belt('belt',10,600,1000,60,100,540,120),machine('sink',6)];
 for(const numericalResolution of ['FAST','BALANCED','PRECISE']){
  const {n,d}=paired(eq,60,{numericalResolution});
  assert.deepEqual(n.summary.materialBalance,balance2D(d));
  const m=n.equipmentMetrics.source,a=d.accountingSnapshot(d.line[0]);
  assert(m.outputCount>=253&&m.outputCount<=255);
  assert(m.stateAccounting.efficiency.runtimeEfficiency<=1);
  assert(a.efficiency.runtimeEfficiency<=1);
 }
});
test('last actual residual discharge is productive and the following tick is Back-up stop',()=>{
 const eq=timing(),defs=definitions(eq);defs[1].residual=1;defs[1].clearDelay=Infinity;
 const model=core.create(defs,7);model.configure({failures:false});model.control('belt','STOP');model.control('sink','STOP');
 const [source,b]=model.line;source.resident=[0];source.admittedInputUnits=1;source.outletCredit=1;b.backupBlocked=true;
 model.step(1/120);let a=model.accountingSnapshot(source);
 assert.equal(source.residualDischargedUnits,1);assert.equal(a.outputUnitsByState.DISCHARGING,1);
 assert.equal(a.outputOutsideProductiveUnits,0);near(a.productiveSeconds,1/120);
 model.step(1/120);a=model.accountingSnapshot(source);assert.equal(source.state,'Back-up stop');
 near(a.stateSeconds.BACKUP_STOP,1/120);assert.equal(balance2D(model).residualUnits,0);
});
test('serializable random streams match numerical draws and are isolated by id and family',()=>{
 for(const family of ['failure','failure-class','microstop-occurrence']){
  const random=createEquipmentRandom(7,'source',family);let state=equipmentRandomSeed(7,'source',family);
  for(let i=0;i<100;i++){const next=seededRandomStep(state);assert.equal(next.value,random.next());state=next.state;}
 }
 assert.notEqual(equipmentRandomSeed(7,'source','failure'),equipmentRandomSeed(7,'source','failure-class'));
 assert.notEqual(equipmentRandomSeed(7,'source','failure'),equipmentRandomSeed(7,'sink','failure'));
 const defs=definitions(timing()),a=core.create(defs,7),b=core.create([defs[1],defs[2],defs[0]],7);
 assert.equal(a.line[0].failureRandomState,b.line[2].failureRandomState);
});
test('general and split reliability histories match at equal exposure, including an open final repair',()=>{
 for(const split of [false,true]){
  const eq=timing();eq[0].noiseProfile.reliability={mtbfMinutes:.05,mttrMinutes:.025};
  if(split)eq[0].processData.equipment.stopInputs={minor:{mtbfMinutes:.05,mttrMinutes:.025},major:{mtbfMinutes:.07,mttrMinutes:.05}};
  const {n,d}=paired(eq,60,{reliabilityEnabled:true});
  assert.deepEqual(n.summary.materialBalance,balance2D(d));
  const h=n.equipmentMetrics.source.failureHistory,other=d.failureHistory(d.line[0]);
  assert(h.episodes.length>3);assert.deepEqual(h,other);
  assert.deepEqual(n.summary.failureOverlap,d.failureOverlap());
  if(split){assert(h.episodes.some(x=>x[2]==='MINOR'));assert(h.episodes.some(x=>x[2]==='MAJOR'));}
  else assert(h.episodes.some(x=>x[1]===null));
  near(h.episodes.reduce((sum,x)=>sum+x[6],0),n.equipmentMetrics.source.failureSeconds);
 }
});
test('shared and standalone RNG support preserve checkpoint history and remaining repair',()=>{
 const eq=timing();eq[0].noiseProfile.reliability={mtbfMinutes:.05,mttrMinutes:.025};const defs=definitions(eq);
 const shared={SimulatorEngine:{advancePackagePositions,equipmentRandomSeed,seededRandomStep,reliabilitySupport:{equipmentRandomSeed,seededRandomStep,stopReliabilityProfile,createFailureHistory,startFailureEpisode,closeFailureEpisode,
  chargeFailureEpisode,snapshotFailureHistory,summarizeFailureOverlap}}};
 new Function('window',script)(shared);
 const a=core.create(defs,7),b=shared.STSimulation2DEngine.create(defs,7);
 for(let i=0;i<1200;i++){a.step(1/120);b.step(1/120);}
 assert(a.line[0].failureRemaining>0);
 assert.deepEqual(a.snapshot(),b.snapshot());
 const restored=core.create(defs,7,a.snapshot());
 for(let i=0;i<6000;i++){a.step(1/120);restored.step(1/120);}
 assert.deepEqual(a.snapshot(),restored.snapshot());
 const old=a.snapshot();delete old.line[0].failureHistory;
 assert.equal(core.create(defs,7,old).failureHistory(core.create(defs,7,old).line[0]),null);
});
test('dedicated episode history survives the generic event cap',()=>{
 const eq=timing();eq[0].noiseProfile.reliability={mtbfMinutes:.00001,mttrMinutes:.0001};
 const r=simulateLine(input(eq,60,{reliabilityEnabled:true}));assert(r.ok,JSON.stringify(r.error));
 const a=r.result.equipmentMetrics.source,h=a.failureHistory;
 assert(r.result.detailCoverage.omittedEvents>0);
 assert(h.complete);assert.equal(h.episodes.length,a.failureCount);
 near(h.episodes.reduce((sum,x)=>sum+x[6],0),a.failureSeconds,.001);
});
test('overlap analysis counts elapsed repair union and simultaneous intervals, not line loss',()=>{
 const a=createFailureHistory(),b=createFailureHistory();
 startFailureEpisode(a,10,'GENERAL',10,5,5);closeFailureEpisode(a,20);
 startFailureEpisode(b,15,'GENERAL',10,5,5);closeFailureEpisode(b,25);
 startFailureEpisode(b,27,'GENERAL',10,5,10);
 const s=summarizeFailureOverlap([a,b],30);
 assert.equal(s.unionSeconds,18);assert.equal(s.overlapSeconds,5);assert.equal(s.summedEquipmentSeconds,23);
 assert.equal(s.peakConcurrent,2);assert.equal(s.openEpisodes,1);
});
test('summary-only replications retain all histories but their average does not invent a timeline',async()=>{
 const eq=timing();eq[0].noiseProfile.reliability={mtbfMinutes:.05,mttrMinutes:.025};
 const r=await simulateBatch(input(eq,20,{rounds:3,reliabilityEnabled:true}),{summaryOnly:true,workerFirstRound:true,runRound:simulateLineAsync,concurrency:1});
 assert(r.ok);const result=r.result,b=result.batch;
 assert(b.rows.every(row=>row.equipmentMetrics.source.failureHistory.complete));
 assert.equal(b.failureOverlapStatistics.overlapSeconds.n,3);
 assert.equal(replicationView(result,'average').equipmentMetrics.source.failureHistory,undefined);
 assert.equal(replicationView(result,'average').summary.failureOverlap,undefined);
 assert.deepEqual(replicationView(result,'representative').equipmentMetrics.source.failureHistory,b.rows[b.representativeRound-1].equipmentMetrics.source.failureHistory);
});
test('independent 2D persistence compares canonical keys, not numerical resolution or key order',()=>{
 const src=read('Simulation2D'),start=src.indexOf('  function canonical2DSignature('),end=src.indexOf('  function capture(){',start);
 const signature=new Function(src.slice(start,end)+';return canonical2DSignature;')();
 const a=['physical-flow-9','same-identity',[{id:'source',rate:4,capacity:30}],{commands:[],stops:[]},''];
 const b=['physical-flow-9','same-identity',[{capacity:30,rate:4,id:'source',zoneId:'ignored'}],{stops:[],commands:[]},''];
 assert.equal(signature(a),signature(JSON.stringify(b)));b[2][0].rate=5;assert.notEqual(signature(a),signature(b));
 assert(src.includes('canonical2DSignature(stored.signature)===signature'));
 assert(src.includes("canonical2DSignature([revised.some(item=>item.macroStopScrapBottles>0)?'physical-flow-9-scrap3':'physical-flow-9',next,revised,nextSchedule,scheduleError])"));
});

// Resolved Line G geometry (fixture only, not a full-day plant validation).
function lineGFixture(){
 return [
  machine('equipment-mwvaswuz',4.25,'BOTTLES','BOTTLES',[37.6,17.26]),
  belt('equipment-mwvbev5i-b0n78t',1,15730,498.833333333333,60,117.37254901960776,13190,718.9068627450976,3,2,2),
  machine('line-g-virtual-source',226/60,'BOTTLES','BOTTLES',[4.5,.5]),
  belt('line-g-lab-fil',226/60,24300,552.666666666667,60,80,23300,390.66666666666663,2,2,2),
  machine('line-g-filler',220/60,'BOTTLES','BOTTLES',[13.6,.9]),
  belt('line-g-fil-cas',220/60,10000,680.666666666667,60,190,9300,1108.3333333333333,3,4,4),
  machine('line-g-case-packer',19/60,'CASES','BOTTLES',[10.5,1.11]),
  belt('line-g-pac-pal',19/60,37500,541.5,310,310,37000,979.0833333333333,2,2,2,'CASES'),
  machine('line-g-palletizer',19/60,'CASES','CASES',[38.2,1.2])
 ];
}
for(const [seed,reliabilityEnabled,expected] of [[20261124,false,1344],[20261124,true,1140],[20261125,true,1344],[20261126,true,984]]){
 test('Line G resolved 600-second fixture '+seed+' failures='+reliabilityEnabled,()=>{
  const {n,d}=paired(lineGFixture(),600,{seed,reliabilityEnabled});
  assert.equal(n.summary.outputCount,expected);assert.equal(balance2D(d).outputUnits,expected);
  for(const machine of d.line.filter(item=>item.kind==='machine')){
   const a=n.equipmentMetrics[machine.id],b=d.accountingSnapshot(machine);
   assert(a.stateAccounting.efficiency.runtimeEfficiency<=1);
   assert(b.efficiency.runtimeEfficiency<=1);
   assert.equal(a.failureCount,machine.failureCount);
   const h=a.failureHistory.episodes,k=d.failureHistory(machine).episodes;
   assert.deepEqual(h.map(row=>[row[2],row[4]]),k.map(row=>[row[2],row[4]]));
  }
  // Overflow/inventory are still different; the total balance and final
  // throughput are checked, not a false assertion of identical trajectories.
 });
}


function scrapFixture(category='major',count=7){
 const eq=timing();eq[2].processData.equipment.macroStopScrapBottles=count;
 eq[2].processData.equipment.stopInputs={minor:{mtbfMinutes:0,mttrMinutes:0},major:{mtbfMinutes:0,mttrMinutes:0},[category]:{mtbfMinutes:.12,mttrMinutes:.06}};
 return eq;
}
function scrapChecks(api,core,assert){
 const trial=(eq,seconds=90,extra={})=>{
  const data=input(eq,seconds,{reliabilityEnabled:true,...extra});
  const n=api.simulateLine(data);assert(n.ok,'numerical '+JSON.stringify(n.error));
  const dt=n.result.numerics.effectiveTickSeconds,defs=definitions(eq,data.run.reliabilityCategories),d=core.create(defs,data.run.seed,undefined,{commands:data.run.commands});
  d.configure({failures:data.run.reliabilityEnabled,calendar:false,events:true});
  for(let i=0;i<Math.round(seconds/dt);i++)d.step(dt);
  assert(n.result.summary.materialBalance.residualUnits===0,'numeric balance');
  assert(balance2D(d).residualUnits===0,'2D balance');
  assert(JSON.stringify(n.result.summary.materialBalance)===JSON.stringify(balance2D(d)),'matched material ledger');
  return {n:n.result,d,defs};
 };
 const a=trial(scrapFixture()),m=a.n.equipmentMetrics.sink,b=a.d.line[2];
 assert(m.macroStopScrapEvents===5&&m.majorFailureCount===5,'five major repairs');
 assert(m.macroStopScrapRequestedBottles===35,'one quota per repair');
 assert(m.macroStopScrapBottles===22&&m.macroStopScrapPendingBottles===13,'actual and pending counted independently');
 assert(b.macroScrap.stopCount===5&&b.macroScrap.actualBottles===22&&b.macroScrap.pendingBottles===13,'2D loss parity');
 assert(a.n.summary.outputCount===115&&b.produced===115,'net output parity');
 assert(m.stateAccounting.efficiency.quality===a.d.accountingSnapshot(b).efficiency.quality,'quality parity');
 const minor=trial(scrapFixture('minor'));assert(minor.n.equipmentMetrics.sink.minorFailureCount>0,'minor repairs observed');
 assert(minor.n.summary.totalMacroStopScrapBottles===0&&minor.d.line[2].macroScrap.requestedBottles===0,'minor excluded');
 const no=trial(scrapFixture(),90,{reliabilityEnabled:false,commands:[stop('sink',20,'PAUSE'),stop('sink',35,'RUN')]});
 assert(no.n.summary.totalMacroStopScrapBottles===0&&no.d.line[2].macroScrap.requestedBottles===0,'PAUSE and disabled failures excluded');
 const general=scrapFixture();delete general[2].processData.equipment.stopInputs;general[2].noiseProfile.reliability={mtbfMinutes:.12,mttrMinutes:.06};
 const g=trial(general);assert(g.n.equipmentMetrics.sink.macroStopScrapEvents===g.n.equipmentMetrics.sink.generalFailureCount&&g.n.summary.totalMacroStopScrapBottles===22,'general repairs included');
 const eq=packing();eq[4].processData.equipment.macroStopScrapBottles=24;eq[4].noiseProfile.reliability={mtbfMinutes:.15,mttrMinutes:.04};
 const p=trial(eq,180);assert(p.n.summary.totalMacroStopScrapBottles===60&&p.d.line[4].macroScrap.actualBottles===60,'whole case losses in bottle equivalents');
 const bad=scrapFixture();bad[2].processData.equipment.macroStopScrapBottles=-1;assert(!api.simulateLine(input(bad)).ok,'negative rejected');
 eq[4].processData.equipment.macroStopScrapBottles=1;assert(!api.simulateLine(input(eq)).ok,'partial cases rejected');
 const pending=trial(scrapFixture('major',1000),30);assert(pending.n.summary.totalMacroStopScrapPendingBottles===1979,'pending not fabricated as loss');
 const saved=pending.d.snapshot(),restored=core.create(pending.defs,7,saved);
 assert(JSON.stringify(restored.line[2].macroScrap)===JSON.stringify(pending.d.line[2].macroScrap),'checkpoint restores loss accounting');
 const micro=timing();micro[2].processData.equipment.macroStopScrapBottles=7;micro[2].noiseProfile.microStop={probabilityPerMinute:60,minDurationSeconds:.1,maxDurationSeconds:.2};
 const mr=api.simulateLine(input(micro,90,{reliabilityEnabled:true}));assert(mr.ok,'microstop fixture');
 assert(mr.result.equipmentMetrics.sink.microStopSeconds>0,'microstop observed');
 assert(mr.result.summary.totalMacroStopScrapBottles===0,'microstop excluded');
 const zero=input(timing(),120);const baseline=api.simulateLine(zero);
 zero.case.equipment[2].processData.equipment.macroStopScrapBottles=0;const explicit=api.simulateLine(zero);
 assert(JSON.stringify(baseline.result)===JSON.stringify(explicit.result),'explicit zero same result as absent');
 assert(api.canonicalSimulationInputSignature(zero)===api.canonicalSimulationInputSignature(input(timing(),120)),'zero signature same as absent');
 return {actual:m.macroStopScrapBottles,pending:m.macroStopScrapPendingBottles,good:a.n.summary.outputCount,caseScrap:p.n.summary.totalMacroStopScrapBottles};
}

test('macrostop scrap physically removes product in both independent engines',()=>{scrapChecks({simulateLine,canonicalSimulationInputSignature},core,(ok,msg)=>assert.ok(ok,msg));});

test('macrostop scrap survives asynchronous calculation, precise playback and batch replications',async()=>{
 const x=input(scrapFixture(),90,{reliabilityEnabled:true}),sync=simulateLine(x);assert(sync.ok);
 const asyncResult=await simulateLineAsync(x,{yieldBetweenChunks:false});assert(asyncResult.ok);
 assert.deepEqual(asyncResult.result.summary,sync.result.summary);
 const session=createLinePlaybackSession(x);let frame;
 while(!session.finished)frame=session.advanceTo(90,{budgetMs:100,maxTicks:8192});
 assert.equal(frame.outputCount,sync.result.summary.outputCount);
 assert.equal(frame.equipment.find(e=>e.id==='sink').macroStopScrapBottles,22);
 const batch=await simulateBatch({...x,run:{...x.run,rounds:2}},{workerFirstRound:true,runRound:(input,options)=>simulateLineAsync(input,{...options,yieldBetweenChunks:false}),laterSummaryOnly:true});
 assert(batch.ok);assert.equal(batch.result.batch.rows.length,2);
 assert.equal(batch.result.batch.rows[0].summary.totalMacroStopScrapBottles,22);
 for(const row of batch.result.batch.rows){assert.equal(row.summary.materialBalance.residualUnits,0);assert.ok(row.equipmentMetrics.sink.macroStopScrapBottles>0);}
});


function manualScrapChecks(api,core,assert){
 const make=()=>{const eq=timing();eq[2].processData.equipment.macroStopScrapBottles=7;return eq;};
 const commands=[stop('sink',20,'STOP'),stop('sink',21,'STOP'),stop('sink',35,'RUN'),stop('sink',50,'PAUSE'),stop('sink',55,'RUN'),stop('sink',70,'STOP'),stop('sink',75,'RUN')];
 const x=input(make(),100,{commands,reliabilityEnabled:false}),a=api.simulateLine(x);
 assert(a.ok,'numerical success '+JSON.stringify(a.error));const n=a.result,m=n.equipmentMetrics.sink;
 const dt=n.numerics.effectiveTickSeconds,d=core.create(definitions(make()),x.run.seed,undefined,{commands});
 d.configure({failures:false,calendar:false,events:true});
 for(let i=0;i<Math.round(100/dt);i++)d.step(dt);
 const b=d.line[2].macroScrap;
 assert(m.macroStopScrapEvents===2&&m.macroStopScrapRequestedBottles===14,'one quota per STOP transition');
 assert(m.macroStopScrapBottles===14&&b.actualBottles===14&&b.stopCount===2,'both settle exactly 14');
 assert(m.failureCount===0&&d.line[2].failureCount===0,'STOP is not own failure');
 assert(n.summary.materialBalance.residualUnits===0&&balance2D(d).residualUnits===0,'material conservation');
 assert(JSON.stringify(n.summary.materialBalance)===JSON.stringify(balance2D(d)),'matched independent engines');
 const manual=core.create(definitions(make()),7);manual.configure({failures:false,calendar:false,events:false});
 for(let i=0;i<Math.round(20/dt);i++)manual.step(dt);
 const item=manual.line[2],inside=item.resident.length,before=item.produced;
 manual.control('sink','STOP');
 assert(item.macroScrap.requestedBottles===7,'direct UI STOP works with events off');
 assert(item.macroScrap.actualBottles===Math.min(inside,7),'immediate actual discard');
 assert(item.resident.length===Math.max(0,inside-7)&&item.produced===before,'only resident inventory removed');
 manual.control('sink','STOP');assert(item.macroScrap.stopCount===1,'repeated direct STOP ignored');
 assert(balance2D(manual).residualUnits===0,'paused checkpoint balance');
 const saved=manual.snapshot(),restored=core.create(definitions(make()),7,saved);restored.control('sink','STOP');
 assert(restored.line[2].macroScrap.stopCount===1,'restored stopped machine not charged again');
 const empty=core.create(definitions(make()),7);empty.control('sink','STOP');
 assert(empty.line[2].macroScrap.actualBottles===0&&empty.line[2].macroScrap.pendingBottles===7,'no invented bottles on empty machine');
 const paused=core.create(definitions(make()),7);paused.control('sink','PAUSE');
 assert(paused.line[2].macroScrap.stopCount===0,'PAUSE unchanged');
 paused.control('sink','STOP');assert(paused.line[2].macroScrap.stopCount===1,'STOP after PAUSE is explicit discard');
 const faultEq=scrapFixture(),faultInput=input(faultEq,90,{reliabilityEnabled:true});
 const faultBaseline=api.simulateLine(faultInput).result;
 const first=faultBaseline.equipmentMetrics.sink.failureHistory.episodes[0],when=first[0]+.25;
 const faultRun=api.simulateLine(input(faultEq,90,{reliabilityEnabled:true,commands:[stop('sink',when,'STOP')]}));
 assert(faultRun.ok,'repair STOP numerical success');
 assert(faultRun.result.equipmentMetrics.sink.macroStopScrapEvents===1,'STOP inside major repair not charged twice');
 const fault2=core.create(definitions(faultEq),7);fault2.configure({failures:true,calendar:false,events:true});
 for(let i=0;i<Math.round(when/dt);i++)fault2.step(dt);
 assert(fault2.line[2].failureRemaining>0,'2D repair active');
 fault2.control('sink','STOP');assert(fault2.line[2].macroScrap.stopCount===1,'2D repair STOP no duplicate');
 const packingEq=packing();packingEq[4].processData.equipment.macroStopScrapBottles=24;
 const packCommands=[stop('sink',80,'STOP'),stop('sink',90,'RUN')],packInput=input(packingEq,180,{commands:packCommands});
 const pr=api.simulateLine(packInput);assert(pr.ok,'cases STOP success');
 const pd=core.create(definitions(packingEq),7,undefined,{commands:packCommands});pd.configure({failures:false,calendar:false,events:true});
 for(let i=0;i<Math.round(180/dt);i++)pd.step(dt);
 assert(pr.result.summary.totalMacroStopScrapBottles===24&&pd.line[4].macroScrap.actualBottles===24,'discard two whole cases, 24 bottles');
 assert(pr.result.summary.materialBalance.residualUnits===0&&balance2D(pd).residualUnits===0,'case balance');
 return {numeric:n.summary.materialBalance,twoD:balance2D(d),stopCount:m.macroStopScrapEvents,caseScrap:pr.result.summary.totalMacroStopScrapBottles};
}

test('individual STOP charges scrap once in both engines, independently of reliability',()=>manualScrapChecks({simulateLine},core,(ok,msg)=>assert.ok(ok,msg)));

test('individual STOP drains only real residual inventory, counts scrap once and refills before normal discharge',()=>{
 for(const [scrap,quota,mode] of [[3,2,'STORAGE'],[0,2,'STORAGE'],[3,0,'STORAGE'],[3,2,'POSITIONS']]){
  const eq=[machine('source',4,'BOTTLES','BOTTLES',null,20),belt('belt',10,1800,900,60,60,1740,120,quota),machine('sink',8)];
  eq[0].processData.equipment.residenceTimeSeconds=2;
  eq[0].processData.equipment.occupancyMode=mode;
  eq[0].processData.equipment.macroStopScrapBottles=scrap;
  const commands=[stop('source',20,'STOP'),stop('source',20.5,'STOP'),stop('source',25,'RUN')];
  const x=input(eq,35,{commands,sampleEverySeconds:.25});
  const r=simulateLine(x);assert(r.ok,JSON.stringify(r.error));
  const result=r.result,dt=result.numerics.effectiveTickSeconds,steps=t=>Math.round(t/dt);
  const defs=definitions(eq);defs[0].residenceSeconds=2;defs[0].occupancyMode=mode;
  const model=core.create(defs,7,undefined,{commands});
  model.configure({failures:false,calendar:false,events:true});
  const m=model.line[0];
  const session=createLinePlaybackSession(x);
  const advance=t=>{while(session.time+dt/2<t)session.advanceTo(t,{budgetMs:1000,maxTicks:10000});return session.snapshot().equipment[0];};
  const initial=advance(20);for(let i=0;i<steps(20);i++)model.step(dt);
  const before={inside:m.resident.length,output:m.produced};
  for(let i=steps(20);i<steps(25);i++)model.step(dt);
  const stopped=advance(25);
  assert.equal(m.macroScrap?.actualBottles||0,scrap);
  assert.equal(m.macroScrap?.stopCount||0,scrap?1:0);
  assert.equal(m.residualDischargedUnits,quota);
  assert.equal(m.produced-before.output,quota);
  assert.equal(m.resident.length,before.inside-scrap-quota);
  assert.equal(stopped.macroStopScrapBottles||0,scrap);
  assert.equal(stopped.outputCount-initial.outputCount,quota);
  assert.equal(stopped.internalInventoryBottles,initial.internalInventoryBottles-scrap-quota);
  let first2D=false,firstN=false,prev=stopped;
  for(let i=steps(25);i<steps(35);i++){
    const inside=m.resident.length,output=m.produced;model.step(dt);
    if(!first2D&&m.produced>output){assert(inside>=before.inside,'2D refills before output');first2D=true;}
    const next=advance((i+1)*dt);
    if(!firstN&&next.outputCount>prev.outputCount){assert(prev.internalInventoryBottles>=initial.internalInventoryBottles,'numerical refills before output');firstN=true;}
    prev=next;
  }
  assert(first2D&&firstN,'both engines eventually discharge');
  assert.equal(result.summary.materialBalance.residualUnits,0);
  assert.equal(balance2D(model).residualUnits,0);
  assert.equal(model.accountingSnapshot(m).outputOutsideProductiveUnits,0);
  assert.equal(result.equipmentMetrics.source.stateAccounting.outputOutsideProductiveUnits,0);
 }
});
