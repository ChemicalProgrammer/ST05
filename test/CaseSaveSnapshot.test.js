import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('apps-script/ClientCases.html','utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
test('case capture saves the live 2D checkpoint without triggering another edit',()=>{
 const owner={id:'s',equipment:[],dynamicConfig:{}},state={activeCase:{id:'c',revision:4,simulations:[owner]}};
 let captures=0;
 const live={identity:['c','s','format'],version:2,checkpoint:{time:12.345,line:[]},presentation:{palletAnimation:{forkStarted:10,placed:36}},source:'independent'};
 const context=vm.createContext({window:{STSimulation2D:{capture(){captures++;return clone(live);}}},state,STProducts:{validateForSave(){}},whatIfOnlySave:false,
  collectCaseEditor:()=>({name:'Case',equipment:[]}),activePersistentSimulation:()=>owner,readRunConfiguration:()=>({}),captureSimulationView(){},fitCaseSave:value=>value,cloneJson:clone});
 vm.runInContext(source.slice(source.indexOf('    function captureForSave()'),source.indexOf('    function fitCaseSave(')),context);
 const saved=context.captureForSave();assert.equal(captures,1);assert.equal(saved.simulations[0].simulation2d.checkpoint.time,12.345);
 assert.deepEqual(saved.simulations[0].simulation2d.presentation,live.presentation);
 context.whatIfOnlySave=true;const evidence=context.captureForSave();assert.equal(evidence.expectedRevision,4);assert.equal(evidence.simulations[0].simulation2d.checkpoint.time,12.345);
});
test('case capture does not attach a checkpoint from a different case',()=>{
 const owner={id:'s',equipment:[],dynamicConfig:{}},state={activeCase:{id:'c',simulations:[owner]}};
 const context=vm.createContext({window:{STSimulation2D:{capture:()=>({identity:['other-case','s'],checkpoint:{time:999}})}},state,STProducts:{validateForSave(){}},whatIfOnlySave:false,
  collectCaseEditor:()=>({name:'Case',equipment:[]}),activePersistentSimulation:()=>owner,readRunConfiguration:()=>({}),captureSimulationView(){},fitCaseSave:value=>value,cloneJson:clone});
 vm.runInContext(source.slice(source.indexOf('    function captureForSave()'),source.indexOf('    function fitCaseSave(')),context);
 assert.equal(context.captureForSave().simulations[0].simulation2d,undefined);
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
