import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planZeroFlowOFAT,zeroFlowChangeAllowed,selectZeroFlowFactors,zeroFlowDesign,zeroFlowRefinement,scenarioSearchRun,planScenarioConfirmation} from '../src/analysis/ScenarioSearch.js';
import {applyScenarioChanges,planScenarios} from '../src/analysis/ScenarioPlanner.js';
import {analyzeScenarioANOVA} from '../src/analysis/ScenarioDOE.js';
const fixture=()=>{const s=JSON.parse(fs.readFileSync('test/fixtures/demo-b-case.json','utf8')).simulations[0];s.dynamicConfig={...s.dynamicConfig,durationSeconds:28800,seed:23,rounds:1,eventsEnabled:false};return s;};
const value=(q,durationSeconds=900,seed=23)=>({durationSeconds,unitOfFlow:'bottles',scenarioFidelity:'PHYSICAL_FAST_V1',overflowUnits:0,throughput:q,oee:q/2,roundMetrics:[-1,0,1].map((x,i)=>({seed:seed+i,durationSeconds,throughput:q+x,oee:(q+x)/2}))});
test('Zero OFAT is bounded, physically valid, one field and non-mutating',()=>{
 const s=fixture(),before=JSON.stringify(s),p=planZeroFlowOFAT(s,{limit:30});
 assert(p.probes.length>0&&p.probes.length<=30);assert.equal(JSON.stringify(s),before);
 assert(p.groups.some(g=>g.kind==='SPEED'));assert(p.groups.some(g=>g.kind==='PRIME'));
 for(const row of p.probes){
  assert.equal(row.changes.length,1);assert(zeroFlowChangeAllowed(row.changes[0],s.equipment));
  const model=applyScenarioChanges(s,row.changes,{tier:'ZERO',previewOnly:true});
  model.equipment.forEach((e,i)=>{assert.deepEqual(e.noiseProfile,s.equipment[i].noiseProfile);assert.equal(e.nominalRatePerSecond,s.equipment[i].nominalRatePerSecond);assert.equal(e.processData?.geometry?.lactMm,s.equipment[i].processData?.geometry?.lactMm);});
 }
 assert(!zeroFlowChangeAllowed({path:'noiseProfile.reliability.mtbfMinutes',originTier:'ZERO'}));
 assert(!zeroFlowChangeAllowed({path:'processData.geometry.lactMm',originTier:'MEDIUM'}));
 assert(!zeroFlowChangeAllowed({path:'nominalRatePerSecond',originTier:'HIGH'}));
 const scoped=planScenarios(s,{zeroOnly:true});assert.equal(scoped.projects.length,1);assert(scoped.candidates.every(p=>p.tier==='ZERO'));assert.equal(scoped.reliabilityOpportunities.length,0);
});
test('Zero selects measured individual factors and uses complete matched factorials',()=>{
 const s=fixture(),p=planZeroFlowOFAT(s,{limit:30}),base=value(100),obs=p.probes.map((r,i)=>({...r,result:value(100+i%7)}));
 const factors=selectZeroFlowFactors(p,obs,base,3).factors;assert.equal(factors.length,3);
 const d=zeroFlowDesign(factors);assert.equal(d.designPoints.length,8);assert(d.designPoints.every(point=>point.changes.every(c=>zeroFlowChangeAllowed(c,s.equipment))));
 const observations=d.designPoints.map(point=>({index:point.index,levels:point.levels,...value(100+point.levels.reduce((sum,v,i)=>sum+(i+1)*v,0),1800)}));
 assert(analyzeScenarioANOVA(d,observations).complete);
 assert(!analyzeScenarioANOVA(d,observations.slice(1)).complete);
 assert(zeroFlowRefinement(factors,d.designPoints[0].changes).length<=6);
 assert.equal(selectZeroFlowFactors(p,obs.map(r=>({...r,result:value(100,900,99)})),base,3).factors.length,0);
});
test('All active experiment windows are physical and ranking matches confirmation for rare failures',()=>{
 const s=fixture(),settings={automaticBasic:true},run=s.dynamicConfig;
 const ofat=scenarioSearchRun(run,'MEDIUM','control-screen',3,settings,s.equipment),doe=scenarioSearchRun(run,'MEDIUM','doe',3,settings,s.equipment);
 assert.equal(ofat.durationSeconds,900);assert.equal(doe.durationSeconds,1800);assert.equal(ofat.scenarioFidelity,'PHYSICAL_FAST_V1');
 const rare=[{type:'FILLER',noiseProfile:{reliability:{mtbfMinutes:180,mttrMinutes:10}}}],ranking=scenarioSearchRun(run,'MEDIUM','ranking',3,settings,rare),confirm=scenarioSearchRun(run,'MEDIUM','validation',6,settings,rare);
 assert.equal(ranking.durationSeconds,confirm.durationSeconds);assert.equal(confirm.scenarioFidelity,'PHYSICAL_PRECISE_V1');assert.equal(confirm.rounds,6);
 assert(planScenarioConfirmation(value(100,3600),value(104,3600),{},{automaticBasic:true}).rounds>=6);
});
test('Active UI and server block legacy categories',()=>{
 const basic=fs.readFileSync('apps-script/MinimalMode.html','utf8'),explorer=fs.readFileSync('apps-script/ScenarioExplorer.html','utf8'),service=fs.readFileSync('apps-script/ScenarioService.gs','utf8');
 assert.match(basic,/var tiers=\['ZERO'\]/);
 assert.match(explorer,/SCENARIO_ZERO_FLOW_ONLY/);assert.match(explorer,/SCENARIO_ZERO_PHYSICAL_ONLY/);
 assert.match(service,/proposal\.tier!=='ZERO'/);assert.match(service,/STScenarioEngine_\.zeroAllowed/);
});
