import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import * as planner from '../src/analysis/ScenarioPlanner.js';
import {createScenarioDOE} from '../src/analysis/ScenarioDOE.js';
import {scenarioSearchRun,scenarioSearchProfile,scenarioSearchSettings,scenarioSearchSettingsSignature,SCENARIO_SEARCH_PROFILES,scenarioPairedEvidence,planScenarioConfirmation,assessScenarioConfirmation,scenarioPracticalGain,planScenarioFinalistRanking,selectScenarioFinalists} from '../src/analysis/ScenarioSearch.js';
import {scenarioSourceReadiness} from '../src/analysis/ScenarioReadiness.js';
import {buildScenarioStudy,scenarioTechnicalMethodology} from '../src/analysis/ScenarioMethodology.js';
import {searchReliabilityTargets} from '../src/analysis/ReliabilityTargetSearch.js';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';
const fixture=()=>completeSyntheticScenarioSource(structuredClone(JSON.parse(fs.readFileSync('test/fixtures/demo-b-case.json','utf8')).simulations[0]));
const change=(sim,type='REPLACEMENT')=>{const e=sim.equipment[0];return {equipmentId:e.id,path:'noiseProfile.reliability.mttrMinutes',before:e.noiseProfile.reliability.mttrMinutes,after:e.noiseProfile.reliability.mttrMinutes/2,external:true,interventionType:type,justification:'Replace complete machine; target from documented supplier trial.'};};
function service(){const ctx=vm.createContext({createSimulatorError_:(code,message)=>Object.assign(new Error(message),{code})});for(const f of ['ScenarioEngine.gs','ScenarioService.gs'])vm.runInContext(fs.readFileSync('apps-script/'+f,'utf8'),ctx);return ctx;}
test('intervention scope classifies reliability independently of gain and distinguishes maintenance OPEX',()=>{
 const s=fixture();for(const [type,tier] of [['OPERATIONAL','ZERO'],['MAINTENANCE','ZERO'],['REPLACEMENT','HIGH']]){const c=change(s,type);assert(planner.scenarioCategoryAllows(c,tier));assert.doesNotThrow(()=>planner.applyScenarioChanges(s,[c]));for(const other of ['ZERO','MEDIUM','HIGH'].filter(t=>t!==tier))assert(!planner.scenarioCategoryAllows(c,other));}
 assert(!planner.scenarioCategoryAllows(change(s,'RETROFIT'),'MEDIUM'));assert.throws(()=>planner.applyScenarioChanges(s,[change(s,'RETROFIT')]),/EVIDENCE/);
 assert.equal(planner.SCENARIO_INTERVENTIONS.MAINTENANCE.costClass,'OPEX');
 assert.throws(()=>planner.applyScenarioChanges(s,[{...change(s),justification:''}]),/EVIDENCE/);
 assert.throws(()=>planner.applyScenarioChanges(s,[{...change(s),interventionType:undefined}]),/EVIDENCE/);
 assert.throws(()=>planner.applyScenarioChanges(s,[{...change(s),after:3}]),/DIRECTION/);
});
test('sensitivity tests MTBF, MTTR and joint effects but cannot be submitted as a scenario',()=>{
 const s=fixture(),cases=planner.reliabilitySensitivityCandidates(s);assert.equal(cases.length,21);assert.deepEqual(cases.slice(0,3).map(c=>c.kind),['MTBF','MTTR','JOINT']);
 const c=cases[0].changes[0];assert(c.analysisOnly);assert.doesNotThrow(()=>planner.applyScenarioChanges(s,[c]));assert(!planner.scenarioCategoryAllows(c,'HIGH'));
 assert.throws(()=>service().normalizeScenarioProposal_({title:'Exploratory',tier:'HIGH',basis:'STATIC',changes:[c]},s),/exploratory/i);
 const disabled=structuredClone(s);delete disabled.equipment[0].noiseProfile.reliability;assert.equal(planner.reliabilitySensitivityCandidates(disabled).length,18);
});
test('documented replacement targets enter planner and survive server normalization; wrong category is rejected',()=>{
 const s=fixture(),c=change(s);s.whatIf={externalOptions:[{tier:'HIGH',changes:[c]}]};assert(planner.planScenarios(s).candidates.some(p=>p.kind==='RELIABILITY_INTERVENTION'&&p.canApply));
 const ctx=service(),p={title:'Replacement',tier:'HIGH',basis:'STATIC',changes:[c]};const result=ctx.normalizeScenarioProposal_(p,s);assert.equal(result.changes[0].interventionType,'REPLACEMENT');assert.equal(result.changes[0].costClass,'CAPEX');assert.throws(()=>ctx.normalizeScenarioProposal_({...p,tier:'MEDIUM'},s),/scope/);
 assert.throws(()=>ctx.normalizeScenarioProposal_({...p,changes:[{...change(s,'MAINTENANCE'),originTier:'ZERO'}]},s),/scope/);
});
test('DOE preserves the operational intervention scope of an independent Zero search',()=>{
 const s=fixture(),c={...change(s,'MAINTENANCE'),originTier:'ZERO'},design=createScenarioDOE([{...c,low:c.after,high:c.before}]);const edited=design.designPoints[0].changes[0];assert.equal(edited.interventionType,'MAINTENANCE');assert.equal(edited.originTier,'ZERO');assert.doesNotThrow(()=>planner.applyScenarioChanges(s,[edited]));
});
test('Zero card downtime search uses paired experiments, independent confirmation and saves no implementation targets',async()=>{
 const dom=new JSDOM('<article class="analysis-recommendation"></article>',{runScripts:'outside-only'}),w=dom.window,s=fixture(),calls=[];
 s.whatIf={searchDepth:'HIGH'};const before=structuredClone(s.equipment);
 w.HTMLDialogElement.prototype.close=function(){};w.HTMLDialogElement.prototype.showModal=function(){};
 w.STPreferences={read(){return '';},write(){return true;}};w.STIcons={svg(){return '<svg></svg>';}};w.STErrors={register(){},capture(){}};
 w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 for(const file of ['ClientUtils.html','Icons.html','Subsection.html']){const source=fs.readFileSync('apps-script/'+file,'utf8'),scripts=[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];if(scripts.length)for(const match of scripts)w.eval(match[1]);else w.eval(source);}
 w.STScenarios={plan:planner.planScenarios,apply:planner.applyScenarioChanges,signature:planner.scenarioSignature,fields:planner.SCENARIO_FIELDS,definitions:planner.SCENARIO_DEFINITIONS,interventions:planner.SCENARIO_INTERVENTIONS,categoryAllows:planner.scenarioCategoryAllows,
  readiness:scenarioSourceReadiness,methodologyInputs:scenarioTechnicalMethodology,study:buildScenarioStudy};
 w.STWhatIf={changeInfo(c){return {equipment:c.equipmentId,parameter:c.path,before:c.before,after:c.after};}};w.STScenarioText={ZERO:'Zero'};
 w.STScenarioSearch={settings:scenarioSearchSettings,settingsSignature:scenarioSearchSettingsSignature,run:scenarioSearchRun,profile:scenarioSearchProfile,profiles:SCENARIO_SEARCH_PROFILES,reliabilityTargets:searchReliabilityTargets,
  rankingPlan:planScenarioFinalistRanking,selectFinalists:selectScenarioFinalists,pairedEvidence:scenarioPairedEvidence,planConfirmation:planScenarioConfirmation,confirm:assessScenarioConfirmation,practicalGain:scenarioPracticalGain};
 w.SimulatorEngine={validateSimulationInput(){return {ok:true};},inputSignature:input=>JSON.stringify(input),async simulateBatch(input){
  calls.push(structuredClone(input));const r=input.case.equipment[0].noiseProfile.reliability,oee=input.run.reliabilityEnabled===false||!r?100:100*r.mtbfMinutes/(r.mtbfMinutes+r.mttrMinutes),summary={lineOeePercent:oee,outputCount:oee*input.run.durationSeconds/60};
  const rows=Array.from({length:input.run.rounds},(_,i)=>({seed:input.run.seed+i,durationSeconds:input.run.durationSeconds,summary:{...summary}}));
  return {ok:true,result:{durationSeconds:input.run.durationSeconds,summary,batch:{rounds:input.run.rounds,rows,statistics:{lineOeePercent:{mean:oee},throughputPerMinute:{mean:oee}}}}};
 }};
 w.eval(fs.readFileSync('apps-script/ScenarioExplorer.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1]);
 w.STScenarioExplorer.connectCase(()=>({metadata:{includeDOE:false},simulations:[s]}),()=>{});w.ST_SCENARIO_SEARCH_LIMITS.maxCandidates=1;
 const host=w.document.querySelector('article');
 try{
  w.STScenarioExplorer.attach(host,{kind:'CUSTOM',tier:'ZERO',explore:true,changes:[]},()=>{},s);
  host.querySelector('.scenario-search').click();
  for(let i=0;i<400;i++){if(s.whatIf.evaluations?.[0]&&!['RUNNING','VALIDATING'].includes(s.whatIf.evaluations[0].status))break;await new Promise(resolve=>setTimeout(resolve,5));}
  const result=s.whatIf.evaluations?.[0];assert.equal(result?.status,'IMPROVEMENT_REPRODUCED',result?.message||host.textContent);
  assert(result.reliabilityTargetSearch);assert(result.analysisOnly);assert(result.evaluatedChanges.every(c=>c.analysisOnly&&c.interventionType==='SENSITIVITY'));
  assert.equal(s.whatIf.externalOptions,undefined);assert.deepEqual(s.equipment,before);
  const pilot=calls.filter(call=>call.run.seed===s.dynamicConfig.seed+100003),confirmation=calls.filter(call=>call.run.seed===s.dynamicConfig.seed+1000003);
  assert(pilot.length>=2);assert(pilot.every(call=>call.run.rounds===3));assert(confirmation.length>=2);
  assert(confirmation.every(call=>call.run.rounds===result.confirmationPlan.rounds&&call.run.durationSeconds===result.independentCheck.durationSeconds));
  assert.equal(result.independentCheck.baseline.roundMetrics.length,result.confirmationPlan.rounds);
  assert.equal(result.independentCheck.candidate.roundMetrics.length,result.confirmationPlan.rounds);
  assert(result.confirmationPlan.pilotSeeds.every(seed=>!result.independentCheck.baseline.roundMetrics.some(row=>row.seed===seed)));
  assert.match(host.querySelector('.scenario-create').title,/exploratory/);
 }finally{dom.window.close();}
});
