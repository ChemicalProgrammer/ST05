import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {JSDOM} from 'jsdom';
import {canonicalSimulationInputSignature} from '../src/simulation/SimulationProvenance.js';
import {scenarioEvidenceInput} from './helpers/ScenarioEvidenceFixture.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const script=name=>fs.readFileSync('apps-script/'+name,'utf8').match(/<script>([\s\S]*)<\/script>/)[1];

test('real engine search preserves the card and source while retaining an independently confirmed methodology study', {timeout:30000}, async t=>{
  const started=performance.now();
  const dom=new JSDOM('<article class="analysis-recommendation"></article>',{runScripts:'outside-only'});
  const w=dom.window,errors=[],calls=[];
  try {
    // Only presentation dependencies are stubs. The complete browser bundle
    // supplies the physical simulator, planner, statistics and study APIs.
    w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    w.STPreferences={read(){return '';},write(){return true;}};
    w.STIcons={svg(){return '<svg></svg>';}};
    w.STErrors={register(){},capture(_host,error){errors.push(error.message);}};
    w.STScenarioText={ZERO:'Zero CAPEX'};
    w.eval(fs.readFileSync('apps-script/ClientUtils.html','utf8'));
    w.eval(script('Subsection.html'));
    w.STWhatIf={changeInfo(change,equipment){return {
      equipment:equipment.find(unit=>unit.id===change.equipmentId)?.name||change.equipmentId,
      parameter:change.path,before:change.before,after:change.after
    };}};
    w.eval(script('SimulationEngine.html'));
    for(const name of ['planConfirmation','confirm','practicalGain'])assert.equal(typeof w.STScenarioSearch[name],'function');
    assert.equal(typeof w.STScenarios.study,'function');

    const simulation=scenarioEvidenceInput();
    simulation.equipment[0].nominalRatePerSecond=1;
    simulation.dynamicConfig={...simulation.dynamicConfig,rounds:2,reliabilityEnabled:false,effectiveRuntimeTargetSeconds:30};
    simulation.whatIf={searchDepth:'LIGHT',methodology:{
      objective:{metric:'throughput',unit:'bpm',target:90,minimumPracticalGain:1},
      replications:{minimum:3,maximum:6,confidenceLevel:.95,relativePrecision:.01}
    }};
    const sourceInput={case:simulation,run:simulation.dynamicConfig};
    const sourceResponse=await w.SimulatorEngine.simulateBatch(sourceInput,{summaryOnly:true});
    assert(sourceResponse.ok,JSON.stringify(sourceResponse.error));
    simulation.results={...copy(sourceResponse.result),replicationStatus:{state:'COMPLETE',rounds:2,baseSeed:simulation.dynamicConfig.seed}};
    assert.equal(simulation.results.inputSignature,canonicalSimulationInputSignature(sourceInput));
    const sourceFields=()=>copy({equipment:simulation.equipment,dynamicConfig:simulation.dynamicConfig,unitOfFlow:simulation.unitOfFlow,results:simulation.results,methodology:simulation.whatIf.methodology});
    const originalSource=sourceFields(),sourceSignature=w.STScenarios.signature(simulation);
    const record={metadata:{includeDOE:false},simulations:[simulation]};
    const change={equipmentId:'upstream',path:'nominalRatePerSecond',before:1,after:1.7,unit:'units/s'};
    const project={kind:'CUSTOM',tier:'ZERO',searchScope:'ZERO',title:'Installed speed adjustment',explore:true,changes:[change]};
    assert.deepEqual(copy(w.STScenarios.apply(simulation,[change]).scenarioWarnings),[]);

    // Observe the real batches unchanged, including the plan already persisted
    // before the first independent outcome becomes available.
    const realBatch=w.SimulatorEngine.simulateBatch.bind(w.SimulatorEngine);
    w.SimulatorEngine.simulateBatch=async(input,options)=>{
      const entry=simulation.whatIf.evaluations?.[0];
      const call={input:copy(input),confirmationPlanAtStart:copy(entry?.confirmationPlan||null)};
      calls.push(call);
      const response=await realBatch(input,options);
      assert(response.ok,JSON.stringify(response.error));
      call.resultDurationSeconds=response.result.durationSeconds;
      call.seedIds=response.result.batch.rows.map(row=>row.seed);
      return response;
    };
    w.eval(script('ScenarioExplorer.html'));
    w.STScenarioExplorer.connectCase(()=>record,()=>{});
    Object.assign(w.ST_SCENARIO_SEARCH_LIMITS,{maxCandidates:1,parallelCandidates:1,wallClockBudget:false});
    const host=w.document.querySelector('article');
    w.STScenarioExplorer.attach(host,project,()=>{},simulation);
    const actionButtons=[...host.querySelector('.scenario-actions').children];
    const parameterRow=host.querySelector('.scenario-change');
    const parameterInputs=[...parameterRow.querySelectorAll('input')].map(node=>({node,value:node.value,checked:node.checked}));
    const depthControl=host.querySelector('.scenario-search-depth');
    const searchButton=host.querySelector('.scenario-search');
    searchButton.click();
    const deadline=performance.now()+25000;
    while(performance.now()<deadline){
      const entry=simulation.whatIf.evaluations?.[0];
      if(entry&&!host.hasAttribute('aria-busy')&&!['RUNNING','VALIDATING'].includes(entry.status))break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(host.hasAttribute('aria-busy'),false,'search must complete within the integration budget');
    assert.deepEqual(errors,[]);
    const evaluation=copy(simulation.whatIf.evaluations[0]);
    assert.equal(evaluation.status,'IMPROVEMENT_REPRODUCED',evaluation.message);
    assert.equal(evaluation.sourceSimulationId,simulation.id);
    assert.equal(evaluation.sourceSignature,sourceSignature);
    assert.equal(evaluation.reproducibility.policy,'CANDIDATE_BUDGET');
    assert.equal(evaluation.searchLimits.maxCandidates,1);
    assert.deepEqual(evaluation.evaluatedChanges.map(c=>({equipmentId:c.equipmentId,path:c.path,before:c.before,after:c.after})),[{equipmentId:'upstream',path:'nominalRatePerSecond',before:1,after:1.7}]);

    const plan=evaluation.confirmationPlan,check=evaluation.independentCheck;
    assert.equal(plan.policy,'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION');
    assert.equal(plan.comparisonBasis,'FIXED_CALENDAR_HORIZON');
    assert.equal(plan.sourceEffectiveRuntimeTargetSeconds,30);
    assert.equal(check.rounds,plan.rounds);
    assert.equal(check.durationSeconds,1800);
    assert.equal(check.baseline.durationSeconds,check.candidate.durationSeconds);
    assert.equal(check.baseline.durationSeconds,check.durationSeconds);
    assert.equal(check.passed,true);
    assert.equal(check.confirmationKind,'DESCRIPTIVE_REPRODUCTION','deterministic repetitions do not invent statistical inference');
    const confirmationSeeds=new Set(check.baseline.roundMetrics.map(row=>row.seed));
    assert.equal(confirmationSeeds.size,plan.rounds);
    assert.deepEqual(check.candidate.roundMetrics.map(row=>row.seed),[...confirmationSeeds]);
    assert(plan.pilotSeeds.every(seed=>!confirmationSeeds.has(seed)));
    const confirmedCalls=calls.filter(call=>call.input.run.seed===check.seed);
    assert.equal(confirmedCalls.length,2,'a fixed baseline/candidate confirmation replaces optional repeated checking');
    for(const call of confirmedCalls){
      assert.equal(call.input.run.rounds,plan.rounds);
      assert.equal(call.input.run.durationSeconds,check.durationSeconds);
      assert.equal(call.resultDurationSeconds,check.durationSeconds);
      assert.equal(call.input.run.effectiveRuntimeTargetSeconds,undefined);
      assert.equal(call.confirmationPlanAtStart.rounds,plan.rounds);
      assert.deepEqual(call.confirmationPlanAtStart.pilotSeeds,plan.pilotSeeds);
    }
    assert(calls.some(call=>call.input.run.durationSeconds===300),'Light screening must use its own recorded horizon');
    assert(calls.every(call=>call.input.run.effectiveRuntimeTargetSeconds===undefined));

    const study=evaluation.study;
    assert.equal(study.source.status,'RECORDED');
    assert.equal(study.source.sourceSignature,sourceSignature);
    assert.equal(study.evaluatedPackage.changeCount,1);
    assert.equal(study.evidence.confirmation.status,'MODEL_REPRODUCED');
    assert.equal(study.baseline.metrics.throughput,check.baseline.throughput);
    assert.equal(study.evidence.confirmation.candidate.throughput,check.candidate.throughput);
    assert.equal(study.objective.assessment.targetMet,true);
    assert.equal(study.economics.status,'NOT_EVALUATED','missing financial inputs remain missing');
    assert.equal(study.plantValidation.verified,false);
    assert(study.hypotheses.every(hypothesis=>!hypothesis.rootCauseVerified&&!hypothesis.targetAchievabilityVerified));
    assert.equal(w.STScenarios.signature(simulation),sourceSignature);
    assert.deepEqual(sourceFields(),originalSource,'search cannot mutate the physical source, its playback settings or completed source result');

    assert.equal(w.document.querySelector('article'),host);
    assert.equal(host.querySelectorAll('.scenario-actions').length,1);
    assert.deepEqual([...host.querySelector('.scenario-actions').children],actionButtons,'search keeps the existing action controls');
    assert.equal(host.querySelector('.scenario-change'),parameterRow);
    for(const original of parameterInputs){assert.equal(original.node.value,original.value);assert.equal(original.node.checked,original.checked);}
    assert.equal(host.querySelector('.scenario-search-depth'),depthControl);
    assert.equal(depthControl.value,'LIGHT');
    assert.equal(host.querySelector('.scenario-search'),searchButton);
    assert.equal(searchButton.title,'Find best scenario');
    assert.equal(host.querySelector('.scenario-create').disabled,false);
    assert.equal(host.querySelector('.scenario-doe-results'),null);
    assert.equal(host.querySelector('.scenario-study'),null);
    t.diagnostic('Real engine: '+calls.length+' measured batches; '+plan.rounds+' fixed confirmation rounds; '+(performance.now()-started).toFixed(0)+' ms.');
  } finally {
    dom.window.close();
  }
});
