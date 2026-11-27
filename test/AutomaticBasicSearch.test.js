import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scenarioSearchSettings,scenarioSearchProfile,scenarioSearchRun,planScenarioFinalistRanking,planBasicScenarioSearch,designScenarioPackages,planScenarioConfirmation} from '../src/analysis/ScenarioSearch.js';
import {applyScenarioChanges} from '../src/analysis/ScenarioPlanner.js';
import {analyzeScenarioDOE,analyzeScenarioANOVA} from '../src/analysis/ScenarioDOE.js';
import {searchReliabilityTargets} from '../src/analysis/ReliabilityTargetSearch.js';

const fixture=()=>JSON.parse(fs.readFileSync('test/fixtures/demo-b-case.json','utf8')).simulations[0];
const get=(object,path)=>path.split('.').reduce((value,part)=>value?.[part],object);

test('Basic owns a bounded automatic profile while preserving failure exposure and full independent confirmation',()=>{
  const raw={speedProfile:'THOROUGH',automaticBasic:true},before=structuredClone(raw),settings=scenarioSearchSettings(raw);
  assert.deepEqual(settings,{speedProfile:'FAST',automaticBasic:true});assert.deepEqual(raw,before);
  const equipment=[{type:'MACHINE',noiseProfile:{reliability:{mtbfMinutes:15,mttrMinutes:1}}}],run={durationSeconds:86400,seed:17,rounds:30,reliabilityEnabled:true};
  for(const depth of ['LIGHT','MEDIUM','HIGH']){
    const profile=scenarioSearchProfile(depth,settings,{run,equipment});
    assert.equal(profile.maxCandidates,24);assert.equal(profile.passes,1);assert.equal(profile.maxFactors,3);assert.equal(profile.finalists,3);assert.equal(profile.fullHorizonFinalists,2);assert.equal(profile.hardCandidateLimit,true);
    assert.equal(profile.explorationSeconds,1800);assert.equal(profile.confirmationSeconds,3600);
    const full=scenarioSearchRun(run,depth,'validation',23,settings,equipment);assert.equal(full.durationSeconds,86400);assert.equal(full.rounds,23);assert.equal(full.seed,17);
    const ranking=planScenarioFinalistRanking(run,depth,3,{searchSettings:settings,equipment});assert.equal(ranking.fullHorizonFinalists,2);assert.equal(ranking.fullRun.durationSeconds,86400);
  }
  const result=(delta,seed)=>({throughput:100+delta,oee:70+delta,durationSeconds:86400,unitOfFlow:'bottles',roundMetrics:[0,1,2].map(i=>({seed:seed+i,durationSeconds:86400,throughput:100+delta,oee:70+delta}))});
  assert.equal(planScenarioConfirmation(result(0,21),result(5,21)).rounds,6,'automatic search keeps the existing independent sample-size rule');
  assert.equal(scenarioSearchSettings({speedProfile:'THOROUGH'}).speedProfile,'THOROUGH','Standard/Advance retain their selected profile');
});

test('Basic selects at most three distinct intervention mechanisms and keeps downtime changes paired',()=>{
  const targets=[
    {change:{equipmentId:'c1',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:100,after:120,originTier:'ZERO'},priority:100},
    {change:{equipmentId:'c2',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:100,after:125,originTier:'ZERO'},priority:99},
    {change:{equipmentId:'m1',path:'noiseProfile.reliability.mtbfMinutes',before:10,after:20,originTier:'ZERO',packageId:'RELIABILITY:m1',external:true,analysisOnly:true,interventionType:'SENSITIVITY'},priority:98},
    {change:{equipmentId:'m1',path:'noiseProfile.reliability.mttrMinutes',before:2,after:1,originTier:'ZERO',packageId:'RELIABILITY:m1',external:true,analysisOnly:true,interventionType:'SENSITIVITY'},priority:98},
    {change:{equipmentId:'c1',path:'processData.accumulation.backupSensorPositionMm',before:500,after:400,originTier:'ZERO'},priority:90},
    {change:{equipmentId:'c3',path:'processData.geometry.lactMm',before:1000,after:2000,originTier:'MEDIUM'},priority:999}
  ],before=structuredClone(targets),plan=planBasicScenarioSearch(targets,{tier:'ZERO'});
  assert.equal(plan.packages.length,3);assert.equal(plan.maximumDesignPoints,8);assert.equal(plan.candidatePackages.length,7);
  assert.deepEqual(plan.packages.map(p=>p.mechanism),['SPEED','RELIABILITY','SENSOR']);
  assert.equal(plan.changes.filter(c=>c.path.startsWith('noiseProfile.reliability.')).length,2);
  for(const point of plan.design.designPoints){const reliability=point.changes.filter(c=>c.path.startsWith('noiseProfile.reliability.'));assert([0,2].includes(reliability.length));assert(reliability.every(c=>c.analysisOnly&&c.interventionType==='SENSITIVITY'));}
  assert.deepEqual(planBasicScenarioSearch(targets.slice().reverse(),{tier:'ZERO'}),plan,'input arrival order cannot change the experiment');
  assert.deepEqual(targets,before);assert.equal(plan.omitted,1);
});

test('Medium factorial installs one, two or three complete accumulation sites with valid source geometry',()=>{
  const source=fixture(),before=structuredClone(source),conveyors=source.equipment.filter(e=>e.type==='CONVEYOR').slice(0,4);
  const targets=conveyors.flatMap((e,index)=>{
    const packageId='ACCUMULATION:'+e.id,meta={equipmentId:e.id,originTier:'MEDIUM',interventionType:'ACCUMULATION',packageId};
    return [
      {change:{...meta,path:'processData.geometry.lactMm',before:e.processData.geometry.lactMm,after:e.processData.geometry.lactMm+2000,unit:'mm'},priority:100-index},
      {change:{...meta,path:'processData.accumulation.backupSensorPositionMm',before:e.processData.accumulation.backupSensorPositionMm??null,after:2000,unit:'mm'},priority:100-index}
    ];
  });
  const plan=planBasicScenarioSearch(targets,{tier:'MEDIUM'});
  assert.equal(plan.packages.length,3);assert.equal(plan.omittedPackages,1);assert.equal(plan.design.designPoints.length,8);
  assert.deepEqual([...new Set(plan.candidatePackages.map(p=>p.siteCount))].sort(),[1,2,3]);
  for(const point of plan.design.designPoints){
    if(!point.changes.length)continue;
    const copy=applyScenarioChanges(source,point.changes,{tier:'MEDIUM'});
    for(const c of point.changes)assert.equal(get(copy.equipment.find(e=>e.id===c.equipmentId),c.path),c.after);
    for(const e of conveyors){const site=point.changes.filter(c=>c.equipmentId===e.id);assert([0,2].includes(site.length));}
  }
  const observations=plan.design.designPoints.map(point=>{
    const gain=point.levels.reduce((sum,level,i)=>sum+(level===1?(i+1)*2:0),0),roundMetrics=[0,1,2].map(i=>({seed:20+i,throughput:100+gain+i,oee:60+gain/10+i/10}));
    return {index:point.index,throughput:101+gain,oee:60.1+gain/10,roundMetrics};
  });
  const analysis=analyzeScenarioDOE(plan.design,observations),anova=analyzeScenarioANOVA(plan.design,observations);
  assert(analysis.complete);assert(anova.complete);assert.deepEqual(analysis.effects.filter(e=>e.type==='MAIN').map(e=>e.throughput),[2,4,6]);
  assert.deepEqual(source,before);
});

test('High binary experiments retain complete replacement specifications and never interpolate them',()=>{
  const source=fixture();source.dynamicConfig.machineMaximumSpeedEnabled=false;
  const machines=source.equipment.filter(e=>e.type!=='CONVEYOR').slice(0,2),targets=machines.flatMap((e,i)=>{
    const packageId='REPLACEMENT:'+e.id+':TEST',meta={equipmentId:e.id,originTier:'HIGH',interventionType:'REPLACEMENT',external:true,analysisOnly:true,packageId,targetId:packageId,justification:'Hypothetical engineering specification requiring supplier validation'};
    return [
      {change:{...meta,path:'nominalRatePerSecond',before:e.nominalRatePerSecond,after:e.nominalRatePerSecond*1.1,replacementMaximumBpm:e.nominalRatePerSecond*72},priority:100-i},
      {change:{...meta,path:'noiseProfile.reliability.mtbfMinutes',before:e.noiseProfile.reliability.mtbfMinutes,after:e.noiseProfile.reliability.mtbfMinutes*2},priority:100-i},
      {change:{...meta,path:'noiseProfile.reliability.mttrMinutes',before:e.noiseProfile.reliability.mttrMinutes,after:e.noiseProfile.reliability.mttrMinutes*.5},priority:100-i}
    ];
  });
  const plan=planBasicScenarioSearch(targets,{tier:'HIGH'});
  assert.equal(plan.design.designPoints.length,4);assert.equal(plan.factors.length,2);
  for(const point of plan.design.designPoints){
    for(const e of machines)assert([0,3].includes(point.changes.filter(c=>c.equipmentId===e.id).length));
    if(point.changes.length)assert.doesNotThrow(()=>applyScenarioChanges(source,point.changes,{tier:'HIGH'}));
  }
  assert(plan.factors.every(f=>f.before===0&&f.low===0&&f.high===1&&f.packageChanges.length===3));
  assert.throws(()=>designScenarioPackages([plan.packages[0],{...plan.packages[0],packageId:'alternative'}]),/DOE_CONFLICTING_PACKAGES/);
  const incomplete={packageId:'incomplete',changes:[{...plan.packages[0].changes[0],packagePaths:plan.packages[0].changes.map(c=>c.path)}]};
  assert.throws(()=>designScenarioPackages([incomplete]),/DOE_INCOMPLETE_PACKAGE/);
  assert.throws(()=>designScenarioPackages([plan.packages[0],{packageId:'foreign',changes:[{equipmentId:'belt',path:'processData.geometry.lactMm',before:1000,after:2000,originTier:'MEDIUM'}]}]),/SCENARIO_CATEGORY_MISMATCH/);
});

test('Basic reliability discovery has a nine-batch bound and ignores retained manual scope',async()=>{
  const source=fixture(),before=structuredClone(source),calls=[];
  const report=await searchReliabilityTargets(source,{automaticBasic:true,scope:'ALL',maximumTargets:12,maximumMachines:12,run:{seed:7,durationSeconds:1800,rounds:3},measure:async(model,changes,run)=>{
    calls.push({model,changes,run});const candidate=changes.length?applyScenarioChanges(model,changes,{tier:'ZERO'}):model;
    const loss=candidate.dynamicConfig.reliabilityEnabled===false?0:candidate.equipment.filter(e=>e.type!=='CONVEYOR').reduce((sum,e)=>{const r=e.noiseProfile.reliability;return sum+(r?10*r.mttrMinutes/(r.mtbfMinutes+r.mttrMinutes):0);},0);
    return {throughput:150-loss,oee:70-loss,warnings:[]};
  }});
  assert.equal(report.scope,'AUTO');assert.equal(report.coverage.screened,3);assert.equal(report.maximumTargets,1);assert.equal(report.targetTests.length,4);
  assert.equal(report.calculations,9);assert.equal(calls.length,9);assert(report.targetTests.every(t=>t.mechanism==='JOINT'));
  assert(calls.every(call=>call.run.seed===7&&call.run.durationSeconds===1800&&call.run.rounds===3));
  assert(report.selectedChanges.every(c=>c.analysisOnly&&c.originTier==='ZERO'));assert.equal(report.classification,'ZERO');assert.equal(report.uncertainty.confirmationRequired,true);assert.deepEqual(source,before);
});

test('engineering bounds deduplicate repeated Basic reliability grades before measuring',async()=>{
  const source=fixture(),limits=Object.fromEntries(source.equipment.filter(e=>e.type!=='CONVEYOR').map(e=>[e.id,{mtbfMaximum:e.noiseProfile.reliability.mtbfMinutes*1.1,mttrMinimum:e.noiseProfile.reliability.mttrMinutes*.9}]));
  const report=await searchReliabilityTargets(source,{automaticBasic:true,equipmentLimits:limits,run:{seed:7},measure:async(model,changes)=>({throughput:changes.length?110:model.dynamicConfig.reliabilityEnabled===false?120:100,oee:60,warnings:[]})});
  assert.equal(report.targetTests.length,1);assert.equal(report.calculations,6);
});
