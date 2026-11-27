import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function setup(){
 let record,writes=0,held=false,releases=0;
 const ctx={Utilities:{getUuid:()=> 'unique-scenario'},createSimulatorError_:(code,message,details)=>Object.assign(new Error(message),{code,details}),withCaseWriteLock_:fn=>{assert(!held);held=true;try{return fn();}finally{held=false;releases++;}},persistCaseRecord_:(record,owned)=>{owned.file.setContent(JSON.stringify(record));return owned.file;},getOwnedCaseFile_:(id,user)=>{assert.equal(user.email,'owner@test');assert(held,'ownership and revision must be checked inside the lock');return {caseData:JSON.parse(JSON.stringify(record)),file:{setContent:value=>{assert(held);writes++;record=JSON.parse(value);}}};},ensureCaseSimulations_:c=>c,generateSimulationId_:()=> 'scenario'};
 vm.createContext(ctx);for(const file of ['DemoCaseFactory.gs','ScenarioEngine.gs','ScenarioService.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),ctx);
 const source={id:'a',name:'Baseline',equipment:JSON.parse(JSON.stringify(ctx.createDemoCaseRequest_().equipment)),dynamicConfig:{durationSeconds:60,tickSeconds:.25,sampleEverySeconds:1,seed:23,commands:[]},results:{summary:{throughput:41},replay:{samples:[1,2]}}};completeSyntheticScenarioSource(source);record={id:'case-a',revision:1,simulations:[source]};
 const proposal=ctx.STScenarioEngine_.plan(source).projects.find(p=>p.canApply);proposal.title='Infeed study';
 const request={caseId:'case-a',simulationId:'a',expectedRevision:1,sourceSignature:ctx.STScenarioEngine_.signature(source),proposal,origin:'GEMINI'};
 return {ctx,request,record:()=>record,writes:()=>writes,releases:()=>releases};
}
test('scenario creation requires a complete current numerical result even for STATIC proposals',()=>{
 for(const mutate of [source=>source.results=null,source=>source.results.replicationStatus.state='CALCULATING',source=>source.results.batch.rows=[],source=>source.dynamicConfig.durationSeconds++]){
  const h=setup();mutate(h.record().simulations[0]);
  assert.throws(()=>h.ctx.createScenario_(h.request,{email:'owner@test'}),error=>error.code==='SCENARIO_SOURCE_NOT_READY');
  assert.equal(h.writes(),0);assert.equal(h.record().simulations.length,1);
 }
});
test('scenario cloning and overrides are one owned, revision-checked write with baseline and seed preserved',()=>{
 const h=setup(),baseline=JSON.stringify(h.record().simulations[0]);
 const response=h.ctx.createScenario_(h.request,{email:'owner@test'});assert.equal(h.writes(),1);assert.equal(h.releases(),1);assert.equal(response.case.simulations.length,2);
 assert.equal(JSON.stringify(response.case.simulations[0]),baseline);assert.equal(response.case.simulations[1].dynamicConfig.seed,23);assert.equal(response.case.simulations[1].results,null);assert.equal(response.case.simulations[1].scenario.origin,'GEMINI');
 assert.throws(()=>h.ctx.createScenario_(h.request,{email:'owner@test'}),e=>e.code==='CASE_CONFLICT');assert.equal(h.writes(),1);
});
test('stale or invalid proposals create no partially saved clone and always release the lock',()=>{
 const h=setup();assert.throws(()=>h.ctx.createScenario_({...h.request,sourceSignature:'stale'},{email:'owner@test'}),e=>e.code==='SCENARIO_STALE');
 const invalid={...h.request,proposal:{...h.request.proposal,changes:[{equipmentId:'unknown',path:'processData.geometry.lactMm',before:null,after:100}]}};
 assert.throws(()=>h.ctx.createScenario_(invalid,{email:'owner@test'}));assert.equal(h.writes(),0);assert.equal(h.record().simulations.length,1);assert.equal(h.releases(),2);
});

test('server accepts an equivalent browser fingerprint after storage normalization',()=>{
 const h=setup(),saved=h.record().simulations[0],client=JSON.parse(JSON.stringify(saved));
 client.equipment=client.equipment.map(unit=>({
  transientRowOpen:true,processData:Object.fromEntries(Object.entries(unit.processData||{}).reverse()),
  characteristics:unit.characteristics||{},noiseProfile:unit.noiseProfile||{},
  initialMode:unit.initialMode,nominalRatePerSecond:String(unit.nominalRatePerSecond),
  name:' '+unit.name+' ',type:unit.type,id:unit.id
 }));
 client.dynamicConfig=Object.fromEntries(Object.entries(client.dynamicConfig).reverse());
 const request={...h.request,sourceSignature:h.ctx.STScenarioEngine_.signature(client)};
 assert.equal(request.sourceSignature,h.ctx.STScenarioEngine_.signature(saved));
 assert.equal(h.ctx.createScenario_(request,{email:'owner@test'}).case.simulations.length,2);
});

test('server returns its own signature for the owned saved simulation and checks revision',()=>{
 const h=setup();h.ctx.getCase_=(id,user)=>{assert.equal(id,'case-a');assert.equal(user.email,'owner@test');return h.record();};
 const request={caseId:'case-a',simulationId:'a',expectedRevision:1};
 const verified=h.ctx.getScenarioSourceSignature_(request,{email:'owner@test'});
 assert.equal(verified.signature,h.ctx.STScenarioEngine_.signature(h.record().simulations[0]));
 assert.equal(verified.revision,1);
 assert.throws(()=>h.ctx.getScenarioSourceSignature_({...request,expectedRevision:0},{email:'owner@test'}),error=>error.code==='CASE_CONFLICT');
 assert.throws(()=>h.ctx.getScenarioSourceSignature_({...request,simulationId:'missing'},{email:'owner@test'}),error=>error.code==='SIMULATION_NOT_FOUND');
});

test('local scenarios are replanned on the locked saved baseline when the client signature differs',()=>{
 const h=setup(),source=h.record().simulations[0],baseline=JSON.stringify(source);
 const request={...h.request,origin:'LOCAL',sourceSignature:'different-client-fingerprint',proposal:{...h.request.proposal,evidence:{invented:'discard this'}}};
 const response=h.ctx.createScenario_(request,{email:'owner@test'}),created=response.case.simulations[1];
 assert.equal(JSON.stringify(response.case.simulations[0]),baseline);
 assert.equal(created.scenario.sourceSignature,h.ctx.STScenarioEngine_.signature(source));
 assert.equal(created.scenario.evidence.invented,undefined);
 assert.equal(created.scenario.origin,'LOCAL');assert.equal(h.writes(),1);
});

test('local replanning rejects modified edits, changed revisions and an unrelated source',()=>{
 const h=setup(),request={...h.request,origin:'LOCAL',sourceSignature:'different-client-fingerprint'};
 const altered=JSON.parse(JSON.stringify(request.proposal));altered.changes[0].after+=1;
 assert.throws(()=>h.ctx.createScenario_({...request,proposal:altered},{email:'owner@test'}),e=>e.code==='SCENARIO_REVIEW_REQUIRED');
 assert.throws(()=>h.ctx.createScenario_({...request,expectedRevision:0},{email:'owner@test'}),e=>e.code==='CASE_CONFLICT');
 assert.throws(()=>h.ctx.createScenario_({...request,proposal:{...request.proposal,sourceSimulationId:'another-source'}},{email:'owner@test'}),e=>e.code==='INVALID_SCENARIO');
 assert.equal(h.writes(),0);assert.equal(h.record().simulations.length,1);assert.equal(h.releases(),3);
});

test('scenario RPC errors identify the responding version without exposing inputs',()=>{
 const h=setup();vm.runInContext(fs.readFileSync('apps-script/ApiResponse.gs','utf8'),h.ctx);
 vm.runInContext(fs.readFileSync('apps-script/Main.gs','utf8'),h.ctx);
 h.ctx.requireCurrentUser_=()=>({email:'owner@test'});
 const response=h.ctx.createScenario({...h.request,expectedRevision:0});
 assert.equal(response.ok,false);assert.equal(response.scenarioVersion,'whatif-20261014-2');
 assert.match(response.error.message,/\[whatif-20261014-2 \/ CASE_CONFLICT\]/);
 assert.doesNotMatch(JSON.stringify(response),/equipment|noiseProfile/);
});

test('reviewed external interventions retain evidence and reject stale source signatures',()=>{
 const h=setup(),source=h.record().simulations[0],e=source.equipment[0],before=e.noiseProfile.reliability.mttrMinutes;
 const proposal={...h.request.proposal,tier:'ZERO',changes:[{equipmentId:e.id,path:'noiseProfile.reliability.mttrMinutes',before,after:before*.8,external:true,interventionType:'MAINTENANCE',justification:'Maintenance with crew access and repair trial target'}]};
 assert.throws(()=>h.ctx.createScenario_({...h.request,origin:'REVIEWED',sourceSignature:'stale',proposal},{email:'owner@test'}),e=>e.code==='SCENARIO_STALE');
 const result=h.ctx.createScenario_({...h.request,origin:'REVIEWED',proposal},{email:'owner@test'});
 assert.equal(result.case.simulations[1].scenario.changes[0].external,true);assert.match(result.case.simulations[1].scenario.changes[0].justification,/crew/);assert.equal(result.case.simulations[0].equipment[0].noiseProfile.reliability.mttrMinutes,before);
});

test('saved scenarios retain server-derived engineering warnings and review status',()=>{
 const h=setup(),apply=h.ctx.STScenarioEngine_.apply;
 h.ctx.STScenarioEngine_.apply=(source,changes)=>{const result=apply(source,changes);result.scenarioWarnings=[{equipmentId:changes[0].equipmentId,rule:'BACKUP_POSITION',before:'PASS',after:'FAIL'}];return result;};
 h.request.origin='REVIEWED';h.request.proposal.evidence={engineeringReview:'ACKNOWLEDGED_REQUIRES_REVIEW'};
 const saved=h.ctx.createScenario_(h.request,{email:'owner@test'}).case.simulations[1];
 assert.equal(saved.scenario.validation,'ENGINEERING_REVIEW_REQUIRED');assert.equal(saved.scenario.engineeringWarnings[0].rule,'BACKUP_POSITION');
 assert.equal(saved.scenario.evidence.engineeringReview,'ACKNOWLEDGED_REQUIRES_REVIEW');assert.equal(saved.results,null);
});



test('reviewed validation drafts retain failed independent confirmation without changing source or claiming a gain',()=>{
 const h=setup(),baseline=JSON.stringify(h.record().simulations[0]);
 h.request.origin='REVIEWED';h.request.proposal.evidence={...Object.fromEntries(Array.from({length:13},(_,i)=>['detail'+i,i])),independentValidation:'NOT_REPRODUCED_REQUIRES_VALIDATION'};
 const response=h.ctx.createScenario_(h.request,{email:'owner@test'}),draft=response.case.simulations[1];
 assert.equal(draft.scenario.validation,'NOT_REPRODUCED_REQUIRES_VALIDATION');assert.equal(draft.scenario.evidence.independentValidation,'NOT_REPRODUCED_REQUIRES_VALIDATION');assert.equal(draft.results,null);assert.equal(JSON.stringify(response.case.simulations[0]),baseline);assert.equal(h.writes(),1);
});

test('reviewed reliability targets require an intervention and its documented target',()=>{
 const h=setup(),source=h.record().simulations[0],e=source.equipment[0],before=e.noiseProfile.reliability.mttrMinutes;
 const proposal={...h.request.proposal,tier:'ZERO',changes:[{equipmentId:e.id,path:'noiseProfile.reliability.mttrMinutes',before,after:before*.8,external:true}]};
 assert.throws(()=>h.ctx.createScenario_({...h.request,origin:'REVIEWED',proposal},{email:'owner@test'}),error=>error.code==='INVALID_SCENARIO'&&error.details.includes('SCENARIO_EXTERNAL_EVIDENCE_REQUIRED'));
 assert.equal(h.writes(),0);assert.equal(h.record().simulations.length,1);
 assert.equal(h.record().simulations[0].equipment[0].noiseProfile.reliability.mttrMinutes,before);
});

test('local scenario preparation applies the same validation without any Drive write',()=>{
 const h=setup(),record=JSON.parse(JSON.stringify(h.record()));h.ctx.getOwnedCaseFile_=()=>{throw Error('Drive must not be read');};h.ctx.persistCaseRecord_=()=>{throw Error('Drive must not be written');};
 const prepared=h.ctx.prepareScenarioFromRecord_(h.request,record,{email:'owner@test'});
 assert.equal(prepared.case.simulations.length,2);assert.equal(prepared.case.simulations[1].results,null);assert.equal(prepared.case.simulations[1].scenario.plantValidated,false);assert.equal(h.writes(),0);
});

test('scenario draft RPC validates the browser snapshot and returns a clone without reading or writing Drive',()=>{
 const h=setup();for(const file of ['GeminiService.gs','Main.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),h.ctx);
 h.ctx.executeServerAction_=fn=>({ok:true,data:fn({email:'owner@test'})});
 h.ctx.getOwnedCaseFile_=()=>{throw Error('Drive must not be read');};h.ctx.persistCaseRecord_=()=>{throw Error('Drive must not be written');};
 const snapshot={...JSON.parse(JSON.stringify(h.record())),ownerEmail:'owner@test'},before=JSON.stringify(snapshot);
 const result=h.ctx.prepareScenarioDraft({...h.request,caseSnapshot:snapshot});assert(result.ok);assert.equal(result.data.simulation.results,null);
 assert.equal(result.data.simulation.scenario.origin,'GEMINI');assert.equal(h.writes(),0);assert.equal(JSON.stringify(snapshot),before);assert.equal(h.record().simulations.length,1);
 assert.throws(()=>h.ctx.prepareScenarioDraft({...h.request,caseSnapshot:{...snapshot,ownerEmail:'someone@test'}}),e=>e.code==='INVALID_LOCAL_CONTEXT');
});

test('Gemini proposals with unchanged provenance bind drifted starting values without changing targets',()=>{
 const h=setup(),source=h.record().simulations[0],baseline=JSON.stringify(source),proposal={...h.request.proposal,changes:h.request.proposal.changes.map(c=>({...c,before:Number(c.before)+.0000001}))};
 assert.throws(()=>h.ctx.normalizeScenarioProposal_(proposal,source),e=>e.code==='SCENARIO_STALE'&&e.details.some(d=>d.includes(proposal.changes[0].path)));
 const response=h.ctx.createScenario_({...h.request,proposal},{email:'owner@test'}),copy=response.case.simulations[1];
 assert.equal(h.writes(),1);assert.equal(JSON.stringify(response.case.simulations[0]),baseline);
 assert.deepEqual(Array.from(copy.scenario.changes,c=>c.after),Array.from(proposal.changes,c=>c.after));
 assert.deepEqual(Array.from(copy.scenario.changes,c=>c.before),Array.from(h.request.proposal.changes,c=>c.before));
});
test('Gemini rebinding rejects stale proposal provenance even when the request supplies a fresh signature',()=>{
 for(const invalid of [{sourceSignature:'old'},{sourceSimulationId:'another-simulation'}]){
  const h=setup();assert.throws(()=>h.ctx.createScenario_({...h.request,proposal:{...h.request.proposal,...invalid}},{email:'owner@test'}),e=>e.code==='SCENARIO_STALE');assert.equal(h.writes(),0);
 }
});
test('Gemini rebinding preserves target bounds and requires provenance before changing before values',()=>{
 const h=setup(),proposal={...h.request.proposal,changes:h.request.proposal.changes.map(c=>({...c,before:Number(c.before)+.0000001,after:1e20}))};
 assert.throws(()=>h.ctx.createScenario_({...h.request,proposal},{email:'owner@test'}),e=>e.code==='INVALID_SCENARIO');assert.equal(h.writes(),0);
 const unsigned={...proposal,changes:h.request.proposal.changes.map(c=>({...c,before:Number(c.before)+.0000001}))};delete unsigned.sourceSignature;
 assert.throws(()=>h.ctx.createScenario_({...h.request,proposal:unsigned},{email:'owner@test'}),e=>e.code==='SCENARIO_STALE');assert.equal(h.writes(),0);
});


test('server rejects legacy lower-category inclusions even when originTier and saved flags request them',()=>{
 for(const tier of ['MEDIUM','HIGH']){
  const h=setup(),proposal={...h.request.proposal,tier,categoryInclusions:{ZERO:true,MEDIUM:true},changes:h.request.proposal.changes.map(change=>({...change,originTier:'ZERO'}))};
  assert.throws(()=>h.ctx.createScenario_({...h.request,origin:'REVIEWED',proposal},{email:'owner@test'}),error=>error.code==='INVALID_SCENARIO');
  assert.equal(h.writes(),0);assert.equal(h.record().simulations.length,1);
 }
});

test('server permits only Zero sensitivity and preserves its exploratory qualification',()=>{
 for(const tier of ['ZERO','MEDIUM','HIGH']){
  const h=setup(),source=h.record().simulations[0],machine=source.equipment.find(e=>e.type!=='CONVEYOR'),before=machine.noiseProfile.reliability.mttrMinutes;
  const change={equipmentId:machine.id,path:'noiseProfile.reliability.mttrMinutes',before,after:before*.8,external:true,analysisOnly:true,interventionType:'SENSITIVITY',justification:'Bounded downtime sensitivity; no implementation evidence.'};
  const proposal={...h.request.proposal,tier,analysisOnly:true,changes:[change]};
  if(tier==='ZERO'){
   const normalized=h.ctx.normalizeScenarioProposal_(proposal,source);assert.equal(normalized.analysisOnly,true);assert.equal(normalized.changes[0].analysisOnly,true);
   assert.throws(()=>h.ctx.normalizeScenarioProposal_({...proposal,analysisOnly:false},source),error=>error.code==='INVALID_SCENARIO');
  }else assert.throws(()=>h.ctx.normalizeScenarioProposal_(proposal,source),error=>error.code==='INVALID_SCENARIO');
  assert.equal(h.writes(),0);
 }
});

test('Medium accumulation normalization retains coupled intervention and package identity',()=>{
 const h=setup(),source=h.record().simulations[0],conveyor=source.equipment.find(e=>e.type==='CONVEYOR'),before=conveyor.processData.geometry.lactMm,packageId='ACCUMULATION:'+conveyor.id;
 const proposal={...h.request.proposal,tier:'MEDIUM',changes:[{equipmentId:conveyor.id,path:'processData.geometry.lactMm',before,after:before+1000,interventionType:'ACCUMULATION',originTier:'MEDIUM',packageId,targetId:packageId,packagePaths:['processData.geometry.lactMm'],justification:'Additional accumulation on the existing conveyor.'}]};
 const normalized=h.ctx.normalizeScenarioProposal_(proposal,source);
 assert.equal(normalized.changes[0].interventionType,'ACCUMULATION');assert.equal(normalized.changes[0].packageId,packageId);assert.equal(normalized.changes[0].targetId,packageId);assert.deepEqual(Array.from(normalized.changes[0].packagePaths),['processData.geometry.lactMm']);
 assert.equal(normalized.changes[0].external,undefined);
});


test('saved Zero downtime sensitivity retains its category without claiming implementation or plant validation',()=>{
 const h=setup(),source=h.record().simulations[0],machine=source.equipment.find(e=>e.type!=='CONVEYOR'),before=machine.noiseProfile.reliability.mttrMinutes;
 const change={equipmentId:machine.id,path:'noiseProfile.reliability.mttrMinutes',before,after:before*.8,external:true,analysisOnly:true,interventionType:'SENSITIVITY',justification:'Bounded downtime sensitivity; maintenance feasibility remains unverified.'};
 const proposal={...h.request.proposal,tier:'ZERO',analysisOnly:true,changes:[change]};
 const saved=h.ctx.createScenario_({...h.request,origin:'REVIEWED',proposal},{email:'owner@test'}).case.simulations[1];
 assert.equal(saved.scenario.capex,'ZERO');assert.equal(saved.scenario.classification,'INTERVENTION_SCOPE');
 assert.equal(saved.scenario.analysisOnly,true);assert.equal(saved.scenario.plantValidated,false);
 assert.equal(saved.scenario.validation,'EXPLORATORY_TARGETS_REQUIRE_FEASIBILITY_REVIEW');
 assert.equal(saved.scenario.changes[0].analysisOnly,true);assert.equal(saved.scenario.study.feasibility.verified,false);
 assert.equal(source.equipment.find(e=>e.id===machine.id).noiseProfile.reliability.mttrMinutes,before);
});
