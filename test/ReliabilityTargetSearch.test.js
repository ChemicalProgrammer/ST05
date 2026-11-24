import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {searchReliabilityTargets} from '../src/analysis/ReliabilityTargetSearch.js';
import {applyScenarioChanges} from '../src/analysis/ScenarioPlanner.js';
import {simulateBatch} from '../src/simulation/SimulationBatch.js';
import {scenarioEvidenceInput,simulatedEvidence} from './helpers/ScenarioEvidenceFixture.js';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';
const fixture=()=>structuredClone(JSON.parse(fs.readFileSync('test/fixtures/demo-b-case.json','utf8')).simulations[0]);
function synthetic(simulation,changes){const s=changes.length?applyScenarioChanges(simulation,changes):simulation;const losses=s.dynamicConfig?.reliabilityEnabled===false?0:s.equipment.filter(e=>e.type!=='CONVEYOR').reduce((sum,e,index)=>{const r=e.noiseProfile.reliability;return sum+(r?[50,30,10,5,4,2,1][index]*r.mttrMinutes/(r.mtbfMinutes+r.mttrMinutes):0);},0);return {throughput:150-losses,oee:(150-losses)/2,warnings:[]};}
test('inverse reliability search uses conditional removal, bounded targets and explicit joint packages without changing the source',async()=>{
 const s=fixture(),before=structuredClone(s),runs=[],report=await searchReliabilityTargets(s,{run:{seed:7,durationSeconds:900,rounds:3},measure:async(model,changes,run)=>{runs.push(run);return synthetic(model,changes);}});
 assert.equal(report.status,'EXPLORATORY_TARGETS_FOUND');assert.equal(report.coverage.screened,7);assert(report.targetTests.some(t=>t.mechanism==='MTBF'));assert(report.targetTests.some(t=>t.mechanism==='MTTR'));assert(report.targetTests.some(t=>t.mechanism==='JOINT'));assert(report.candidateSets.some(t=>t.kind==='JOINT_MECHANISM_TARGETS'));assert(report.selectedChanges.every(c=>c.analysisOnly&&c.interventionType==='SENSITIVITY'&&c.after>0));assert(runs.every(r=>r.seed===7&&r.durationSeconds===900));assert.deepEqual(s,before);assert.equal(report.classification,'UNASSIGNED');
});
test('disabled reliability skips discovery and cancellation cannot return partial targets',async()=>{
 const s=fixture();s.dynamicConfig.reliabilityEnabled=false;let calls=0;assert.equal((await searchReliabilityTargets(s,{measure:()=>calls++})).status,'FAILURES_DISABLED');assert.equal(calls,0);
 s.dynamicConfig.reliabilityEnabled=true;await assert.rejects(()=>searchReliabilityTargets(s,{run:{},cancelled:()=>calls>2,measure:async(model,changes)=>{calls++;return synthetic(model,changes);}}),/BATCH_CANCELLED/);
});
test('exploratory target scenarios preserve their label on the server and cannot become an ordinary CAPEX recommendation',()=>{
 const s=completeSyntheticScenarioSource(fixture()),e=s.equipment[6],c={equipmentId:e.id,path:'noiseProfile.reliability.mttrMinutes',before:2,after:1,unit:'min',external:true,analysisOnly:true,interventionType:'SENSITIVITY',justification:'Exploratory model target'};
 const ctx=vm.createContext({createSimulatorError_:(code,message)=>Object.assign(Error(message),{code})});for(const file of ['ScenarioEngine.gs','ScenarioService.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),ctx);
 const proposal={title:'Exploratory targets',tier:'HIGH',basis:'STATIC',changes:[c]};assert.throws(()=>ctx.normalizeScenarioProposal_(proposal,s));const normalized=ctx.normalizeScenarioProposal_({...proposal,analysisOnly:true},s);assert(normalized.analysisOnly);assert(normalized.changes[0].analysisOnly);assert.equal(normalized.changes[0].interventionType,'SENSITIVITY');
});

test('server-created exploratory simulations remain unclassified and retain target metadata',()=>{
 const s=completeSyntheticScenarioSource(fixture()),ctx=vm.createContext({createSimulatorError_:(code,message)=>Object.assign(Error(message),{code})});for(const file of ['ScenarioEngine.gs','ScenarioService.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),ctx);
 const record={id:'case',revision:1,simulations:[s]};ctx.withCaseWriteLock_=fn=>fn();ctx.getOwnedCaseFile_=()=>({caseData:record,file:{}});ctx.ensureCaseSimulations_=value=>structuredClone(value);ctx.generateSimulationId_=()=> 'exploratory';ctx.Utilities={getUuid:()=> 'abcdefgh-uuid'};ctx.persistCaseRecord_=()=>({});
 const e=s.equipment[6],change={equipmentId:e.id,path:'noiseProfile.reliability.mttrMinutes',before:2,after:.5,unit:'min',external:true,analysisOnly:true,interventionType:'SENSITIVITY',justification:'Model target'};
 const response=ctx.createScenario_({caseId:'case',expectedRevision:1,simulationId:s.id,sourceSignature:ctx.STScenarioEngine_.signature(s),origin:'REVIEWED',proposal:{analysisOnly:true,title:'Exploratory reliability targets',tier:'HIGH',basis:'STATIC',changes:[change]}},{});const created=response.case.simulations.at(-1);assert.equal(created.scenario.capex,null);assert.equal(created.scenario.classification,'UNASSIGNED');assert.equal(created.scenario.plantValidated,false);assert(created.scenario.analysisOnly);assert.equal(created.equipment[6].noiseProfile.reliability.mttrMinutes,.5);assert.equal(created.scenario.validation,'EXPLORATORY_TARGETS_REQUIRE_FEASIBILITY_REVIEW');
});

test('manual scope evaluates exactly the requested machines and every target obeys engineering bounds',async()=>{
 const s=fixture(),ids=s.equipment.filter(e=>e.type!=='CONVEYOR').slice(-2).map(e=>e.id),limits=Object.fromEntries(ids.map(id=>{const r=s.equipment.find(e=>e.id===id).noiseProfile.reliability;return [id,{mtbfMaximum:r.mtbfMinutes*1.4,mttrMinimum:r.mttrMinutes*.7,source:'Planned replacement estimate'}];}));
 const report=await searchReliabilityTargets(s,{scope:'MANUAL',equipmentIds:ids,equipmentLimits:limits,maximumTargets:1,run:{seed:7},measure:async(model,changes)=>{for(const c of changes){assert(ids.includes(c.equipmentId));if(c.path.endsWith('mtbfMinutes'))assert(c.after<=limits[c.equipmentId].mtbfMaximum);else assert(c.after>=limits[c.equipmentId].mttrMinimum);}return synthetic(model,changes);}});
 assert.equal(report.coverage.screened,2);assert.equal(report.ranking.length,2);assert.equal(report.scope,'MANUAL');assert(report.targetTests.every(t=>ids.includes(t.equipmentId)));assert.equal(new Set(report.targetTests.map(t=>t.equipmentId)).size,2);assert(report.candidateSets.some(c=>c.kind==='JOINT_MECHANISM_TARGETS'));
});
test('all scope includes more than the automatic screen cap and retains coupled target packages',async()=>{
 const s=fixture(),report=await searchReliabilityTargets(s,{scope:'ALL',maximumMachines:1,maximumTargets:1,run:{seed:7},measure:async(model,changes)=>synthetic(model,changes)});
 assert.equal(report.coverage.screened,7);assert.equal(new Set(report.targetTests.map(t=>t.equipmentId)).size,7);assert(report.candidateSets.some(c=>new Set(c.changes.map(x=>x.equipmentId)).size===7));
});
test('invalid scope, empty manual selections and physically inconsistent limits fail before simulation',async()=>{
 const s=fixture(),e=s.equipment.find(e=>e.type!=='CONVEYOR');let calls=0;const measure=()=>{calls++;return synthetic(s,[]);};
 for(const options of [{scope:'MANUAL',equipmentIds:[]},{scope:'MANUAL',equipmentIds:['missing']},{equipmentLimits:{[e.id]:{mttrMinimum:0}}},{equipmentLimits:{[e.id]:{mtbfMaximum:e.noiseProfile.reliability.mtbfMinutes/2}}}])await assert.rejects(()=>searchReliabilityTargets(s,{...options,measure}),/SCENARIO_RELIABILITY/);
 assert.equal(calls,0);
});

test('automatic bounded screening prioritizes nominal constraints instead of the first equipment IDs',async()=>{
 const s=scenarioEvidenceInput(),template=s.equipment[0];
 // Synthetic policy fixture: only selection is tested; no physical production
 // outcome is claimed for this deliberately simplified equipment list.
 s.equipment=Array.from({length:15},(_,index)=>({...structuredClone(template),id:'machine-'+String(index).padStart(2,'0'),name:'Machine '+index,type:index===14?'FILLER':'BLOWMOLDER',nominalRatePerSecond:index===14?1:2}));
 const report=await searchReliabilityTargets(s,{run:s.dynamicConfig,maximumTargets:1,measure:async(model,changes)=>({throughput:100+changes.length,oee:50+changes.length/2,warnings:[]})});
 assert.equal(report.coverage.screened,12);assert.equal(report.coverage.omitted,3);
 assert(report.equipmentIds.includes('machine-14'),'the final nominal constraint is not crowded out by alphabetical IDs');
 assert.equal(report.coverage.selectionEvidence[0].equipmentId,'machine-14');
 assert.equal(report.coverage.selectionEvidence[0].nominalConstraint,true);
 assert.equal(report.coverage.diagnosisReason,'NO_RESULTS');
 assert(report.coverage.selectionEvidence.every(row=>row.causalStatus==='NOT_ESTABLISHED'));
 assert.equal(report.ranking[0].pairedEvidence.available,false,'summary-only synthetic responses have no independent seed evidence');
});

test('compatible own-stop evidence affects AUTO priority, while historical observations do not',async()=>{
 const s=await simulatedEvidence();
 // Controlled observed-loss report isolates priority from the stochastic run.
 for(const [id,seconds] of [['upstream',60],['reference',0]]){
  s.results.batch.equipmentStatistics[id].failureSeconds.mean=seconds;
  s.results.batch.equipmentStatistics[id].microStopSeconds.mean=0;
 }
 const options={run:s.dynamicConfig,maximumMachines:1,maximumTargets:1,measure:async(model,changes)=>({throughput:100+changes.length,oee:50+changes.length/2,warnings:[]})};
 const current=await searchReliabilityTargets(s,options);assert.deepEqual(current.equipmentIds,['upstream']);assert.equal(current.coverage.diagnosisStatus,'OBSERVED');
 const old=JSON.parse(s.results.inputSignature);old.version='historical-engine';s.results.inputSignature=JSON.stringify(old);
 const historical=await searchReliabilityTargets(s,options);assert.deepEqual(historical.equipmentIds,['reference']);assert.equal(historical.coverage.diagnosisReason,'PROVENANCE_VERSION_MISMATCH');
 assert(historical.coverage.selectionEvidence.every(row=>row.observedOwnStopSeconds===null));
});

test('conditional reliability gains retain matched per-run uncertainty from the real simulator',async()=>{
 const s=scenarioEvidenceInput(),before=structuredClone(s);
 const report=await searchReliabilityTargets(s,{run:s.dynamicConfig,maximumTargets:1,measure:async(model,changes,run)=>{
  const candidate=changes.length?applyScenarioChanges(model,changes):model;
  const response=await simulateBatch({case:candidate,run},{summaryOnly:true});assert(response.ok,JSON.stringify(response.error));
  const result=response.result;
  return {throughput:result.batch.statistics.throughputPerMinute.mean,oee:result.batch.statistics.lineOeePercent.mean,warnings:candidate.scenarioWarnings||[],roundMetrics:result.batch.rows.map(row=>({seed:row.seed,throughput:row.summary.outputCount/(row.durationSeconds??run.durationSeconds)*60,oee:row.summary.lineOeePercent}))};
 }});
 assert.deepEqual(s,before);assert.equal(report.analysisOnly,true);assert.equal(report.classification,'UNASSIGNED');
 assert.equal(report.conditionalReliabilityGain.additive,false);
 for(const row of report.ranking){
  assert.equal(row.pairedEvidence.available,true);assert.equal(row.pairedEvidence.n,3);
  assert.deepEqual(row.pairedEvidence.seedIds,[51,52,53]);
  const deltas=row.candidate.roundMetrics.map((r,index)=>r.throughput-report.baseline.roundMetrics[index].throughput);
  assert(Math.abs(row.pairedEvidence.metrics.throughput.mean-deltas.reduce((sum,value)=>sum+value,0)/3)<1e-9);
 }
 assert(report.ranking.some(row=>Number.isFinite(row.pairedEvidence.metrics.throughput.lower)));
 assert(report.targetTests.every(row=>row.pairedEvidence.available));
 assert.equal(report.uncertainty.confirmationRequired,true);assert.equal(report.uncertainty.selectionIsExploratory,true);
});
