import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {simulateLine,simulateLineAsync} from '../src/simulation/LineSimulationEngine.js';
import {advancePackagePositions} from '../src/simulation/DiscretePackageEngine.js';
const script=name=>fs.readFileSync('apps-script/'+name+'.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function equipment(capacity=30){
 const machine=(id,rate)=>({id,name:id,type:'CUSTOM',initialMode:'AUTO',nominalRatePerSecond:rate,processData:{equipment:{internalCapacityBottles:capacity},flowUnits:{input:'BOTTLES',output:'BOTTLES'}}});
 return [machine('source',2),{id:'belt',name:'Belt',type:'CONVEYOR',initialMode:'AUTO',nominalRatePerSecond:10,processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'},accumulation:{speedMode:'MANUAL',usableLengthMm:1000,productLengthMm:20,movingGapMm:10,accumulatedGapMm:0,conveyorSpeedMmPerSecond:500,primeSensorPositionMm:900,backupSensorPositionMm:100,backupRestartPositionMm:200,upstreamStopResponseSeconds:0,bottlesDischargedAtStop:0,downstreamRampUpSeconds:0,blockedTimeDelaySeconds:.5,clearTimeDelaySeconds:.5}}},machine('sink',10)];
}
function run(line,product){const response=simulateLine({case:{id:'policy',unitOfFlow:'bottles',equipment:line},run:{durationSeconds:60,tickSeconds:.25,sampleEverySeconds:1,seed:7,reliabilityEnabled:false,machineResidenceEnabled:true,...(product?{productCatalog:[product],initialProductId:product.id}:{})}});assert.equal(response.ok,true,JSON.stringify(response.error));return response.result;}
test('capacity is a storage ceiling and does not synthesize a residence delay',()=>{
 const small=run(equipment(1)),large=run(equipment(100));
 const first=r=>r.samples.find(s=>s.equipment[0].outputCount>0).virtualSecond;
 assert.equal(first(small),first(large));assert(first(large)<=1);
 assert.equal(small.equipmentMetrics.source.outputCount,large.equipmentMetrics.source.outputCount);
 assert.equal(large.samples.at(-1).equipment[0].estimatedResidenceSeconds,0);
 for(const result of [small,large]){assert.equal(result.summary.materialBalance.residualUnits,0);for(const m of Object.values(result.equipmentMetrics))assert(Number.isInteger(m.outputCount));}
});
test('a twelve-bottle packer releases complete cases and preserves equivalents at every sample',()=>{
 const line=equipment(30);Object.assign(line[2],{type:'CASE_PACKER',nominalRatePerSecond:1/6});line[2].processData.flowUnits.output='CASES';
 const result=run(line,{id:'12',name:'12 pack',bottlesPerCase:12,bottleLengthMm:20,caseLengthMm:100});
 assert(result.products.rows[0].outputNative>0);assert(Number.isInteger(result.products.rows[0].outputNative));
 for(const sample of result.samples){assert.equal(sample.outputCount,sample.equipment.at(-1).outputCount*12);assert(Number.isInteger(sample.equipment.at(-1).outputCount));}
 assert.equal(result.summary.materialBalance.residualUnits,0);
});
test('explicit residence is productive internal work, not starvation',()=>{
 const line=equipment(30);line[0].processData.equipment.residenceTimeSeconds=10;
 const result=run(line),early=result.samples.find(s=>s.virtualSecond===5).equipment[0];
 assert.equal(early.outputCount,0);assert.equal(early.availabilityState,'RUNNING');assert(early.runningSeconds>4);
});
test('photoeye timers keep working with a stopped belt and reset on an interrupted clear delay',()=>{
 const window={SimulatorEngine:{advancePackagePositions}};vm.runInNewContext(script('Simulation2DEngine'),{window});
 const model=window.STSimulation2DEngine.create([{id:'belt',kind:'belt',length:1000,speed:100,packageLength:60,pitch:100,packedGap:0,prime:null,backup:200,blockDelay:.5,clearDelay:.5}]);
 const belt=model.line[0];belt.items=[{x:200}];model.control('belt','STOP');model.step(.25);model.step(.25);
 assert.equal(belt.items[0].x,200);assert.equal(belt.backupBlocked,true);
 belt.items=[];model.step(.25);assert.equal(belt.backupBlocked,true);
 belt.items=[{x:200}];model.step(.1);assert.equal(belt.backupElapsed,0);
 belt.items=[];model.step(.25);assert.equal(belt.backupBlocked,true);model.step(.25);assert.equal(belt.backupBlocked,false);
});
test('conveyor dimension samples draw two matching units with independent width and edge gap',()=>{
 const source=script('Simulation2D'),draws=[],dimensions=[];
 const window={STSimulation2DMachines:{drawBottle(...args){draws.push(['bottle',...args.slice(1)]);},drawCase(...args){draws.push(['case',...args.slice(1)]);}}};
 const ctx={save(){},restore(){},measureText(text){return{width:text.length*5};}};
 const context=vm.createContext({defaultLayoutColors:{label:'#4E8AC2',caseLabel:'#4E8AC2'},window,appearance:{bottle:'oval-jug',liquid:'#123456',cases:'#987654'},bottleStages:new Map([['belt',7]]),sceneScale:.09,telemetryFont:'6.75px system-ui',num:String,
  productWidth:item=>(item.packageWidth||item.packageLength)*.09,productHeight:()=>25,
  CanvasDimension:class{constructor(...args){dimensions.push(args);}draw(){}}});
 vm.runInContext(source.slice(source.indexOf('  function drawConveyorUnitDimensions('),source.indexOf('  function drawBelt('))+';this.drawSample=drawConveyorUnitDimensions;',context);
 const item={id:'belt',unit:'BOTTLES',packageWidth:130,packageLength:98,pitch:141};
 context.drawSample(ctx,item,100,100,'#111','#08f','#fff','#777','#999',null);
 assert.equal(draws.length,2);assert(draws.every(d=>d[0]==='bottle'&&d.at(-2)==='oval-jug'&&d.at(-1)===7));
 assert.deepEqual(dimensions.map(d=>d[0]),['Width · 130 mm','Gap · 43 mm','Pitch · 141 mm']);
 draws.length=0;dimensions.length=0;item.unit='CASES';item.pitch=98;
 context.drawSample(ctx,item,100,100,'#111','#08f','#fff','#777','#999',null);
 assert.equal(draws.length,2);assert(draws.every(d=>d[0]==='case'));assert.equal(dimensions[1][0],'Gap · 0 mm');
 assert(dimensions[2][3]<draws[0][2],'case center-to-center dimension is above the cases');
 assert(dimensions[0][3]>draws[0][2]+25&&dimensions[1][3]>dimensions[0][3],'width and gap stay below the cases');
});


test('Optional physical positions reach full 36-pocket occupancy without creating material',()=>{
 const line=equipment(36);
 line[0].nominalRatePerSecond=8;line[2].nominalRatePerSecond=10;
 line[0].processData.equipment.residenceTimeSeconds=3;
 line[2].processData.equipment.residenceTimeSeconds=0;
 line[0].processData.equipment.occupancyMode='STORAGE';
 const storage=run(line);
 line[0].processData.equipment.occupancyMode='POSITIONS';
 const positions=run(line);
 const at=(result,time)=>result.samples.find(frame=>frame.virtualSecond===time).equipment[0];
 assert.equal(at(storage,6).internalInventoryBottles,24,'A residence of three seconds retains 24 bottles at 480 bpm');
 assert.equal(at(positions,6).internalInventoryBottles,36,'A 36-position rotating machine is fully occupied after startup');
 assert.equal(at(positions,6).internalCapacityBottles,36);
 assert(at(positions,10).outputCount>0,'Position mode must discharge completed bottles');
 assert.equal(positions.summary.materialBalance.residualUnits,0);
 assert.equal(storage.summary.materialBalance.residualUnits,0);
 assert(positions.samples.every(frame=>frame.equipment[0].internalInventoryBottles<=36));
});

test('2D physical positions hold 36 bottles at full feed and preserve the storage model',()=>{
 const host={};vm.runInNewContext(script('Simulation2DEngine'),{window:host});
 const machine=(id,occupancyMode)=>({kind:'machine',id,rate:8,
   capacityBottles:36,residenceSeconds:3,occupancyMode,
   inputBottleFactor:1,bottlesPerUnit:1,batch:1,startDelay:0,
   rampSeconds:0,primeRampSeconds:0,mode:'AUTO'});
 const conveyor={kind:'belt',id:'belt',length:10000,speed:1000,
   packageLength:50,pitch:100,packedGap:0,prime:null,backup:null,
   blockDelay:.5,clearDelay:.5,responseDelay:0,residual:0};
 const runMode=mode=>{
   const line=host.STSimulation2DEngine.create([machine('source',mode),conveyor,machine('sink','STORAGE')],7);
   line.configure({failures:false,events:false,calendar:false});
   for(let tick=0;tick<120*12;tick++)line.step(1/120);
   return line.line[0];
 };
 const storage=runMode('STORAGE'),positions=runMode('POSITIONS');
 assert.equal(storage.resident.length,24);
 assert.equal(positions.resident.length,36);
 assert(positions.produced>0);
 assert.equal(positions.positionDue.length,positions.resident.length);
});

test('Live telemetry is denser than saved history and uses measured equipment counters',async()=>{
 const line=equipment(36);
 line[0].nominalRatePerSecond=8;
 line[0].processData.equipment.occupancyMode='POSITIONS';
 const input={case:{id:'live-telemetry',unitOfFlow:'bottles',equipment:line},
   run:{durationSeconds:10,tickSeconds:.25,sampleEverySeconds:1,seed:7,
     reliabilityEnabled:false,machineResidenceEnabled:true,calculationMode:'LIVE'}};
 const parts=[];
 const response=await simulateLineAsync(input,{onPartial:partial=>parts.push(partial),
   yieldBetweenChunks:false});
 assert(response.ok,JSON.stringify(response.error));
 const result=response.result,telemetry=result.liveTelemetry;
 assert(telemetry.length>result.samples.length,'Live telemetry is separate from bounded replay history');
 assert(telemetry.length<=5001);
 assert(parts.length>0&&parts[0].liveTelemetry.length>0,'Initial Live frame reaches the UI');
 assert(telemetry.every((frame,index)=>index===0||frame.virtualSecond>telemetry[index-1].virtualSecond));
 assert(telemetry.every(frame=>frame.equipment[0].internalInventoryBottles<=36));
 assert.equal(telemetry.at(-1).equipment[0].internalInventoryBottles,36);
 assert(telemetry.at(-1).equipment[0].processedUnits>0);
 assert.equal(result.summary.materialBalance.residualUnits,0);
});
