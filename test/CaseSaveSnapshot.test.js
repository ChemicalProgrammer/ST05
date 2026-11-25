import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('apps-script/ClientCases.html','utf8');
const simulationSource=fs.readFileSync('apps-script/ClientSimulation.html','utf8');
const equipmentSource=fs.readFileSync('apps-script/ClientEquipment.html','utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function loadCapture(context){
 context.state.run=context.state.run||{};context.roundSession=null;
 vm.runInContext(simulationSource.slice(simulationSource.indexOf('    function preserveCommittedSimulationInputs('),simulationSource.indexOf('    function syncPersistentSimulation(')),context);
 vm.runInContext(equipmentSource.slice(equipmentSource.indexOf('    function caseEditorSnapshot('),equipmentSource.indexOf('    function basicEquipmentPreview(')),context);
 vm.runInContext(source.slice(source.indexOf('    function captureForSave()'),source.indexOf('    function fitCaseSave(')),context);
}
test('case capture saves the live 2D checkpoint without triggering another edit',()=>{
 const owner={id:'s',equipment:[],dynamicConfig:{}},state={activeCase:{id:'c',revision:4,simulations:[owner]}};
 let captures=0;
 const live={identity:['c','s','format'],version:2,checkpoint:{time:12.345,line:[]},presentation:{palletAnimation:{forkStarted:10,placed:36}},source:'independent'};
 const context=vm.createContext({window:{STSimulation2D:{capture(){captures++;return clone(live);}}},state,STProducts:{validateForSave(){}},whatIfOnlySave:false,
  collectCaseEditor:()=>({name:'Case',equipment:[]}),activePersistentSimulation:()=>owner,readRunConfiguration:()=>({}),captureSimulationView(){},fitCaseSave:value=>value,cloneJson:clone});
 loadCapture(context);
 const saved=context.captureForSave();assert.equal(captures,1);assert.equal(saved.simulations[0].simulation2d.checkpoint.time,12.345);
 assert.deepEqual(saved.simulations[0].simulation2d.presentation,live.presentation);
 context.whatIfOnlySave=true;const evidence=context.captureForSave();assert.equal(evidence.expectedRevision,4);assert.equal(evidence.simulations[0].simulation2d.checkpoint.time,12.345);
});
test('case capture does not attach a checkpoint from a different case',()=>{
 const owner={id:'s',equipment:[],dynamicConfig:{}},state={activeCase:{id:'c',simulations:[owner]}};
 const context=vm.createContext({window:{STSimulation2D:{capture:()=>({identity:['other-case','s'],checkpoint:{time:999}})}},state,STProducts:{validateForSave(){}},whatIfOnlySave:false,
  collectCaseEditor:()=>({name:'Case',equipment:[]}),activePersistentSimulation:()=>owner,readRunConfiguration:()=>({}),captureSimulationView(){},fitCaseSave:value=>value,cloneJson:clone});
 loadCapture(context);
 assert.equal(context.captureForSave().simulations[0].simulation2d,undefined);
});
test('saving a completed search with no improvement preserves committed inputs and its full progress history',()=>{
 const equipment=[{id:'inlet',name:'Virtual inlet',type:'FEEDER',nominalRatePerSecond:4,processData:{equipment:{mtbfMinutes:null,mttrMinutes:null}},noiseProfile:{}}];
 const trace={state:'Completed',percent:100,elapsedMs:1041000,steps:Array.from({length:8},(_,i)=>({name:'Step '+(i+1),state:'Completed',percent:100,elapsedMs:1000,work:{batches:{label:'Batches',done:3,total:3}}}))};
 const owner={id:'s',equipment,dynamicConfig:{durationSeconds:86400,rounds:3},results:{summary:{outputCount:120},inputSignature:'saved-inputs'},
  whatIf:{evaluations:[{sourceSimulationId:'s',sourceSignature:'saved-source',status:'NO_DEMONSTRATED_IMPROVEMENT',message:'No demonstrated improvement.',progress:'Finished',progressTrace:trace,trials:32}]}};
 const state={activeCase:{id:'c',name:'Case',revision:4,equipment:clone(equipment),simulations:[owner]}};
 const context=vm.createContext({window:{},state,STProducts:{validateForSave(){}},whatIfOnlySave:false,
  collectCaseEditor:()=>{throw Error('Completed evidence must not read the editor');},activePersistentSimulation:()=>owner,
  readRunConfiguration:()=>{throw Error('Completed evidence must keep its run');},captureSimulationView(){},fitCaseSave:value=>value,cloneJson:clone});
 loadCapture(context);
 const before=clone(owner);
 for(const evidenceOnly of [false,true]){
  context.whatIfOnlySave=evidenceOnly;
  const saved=context.captureForSave(),restored=JSON.parse(JSON.stringify(saved));
  assert.deepEqual(restored.simulations[0],before);
  assert.equal(restored.simulations[0].whatIf.evaluations[0].progressTrace.steps.length,8);
  assert.equal(restored.simulations[0].equipment[0].processData.equipment.mtbfMinutes,null);
  saved.simulations[0].whatIf.evaluations[0].progressTrace.steps[0].state='Changed copy';
  assert.deepEqual(owner,before,'capture returns a detached snapshot');
 }
});
test('manual Save flushes the request even when automatic saving is disabled',async()=>{
 const sent=[],state={activeCase:{id:'c'}},context=vm.createContext({window:{},setTimeout,clearTimeout,Date,__ST_TEXT__:key=>key,state,prepareCaseDraft:()=>Promise.resolve(),showError:error=>{throw error;}});
 vm.runInContext(fs.readFileSync('apps-script/Autosave.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);
 context.autosave=context.window.STAutosave({enabled:false,capture:()=>({id:'c',checkpoint:{time:1.25}}),send:(payload,done)=>sent.push({payload,done}),accept(){},status(){}});
 vm.runInContext(source.slice(source.indexOf('    function saveActiveCase('),source.indexOf('    function captureSheetImport(')),context);
 let finished=false;const saving=context.saveActiveCase(()=>{finished=true;});
 await Promise.resolve();assert.equal(sent.length,1);assert.equal(finished,false);
 sent[0].done({ok:true,data:{id:'c',revision:2}});await saving;assert.equal(finished,true);assert(!context.autosave.pending());
});

test('Real Data metadata changes use the shared manual Save controls without invalidating the completed simulation',async()=>{
 const equipment=[{id:'filler',name:'Filler',type:'FILLER',nominalRatePerSecond:4,noiseProfile:{reliability:{mtbfMinutes:20,mttrMinutes:1}}}];
 const simulation={id:'s',equipment:clone(equipment),dynamicConfig:{durationSeconds:86400,rounds:3},results:{summary:{outputCount:180000,lineOeePercent:65},inputSignature:'complete-inputs',replicationStatus:{state:'COMPLETE'}}};
 const state={activeCase:{id:'c',name:'Line G',revision:4,equipment:clone(equipment),metadata:{consoleOptions:{autosaveEnabled:true}},simulations:[simulation]},activeSimulationId:'s',run:{result:simulation.results},isDirty:false,saving:false};
 const makeButton=()=>({disabled:true,classList:{values:new Set(['hidden']),toggle(key,flag){if(flag)this.values.add(key);else this.values.delete(key);},contains(key){return this.values.has(key);}}});
 const buttons={'save-case':makeButton(),'real-data-save':makeButton()},sent=[],errors=[];
 const context=vm.createContext({window:{},state,setTimeout,clearTimeout,Date,__ST_TEXT__:key=>key,
  document:{getElementById:id=>buttons[id]},STProducts:{validateForSave(){}},
  whatIfOnlySave:false,activePersistentSimulation:()=>simulation,cloneJson:clone,
  collectCaseEditor:()=>{throw Error('Metadata-only save must not reread the equipment editor');},
  readRunConfiguration:()=>{throw Error('Metadata-only save must not reread the run settings');},
  captureSimulationView(){},fitCaseSave:value=>value,prepareCaseDraft:()=>Promise.resolve(),showError:error=>errors.push(error)});
 loadCapture(context);
 vm.runInContext(fs.readFileSync('apps-script/Autosave.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);
 context.autosave=context.window.STAutosave({enabled:false,capture:()=>context.captureForSave(),
  send:(payload,done)=>sent.push({payload,done}),accept(){},
  status(status){state.saving=status==='saving';state.isDirty=status!=='saved';context.syncSaveButton();}});
 vm.runInContext(source.slice(source.indexOf('    var queueCaseSave='),source.indexOf('    function saveGeminiHistory(')),context);
 vm.runInContext(source.slice(source.indexOf('    function automaticSaving('),source.indexOf('    function configureSaving(')),context);
 vm.runInContext(source.slice(source.indexOf('    function saveActiveCase('),source.indexOf('    function captureSheetImport(')),context);
 context.syncSaveButton();
 assert(Object.values(buttons).every(b=>!b.classList.contains('hidden')&&b.disabled));
 const before=clone(simulation);
 state.activeCase.metadata.realData={schema:'st-real-data-v1',records:[{id:'r',name:'Observed shift',durationSeconds:86400}]};
 context.queueCaseEvidenceSave();
 assert.equal(context.whatIfOnlySave,true);
 assert.equal(sent.length,0,'Importing observations remains a draft until explicit Save');
 assert(Object.values(buttons).every(b=>!b.disabled&&!b.classList.contains('hidden')&&b.classList.contains('has-changes')));
 assert.deepEqual(simulation,before);
 const pending=context.saveActiveCase();await Promise.resolve();
 assert.equal(sent.length,1);
 assert.deepEqual(sent[0].payload.metadata.realData,state.activeCase.metadata.realData);
 assert.deepEqual(sent[0].payload.simulations[0],before);
 assert(Object.values(buttons).every(b=>b.disabled&&!b.classList.contains('hidden')));
 sent[0].done({ok:true,data:{id:'c',revision:5}});await pending;
 assert(Object.values(buttons).every(b=>b.disabled&&!b.classList.contains('has-changes')&&!b.classList.contains('hidden')));
 assert.deepEqual(errors,[]);
 assert.deepEqual(simulation,before);
 state.activeCase=null;context.syncSaveButton();
 assert(Object.values(buttons).every(b=>b.disabled&&b.classList.contains('hidden')));
});
