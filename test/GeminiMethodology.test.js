import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';

function setup() {
  const ctx=vm.createContext({});
  for(const name of ['DemoCaseFactory.gs','ScenarioEngine.gs','GeminiContext.gs'])vm.runInContext(fs.readFileSync('apps-script/'+name,'utf8'),ctx);
  const simulation={id:'methodology-source',unitOfFlow:'bottles',equipment:JSON.parse(JSON.stringify(ctx.createDemoCaseRequest_().equipment)),dynamicConfig:{durationSeconds:1800,tickSeconds:.25,sampleEverySeconds:1,seed:1,rounds:3,commands:[]},whatIf:{methodology:{}}};
  completeSyntheticScenarioSource(simulation);
  const proposal=ctx.STScenarioEngine_.plan(simulation).projects.find(p=>p.canApply);
  const metrics=(gain=0)=>{
    const deltas=[0,.1,-.1,.2,-.2,0];
    const roundMetrics=deltas.map((noise,i)=>({seed:1000004+i,durationSeconds:1800,throughput:100+(gain?gain+noise:0),oee:50+(gain?gain+noise:0)/10}));
    return {throughput:roundMetrics.reduce((s,r)=>s+r.throughput,0)/6,oee:roundMetrics.reduce((s,r)=>s+r.oee,0)/6,durationSeconds:1800,unitOfFlow:'bottles',roundMetrics};
  };
  const baseline=metrics(),candidate=metrics(5),confirmationPlan={rounds:6,pilotSeeds:[1,2,3],baselineMeanThroughput:100,confidenceLevel:.95,minimumPracticalGain:.1,targetHalfWidth:.5,requiredRounds:6,capped:false,comparisonDurationSeconds:1800,comparisonUnitOfFlow:'bottles',policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};
  const evaluation={title:'Supported model comparison',sourceSimulationId:simulation.id,sourceSignature:ctx.STScenarioEngine_.signature(simulation),unitOfFlow:'bottles',searchPolicyVersion:'MATCHED_CAPEX_V11',methodologySignature:JSON.stringify(ctx.STScenarioEngine_.methodologyInputs(simulation.whatIf.methodology)),status:'IMPROVEMENT_REPRODUCED',evaluatedChanges:proposal.changes,confirmationPlan,independentCheck:{passed:true,seed:1000004,rounds:6,durationSeconds:1800,unitOfFlow:'bottles',baseline,candidate},study:{plantValidation:{verified:true},economics:{status:'ESTIMATED',npv:1e12}}};
  simulation.whatIf.evaluations=[evaluation];
  return {ctx,simulation,evaluation};
}

test('Gemini receives a bounded rebuilt model study, without invented financial or plant approval',()=>{
  const {ctx,simulation,evaluation}=setup(),before=JSON.stringify(evaluation);
  const evidence=ctx.compactSearchEvidence_(simulation),entry=evidence.evaluations[0];
  assert.equal(entry.independentCheck.passed,true);
  assert.equal(entry.study.confirmation.status,'MODEL_REPRODUCED');
  assert.equal(entry.study.confirmation.kind,'PAIRED_CONFIDENCE_INTERVAL');
  assert.equal(entry.study.confirmation.n,6);assert(entry.study.confirmation.throughput.lower>.1);
  assert.equal(entry.study.economics.status,'NOT_EVALUATED');assert.equal(entry.study.economics.reason,'OUT_OF_SCOPE');assert.equal(entry.study.economics.monetaryInputsRequired,false);assert.equal(entry.study.economics.missingInputs.length,0);
  assert.equal(entry.study.economics.npv,undefined);assert.equal(entry.study.plantValidation.verified,false);
  assert(entry.study.hypotheses.every(h=>h.rootCauseVerified===false&&h.targetAchievabilityVerified===false));
  const serialized=JSON.stringify(evidence);assert(!serialized.includes('roundMetrics'));assert(!serialized.includes('"packageSignature":'));assert(serialized.length<12000);
  assert.equal(JSON.stringify(evaluation),before,'Context assembly must not mutate stored evidence.');
});

test('Gemini rechecks raw confirmation instead of trusting a saved passed flag',()=>{
  for(const mutation of [
    e=>{e.independentCheck.candidate.throughput=9999;},
    e=>{e.independentCheck.candidate.durationSeconds=60;},
    e=>{e.independentCheck.candidate.unitOfFlow='cases';},
    e=>{e.independentCheck.rounds=3;}
  ]){
    const {ctx,simulation,evaluation}=setup();mutation(evaluation);
    const entry=ctx.compactSearchEvidence_(simulation).evaluations[0];
    assert.equal(entry.independentCheck.reportedPassed,true);assert.equal(entry.independentCheck.passed,false);
    assert.equal(entry.study.confirmation.status,'NOT_REPRODUCED');assert(entry.study.confirmation.reason);
    assert.equal(entry.study.economics.status,'NOT_EVALUATED');
  }
});

test('Gemini retains historical advice but never carries confirmation across a policy or methodology change',()=>{
  for(const mutate of [e=>{e.searchPolicyVersion='MATCHED_CAPEX_V9';},e=>{e.methodologySignature='old';},e=>{e.status='RUNNING';}]){
    const {ctx,simulation,evaluation}=setup();mutate(evaluation);
    const entry=ctx.compactSearchEvidence_(simulation).evaluations[0];
    assert.equal(entry.independentCheck.passed,false);
    assert.equal(entry.study.confirmation.reason,'CURRENT_CONFIRMATION_REQUIRED');
    assert.equal(entry.study.confirmation.n,undefined);
  }
});

test('Gemini cannot reauthorize saved confirmation while the current numerical source is incomplete',()=>{
  const {ctx,simulation}=setup();simulation.results.replicationStatus.state='RUNNING';
  const entry=ctx.compactSearchEvidence_(simulation).evaluations[0];
  assert.equal(entry.independentCheck.reportedPassed,true);assert.equal(entry.independentCheck.passed,false);
  assert.equal(entry.study.confirmation.reason,'CURRENT_CONFIRMATION_REQUIRED');assert.equal(entry.study.confirmation.n,undefined);
});

test('technical scenario confirmation is unaffected by monetary metadata',()=>{
  const {ctx,simulation,evaluation}=setup();
  const before=JSON.stringify(ctx.compactSearchEvidence_(simulation));
  simulation.whatIf.methodology={economics:{investment:1e12},budget:1,capexBudget:0,investmentBudget:42};
  assert.equal(JSON.stringify(ctx.STScenarioEngine_.methodologyInputs(simulation.whatIf.methodology)),evaluation.methodologySignature);
  assert.equal(JSON.stringify(ctx.compactSearchEvidence_(simulation)),before);
});

test('bounded Gemini diagnosis retains readiness, complete confirmation and financial scope',()=>{
  const {ctx,simulation}=setup(),before=JSON.stringify(simulation),original=ctx.compactSearchEvidence_(simulation).evaluations[0];
  ctx.GEMINI_CONTEXT_BUDGET_.contextCharacters=14000;
  const result=ctx.buildGeminiContext_({id:'case',name:'Case',unitOfFlow:'bottles',simulations:[simulation]},simulation.id),context=JSON.parse(result.json);
  assert(result.characters<=14000);assert.equal(context.selectedSimulation.sourceReadiness.ready,true);
  assert.equal(context.searchEvidence.evaluations.length,1);
  assert.deepEqual(context.searchEvidence.evaluations[0].study.confirmation,JSON.parse(JSON.stringify(original.study.confirmation)));
  assert.equal(context.searchEvidence.evaluations[0].study.economics.reason,'OUT_OF_SCOPE');
  assert(Object.values(context.coverage.diagnostics.sections).some(section=>section.omitted>0));
  assert.equal(JSON.stringify(simulation),before);
});
