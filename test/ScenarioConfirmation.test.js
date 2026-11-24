import test from 'node:test';
import assert from 'node:assert/strict';
import {planScenarioConfirmation,assessScenarioConfirmation,scenarioSearchRun} from '../src/analysis/ScenarioSearch.js';

function sample(gains,{seed=1,baseline=100,oeeGain=.1,durationSeconds=1800,unitOfFlow='bottles'}={}) {
  const base={throughput:baseline,oee:50,durationSeconds,unitOfFlow,roundMetrics:gains.map((_,i)=>({seed:seed+i,throughput:baseline,oee:50,durationSeconds}))};
  const candidate={throughput:baseline+gains.reduce((sum,value)=>sum+value,0)/gains.length,oee:50+oeeGain,durationSeconds,unitOfFlow,
    roundMetrics:gains.map((gain,i)=>({seed:seed+i,throughput:baseline+gain,oee:50+oeeGain,durationSeconds}))};
  return {base,candidate};
}
const repeated=(pattern,count)=>Array.from({length:count},(_,i)=>pattern[i%pattern.length]);
function planned(methodology={}) {
  const pilot=sample([4,5,6]);
  return {pilot,plan:planScenarioConfirmation(pilot.base,pilot.candidate,methodology)};
}

test('confirmation size is fixed by a separate pilot and a reproducible gain passes on new seeds',()=>{
  const {pilot,plan}=planned(),before=JSON.stringify({pilot,plan});
  assert.equal(plan.rounds,18);assert.equal(plan.requiredRounds,18);assert.equal(plan.targetHalfWidth,.5);
  assert.equal(plan.policy,'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION');
  const confirmation=sample(repeated([4,5,6],18),{seed:1000});
  const evidence=assessScenarioConfirmation(confirmation.base,confirmation.candidate,plan);
  assert(evidence.passed);assert.equal(evidence.kind,'PAIRED_CONFIDENCE_INTERVAL');
  assert(evidence.statisticalEvidence.metrics.throughput.lower>evidence.threshold);
  assert.equal(evidence.precision.plannedRounds,18);assert.equal(evidence.precision.met,true);
  assert.equal(JSON.stringify({pilot,plan}),before);
});

test('incomplete, extra, duplicated, invalid or overlapping confirmation seeds cannot authorize a gain',()=>{
  const {plan}=planned();
  for(const count of [17,19]) {
    const confirmation=sample(repeated([4,5,6],count),{seed:1000});
    assert.equal(assessScenarioConfirmation(confirmation.base,confirmation.candidate,plan).passed,false);
  }
  for(const damage of [
    pair=>{pair.candidate.roundMetrics[1].seed=pair.candidate.roundMetrics[0].seed;},
    pair=>{pair.base.roundMetrics[1].seed=Infinity;},
    pair=>{pair.candidate.roundMetrics[1].seed=999999;},
    pair=>{pair.base.roundMetrics[0].seed=1;pair.candidate.roundMetrics[0].seed=1;}
  ]) {
    const confirmation=sample(repeated([4,5,6],18),{seed:1000});damage(confirmation);
    assert.equal(assessScenarioConfirmation(confirmation.base,confirmation.candidate,plan).passed,false);
  }
});

test('a precisely positive result below the practical target fails while a material gain passes',()=>{
  const methodology={objective:{minimumPracticalGain:2}}, {plan}=planned(methodology);
  const minor=sample(repeated([.96,1,1.04],18),{seed:1000});
  const small=assessScenarioConfirmation(minor.base,minor.candidate,plan,methodology);
  assert(small.statisticalEvidence.metrics.throughput.lower>0);
  assert.equal(small.passed,false);assert.equal(small.reason,'PRACTICAL_GAIN_NOT_ESTABLISHED');assert.equal(small.threshold,2);
  const material=sample(repeated([2.96,3,3.04],18),{seed:1000});
  assert.equal(assessScenarioConfirmation(material.base,material.candidate,plan,methodology).passed,true);
});

test('observed OEE regression or missing OEE evidence vetoes an otherwise clear throughput gain',()=>{
  const {plan}=planned();
  const regression=sample(repeated([4,5,6],18),{seed:1000,oeeGain:-.2});
  const evidence=assessScenarioConfirmation(regression.base,regression.candidate,plan);
  assert(evidence.statisticalEvidence.metrics.throughput.lower>evidence.threshold);
  assert.equal(evidence.passed,false);assert.equal(evidence.reason,'OEE_REGRESSION');
  const incomplete=sample(repeated([4,5,6],18),{seed:1000});incomplete.candidate.roundMetrics[2].oee=null;
  assert.equal(assessScenarioConfirmation(incomplete.base,incomplete.candidate,plan).passed,false);
});

test('a noisy positive mean does not pass when its independent interval includes no practical gain',()=>{
  const {plan}=planned(),confirmation=sample(repeated([-10,5,20],18),{seed:1000});
  const evidence=assessScenarioConfirmation(confirmation.base,confirmation.candidate,plan);
  assert(evidence.statisticalEvidence.metrics.throughput.mean>0);
  assert(evidence.statisticalEvidence.metrics.throughput.lower<0);
  assert.equal(evidence.passed,false);assert.equal(evidence.reason,'PRACTICAL_GAIN_NOT_ESTABLISHED');
  assert.equal(evidence.precision.met,false);assert.equal(evidence.precision.plannedRounds,18);
});

test('zero-variance reproduction is descriptive and never manufactures an inferential interval',()=>{
  const pilot=sample([3,3,3]),plan=planScenarioConfirmation(pilot.base,pilot.candidate);
  assert.equal(plan.status,'ZERO_PILOT_VARIANCE');assert.equal(plan.rounds,6);assert.equal(plan.requiredRounds,null);
  const confirmation=sample([3,3,3,3,3,3],{seed:1000});
  const evidence=assessScenarioConfirmation(confirmation.base,confirmation.candidate,plan);
  assert(evidence.passed);assert.equal(evidence.kind,'DESCRIPTIVE_REPRODUCTION');
  assert.equal(evidence.statisticalEvidence.metrics.throughput.inferenceAvailable,false);
  assert.equal(evidence.statisticalEvidence.metrics.throughput.lower,null);assert.equal(evidence.precision.met,null);
  const trivial=sample([.05,.05,.05,.05,.05,.05],{seed:1000});
  assert.equal(assessScenarioConfirmation(trivial.base,trivial.candidate,plan).passed,false);
});

test('a replication cap remains visible even when a large gain is established before precision is achieved',()=>{
  const pilot=sample([-15,5,25]),plan=planScenarioConfirmation(pilot.base,pilot.candidate);
  assert.equal(plan.rounds,30);assert(plan.requiredRounds>30);assert.equal(plan.capped,true);
  const confirmation=sample(repeated([30,40,50],30),{seed:1000});
  const evidence=assessScenarioConfirmation(confirmation.base,confirmation.candidate,plan);
  assert(evidence.passed);assert.equal(evidence.precision.capped,true);assert.equal(evidence.precision.met,false);
  assert(evidence.precision.achievedHalfWidth>evidence.precision.targetHalfWidth);
  assert(evidence.precision.requiredRounds>evidence.precision.plannedRounds);
});

test('practical gain remains the predeclared pilot threshold when confirmation baseline varies',()=>{
  const {plan}=planned();
  assert.equal(plan.minimumPracticalGain,.1);
  const confirmation=sample(repeated([.45,.5,.55],18),{seed:1000,baseline:1000});
  const evidence=assessScenarioConfirmation(confirmation.base,confirmation.candidate,plan);
  assert.equal(evidence.threshold,plan.minimumPracticalGain);
  assert(evidence.passed);
});

test('inconsistent aggregates, horizons and units cannot turn saved replication evidence into an accepted scenario',()=>{
  const {plan}=planned();
  const cases=[
    ['AGGREGATES_DO_NOT_MATCH_REPLICATIONS',pair=>{pair.candidate.throughput=9999;}],
    ['INCOMPATIBLE_CALENDAR_HORIZONS',pair=>{pair.candidate.durationSeconds=60;pair.candidate.roundMetrics.forEach(row=>{row.durationSeconds=60;});}],
    ['INCOMPATIBLE_REPLICATION_HORIZONS',pair=>{pair.candidate.roundMetrics[0].durationSeconds=60;}],
    ['INCOMPATIBLE_FLOW_UNITS',pair=>{pair.candidate.unitOfFlow='boxes';}],
    ['CONFIRMATION_HORIZON_CHANGED',pair=>{for(const value of [pair.base,pair.candidate]){value.durationSeconds=3600;value.roundMetrics.forEach(row=>{row.durationSeconds=3600;});}}],
    ['CONFIRMATION_UNIT_CHANGED',pair=>{pair.base.unitOfFlow='boxes';pair.candidate.unitOfFlow='boxes';}]
  ];
  for(const [reason,damage] of cases) {
    const confirmation=sample(repeated([4,5,6],18),{seed:1000});damage(confirmation);
    const evidence=assessScenarioConfirmation(confirmation.base,confirmation.candidate,plan);
    assert.equal(evidence.passed,false,reason);assert.equal(evidence.reason,reason);
  }
  const corrupted=sample([4,5,6]);corrupted.candidate.throughput=9999;
  const invalidPlan=planScenarioConfirmation(corrupted.base,corrupted.candidate);
  assert.equal(invalidPlan.rounds,null);assert.equal(invalidPlan.status,'AGGREGATES_DO_NOT_MATCH_REPLICATIONS');
});

test('an OEE objective in percentage points never becomes a throughput threshold in bottles per minute',()=>{
  const methodology={objective:{metric:'oee',minimumPracticalGain:5,unit:'percentagePoints'}}, {plan}=planned(methodology);
  assert.equal(plan.minimumPracticalGain,.1);
  const confirmation=sample(repeated([.45,.5,.55],18),{seed:1000,oeeGain:6});
  const evidence=assessScenarioConfirmation(confirmation.base,confirmation.candidate,plan,methodology);
  assert.equal(evidence.threshold,.1);assert(evidence.passed);
  assert(evidence.statisticalEvidence.metrics.throughput.upper<5);
  assert.equal(evidence.oeeGuard.observedMeanDelta,6);
});

test('negative or lowered plan thresholds cannot authorize a sub-target gain',()=>{
  const methodology={objective:{metric:'throughput',minimumPracticalGain:2,unit:'bpm'}}, {plan}=planned(methodology);
  const confirmation=sample(repeated([.45,.5,.55],18),{seed:1000});
  for(const [minimumPracticalGain,reason] of [[-999,'INVALID_PRACTICAL_GAIN_THRESHOLD'],[.1,'PRACTICAL_GAIN_THRESHOLD_REDUCED']]) {
    const damaged={...plan,minimumPracticalGain};
    const evidence=assessScenarioConfirmation(confirmation.base,confirmation.candidate,damaged,methodology);
    assert.equal(evidence.passed,false);assert.equal(evidence.reason,reason);assert.equal(evidence.threshold,null);
  }
  const ordinary=planned().plan;
  const belowPilotFloor=assessScenarioConfirmation(confirmation.base,confirmation.candidate,{...ordinary,minimumPracticalGain:.01});
  assert.equal(belowPilotFloor.passed,false);assert.equal(belowPilotFloor.reason,'PRACTICAL_GAIN_THRESHOLD_REDUCED');
});

test('missing or malformed pilot plans return an explicit rejection without throwing or extending the sample',()=>{
  const {plan}=planned(),confirmation=sample(repeated([4,5,6],18),{seed:1000});
  const invalidPlans=[
    [undefined,'CONFIRMATION_PLAN_REQUIRED'],[null,'CONFIRMATION_PLAN_REQUIRED'],[{},'INVALID_CONFIRMATION_POLICY'],
    [{...plan,policy:'OPTIONAL_STOPPING'},'INVALID_CONFIRMATION_POLICY'],
    [{...plan,baselineMeanThroughput:undefined},'INVALID_CONFIRMATION_PILOT'],
    [{...plan,baselineMeanThroughput:-1},'INVALID_CONFIRMATION_PILOT'],
    [{...plan,baselineMeanThroughput:Infinity},'INVALID_CONFIRMATION_PILOT'],
    [{...plan,pilotSeeds:undefined},'INVALID_CONFIRMATION_PILOT'],
    [{...plan,pilotSeeds:{}},'INVALID_CONFIRMATION_PILOT'],
    [{...plan,pilotSeeds:[1,2]},'INVALID_CONFIRMATION_PILOT'],
    [{...plan,pilotSeeds:[1,1,2]},'INVALID_CONFIRMATION_PILOT'],
    [{...plan,pilotSeeds:[1,2,3.5]},'INVALID_CONFIRMATION_PILOT'],
    [{...plan,rounds:2},'INVALID_CONFIRMATION_SAMPLE_SIZE'],
    [{...plan,rounds:18.5},'INVALID_CONFIRMATION_SAMPLE_SIZE'],
    [{...plan,confidenceLevel:1},'INVALID_CONFIRMATION_CONFIDENCE'],
    [{...plan,confidenceLevel:undefined},'INVALID_CONFIRMATION_CONFIDENCE'],
    [{...plan,comparisonDurationSeconds:0},'INVALID_CONFIRMATION_COMPARISON'],
    [{...plan,comparisonUnitOfFlow:' '},'INVALID_CONFIRMATION_COMPARISON'],
    [{...plan,minimumPracticalGain:undefined},'INVALID_PRACTICAL_GAIN_THRESHOLD']
  ];
  for(const [invalid,reason] of invalidPlans) {
    let evidence;assert.doesNotThrow(()=>{evidence=assessScenarioConfirmation(confirmation.base,confirmation.candidate,invalid);},reason);
    assert.equal(evidence.passed,false);assert.equal(evidence.reason,reason);
  }
  assert.equal(plan.rounds,18);
});

test('insufficient or invalid pilot seeds cannot produce a confirmation plan',()=>{
  for(const invalidate of [
    pair=>{for(const value of [pair.base,pair.candidate])value.roundMetrics=value.roundMetrics.slice(0,2);pair.candidate.throughput=104.5;},
    pair=>{pair.base.roundMetrics[1].seed=1;},
    pair=>{pair.base.roundMetrics[0].seed=1.5;pair.candidate.roundMetrics[0].seed=1.5;},
    pair=>{pair.candidate.roundMetrics[1].seed=999;}
  ]) {
    const pilot=sample([4,5,6]);invalidate(pilot);
    const plan=planScenarioConfirmation(pilot.base,pilot.candidate);
    assert.equal(plan.rounds,null);assert.equal(plan.status,'INVALID_PILOT_REPLICATIONS');
  }
});

test('What-If uses equal fixed calendar exposure and preserves the source run and scheduled commands',()=>{
  const run={durationMode:'UNTIL_EFFECTIVE_RUNTIME',durationSeconds:86400,effectiveRuntimeTargetSeconds:7200,
    shiftSeconds:28800,shiftHours:8,shiftCount:3,seed:42,rounds:40,commands:[{atVirtualSecond:60,command:'STOP'}]};
  const before=JSON.stringify(run);
  for(const [stage,expected] of [[false,900],[true,1800],['validation',86400]]) {
    const adapted=scenarioSearchRun(run,'HIGH',stage,18);
    assert.equal(adapted.durationMode,'FIXED');assert.equal(adapted.durationSeconds,expected);assert.equal(adapted.rounds,18);
    assert.equal(adapted.effectiveRuntimeTargetSeconds,undefined);assert.equal(adapted.shiftCount,undefined);assert.equal(adapted.shiftHours,undefined);assert.equal(adapted.shiftSeconds,undefined);
    assert.equal(adapted.seed,42);assert.deepEqual(adapted.commands,run.commands);
  }
  assert.equal(JSON.stringify(run),before);
});
