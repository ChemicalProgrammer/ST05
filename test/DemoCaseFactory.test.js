import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {simulateLine} from '../src/simulation/LineSimulationEngine.js';
import {resolvePackingFormats,validateFormatCatalog} from '../src/simulation/FormatCatalog.js';
import {applyScenarioChanges} from '../src/analysis/ScenarioPlanner.js';
const demo=()=>{const f=vm.createContext({});vm.runInContext(fs.readFileSync('apps-script/DemoCaseFactory.gs','utf8'),f);return JSON.parse(JSON.stringify(f.createDemoCaseRequest_()));};

test('complete demo covers all distinct machine designs in a coherent 19-step physical line',()=>{
 const r=demo(),machines=r.equipment.filter(e=>e.type!=='CONVEYOR');
 assert.deepEqual(machines.map(e=>e.type),['BLOWMOLDER','FEEDER','PUCKER','FILLER','CAPPER','DEPUCKER','SLEEVER','CUSTOM','CASE_PACKER','PALLETIZER']);
 assert.equal(r.equipment.length,19);assert.equal(r.equipment.filter(e=>e.type==='CONVEYOR').length,9);
 assert.equal(r.metadata.dataClassification,'DEMO_ONLY');assert.match(r.metadata.dataNote,/synthetic assumptions/i);
 assert.equal(r.equipment.filter(e=>e.characteristics.isPacemaker).length,1);
 for(const [i,e] of r.equipment.entries()){
  assert.equal(e.type==='CONVEYOR',i%2===1);
  assert(e.nominalRatePerSecond>0);assert(e.processData.equipment.maximumSpeedBpm>=e.nominalRatePerSecond*60);
  if(e.type==='CONVEYOR'){
   const a=e.processData.accumulation,g=e.processData.geometry;
   assert(g.lactMm>g.lpPrimeMm);assert(a.backupSensorPositionMm>0&&a.backupSensorPositionMm<g.lactMm-g.lpPrimeMm);
   assert(a.conveyorSpeedMmPerSecond>0);assert(a.conveyorWidthMm>=e.processData.upstream.packageWidthMm);
   for(const key of ['blockedTimeDelaySeconds','clearTimeDelaySeconds','upstreamStopResponseSeconds','restartToFirstPackageSeconds'])assert(Number.isFinite(a[key])&&a[key]>=0,key);
   assert(e.processData.upstream.dischargeVelocityMPerMinute>0);
  }else{
   assert(Number.isInteger(e.processData.equipment.internalCapacityBottles));
   assert(e.processData.equipment.residenceTimeSeconds>0);assert.equal(e.processData.downstream.rampAfterRepair,true);
  }
 }
 const palletizer=machines.at(-1);assert.deepEqual(palletizer.processData.flowUnits,{input:'CASES',output:'CASES'});
 assert.equal(palletizer.processData.equipment.internalCapacityBottles,8);
 assert.deepEqual(r.equipment.at(-2).processData.flowUnits,{input:'CASES',output:'CASES'});
 assert.deepEqual(machines.at(-2).processData.flowUnits,{input:'BOTTLES',output:'CASES'});
});

test('demo has a shared packing format and opens every simulation with the current animated equipment',()=>{
 const r=demo(),catalog=r.metadata.formatCatalog;validateFormatCatalog(catalog);
 const resolved=resolvePackingFormats(catalog)[0];
 assert.deepEqual(r.simulations[0].dynamicConfig.productCatalog,[resolved]);
 assert.equal(resolved.bottlesPerCase,12);assert.equal(resolved.presentations.bottle.widthMm,66);assert.equal(resolved.presentations.case.widthMm,260);
 for(const s of r.simulations){assert.equal(s.dynamicConfig.initialFormatId,resolved.id);assert.equal(s.simulation2d.layout.equipmentView,'animated');assert.equal(s.results,null);}
 assert.deepEqual(r.engineConfig.packConfiguration,{bottlesPerCase:12,casesPerLayer:9,layersPerPallet:4});
});

test('complete demo runs through case packing and palletizing with internal inventory and conserves bottle equivalents',()=>{
 const r=demo(),s=r.simulations[0];
 const response=simulateLine({case:r,run:{...s.dynamicConfig,reliabilityEnabled:false,rounds:1}});
 assert.equal(response.ok,true,JSON.stringify(response.error));const result=response.result;
 const output=result.equipmentMetrics['palletizer-1'];assert(output.outputCount>0);assert(Number.isInteger(output.outputCount));
 assert.equal(result.summary.outputCount,output.outputCount*12);assert(Math.abs(result.summary.materialBalance.residualUnits)<1e-8);
 assert(result.equipmentMetrics['case-packer-1'].outputCount>=output.outputCount);
 assert(result.samples.some(s=>s.equipment.some(e=>e.residentBottles>0||e.internalInventoryBottles>0))||result.summary.materialBalance.inventoryUnits>0);
});

test('demo CAPEX scenarios retain shared physical units, capacities, residence times and reliability',()=>{
 const r=demo(),base=r.simulations[0];assert.equal(r.simulations.length,4);
 for(const [index,option] of base.whatIf.externalOptions.entries()){
  const candidate=applyScenarioChanges(base,option.changes);assert(!candidate.scenarioWarnings?.length,JSON.stringify(candidate.scenarioWarnings));
  assert.deepEqual(candidate.equipment,r.simulations[index+1].equipment);
  assert.deepEqual(candidate.equipment.map(e=>e.noiseProfile.reliability),base.equipment.map(e=>e.noiseProfile.reliability));
  for(const [i,e] of candidate.equipment.entries()){
   assert.deepEqual(e.processData.flowUnits,base.equipment[i].processData.flowUnits);
   assert.equal(e.processData.equipment.internalCapacityBottles,base.equipment[i].processData.equipment.internalCapacityBottles);
  }
  if(option.tier==='ZERO')assert(option.changes.every(c=>c.path!=='processData.geometry.lactMm'));
  assert.equal(candidate.equipment.find(e=>e.id==='filler-1').nominalRatePerSecond,400/60);
 }
});
