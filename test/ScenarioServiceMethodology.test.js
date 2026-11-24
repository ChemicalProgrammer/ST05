import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createScenarioDOE,analyzeScenarioDOE,analyzeScenarioANOVA} from '../src/analysis/ScenarioDOE.js';
import {planScenarioConfirmation} from '../src/analysis/ScenarioSearch.js';

const plain=value=>JSON.parse(JSON.stringify(value));
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.keys(value).sort().reduce((copy,key)=>{if(value[key]!==undefined)copy[key]=canonical(value[key]);return copy;},{});
  return value;
}
function metrics(gains,seed) {
  const durationSeconds=1800,unitOfFlow='bottles';
  return {
    base:{throughput:100,oee:50,durationSeconds,unitOfFlow,roundMetrics:gains.map((_,i)=>({seed:seed+i,throughput:100,oee:50,durationSeconds}))},
    candidate:{throughput:100+gains.reduce((sum,value)=>sum+value,0)/gains.length,oee:51,durationSeconds,unitOfFlow,
      roundMetrics:gains.map((gain,i)=>({seed:seed+i,throughput:100+gain,oee:51,durationSeconds}))}
  };
}
function setup() {
  let record,writes=0,locked=false;
  const context={
    Utilities:{getUuid:()=> 'methodology-scenario-uuid'},
    createSimulatorError_:(code,message,details)=>Object.assign(new Error(message),{code,details}),
    withCaseWriteLock_:callback=>{assert(!locked);locked=true;try{return callback();}finally{locked=false;}},
    ensureCaseSimulations_:value=>value,
    generateSimulationId_:()=> 'scenario',
    getOwnedCaseFile_:(id,user)=>{
      assert(locked);assert.equal(id,'case-methodology');assert.equal(user.email,'owner@test');
      return {caseData:plain(record),file:{setContent:value=>{assert(locked);writes++;record=JSON.parse(value);}}};
    },
    persistCaseRecord_:(value,owned)=>{owned.file.setContent(JSON.stringify(value));return owned.file;}
  };
  vm.createContext(context);
  for(const file of ['DemoCaseFactory.gs','ScenarioEngine.gs','ScenarioService.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),context);
  const source={id:'baseline',name:'Baseline',unitOfFlow:'bottles',
    equipment:plain(context.createDemoCaseRequest_().equipment),
    dynamicConfig:{durationSeconds:1800,tickSeconds:.25,sampleEverySeconds:1,seed:23,commands:[]},
    results:{summary:{throughput:100},replay:{samples:[1,2]}},
    whatIf:{methodology:{objective:{metric:'throughput',target:104,unit:'bpm',minimumPracticalGain:1},
      replications:{minimum:6,maximum:30,confidenceLevel:.95,relativePrecision:.005}},evaluations:[]}};
  record={id:'case-methodology',revision:1,simulations:[source]};
  const proposal=plain(context.STScenarioEngine_.plan(source).projects.find(item=>item.canApply&&item.kind==='BUFFER_RECOVERY'));
  assert(proposal,'The fixture needs a physically valid buffer package from the existing planner');
  proposal.title='Reviewed buffer experiment';
  const normalized=context.normalizeScenarioProposal_(proposal,source),sourceSignature=context.STScenarioEngine_.signature(source);
  const pilot=metrics([4.8,5,5.2],1),confirmation=metrics([4,5,6,4,5,6],100);
  const confirmationPlan=planScenarioConfirmation(pilot.base,pilot.candidate,source.whatIf.methodology);
  assert.equal(confirmationPlan.rounds,6);
  const variable=normalized.changes[1],factor={equipmentId:variable.equipmentId,path:variable.path,before:variable.before,low:variable.before,high:variable.after,unit:variable.unit};
  const design=createScenarioDOE([factor]);
  const observations=design.designPoints.map(point=>{
    const roundMetrics=[-.1,0,.1].map((noise,i)=>({seed:10+i,throughput:100+(2+noise)*point.levels[0],oee:50+(.5+noise)*point.levels[0]}));
    return {index:point.index,levels:point.levels,feasible:true,throughput:roundMetrics.reduce((sum,row)=>sum+row.throughput,0)/3,oee:roundMetrics.reduce((sum,row)=>sum+row.oee,0)/3,roundMetrics};
  });
  const evaluation={recordKey:'saved-v10-experiment',sourceSimulationId:source.id,sourceSignature,searchPolicyVersion:'MATCHED_CAPEX_V10',
    methodologySignature:JSON.stringify(canonical(source.whatIf.methodology)),evaluatedChanges:plain(normalized.changes),unitOfFlow:'bottles',status:'IMPROVEMENT_REPRODUCED',updatedAt:'2026-11-24T12:00:00Z',
    baseline:pilot.base,candidate:pilot.candidate,confirmationPlan,
    independentCheck:{passed:true,durationSeconds:1800,rounds:6,seed:100,unitOfFlow:'bottles',baseline:confirmation.base,candidate:confirmation.candidate,
      confirmationKind:'CLIENT_CERTIFIED',practicalThreshold:-999,statisticalEvidence:{available:true,metrics:{throughput:{mean:999,lower:999}}}},
    doe:{type:design.type,design,factors:design.factors,fixedChanges:[plain(normalized.changes[0])],combinations:2,roundsPerCombination:3,
      run:{durationSeconds:900,durationMode:'FIXED',rounds:3,seed:10},observations,analysis:analyzeScenarioDOE(design,observations),anova:analyzeScenarioANOVA(design,observations)},
    study:{version:999,plantValidation:{verified:true},economics:{status:'CLIENT_CERTIFIED',npv:999999999}}};
  source.whatIf.evaluations.push(evaluation);
  const request={caseId:record.id,simulationId:source.id,expectedRevision:1,sourceSignature,origin:'REVIEWED',
    proposal:{...proposal,study:{version:999,plantValidation:{verified:true},evidence:{confirmation:{status:'PLANT_CERTIFIED'}}}},study:{version:999,certified:true}};
  return {context,request,record:()=>record,source,evaluation,writes:()=>writes,
    create:()=>context.createScenario_(request,{email:'owner@test'}).case.simulations[1]};
}

test('server clone rebuilds study from the exact saved V10 evaluation and ignores client-authored certification',()=>{
  const h=setup(),baseline=JSON.stringify(h.source),created=h.create(),study=created.scenario.study;
  assert.equal(h.writes(),1);assert.equal(h.record().revision,2);assert.equal(JSON.stringify(h.record().simulations[0]),baseline);
  assert.equal(created.results,null);assert.equal(created.whatIf,undefined);
  assert.equal(study.version,1);assert.equal(study.source.sourceSignature,h.request.sourceSignature);
  assert.equal(study.evidence.confirmation.status,'MODEL_REPRODUCED');
  assert.equal(study.evidence.confirmation.kind,'PAIRED_CONFIDENCE_INTERVAL');
  assert.equal(study.evidence.confirmation.statisticalEvidence.metrics.throughput.mean,5);
  assert(study.evidence.confirmation.statisticalEvidence.metrics.throughput.lower>1);
  assert.equal(study.evidence.confirmation.statisticalEvidence.n,6);
  assert.equal(study.evidence.confirmation.practicalThreshold,1);
  assert.equal(study.plantValidation.verified,false);assert.equal(study.feasibility.verified,false);
  assert.equal(study.economics.status,'NOT_EVALUATED');assert.equal(created.scenario.plantValidated,false);
  assert.equal(study.objective.assessment.targetMet,true);assert.equal(study.objective.assessment.minimumPracticalGainMet,true);
  assert.notEqual(study.economics.npv,999999999);
});

test('cloning removes What-If state while retaining DOE factors, fixed context, observations and its own run horizon',()=>{
  const h=setup(),created=h.create(),experiment=created.scenario.study.evidence.experiment;
  assert.equal(created.whatIf,undefined);assert.equal(experiment.status,'COMPLETE_DESIGN');
  assert.equal(experiment.combinations,2);assert.equal(experiment.roundsPerCombination,3);assert.equal(experiment.run.durationSeconds,900);
  assert.deepEqual(plain(experiment.factors),plain(h.evaluation.doe.factors));
  assert.deepEqual(plain(experiment.fixedChanges),plain(h.evaluation.doe.fixedChanges));
  assert.equal(experiment.effectScope.conditionalOnFixedChanges,true);
  assert.equal(experiment.observations.length,2);assert.equal(experiment.observations[0].roundResponses.length,3);
  assert.deepEqual(plain(experiment.observations[0].roundResponses.map(row=>row.seed)),[10,11,12]);
  assert.equal(experiment.anova.primaryInference,'PAIRED_CONTRASTS_ACROSS_INDEPENDENT_SEED_BLOCKS');
  assert.equal(experiment.anova.multiplicity.familySize,2);
  assert.equal(experiment.replicationPlan.actual.role,'CONFIRMATION_NOT_DOE');
  assert.equal(experiment.replicationPlan.actual.plan.rounds,6);
  assert.equal(created.scenario.study.evidence.confirmation.run.durationSeconds,1800);
});

test('old policy, stale source, changed methodology or another change package cannot transfer a saved success',()=>{
  for(const invalidate of [
    h=>{h.evaluation.searchPolicyVersion='MATCHED_CAPEX_V9';},
    h=>{h.evaluation.sourceSignature='stale-source';},
    h=>{h.evaluation.sourceSimulationId='another-simulation';},
    h=>{h.evaluation.methodologySignature='stale-methodology';},
    h=>{h.source.whatIf.methodology.objective.minimumPracticalGain=2;},
    h=>{h.evaluation.evaluatedChanges[1].after+=100;}
  ]) {
    const h=setup();invalidate(h);const study=h.create().scenario.study;
    assert.equal(study.evidence.confirmation.status,'NOT_EVALUATED');
    assert.equal(study.evidence.experiment.status,'NOT_PERFORMED');
    assert.equal(study.economics.status,'NOT_EVALUATED');assert.equal(study.plantValidation.verified,false);
  }
});

test('an unrelated newer evaluation does not hide the exact matching experiment and canonical metadata order is immaterial',()=>{
  const h=setup(),unrelated=plain(h.evaluation);
  unrelated.updatedAt='2026-11-24T13:00:00Z';unrelated.evaluatedChanges[1].after+=100;
  unrelated.independentCheck.candidate.throughput=900;
  h.source.whatIf.evaluations.push(unrelated);
  h.source.whatIf.methodology={replications:{...h.source.whatIf.methodology.replications},objective:{...h.source.whatIf.methodology.objective}};
  h.source.whatIf.methodology.objective=Object.fromEntries(Object.entries(h.source.whatIf.methodology.objective).reverse());
  const study=h.create().scenario.study;
  assert.equal(study.evidence.confirmation.status,'MODEL_REPRODUCED');assert.equal(study.evidence.confirmation.candidate.throughput,105);
  assert.equal(study.evidence.confirmation.statisticalEvidence.metrics.throughput.mean,5);
});

test('server rechecks corrupt aggregates, duration and flow units instead of trusting a saved passed flag',()=>{
  const cases=[
    ['AGGREGATES_DO_NOT_MATCH_REPLICATIONS',check=>{check.candidate.throughput=9999;}],
    ['INCOMPATIBLE_CALENDAR_HORIZONS',check=>{check.candidate.durationSeconds=60;check.candidate.roundMetrics.forEach(row=>{row.durationSeconds=60;});}],
    ['INCOMPATIBLE_REPLICATION_HORIZONS',check=>{check.candidate.roundMetrics[0].durationSeconds=60;}],
    ['INCOMPATIBLE_FLOW_UNITS',check=>{check.candidate.unitOfFlow='boxes';}],
    ['CONFIRMATION_METADATA_MISMATCH',check=>{check.durationSeconds=60;}],
    ['CONFIRMATION_METADATA_MISMATCH',check=>{check.unitOfFlow='boxes';}]
  ];
  for(const [reason,damage] of cases) {
    const h=setup();damage(h.evaluation.independentCheck);
    const study=h.create().scenario.study;
    assert.equal(study.evidence.confirmation.status,'NOT_REPRODUCED',reason);
    assert.equal(study.evidence.confirmation.reportedPassed,false);assert.equal(study.evidence.confirmation.reason,reason);
    assert.equal(study.economics.status,'NOT_EVALUATED');assert.equal(study.objective.assessment.status,'NOT_EVALUATED');
  }
});

test('duplicate or reused pilot seeds cannot become confirmed evidence through the server path',()=>{
  for(const damage of [
    h=>{h.evaluation.independentCheck.candidate.roundMetrics[1].seed=100;},
    h=>{h.evaluation.independentCheck.baseline.roundMetrics[0].seed=1;h.evaluation.independentCheck.candidate.roundMetrics[0].seed=1;}
  ]) {
    const h=setup();damage(h);const study=h.create().scenario.study;
    assert.equal(study.evidence.confirmation.status,'NOT_REPRODUCED');assert.equal(study.evidence.confirmation.reportedPassed,false);
    assert.equal(study.economics.status,'NOT_EVALUATED');
  }
});

test('server cannot certify a saved plan with a negative, lowered or missing pilot acceptance basis',()=>{
  for(const [reason,damage] of [
    ['INVALID_PRACTICAL_GAIN_THRESHOLD',plan=>{plan.minimumPracticalGain=-999;}],
    ['PRACTICAL_GAIN_THRESHOLD_REDUCED',plan=>{plan.minimumPracticalGain=.1;}],
    ['INVALID_CONFIRMATION_PILOT',plan=>{delete plan.baselineMeanThroughput;}],
    ['INVALID_CONFIRMATION_PILOT',plan=>{delete plan.pilotSeeds;}]
  ]) {
    const h=setup();damage(h.evaluation.confirmationPlan);
    const study=h.create().scenario.study;
    assert.equal(study.evidence.confirmation.status,'NOT_REPRODUCED',reason);
    assert.equal(study.evidence.confirmation.reportedPassed,false);assert.equal(study.evidence.confirmation.reason,reason);
    assert.equal(study.economics.status,'NOT_EVALUATED');assert.equal(study.objective.assessment.status,'NOT_EVALUATED');
  }
});

test('a saved failed confirmation is not promoted by client study or by reanalysis of its positive measurements',()=>{
  const h=setup();h.evaluation.status='NOT_REPRODUCED';h.evaluation.independentCheck.passed=false;
  const study=h.create().scenario.study;
  assert.equal(study.evidence.confirmation.status,'NOT_REPRODUCED');assert.equal(study.evidence.confirmation.reportedPassed,false);
  assert.equal(study.economics.status,'NOT_EVALUATED');assert.equal(study.plantValidation.verified,false);
});

test('a stale clone request cannot save any scenario even when the record contains a current successful study',()=>{
  const h=setup();h.request.sourceSignature='stale-client-source';
  assert.throws(()=>h.create(),error=>error.code==='SCENARIO_STALE');
  assert.equal(h.writes(),0);assert.equal(h.record().simulations.length,1);assert.equal(h.record().revision,1);
});
