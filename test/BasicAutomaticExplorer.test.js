import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';

const get=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object);
function harness({reliability=true,durationSeconds=86400,compact=true,uiMode='basic'}={}){
  const sim=JSON.parse(fs.readFileSync('test/fixtures/demo-b-case.json','utf8')).simulations[0];
  sim.unitOfFlow='bottles';
  sim.dynamicConfig={...sim.dynamicConfig,durationMode:'FIXED',durationSeconds,rounds:3,seed:23,commands:[],machineDesignEnabled:false,machineMaximumSpeedEnabled:false,reliabilityEnabled:reliability};
  sim.whatIf={searchDepth:'LIGHT',exploreReliabilityTargets:false,reliabilitySettings:{scope:'MANUAL',maximumTargets:20,equipmentIds:['stale-id'],equipmentLimits:{'stale-id':{mtbfMaximum:0}}},capexInclusions:{MEDIUM:{ZERO:true},HIGH:{ZERO:true,MEDIUM:true}},cardConfigurations:{}};
  completeSyntheticScenarioSource(sim);
  // Keep the saved original and the deterministic evaluator on the same
  // synthetic reference: 100 bpm, 50% OEE. The source must not be mutated later.
  sim.results.unitOfFlow='bottles';sim.results.summary.outputCount=100*durationSeconds/60;
  sim.results.batch.rows.forEach(row=>{row.summary.outputCount=100*durationSeconds/60;});
  sim.results.batch.equipmentStatistics=Object.fromEntries(sim.equipment.filter(e=>e.type!=='CONVEYOR').map(e=>[e.id,Object.fromEntries(Object.entries({failureSeconds:reliability?durationSeconds*.1:0,microStopSeconds:0,starvedSeconds:durationSeconds*.1,blockedSeconds:durationSeconds*.1,failureCount:10,microStopCount:0}).map(([key,mean])=>[key,{mean}]))]));
  if(!compact){sim.whatIf.searchDepth='MEDIUM';sim.whatIf.reliabilitySettings={scope:'AUTO',maximumTargets:3,equipmentIds:[],equipmentLimits:{}};}
  const record={id:'case',simulations:[sim],metadata:{includeDOE:!compact,scenarioSearch:{speedProfile:compact?'THOROUGH':'FAST'}}},before={equipment:structuredClone(sim.equipment),dynamicConfig:structuredClone(sim.dynamicConfig),results:structuredClone(sim.results)};
  const dom=new JSDOM('<!doctype html><html data-ui-mode="basic"><body><main id="scenarios"></main></body></html>',{runScripts:'outside-only'}),w=dom.window,calls=[],errors=[];
  w.document.documentElement.dataset.uiMode=uiMode;
  w.__ST_TEXT__=key=>key;w.STPreferences={read:()=>null,write:()=>true};w.STIcons={svg:()=>'<svg></svg>'};w.STReports={bindWhatIf(){}};w.STErrors={register(){},capture(target,error){errors.push(error||target);}};
  w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const file of ['ClientUtils.html','Icons.html','Subsection.html','SimulationEngine.html','WhatIf.html','ScenarioExplorer.html']){
    const source=fs.readFileSync('apps-script/'+file,'utf8'),scripts=[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    if(scripts.length)for(const match of scripts)w.eval(match[1]);else w.eval(source);
  }
  // A deterministic response stub verifies experiment orchestration. It is not
  // evidence that these interventions improve the real plant or physical model.
  w.SimulatorEngine.simulateBatch=async input=>{
    const copy=JSON.parse(JSON.stringify(input));calls.push(copy);let gain=0;
    if(input.run.reliabilityEnabled===false&&reliability)gain+=20;
    for(const e of input.case.equipment){const original=before.equipment.find(unit=>unit.id===e.id);
      if(reliability&&original.noiseProfile?.reliability&&!e.noiseProfile?.reliability)gain+=6;
      for(const path of Object.keys(w.STScenarios.fields)){const current=get(e,path),initial=get(original,path);if(Number.isFinite(current)&&current!==initial)gain+=1;}
    }
    gain=Math.min(25,gain);const throughput=100+gain,oee=50+gain/5;
    const rows=Array.from({length:input.run.rounds},(_,i)=>({seed:input.run.seed+i,durationSeconds:input.run.durationSeconds,summary:{lineOeePercent:oee,outputCount:throughput*input.run.durationSeconds/60}}));
    return {ok:true,result:{scenarioFidelity:input.run.scenarioFidelity,durationSeconds:input.run.durationSeconds,unitOfFlow:'bottles',summary:rows[0].summary,batch:{rounds:rows.length,rows,statistics:{lineOeePercent:{mean:oee},throughputPerMinute:{mean:throughput}}}}};
  };
  w.STScenarioSearch.screenFlow=async()=>{throw Error('Basic must not run the preliminary factor-and-pair screen.');};
  w.STScenarioExplorer.connectCase(()=>record,()=>{});
  const target=w.document.getElementById('scenarios');
  w.STWhatIf.render(sim,target,()=>{}, {compact});
  const cards=Object.fromEntries([...target.querySelectorAll('.analysis-recommendation')].filter(card=>card.querySelector('.analysis-capex')).map(card=>[card.querySelector('.analysis-capex').dataset.tier,card]));
  return {w,dom,sim,record,before,calls,cards,errors,close:()=>w.close()};
}

async function search(h,tier){
  const card=h.cards[tier];assert(card,'Missing '+tier+' category');
  const result=await card._runMinimalSearch();
  assert.equal(result.started,true,JSON.stringify(result));
  assert(!['ERROR','FAILED','INTERRUPTED','NO_ELIGIBLE_TARGETS'].includes(result.status),JSON.stringify(result)+'\n'+h.errors.map(error=>error.stack||error.message).join('\n'));
  const entry=h.sim.whatIf.evaluations.find(e=>e.tier===tier||e.searchScope===tier);
  assert(entry,JSON.stringify(h.sim.whatIf.evaluations));return entry;
}

function verifyAutomatic(entry,h){
  assert.equal(entry.searchSettings.automaticBasic,true);assert.equal(entry.searchSettings.speedProfile,'FAST');assert.equal(entry.depth,'MEDIUM');assert.equal(entry.method,'AUTOMATIC_PACKAGE_DOE');
  const expanded=entry.tier==='ZERO'&&entry.explorationRun.scenarioFidelity==='FLUID_SCREEN_V1';
  assert.equal(entry.searchLimits.maxCandidates,expanded?32:24);assert.equal(entry.searchLimits.passes,1);
  assert(entry.phaseAudit.automaticSelection.selectedPackages<=(expanded?4:3));assert(entry.doe.observations.length<=(expanded?16:8));assert(entry.doe.analysis.complete);assert(entry.doe.anova.complete);
  assert.equal(entry.conditionalFlowDOE,undefined);assert.equal(entry.phaseAudit.flowScreen,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(entry.reproducibility.categoryInclusions)),{});
  assert(entry.phaseAudit.exploration.testedCandidates<=(expanded?32:7),'The bounded isolated screen and factorial remain within budget');
  assert.equal(entry.infeasibleTrials,0,'Every expanded package combination must reach a valid experiment');
  assert(entry.phaseAudit.ranking.finalists<=1);assert(entry.independentCheck.rounds<=6);
  assert.equal(entry.independentCheck.durationSeconds,entry.rankingPlan.confirmationHorizon.seconds);assert.equal(entry.independentCheck.scenarioFidelity,'PHYSICAL_PRECISE_V1');
  assert.equal(entry.independentCheck.rounds,entry.confirmationPlan.rounds);
  assert.equal(entry.originalVerificationRequired,true);assert(entry.originalVerification?.passed);assert.equal(entry.originalVerification.durationSeconds,h.before.dynamicConfig.durationSeconds);assert.equal(entry.originalVerification.rounds,h.before.dynamicConfig.rounds);assert.equal(entry.originalVerification.baseline.throughput,100);assert(entry.originalVerification.candidate.throughput>100);
  assert(entry.confirmationPlan.pilotSeeds.every(seed=>!entry.independentCheck.baseline.roundMetrics.some(row=>row.seed===seed)));
  assert.equal(entry.phaseAudit.doe.plannedCombinations,entry.phaseAudit.doe.evaluatedCombinations);
  assert.deepEqual(h.sim.equipment,h.before.equipment);assert.deepEqual(h.sim.dynamicConfig,h.before.dynamicConfig);assert.deepEqual(h.sim.results,h.before.results);
}

test('Basic selects its DOE and budgets despite retained manual preferences and reuses the subset experiments',async()=>{
  const h=harness();try{
    for(const card of Object.values(h.cards)){
      for(const input of card.querySelectorAll('.scenario-target,.scenario-doe-level,.scenario-limit'))input.value='';
      for(const input of card.querySelectorAll('.scenario-change input[type="checkbox"]'))input.checked=false;
    }
    const entry=await search(h,'ZERO');verifyAutomatic(entry,h);
    assert.equal(entry.reliabilityTargetSearch.searchPolicy,'BASIC_JOINT_RELIABILITY_V1');assert.equal(entry.reliabilityTargetSearch.coverage.screened,3);assert(entry.reliabilityTargetSearch.calculations<=16);
    assert(entry.reliabilityTargetSearch.targetTests.every(t=>t.mechanism==='JOINT'));
    assert(!entry.reliabilityCounterfactual,'Basic skips the optional second full-horizon failure-free diagnosis');
    assert(entry.automaticPlan.packages.some(p=>p.mechanism==='RELIABILITY'),'Automatic downtime reduction remains represented with the flow controls');
    assert(h.calls.length<=57,'Broader fluid screen, factorial, ranking and original verification remain bounded');
    assert.equal(h.record.metadata.includeDOE,false);assert.equal(h.record.metadata.scenarioSearch.speedProfile,'THOROUGH');assert.equal(h.sim.whatIf.searchDepth,'LIGHT');
  }finally{h.close();}
});

test('Basic Medium evaluates one, two and three complete accumulation packages from the unchanged baseline',async()=>{
  const h=harness();try{
    const entry=await search(h,'MEDIUM');verifyAutomatic(entry,h);
    assert.equal(entry.automaticPlan.packages.length,3);assert.equal(entry.doe.observations.length,8);
    assert.deepEqual([...new Set(entry.automaticPlan.candidatePackages.map(p=>p.siteCount))].sort(),[1,2,3]);
    assert.equal(entry.reliabilityTargetSearch,undefined);assert(entry.evaluatedChanges.every(c=>c.originTier==='MEDIUM'&&c.interventionType==='ACCUMULATION'));
    for(const point of entry.doe.observations){
      for(const c of point.changes){assert(c.originTier==='MEDIUM');for(const path of c.packagePaths||[])assert(point.changes.some(other=>other.equipmentId===c.equipmentId&&other.path===path));}
    }
    const base=entry.doe.observations.find(point=>point.levels.every(level=>level===-1));assert.equal(base.throughput,100,'All-low factorial point really is the source baseline');
    assert(h.calls.length<=18,'Geometry subsets are not re-simulated during DOE');
  }finally{h.close();}
});

test('Basic High compares atomic full-machine replacements and all three categories retain the same baseline',async()=>{
  const h=harness();try{
    const entries=[];for(const tier of ['ZERO','MEDIUM','HIGH']){const entry=await search(h,tier);verifyAutomatic(entry,h);entries.push(entry);}
    const entry=entries[2];assert(entry.automaticPlan.packages.length>0);assert.equal(entry.reliabilityTargetSearch,undefined);
    assert(entry.evaluatedChanges.every(c=>c.interventionType==='REPLACEMENT'&&c.originTier==='HIGH'));
    for(const point of entry.doe.observations)for(const c of point.changes){
      assert.equal(c.interventionType,'REPLACEMENT');assert.equal(c.originTier,'HIGH');for(const path of c.packagePaths||[])assert(point.changes.some(other=>other.equipmentId===c.equipmentId&&other.path===path));
    }
    assert(entries.every(e=>e.sourceSignature===entries[0].sourceSignature&&e.independentCheck.baseline.throughput===100));
    assert(entries.every(e=>e.doe.observations.find(point=>point.levels.every(level=>level===-1)).throughput===100));
    assert.equal(h.w.document.querySelectorAll('.scenario-include-category').length,0);
  }finally{h.close();}
});

test('Basic keeps a complete thirty-minute confirmation when the configured source run is shorter',async()=>{
  const h=harness({reliability:false,durationSeconds:600});try{
    const entry=await search(h,'ZERO');verifyAutomatic(entry,h);
    assert.equal(entry.independentCheck.durationSeconds,1800);assert.equal(entry.reliabilityTargetSearch,undefined);
    assert.equal(h.sim.dynamicConfig.durationSeconds,600);
  }finally{h.close();}
});

test('Standard numeric Medium DOE removes coupled sensor fields at the baseline length level',async()=>{
  const h=harness({compact:false});try{
    h.w.ST_SCENARIO_SEARCH_LIMITS.maxCandidates=1;
    const card=h.cards.MEDIUM,selects=[...card.querySelectorAll('.scenario-doe-select')].filter(input=>input.getAttribute('aria-label').includes('installed_length_l_act_mm'));
    assert.equal(selects.length,3);for(const input of selects){input.checked=true;input.onchange();}
    const entry=await search(h,'MEDIUM');
    assert.equal(entry.searchSettings.automaticBasic,undefined);assert.equal(entry.doe.observations.length,8);assert(entry.doe.analysis.complete);assert(entry.doe.anova.complete);
    assert.equal(entry.doe.fixedChanges.length,0,'Sensor companions must not remain fixed when their length factor is absent');
    assert.equal(entry.doe.observations.find(point=>point.levels.every(level=>level===-1)).throughput,100);
    assert.equal(entry.infeasibleTrials,0);assert.deepEqual(h.sim.equipment,h.before.equipment);
  }finally{h.close();}
});

test('Standard High DOE selects complete replacement packages when one field per machine is chosen',async()=>{
  const h=harness({compact:false});try{
    h.w.ST_SCENARIO_SEARCH_LIMITS.maxCandidates=1;
    const card=h.cards.HIGH,byMachine=new Map();
    for(const input of card.querySelectorAll('.scenario-doe-select')){const name=input.getAttribute('aria-label').split(' · ')[0];if(!byMachine.has(name))byMachine.set(name,input);}
    assert(byMachine.size>0);for(const input of [...byMachine.values()].slice(0,3)){input.checked=true;input.onchange();}
    const entry=await search(h,'HIGH');
    assert.equal(entry.searchSettings.automaticBasic,undefined);assert(entry.doe.analysis.complete);assert(entry.doe.anova.complete);
    for(const factor of entry.doe.factors){assert(factor.packageChanges.length>0);assert.equal(factor.low,0);assert.equal(factor.high,1);}
    assert.equal(entry.infeasibleTrials,0);
    for(const point of entry.doe.observations)for(const c of point.changes)for(const path of c.packagePaths)assert(point.changes.some(other=>other.equipmentId===c.equipmentId&&other.path===path));
    assert.deepEqual(h.sim.equipment,h.before.equipment);
  }finally{h.close();}
});

test('adding documented High targets rebuilds one complete supplier package without mixing automatic specifications',async()=>{
  const h=harness({compact:false});try{
    const equipment=h.sim.equipment.find(e=>e.type!=='CONVEYOR'),select=h.w.document.querySelector('[aria-label="Intervention equipment"]');select.value=equipment.id;select.onchange();
    const field=h.w.document.querySelector('[aria-label="Intervention parameter"]'),type=h.w.document.querySelector('[aria-label="Intervention type"]'),source=h.w.document.querySelector('[aria-label="Intervention and target justification"]'),target=h.w.document.querySelector('[aria-label="Intervention target (minutes)"]'),maximum=h.w.document.querySelector('[aria-label="Replacement maximum speed (units/min)"]'),add=h.w.document.querySelector('.scenario-add-intervention');
    source.value='Supplier performance specification and full-machine replacement scope';
    for(const [path,value] of [['noiseProfile.reliability.mtbfMinutes',equipment.noiseProfile.reliability.mtbfMinutes*2],['noiseProfile.reliability.mttrMinutes',equipment.noiseProfile.reliability.mttrMinutes*.75],['nominalRatePerSecond',equipment.nominalRatePerSecond*1.2*60]]){
      field.value=path;field.onchange();type.value='REPLACEMENT';target.value=value;maximum.value=equipment.nominalRatePerSecond*1.4*60;add.click();
      assert.match(h.w.document.querySelector('.scenario-intervention-status').textContent,/Target saved/);
    }
    const saved=h.sim.whatIf.externalOptions.filter(option=>option.tier==='HIGH'&&option.changes.some(c=>c.equipmentId===equipment.id));assert.equal(saved.length,1);assert.equal(saved[0].changes.length,3);
    h.cards.HIGH=[...h.w.document.querySelectorAll('.analysis-recommendation')].find(card=>card.querySelector('.analysis-capex')?.dataset.tier==='HIGH');
    for(const row of h.cards.HIGH.querySelectorAll('.scenario-change')){const use=row.querySelector('input[type="checkbox"]');use.checked=use.getAttribute('aria-label').includes(equipment.name+' · ');use.onchange();}
    const factor=[...h.cards.HIGH.querySelectorAll('.scenario-doe-select')].find(input=>input.getAttribute('aria-label').includes(equipment.name+' · '));assert(factor);factor.checked=true;factor.onchange();h.w.ST_SCENARIO_SEARCH_LIMITS.maxCandidates=1;
    const entry=await search(h,'HIGH');assert(entry.doe.analysis.complete);assert.equal(entry.doe.factors.length,1);assert.equal(entry.doe.factors[0].packageChanges.length,3);assert.equal(entry.evaluatedChanges.length,3);
    assert(entry.evaluatedChanges.every(c=>c.equipmentId===equipment.id&&c.interventionType==='REPLACEMENT'&&!c.analysisOnly));
    assert.equal(new Set(entry.evaluatedChanges.map(c=>c.packageId)).size,1);assert(entry.evaluatedChanges.every(c=>c.packageId.includes('DOCUMENTED')));assert.deepEqual(h.sim.equipment,h.before.equipment);
  }finally{h.close();}
});

test('Basic, Standard and Advance render three independent CAPEX categories using the shared scope policy',()=>{
  for(const variant of [{name:'Basic',compact:true,uiMode:'basic'},{name:'Standard',compact:false,uiMode:'basic'},{name:'Advance',compact:false,uiMode:'advance'}]){
    const h=harness(variant);try{
      const badges=[...h.w.document.querySelectorAll('.analysis-capex')].map(badge=>badge.dataset.tier);assert.deepEqual(badges,['ZERO','MEDIUM','HIGH'],variant.name);
      assert.equal(h.w.document.querySelectorAll('.scenario-include-category').length,0,variant.name);
      const candidates=h.w.STScenarios.plan(h.sim).candidates;
      for(const tier of badges){
        const allowed=candidates.filter(candidate=>candidate.canApply&&candidate.tier===tier&&candidate.changes.every(change=>h.w.STScenarios.categoryAllows(change,tier,{allowAnalysisOnly:true})));
        const labels=new Set(allowed.flatMap(candidate=>candidate.changes).map(change=>{const info=h.w.STWhatIf.changeInfo(change,h.sim.equipment);return info.equipment+' · '+info.parameter+' · Target (';}));
        const targets=[...h.cards[tier].querySelectorAll('.scenario-target')];assert.equal(targets.length,labels.size,variant.name+' '+tier+' row count');
        for(const target of targets)assert([...labels].some(label=>target.getAttribute('aria-label').startsWith(label)),variant.name+' '+tier+' contains a row outside its scoped proposals');
      }
      assert.equal(h.calls.length,0,'Rendering categories must not launch an experiment');
    }finally{h.close();}
  }
});

test('Basic short negative screen exits without spending full-horizon simulations',async()=>{
  const h=harness({reliability:false,durationSeconds:86400});try{
    // Clear any long-transit precaution on this synthetic response fixture.
    const orig=h.w.STScenarioSearch.progressiveFinalists;
    h.w.STScenarioSearch.progressiveFinalists=(items,base,run,equipment,limit)=>orig(items,base,run,[],limit);
    const simulate=h.w.SimulatorEngine.simulateBatch;
    h.w.SimulatorEngine.simulateBatch=input=>simulate({...input,case:{...input.case,equipment:h.before.equipment}});
    const entry=await search(h,'ZERO');
    assert.equal(entry.status,'NO_PROMISING_CANDIDATE');assert.equal(entry.screeningOnly,true);
    assert.equal(entry.independentCheck,null);assert(h.calls.every(call=>call.run.durationSeconds<86400));
    assert(h.cards.ZERO.querySelector('.scenario-create').disabled);
    assert.match(h.cards.ZERO.querySelector('.scenario-result-notice').textContent,/Physical confirmation not performed/);
  }finally{h.close();}
});
test('Basic deadline interrupts calculation without marking the candidate confirmed',async()=>{
  const h=harness({reliability:false});try{
    h.w.ST_SCENARIO_SEARCH_LIMITS.basicTimeLimitMs=1;
    const result=await h.cards.ZERO._runMinimalSearch();
    assert.equal(result.status,'SEARCH_BUDGET_REACHED',JSON.stringify(result));
    const entry=h.sim.whatIf.evaluations.find(e=>e.tier==='ZERO');
    assert.equal(entry.independentCheck,null);assert.equal(entry.stopReason,'BASIC_TIME_LIMIT');
    assert(h.cards.ZERO.querySelector('.scenario-create').disabled);
    assert.match(h.cards.ZERO.querySelector('.scenario-result-notice').textContent,/Time limit reached/);
  }finally{h.close();}
});

test('Basic displays a provisional estimate while the full-horizon candidate is being ranked',async()=>{
 const h=harness({reliability:false,durationSeconds:86400});try{
  const original=h.w.SimulatorEngine.simulateBatch;let sawPreview=false;
  h.w.SimulatorEngine.simulateBatch=async input=>{
   if(input.run.scenarioFidelity==='PHYSICAL_FAST_V1'&&input.run.durationSeconds===3600){
    const notice=h.cards.ZERO.querySelector('.scenario-result-notice');
    sawPreview ||= !notice.hidden&&/Provisional estimate/.test(notice.textContent);
    assert(h.cards.ZERO.querySelector('.scenario-create').disabled);
   }
   return original(input);
  };
  const entry=await search(h,'ZERO');
  assert(sawPreview);assert(entry.independentCheck.passed);
  assert(entry.originalVerification.passed);assert.match(h.cards.ZERO.querySelector('.scenario-result-notice').textContent,/Verified on the original run/);
 }finally{h.close();}
});


test('Basic separates independent improvement from a worse original-horizon candidate',async()=>{
 const h=harness({reliability:false,durationSeconds:86400});try{
  const original=h.w.SimulatorEngine.simulateBatch;let originalCalls=0;
  h.w.SimulatorEngine.simulateBatch=async input=>{
    if(input.run.durationSeconds===86400&&!input.run.scenarioFidelity){originalCalls++;assert(h.cards.ZERO.querySelector('.scenario-create').disabled);return original({...input,case:{...input.case,equipment:h.before.equipment}});}
    return original(input);
  };
  const entry=await search(h,'ZERO');assert.equal(originalCalls,1);assert(entry.independentCheck.passed);assert.equal(entry.originalVerification.passed,false);assert.equal(entry.status,'NOT_REPRODUCED');assert.match(h.cards.ZERO.querySelector('.scenario-result-notice').textContent,/did not improve the original run/);
 }finally{h.close();}
});
