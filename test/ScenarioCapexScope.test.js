import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {applyScenarioChanges,expandScenarioPackages,planScenarios,scenarioCategoryAllows,SCENARIO_POLICY} from '../src/analysis/ScenarioPlanner.js';
import {buildScenarioStudy} from '../src/analysis/ScenarioMethodology.js';
import {createScenarioDOE} from '../src/analysis/ScenarioDOE.js';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';

function bufferFixture(mode='ADVANCE'){
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('apps-script/DemoCaseFactory.gs','utf8'),context);
  const simulation={id:'capex-scope',equipment:JSON.parse(JSON.stringify(context.createDemoCaseRequest_().equipment)),dynamicConfig:{durationSeconds:120,tickSeconds:.25,sampleEverySeconds:5,rounds:1,seed:31,commands:[]}};
  if(mode==='BASIC')Object.assign(simulation.dynamicConfig,{machineDesignEnabled:false,machineMaximumSpeedEnabled:false});
  for(const e of simulation.equipment.filter(e=>e.type==='CONVEYOR')){
    e.processData.geometry.lactMm=1000;e.processData.geometry.lpPrimeMm=200;e.processData.accumulation.backupSensorPositionMm=100;
  }
  return simulation;
}
function replacementFixture(mode='ADVANCE'){
  const simulation=JSON.parse(fs.readFileSync('test/fixtures/demo-b-case.json','utf8')).simulations[0];
  simulation.dynamicConfig.rounds=1;
  if(mode==='BASIC')Object.assign(simulation.dynamicConfig,{machineDesignEnabled:false,machineMaximumSpeedEnabled:false});
  completeSyntheticScenarioSource(simulation);
  simulation.results.equipmentMetrics=Object.fromEntries(simulation.equipment.filter(e=>e.type!=='CONVEYOR').map(e=>[e.id,{failureSeconds:simulation.results.durationSeconds*.1,microStopSeconds:0,starvedSeconds:0,blockedSeconds:0}]));
  return simulation;
}

test('CAPEX categories are mutually exclusive and old retrofit or inherited-category targets are rejected',()=>{
  const controls={path:'processData.accumulation.conveyorSpeedFactorPercent',before:110,after:125};
  const reliability={path:'noiseProfile.reliability.mttrMinutes',before:2,after:1,external:true,interventionType:'MAINTENANCE'};
  const buffer={path:'processData.geometry.lactMm',before:1000,after:2000,interventionType:'ACCUMULATION'};
  const replacement={path:'nominalRatePerSecond',before:2,after:2.5,replacementMaximumBpm:150,external:true,interventionType:'REPLACEMENT'};
  for(const [change,tier] of [[controls,'ZERO'],[reliability,'ZERO'],[buffer,'MEDIUM'],[replacement,'HIGH']]){
    assert(scenarioCategoryAllows(change,tier));
    for(const other of ['ZERO','MEDIUM','HIGH'].filter(t=>t!==tier))assert(!scenarioCategoryAllows(change,other));
  }
  assert(!scenarioCategoryAllows({...reliability,interventionType:'RETROFIT'},'MEDIUM'));
  assert(!scenarioCategoryAllows({...controls,originTier:'ZERO'},'HIGH'));
  assert(!scenarioCategoryAllows({path:'nominalRatePerSecond',before:2,after:2.1},'ZERO'));
});

test('every mode ranks at most three new accumulation sites and preserves all machine operating inputs',()=>{
  for(const mode of ['BASIC','STANDARD','ADVANCE']){
    const simulation=bufferFixture(mode),before=structuredClone(simulation),plan=planScenarios(simulation);
    const packages=plan.candidates.filter(c=>c.tier==='MEDIUM'&&c.canApply);
    assert.equal(packages.length,3);
    assert(packages.some(p=>p.evidence.criticalEquipmentIds.length));
    for(const candidate of packages){
      assert.equal(candidate.kind,'BUFFER_RECOVERY');
      assert.equal(candidate.evidence.accumulationScope,'NEW_SECTION_AT_EXISTING_CONVEYOR_SITE');
      assert(candidate.evidence.addedLengthMm>0);
      assert(candidate.changes.every(c=>c.interventionType==='ACCUMULATION'&&c.originTier==='MEDIUM'&&c.packageId));
    }
    for(const count of [1,2,3]){
      const changes=packages.slice(0,count).flatMap(p=>p.changes),copy=applyScenarioChanges(simulation,changes,{tier:'MEDIUM'});
      assert.equal(copy.equipment.length,simulation.equipment.length,'new physical sections attach to existing transport sites');
      assert.deepEqual(copy.equipment.filter(e=>e.type!=='CONVEYOR'),simulation.equipment.filter(e=>e.type!=='CONVEYOR'));
    }
    assert.deepEqual(simulation,before);
    assert(!plan.candidates.some(p=>p.tier==='HIGH'&&p.changes.some(c=>c.path.includes('geometry'))));
  }
});

test('Medium rejects four sites, incomplete buffer packages and cross-category controls',()=>{
  const simulation=bufferFixture(),packages=planScenarios(simulation).candidates.filter(c=>c.tier==='MEDIUM'&&c.canApply),first=packages[0];
  const length=first.changes.find(c=>c.path==='processData.geometry.lactMm');
  assert.throws(()=>applyScenarioChanges(simulation,[length],{tier:'MEDIUM'}),/PACKAGE_INCOMPLETE/);
  assert.throws(()=>applyScenarioChanges(simulation,first.changes.filter(c=>c.path!==length.path),{tier:'MEDIUM'}),/ACCUMULATION_GEOMETRY_REQUIRED/);
  const machines=simulation.equipment.filter(e=>e.type!=='CONVEYOR'),reliability={equipmentId:machines[0].id,path:'noiseProfile.reliability.mttrMinutes',before:1,after:.8,external:true,interventionType:'MAINTENANCE',originTier:'ZERO',justification:'Operational target'};
  assert.throws(()=>applyScenarioChanges(simulation,[...first.changes,reliability],{tier:'MEDIUM'}),/CATEGORY_MISMATCH/);
  const lengths=simulation.equipment.filter(e=>e.type==='CONVEYOR').slice(0,4).map(e=>({equipmentId:e.id,path:length.path,before:1000,after:2000,originTier:'MEDIUM',interventionType:'ACCUMULATION'}));
  assert.equal(SCENARIO_POLICY.maxAccumulationSites,3);
  assert.throws(()=>applyScenarioChanges(simulation,lengths,{tier:'MEDIUM'}),/ACCUMULATION_SITE_LIMIT/);
});

test('Medium DOE varies capacity with coupled sensor geometry and never invents a missing sensor baseline',()=>{
  const simulation=bufferFixture(),candidate=planScenarios(simulation).candidates.find(c=>c.tier==='MEDIUM'&&c.canApply),length=candidate.changes.find(c=>c.path==='processData.geometry.lactMm');
  const chosen={...length,after:(length.before+length.after)/2},expanded=expandScenarioPackages(simulation,[chosen],candidate.changes);
  assert.equal(expanded.length,candidate.changes.length);
  for(const c of expanded){const template=candidate.changes.find(t=>t.path===c.path);assert.equal(c.after,(template.before+template.after)/2);}
  assert.doesNotThrow(()=>applyScenarioChanges(simulation,expanded,{tier:'MEDIUM'}));
  assert.deepEqual(expandScenarioPackages(simulation,[{...length,after:length.before}],candidate.changes),[]);
  const missing=candidate.changes.map(c=>c.path===length.path?c:{...c,before:null});
  const missingExpanded=expandScenarioPackages(simulation,[chosen],missing);
  assert.equal(missingExpanded.find(c=>c.path!==length.path).after,missing.find(c=>c.path!==length.path).after);
  assert.deepEqual(expandScenarioPackages(simulation,[chosen],[chosen,...candidate.changes,...candidate.changes]),expanded);
  const doe=createScenarioDOE([{...length,low:(length.before+length.after)/2,high:length.after}]);
  for(const point of doe.designPoints){
    assert.equal(point.changes[0].interventionType,'ACCUMULATION');assert.equal(point.changes[0].originTier,'MEDIUM');
    assert.deepEqual(point.changes[0].packagePaths,length.packagePaths);
    const packageChanges=expandScenarioPackages(simulation,point.changes,candidate.changes);
    assert.doesNotThrow(()=>applyScenarioChanges(simulation,packageChanges,{tier:'MEDIUM'}));
  }
});

test('High automatic replacements are bounded whole-machine engineering hypotheses in every mode',()=>{
  for(const mode of ['BASIC','STANDARD','ADVANCE']){
    const simulation=replacementFixture(mode),before=structuredClone(simulation),candidates=planScenarios(simulation).candidates.filter(c=>c.tier==='HIGH'&&c.canApply);
    assert(candidates.length>0&&candidates.length<=3);
    for(const candidate of candidates){
      assert(candidate.analysisOnly);assert.equal(candidate.evidence.targetFeasibility,'NOT_ESTABLISHED');assert.equal(candidate.evidence.supplierTarget,false);
      assert(candidate.changes.every(c=>c.analysisOnly&&c.external&&c.interventionType==='REPLACEMENT'&&c.packageId&&c.targetId));
      assert(candidate.changes.every(c=>scenarioCategoryAllows(c,'HIGH',{allowAnalysisOnly:true})&&!scenarioCategoryAllows(c,'HIGH')));
      assert(candidate.changes.every(c=>!c.path.startsWith('processData.')));
      for(const c of candidate.changes){
        if(c.path==='nominalRatePerSecond'||c.path.endsWith('mtbfMinutes'))assert(c.after<=c.before*1.25+1e-9);
        if(c.path.endsWith('mttrMinutes'))assert(c.after>=c.before*.8-1e-9);
      }
      const copy=applyScenarioChanges(simulation,candidate.changes,{tier:'HIGH'});
      assert.deepEqual(copy.equipment.filter(e=>e.type==='CONVEYOR'),simulation.equipment.filter(e=>e.type==='CONVEYOR'));
      const expanded=expandScenarioPackages(simulation,[candidate.changes[0]],candidate.changes);
      assert.deepEqual(expanded,candidate.changes);
      if(candidate.changes.length>1)assert.throws(()=>applyScenarioChanges(simulation,[candidate.changes[0]],{tier:'HIGH'}),/PACKAGE_INCOMPLETE/);
      assert.throws(()=>expandScenarioPackages(simulation,[{...candidate.changes[0],after:(candidate.changes[0].before+candidate.changes[0].after)/2}],candidate.changes),/REPLACEMENT_PACKAGE_REQUIRED/);
      const factor=candidate.changes[0],doe=createScenarioDOE([{...factor,low:Math.min(factor.before,factor.after),high:Math.max(factor.before,factor.after)}]);
      assert(doe.designPoints.flatMap(p=>p.changes).every(c=>c.analysisOnly&&c.packageId===factor.packageId&&c.targetId===factor.targetId));
    }
    assert.deepEqual(simulation,before);
  }
});

test('High does not generate replacement specifications before a completed source and preserves documented target packages',()=>{
  const simulation=replacementFixture(),automatic=planScenarios(simulation).candidates.find(c=>c.tier==='HIGH'&&c.changes.length>1);
  assert(automatic);
  const documented=automatic.changes.map(c=>({...c,analysisOnly:false,targetId:'supplier-trial',packageId:'supplier-trial',justification:'Measured supplier trial: complete machine replacement'}));
  simulation.whatIf={externalOptions:[{id:'supplier-trial',tier:'HIGH',changes:documented}]};
  const candidates=planScenarios(simulation).candidates.filter(c=>c.tier==='HIGH'&&c.equipmentId===automatic.equipmentId);
  assert.equal(candidates.length,1);assert(!candidates[0].analysisOnly);assert(candidates[0].changes.every(c=>c.targetId==='supplier-trial'));
  simulation.results=null;
  assert(!planScenarios(simulation).candidates.some(c=>c.tier==='HIGH'&&c.analysisOnly));
});

test('study identifies accumulation and exploratory replacement scope and retains package evidence',()=>{
  const simulation=replacementFixture(),candidate=planScenarios(simulation).candidates.find(c=>c.tier==='HIGH'&&c.canApply);
  const evaluation={sourceSimulationId:simulation.id,sourceSignature:'source',evaluatedChanges:candidate.changes,status:'NO_DEMONSTRATED_IMPROVEMENT'};
  const study=buildScenarioStudy(simulation,evaluation,{}),hypothesis=study.hypotheses[0];
  assert.equal(hypothesis.classification,'EXPLORATORY_REPLACEMENT');assert.equal(hypothesis.capexClassification.tier,'HIGH');assert.equal(hypothesis.targetAchievabilityVerified,false);
  assert.deepEqual(hypothesis.changes[0].packagePaths,candidate.changes[0].packagePaths);
});
