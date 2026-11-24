import test from 'node:test';
import assert from 'node:assert/strict';
import {applyScenarioChanges,planScenarios,scenarioAudit,scenarioProposalNeeds} from '../src/analysis/ScenarioPlanner.js';

function fixture(){
  const machine=(id,type,bpm,input,output,mtbf,mttr)=>({
    id,name:id,type,initialMode:'AUTO',nominalRatePerSecond:bpm/60,
    unitOfFlow:output.toLowerCase(),characteristics:{},noiseProfile:mtbf?{reliability:{mtbfMinutes:mtbf,mttrMinutes:mttr}}:{},
    processData:{role:type==='FILLER'?'PACEMAKER':'MACHINE',flowUnits:{input,output},equipment:{maximumSpeedBpm:bpm,occupancyMode:'STORAGE'}}
  });
  const belt=(id,unit,bpm,length,prime,backup,speed,pitch,packageLength)=>({
    id,name:id,type:'CONVEYOR',initialMode:'AUTO',nominalRatePerSecond:bpm/60,
    unitOfFlow:unit.toLowerCase(),characteristics:{sourceSheetLayout:'plant-sheet-v2'},noiseProfile:{},
    processData:{role:'CONVEYOR',flowUnits:{input:unit,output:unit},equipment:{maximumSpeedBpm:bpm},
      geometry:{lactMm:length,lpPrimeMm:prime,actualCodingMm:0,actualDischargeMm:0},
      upstream:{packageLengthMm:packageLength,dischargePitchMm:pitch,startupTimeSeconds:2,bottlesDischargedAtStop:2},
      downstream:{infeedPitchMm:pitch,rampUpTimeSeconds:2},
      speedAndSensors:{overspeedVsInfeedScrewPercent:5},
      accumulation:{speedMode:'MANUAL',conveyorSpeedMmPerSecond:speed,useNominalDesignSpeed:true,backupSensorPositionMm:backup,
        blockedTimeDelaySeconds:.5,clearTimeDelaySeconds:.5,bottlesDischargedAtStop:2,insuranceFactorUnits:1,downstreamRampUpSeconds:2}}
  });
  const product=(id,pack)=>({id,formatId:id,name:id,bottlesPerCase:pack,bottleLengthMm:60,caseLengthMm:310,equipment:{}});
  return {id:'mixed-line',name:'Mixed bottle and case line',unitOfFlow:'bottles',equipment:[
    machine('inlet','FEEDER',226,'BOTTLES','BOTTLES'),
    belt('lab-fil','BOTTLES',226,24300,1000,6016.51,552.666666666667,80,60),
    machine('filler','FILLER',220,'BOTTLES','BOTTLES',13.6,.9),
    belt('fil-cas','BOTTLES',220,10000,700,1082.88,680.666666666667,190,60),
    machine('packer','CASE_PACKER',19,'BOTTLES','CASES',10.5,1.11),
    belt('pac-pal','CASES',19,37500,500,5400.75,541.5,310,310),
    machine('palletizer','PALLETIZER',19,'CASES','CASES',38.2,1.2)
  ],dynamicConfig:{durationSeconds:60,tickSeconds:.25,sampleEverySeconds:1,seed:17,commands:[],engineId:'ST_CURRENT',
    initialFormatId:'twelve',initialProductId:'twelve',productCatalog:[product('twenty-four',24),product('twelve',12)]},results:null};
}

test('planner uses the selected format and converts Case Packer input to bottles without changing native data',()=>{
  const simulation=fixture(),before=structuredClone(simulation),audit=scenarioAudit(simulation);
  const input=audit.find(item=>item.equipmentId==='fil-cas').engineering;
  assert.equal(input.input.downstreamHighSpeedBpm,228);
  assert.equal(input.calculated.recommendedInfeedConveyorSpeedMmPerSecond,758.1);
  const plan=planScenarios(simulation),proposal=plan.candidates.find(item=>item.equipmentId==='fil-cas'&&item.kind==='SPEED_BALANCE');
  assert.equal(proposal.changes[0].before,680.666666666667);
  assert.equal(proposal.changes[0].after,758.1);
  assert.equal(proposal.canApply,true,proposal.disabledReason);
  assert.equal(audit.find(item=>item.equipmentId==='pac-pal').engineering.input.downstreamHighSpeedBpm,19);
  assert.equal(audit.find(item=>item.equipmentId==='pac-pal').engineering.calculated.recommendedInfeedConveyorSpeedMmPerSecond,103.075);
  assert.deepEqual(simulation,before);
  const changed=applyScenarioChanges(simulation,proposal.changes);
  for(const original of simulation.equipment.filter(item=>item.type!=='CONVEYOR')){
    assert.deepEqual(changed.equipment.find(item=>item.id===original.id),original);
  }
});

test('format changes and per-format rates drive planning instead of catalog order or stale derived rates',()=>{
  const simulation=fixture();simulation.dynamicConfig.initialFormatId='twenty-four';simulation.dynamicConfig.initialProductId='twenty-four';
  let engineering=scenarioAudit(simulation).find(item=>item.equipmentId==='fil-cas').engineering;
  assert.equal(engineering.input.downstreamHighSpeedBpm,456);
  assert.equal(engineering.calculated.recommendedInfeedConveyorSpeedMmPerSecond,1516.2);
  simulation.dynamicConfig.productCatalog[0].equipment.packer={ratePerMinute:10};
  simulation.equipment.find(item=>item.id==='packer').processData.productInputRatePerSecond=999;
  engineering=scenarioAudit(simulation).find(item=>item.equipmentId==='fil-cas').engineering;
  assert.equal(engineering.input.downstreamHighSpeedBpm,240);
  assert.equal(engineering.calculated.recommendedInfeedConveyorSpeedMmPerSecond,798);
  assert.equal(simulation.equipment.find(item=>item.id==='packer').nominalRatePerSecond,19/60);
});

test('capacity and availability screening compare bottles with bottles while preserving installed case limits',()=>{
  const simulation=fixture(),before=structuredClone(simulation),needs=scenarioProposalNeeds(simulation);
  assert(!needs.some(item=>item.kind==='CAPACITY_TARGET_REQUIRED'));
  assert(!needs.some(item=>item.equipmentId==='palletizer'));
  const packer=needs.find(item=>item.equipmentId==='packer'&&item.kind==='RELIABILITY_TARGET_REQUIRED');
  assert(packer);
  assert(Math.abs(packer.availabilityOnlyBpm-228*10.5/(10.5+1.11))<1e-10);
  assert.equal(packer.referenceBpm,220);
  assert.deepEqual(simulation,before);
  simulation.equipment.find(item=>item.id==='packer').processData.equipment.maximumSpeedBpm=18;
  simulation.equipment.find(item=>item.id==='packer').nominalRatePerSecond=18/60;
  const capacity=scenarioProposalNeeds(simulation).find(item=>item.equipmentId==='packer'&&item.kind==='CAPACITY_TARGET_REQUIRED');
  assert.equal(capacity.configuredBpm,216);
  assert.equal(capacity.installedMaximumBpm,216);
  assert.equal(simulation.equipment.find(item=>item.id==='packer').processData.equipment.maximumSpeedBpm,18);
});

test('missing worksheet speed factor keeps a bounded existing Back-up sensor in the search',()=>{
  const simulation=fixture(),before=structuredClone(simulation),plan=planScenarios(simulation);
  for(const belt of simulation.equipment.filter(item=>item.type==='CONVEYOR')){
    const engineering=scenarioAudit(simulation).find(item=>item.equipmentId===belt.id).engineering;
    assert.equal(engineering.calculated.recommendedBackupSensorPositionMm,undefined);
    const candidate=plan.candidates.find(item=>item.kind==='SENSOR_POSITION'&&item.equipmentId===belt.id);
    assert(candidate);
    assert.equal(candidate.canApply,true,candidate.disabledReason);
    assert.equal(candidate.evidence.engineeringTargetAvailable,false);
    assert.equal(candidate.evidence.targetBasis,'EXISTING_SENSOR_RANGE');
    const change=candidate.changes[0];
    assert(change.after>=0&&change.after<change.before);
    assert(change.after<=belt.processData.geometry.lactMm-belt.processData.geometry.lpPrimeMm);
    assert.doesNotThrow(()=>applyScenarioChanges(simulation,candidate.changes));
  }
  assert.deepEqual(simulation,before);
});

test('sensor fallback requires an existing valid position and respects the physical sensor ordering',()=>{
  for(const backup of [undefined,-1,9500]){
    const simulation=fixture(),belt=simulation.equipment.find(item=>item.id==='fil-cas');
    if(backup===undefined)delete belt.processData.accumulation.backupSensorPositionMm;
    else belt.processData.accumulation.backupSensorPositionMm=backup;
    assert(!planScenarios(simulation).candidates.some(item=>item.kind==='SENSOR_POSITION'&&item.equipmentId===belt.id));
  }
});

test('actual case-passage pulse creates a zero CAPEX debounce target even with incomplete CAT speed inputs',()=>{
  const sim=fixture(),original=structuredClone(sim),plan=planScenarios(sim);
  const proposal=plan.candidates.find(p=>p.kind==='SENSOR_DEBOUNCE'&&p.equipmentId==='pac-pal');
  assert(proposal);assert.equal(proposal.canApply,true,proposal.disabledReason);assert.equal(proposal.tier,'ZERO');
  assert.equal(proposal.evidence.targetBasis,'ACTUAL_PACKAGE_PASS_TIME');
  assert(Math.abs(proposal.evidence.pulseSeconds-310/541.5)<1e-10);
  assert.equal(proposal.evidence.engineeringReviewRequired,true);
  assert.equal(proposal.changes[0].path,'processData.accumulation.blockedTimeDelaySeconds');
  assert.equal(proposal.changes[0].before,.5);assert.equal(proposal.changes[0].after,.8);
  const corrected=applyScenarioChanges(sim,proposal.changes);
  assert.equal(corrected.equipment.find(e=>e.id==='pac-pal').processData.accumulation.blockedTimeDelaySeconds,.8);
  assert.deepEqual(sim,original);
  const remaining=planScenarios(corrected).candidates.find(p=>p.kind==='SENSOR_DEBOUNCE'&&p.equipmentId==='pac-pal'&&p.evidence.targetBasis==='ACTUAL_PACKAGE_PASS_TIME');
  assert.equal(remaining,undefined,'A timer already longer than the isolated package passage is not diagnosed as this conflict.');
});
