import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';
import {validateSimulationInput} from '../src/simulation/SimulationValidation.js';
import {simulateLine} from '../src/simulation/LineSimulationEngine.js';
import {normalizeFormatCatalog,mergeFormatCatalogs,resolvePackingFormats} from '../src/simulation/FormatCatalog.js';

const source=fs.readFileSync(new URL('../apps-script/ConfigurationEditor.html',import.meta.url),'utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/simpy-pipeline.json',import.meta.url),'utf8'));
const copy=value=>JSON.parse(JSON.stringify(value));
// Keep the production nodes and rendered text, without starting the rest of the
// application. The native dialog/file-picker APIs are the only UI boundaries
// supplied by this harness; validation uses the production engine modules.
const page=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
const markup=['simulation-json-section','configuration-file','configuration-dialog']
  .map(id=>page.window.document.getElementById(id).outerHTML).join('')
  +page.window.document.getElementById('open-json-import').closest('details').outerHTML;
page.window.close();

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function configuration(){
  return {schema:'st-line-configuration-v1',case:{id:'case-1',unitOfFlow:fixture.case.unitOfFlow,metadata:{}},
    simulation:{id:'simulation-1',engineConfig:{},equipment:copy(fixture.case.equipment),
      dynamicConfig:{...copy(fixture.run),durationMode:'FIXED',rounds:1}}};
}
function draftConfiguration(){
  const incoming=configuration();incoming.importMode='DRAFT';
  incoming.simulation.equipment.forEach(e=>{e.processData??={};});
  const conveyor=incoming.simulation.equipment[1];conveyor.name='Conveyor ETI - FIL';
  conveyor.processData.speedAndSensors.conveyorSpeedFactorVsDischargeVelocityPercent=null;
  conveyor.processData.accumulation.conveyorSpeedFactorPercent=null;
  conveyor.processData.sourceEvidence={caseId:'E',speedFactor:null,note:'Not visible in the source; preserve as unknown.'};
  return incoming;
}
function selectedFile(text,options={}){
  return {name:options.name||'line.json',size:options.size??Buffer.byteLength(text),text:options.read||(()=>Promise.resolve(text))};
}
function harness(options={}){
  const errors=[],console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(markup,{runScripts:'outside-only',virtualConsole:console}),w=dom.window,d=w.document;
  const get=id=>d.getElementById(id),dialog=get('configuration-dialog'),file=get('configuration-file');
  const state={activeCase:{id:'case-1'},activeSimulationId:'simulation-1'},current=configuration();
  const calls={pickers:0,captures:0,applied:[],messages:[],validationErrors:[]};
  dialog.showModal=function(){this.open=true;};
  dialog.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  file.click=()=>{calls.pickers++;options.onPicker?.();};
  Object.assign(w,{SimulatorEngine:{validateSimulationInput,normalizeFormatCatalog,mergeFormatCatalogs,resolvePackingFormats},
    STDialog:{open:message=>{calls.messages.push(message);return Promise.resolve();}},
    STErrors:{capture:(_node,error)=>calls.validationErrors.push(error.message)}});
  w.eval(source);w.STConfigurationEditor.init(state,{
    capture:()=>{calls.captures++;return options.capture?options.capture(current,state):copy(current);},
    apply:value=>calls.applied.push(copy(value))
  });
  function select(selected){
    Object.defineProperty(file,'files',{configurable:true,value:selected?[selected]:[]});
    file.dispatchEvent(new w.Event('change',{bubbles:true}));
  }
  return {w,d,get,state,current,calls,errors,dialog,file,select,
    settle:()=>new Promise(resolve=>w.setTimeout(resolve,0)),close:()=>w.close()};
}

test('JSON uses a described subsection and its modal has no import control or file picker',()=>{
  const h=harness();
  try{
    const section=h.get('simulation-json-section');
    assert.ok(section.matches('.fold-card'));
    assert.ok(section.querySelector('.fold-heading .subsection-description').textContent.trim());
    assert.ok(section.querySelector('.fold-tools #import-setup-json'));
    const toggle=section.querySelector('[data-subsection-toggle]'),content=h.get(toggle.getAttribute('aria-controls'));
    assert.ok(content.matches('.fold-content'));assert.equal(content.hidden,true);
    assert.ok(content.contains(h.get('case-json-preview')));
    assert.equal(h.dialog.querySelector('#configuration-import,input[type=file]'),null);
    assert.equal(h.dialog.contains(h.file),false);assert.equal(h.file.hidden,true);
    assert.deepEqual([...h.dialog.querySelectorAll('button')].map(button=>button.id),
      ['configuration-close','configuration-cancel','configuration-apply']);
  }finally{h.close();}
});

test('edit opens the active configuration and cancel, close and Escape discard the draft',async()=>{
  const h=harness();
  try{
    const original=copy(h.current);
    for(const action of ['configuration-cancel','configuration-close','escape']){
      h.get('edit-setup-json').click();await h.settle();
      assert.equal(h.dialog.open,true);assert.deepEqual(JSON.parse(h.get('configuration-draft').value),original);
      assert.equal(h.get('configuration-filename').hidden,true);
      h.get('configuration-draft').value='unsaved edit';
      if(action==='escape'){
        const event=new h.w.Event('cancel',{cancelable:true});h.dialog.dispatchEvent(event);
        assert.equal(event.defaultPrevented,true);
      }else h.get(action).click();
      assert.equal(h.dialog.open,false);assert.equal(h.get('configuration-draft').value,'');
      assert.deepEqual(h.current,original);assert.equal(h.calls.applied.length,0);
    }
    assert.equal(h.calls.pickers,0);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('both external import controls invoke the picker synchronously and open the selected file before applying once',async()=>{
  for(const id of ['open-json-import','import-setup-json']){
    let inGesture=false,pickerWasSynchronous=false;
    const h=harness({onPicker:()=>{pickerWasSynchronous=inGesture;}});
    try{
      const incoming=copy(h.current);incoming.simulation.equipment[0].name='Imported machine';
      const button=h.get(id),menu=button.closest('details');if(menu)menu.open=true;
      inGesture=true;button.click();inGesture=false;
      assert.equal(pickerWasSynchronous,true,id);assert.equal(h.calls.pickers,1);
      assert.equal(h.calls.captures,0);assert.equal(h.dialog.open,false);
      if(menu)assert.equal(menu.open,false);
      h.select(selectedFile(JSON.stringify(incoming),{name:'chosen.json'}));await h.settle();
      assert.equal(h.calls.captures,1);assert.equal(h.dialog.open,true);
      assert.deepEqual(JSON.parse(h.get('configuration-draft').value),incoming);
      assert.equal(h.get('configuration-filename').textContent,'chosen.json');assert.equal(h.get('configuration-filename').hidden,false);
      assert.equal(h.calls.applied.length,0,'Selecting a file does not apply it');
      h.get('configuration-apply').click();
      assert.equal(h.calls.applied.length,1);assert.equal(h.calls.applied[0].equipment[0].name,'Imported machine');
      assert.equal(h.dialog.open,false);assert.equal(h.get('configuration-draft').value,'');
      h.get('configuration-apply').click();assert.equal(h.calls.applied.length,1,'A stale second click cannot apply twice');
      assert.deepEqual(h.errors,[]);
    }finally{h.close();}
  }
});

test('cancelling the native picker makes no capture, dialog or case changes',async()=>{
  const h=harness();
  try{
    const before=copy(h.state);
    h.get('import-setup-json').click();h.file.dispatchEvent(new h.w.Event('cancel'));
    h.select(selectedFile(JSON.stringify(h.current)));await h.settle();
    assert.equal(h.calls.captures,0,'A selection arriving after cancellation is ignored');
    assert.equal(h.dialog.open,false);assert.deepEqual(h.state,before);
    assert.equal(h.calls.applied.length,0);assert.deepEqual(h.calls.messages,[]);
    h.get('open-json-import').click();h.select(null);await h.settle();
    assert.equal(h.calls.captures,0);assert.equal(h.dialog.open,false);
  }finally{h.close();}
});

test('invalid JSON and invalid model inputs stay in the editor without applying',async()=>{
  const h=harness();
  try{
    h.get('import-setup-json').click();h.select(selectedFile('{broken JSON'));await h.settle();
    h.get('configuration-apply').click();
    assert.equal(h.dialog.open,true);assert.equal(h.get('configuration-draft').value,'{broken JSON');
    assert.ok(h.get('configuration-error').textContent);assert.equal(h.calls.applied.length,0);
    const invalid=copy(h.current);invalid.simulation.equipment[0].nominalRatePerSecond=-1;
    h.get('configuration-draft').value=JSON.stringify(invalid);h.get('configuration-apply').click();
    assert.match(h.get('configuration-error').textContent,/nominalRatePerSecond/);
    assert.equal(h.dialog.open,true);assert.equal(h.calls.applied.length,0);
    h.get('configuration-draft').value=JSON.stringify(h.current);h.get('configuration-apply').click();
    assert.equal(h.calls.applied.length,1);assert.equal(h.dialog.open,false);
  }finally{h.close();}
});

test('oversized files are rejected before reading or capturing and the next import can succeed',async()=>{
  const h=harness();let reads=0;
  try{
    h.get('import-setup-json').click();
    h.select(selectedFile('{}',{size:6*1024*1024+1,read:()=>{reads++;return Promise.resolve('{}');}}));await h.settle();
    assert.equal(reads,0);assert.equal(h.calls.captures,0);assert.equal(h.dialog.open,false);
    assert.equal(h.calls.applied.length,0);assert.match(h.calls.messages[0].message,/6 MB/);
    h.get('open-json-import').click();h.select(selectedFile(JSON.stringify(h.current)));await h.settle();
    assert.equal(h.dialog.open,true);assert.equal(h.calls.captures,1);
  }finally{h.close();}
});

test('an import is discarded if the active case or simulation changes during capture or file reading',async()=>{
  for(const stage of ['capture','read'])for(const changed of ['case','simulation']){
    const pending=deferred();let reads=0;
    const h=harness(stage==='capture'?{capture:()=>pending.promise}:{});
    try{
      h.get('import-setup-json').click();
      h.select(selectedFile(JSON.stringify(h.current),{read:()=>{reads++;return stage==='read'?pending.promise:Promise.resolve(JSON.stringify(h.current));}}));
      await h.settle();
      if(changed==='case')h.state.activeCase={id:'case-2'};else h.state.activeSimulationId='simulation-2';
      pending.resolve(stage==='capture'?copy(h.current):JSON.stringify(h.current));await h.settle();
      assert.equal(h.dialog.open,false,stage+' '+changed);assert.equal(h.get('configuration-draft').value,'');
      assert.equal(h.calls.applied.length,0);assert.deepEqual(h.calls.messages,[]);
      assert.equal(reads,stage==='capture'?0:1);
    }finally{h.close();}
  }
});

test('a late file read cannot replace a newer editor draft or surface an obsolete read error',async()=>{
  for(const failure of [false,true]){
    const pending=deferred(),h=harness();
    try{
      h.get('open-json-import').click();h.select(selectedFile('old file',{read:()=>pending.promise}));await h.settle();
      h.get('edit-setup-json').click();await h.settle();
      assert.equal(h.dialog.open,true);h.get('configuration-draft').value='new unsaved draft';
      if(failure)pending.reject(new Error('Old read failed'));else pending.resolve('old file');
      await h.settle();
      assert.equal(h.get('configuration-draft').value,'new unsaved draft');assert.equal(h.get('configuration-filename').hidden,true);
      assert.equal(h.dialog.open,true);assert.deepEqual(h.calls.messages,[]);assert.equal(h.calls.applied.length,0);
    }finally{h.close();}
  }
});

test('changing the active simulation after the editor opens prevents application',async()=>{
  const h=harness();
  try{
    h.get('edit-setup-json').click();await h.settle();h.state.activeSimulationId='simulation-2';
    h.get('configuration-apply').click();
    assert.equal(h.calls.applied.length,0);assert.equal(h.dialog.open,true);
    assert.match(h.get('configuration-error').textContent,/active simulation changed/i);
  }finally{h.close();}
});

test('an explicit draft shows physical review before applying, preserves unknown inputs and cannot run',async()=>{
  const h=harness();
  try{
    const incoming=draftConfiguration(),original=copy(incoming),before=copy(h.current);
    h.get('import-setup-json').click();h.select(selectedFile(JSON.stringify(incoming)));await h.settle();
    assert.equal(h.dialog.open,true);assert.equal(h.calls.applied.length,0);
    assert.match(h.get('configuration-error').textContent,/Draft configuration.*physical review required before simulation/);
    assert.match(h.get('configuration-error').textContent,/Conveyor ETI - FIL/);
    assert.match(h.get('configuration-error').textContent,/conveyorSpeedMmPerSecond/);
    h.get('configuration-apply').click();
    assert.equal(h.calls.applied.length,1);assert.equal(h.dialog.open,false);
    const applied=h.calls.applied[0];
    assert.deepEqual(applied.equipment,original.simulation.equipment);
    assert.equal(applied.physicalReview.status,'REQUIRES_REVIEW');
    assert.ok(applied.physicalReview.issues.every(issue=>issue.equipmentId==='c0'&&issue.equipmentName==='Conveyor ETI - FIL'));
    assert.equal(applied.equipment[1].processData.sourceEvidence.speedFactor,null);
    const attempted=simulateLine({case:{equipment:applied.equipment},run:applied.dynamicConfig});
    assert.equal(attempted.ok,false);assert.equal(attempted.error.code,'INVALID_SIMULATION_INPUT');
    assert.deepEqual(h.current,before);assert.deepEqual(incoming,original);
    assert.deepEqual(h.calls.validationErrors,[]);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('draft imports are complete run snapshots and do not inherit runtime targets, products or calendars',()=>{
  const h=harness();
  try{
    Object.assign(h.current.simulation.dynamicConfig,{
      effectiveRuntimeTargetSeconds:100000,productCatalog:[{id:'old-format'}],initialProductId:'old-format',initialFormatId:'old-format',
      commands:[{equipmentId:'removed-equipment',atVirtualSecond:1,action:'STOP'}],
      plannedStops:[{category:'changeoverMinutes',targetFormatId:'old-format'}],
      plantCalendar:{enabled:true,mode:'SCHEDULED'},eventsEnabled:true
    });
    const incoming=draftConfiguration();delete incoming.simulation.dynamicConfig.commands;
    const before=copy(h.current),applied=h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current);
    assert.deepEqual(copy(applied.dynamicConfig),incoming.simulation.dynamicConfig);
    for(const key of ['effectiveRuntimeTargetSeconds','productCatalog','initialProductId','initialFormatId','commands','plannedStops','plantCalendar','eventsEnabled'])
      assert.equal(Object.hasOwn(applied.dynamicConfig,key),false,key);
    assert.deepEqual(h.current,before);
    delete incoming.simulation.dynamicConfig;
    assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current),/complete dynamicConfig/);
    incoming.simulation.dynamicConfig={};
    assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current),/tickSeconds/);
  }finally{h.close();}
});

test('ordinary and explicitly validated imports retain strict physics; draft mode requires the canonical schema',()=>{
  const h=harness();
  try{
    for(const mode of [undefined,'VALIDATED']){
      const incoming=draftConfiguration();if(mode)incoming.importMode=mode;else delete incoming.importMode;
      assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current),/conveyorSpeedMmPerSecond/);
    }
    for(const mode of ['draft','SKIP_VALIDATION',null,0]){
      const incoming=draftConfiguration();incoming.importMode=mode;
      assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current),/importMode/);
    }
    const bare={...draftConfiguration().simulation,importMode:'DRAFT'};
    assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(bare),h.current),/importMode/);
    const documented=draftConfiguration();documented.schema='st-documented-case-transcription-v1';
    assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(documented),h.current),/Unsupported configuration schema/);
  }finally{h.close();}
});

test('drafts preserve inconsistent measured geometry for review instead of adjusting sensors or lengths',()=>{
  const h=harness();
  try{
    const incoming=configuration();incoming.importMode='DRAFT';
    incoming.simulation.equipment.forEach(e=>{e.processData??={};});
    incoming.simulation.equipment[0].nominalRatePerSecond=145/60;
    const conveyor=incoming.simulation.equipment[1];conveyor.name='Conveyor FIL-EMP';
    conveyor.processData.geometry={lactMm:2000,lpPrimeMm:1999};
    conveyor.processData.upstream={packageLengthMm:130,dischargePitchMm:150};
    conveyor.processData.downstream={infeedPitchMm:125};
    conveyor.processData.speedAndSensors={conveyorSpeedFactorVsDischargeVelocityPercent:0,conveyorSpeedFactorVsPreviousConveyorPercent:1};
    conveyor.processData.accumulation={blockedTimeDelaySeconds:0.5,bottlesDischargedAtStop:6,insuranceFactorUnits:1};
    const original=copy(incoming.simulation.equipment),applied=h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current);
    assert.deepEqual(copy(applied.equipment),original);
    assert.equal(applied.physicalReview.issues.length,1);
    assert.equal(applied.physicalReview.issues[0].reason,'must be upstream of the Prime sensor');
    assert.equal(simulateLine({case:{equipment:applied.equipment},run:applied.dynamicConfig}).ok,false);
    delete incoming.simulation.equipment[1].processData.accumulation;
    const incomplete=h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current);
    assert.equal(incomplete.physicalReview.issues[0].path,'case.equipment[1].processData.accumulation');
    assert.equal(Object.hasOwn(incomplete.equipment[1].processData,'accumulation'),false);
  }finally{h.close();}
});

test('draft mode never defers structural, reliability, run, product or shared-case errors',()=>{
  const h=harness();
  try{
    const mutations=[
      ['duplicate IDs',d=>{d.simulation.equipment[1].id='m0';},/must be unique/],
      ['missing ID',d=>{delete d.simulation.equipment[0].id;},/\.id/],
      ['empty name',d=>{d.simulation.equipment[0].name='';},/name is required/],
      ['unsupported type',d=>{d.simulation.equipment[0].type='UNKNOWN';},/type is unsupported/],
      ['negative rate',d=>{d.simulation.equipment[0].nominalRatePerSecond=-1;},/nominalRatePerSecond/],
      ['invalid reliability',d=>{d.simulation.equipment[0].noiseProfile.reliability={mtbfMinutes:0,mttrMinutes:1};},/mtbfMinutes/],
      ['invalid split stops',d=>{d.simulation.equipment[0].processData.equipment={stopInputs:{minor:{mtbfMinutes:1,mttrMinutes:1}}};},/stopInputs.major/],
      ['wrong topology',d=>{d.simulation.equipment.push(copy(d.simulation.equipment[0]));d.simulation.equipment.at(-1).id='extra';},/must be followed by a CONVEYOR/],
      ['accumulation on machine',d=>{d.simulation.equipment[0].processData.accumulation={};},/belongs only on a CONVEYOR/],
      ['invalid run duration',d=>{d.simulation.dynamicConfig.durationSeconds=-1;},/durationSeconds/],
      ['invalid seed',d=>{d.simulation.dynamicConfig.seed=1.5;},/seed/],
      ['invalid rounds',d=>{d.simulation.dynamicConfig.rounds=0;},/rounds/],
      ['invalid run mode',d=>{d.simulation.dynamicConfig.durationMode='UNKNOWN';},/durationMode/],
      ['invalid product selection',d=>{d.simulation.dynamicConfig.initialProductId='missing';},/productCatalog/],
      ['invalid events',d=>{d.simulation.dynamicConfig.commands=[{equipmentId:'missing',atVirtualSecond:1,action:'STOP'}];},/commands/],
      ['shared unit mismatch',d=>{d.case.unitOfFlow='cases';},/unitOfFlow must match/],
      ['shared engine mismatch',d=>{d.simulation.engineConfig={different:true};},/engineConfig is shared/]
    ];
    for(const [label,mutate,pattern] of mutations){const incoming=draftConfiguration();mutate(incoming);assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current),pattern,label);}
  }finally{h.close();}
});

test('draft mode rejects malformed physical input objects and declared invalid numbers while preserving nulls',()=>{
  const h=harness();
  try{
    for(const group of ['geometry','upstream','downstream','speedAndSensors','equipment','accumulation'])for(const value of [[],false,'bad']){
      const incoming=draftConfiguration();incoming.simulation.equipment[1].processData[group]=value;
      assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current),/must be an object/,group+' '+JSON.stringify(value));
    }
    for(const [group,key] of [['geometry','lactMm'],['upstream','packageLengthMm'],['downstream','infeedPitchMm'],['speedAndSensors','blockedTimeDelaySeconds'],['accumulation','conveyorSpeedMmPerSecond'],['accumulation','upstreamStopResponseSeconds']])for(const value of [-1,'100',false]){
      const incoming=draftConfiguration();incoming.simulation.equipment[1].processData[group]??={};incoming.simulation.equipment[1].processData[group][key]=value;
      assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current),/non-negative number or null/,group+'.'+key);
    }
    for(const values of [{speedMode:'UNKNOWN'},{targetPopulationPercent:101},{targetOverspeedPercent:1001},{targetPopulationPercent:50,targetOverspeedPercent:5},{manualLbaMm:0}]){
      const incoming=draftConfiguration();Object.assign(incoming.simulation.equipment[1].processData.accumulation,values);
      assert.throws(()=>h.w.STConfigurationEditor.validate(JSON.stringify(incoming),h.current),/speedMode|targetPopulationPercent|targetOverspeedPercent|choose either|manualLbaMm/);
    }
  }finally{h.close();}
});

test('editing a draft refreshes its review notice and blocking errors remain in the same modal',async()=>{
  const h=harness();
  try{
    const incoming=draftConfiguration();
    h.get('open-json-import').click();h.select(selectedFile(JSON.stringify(incoming)));await h.settle();
    assert.match(h.get('configuration-error').textContent,/physical review required/);
    incoming.simulation.dynamicConfig.rounds=0;
    h.get('configuration-draft').value=JSON.stringify(incoming);h.get('configuration-draft').dispatchEvent(new h.w.Event('input'));
    assert.match(h.get('configuration-error').textContent,/rounds/);
    h.get('configuration-apply').click();assert.equal(h.calls.applied.length,0);assert.equal(h.dialog.open,true);
    incoming.simulation.dynamicConfig.rounds=1;
    incoming.simulation.equipment[1].processData.speedAndSensors.conveyorSpeedFactorVsDischargeVelocityPercent=900;
    incoming.simulation.equipment[1].processData.accumulation.conveyorSpeedFactorPercent=900;
    h.get('configuration-draft').value=JSON.stringify(incoming);h.get('configuration-draft').dispatchEvent(new h.w.Event('input'));
    assert.equal(h.get('configuration-error').textContent,'');
    h.get('configuration-apply').click();assert.equal(h.calls.applied.length,1);assert.equal(h.calls.applied[0].physicalReview,undefined);
  }finally{h.close();}
});

test('the physical review heading follows the current language without changing technical issue details',async()=>{
  const h=harness();let language='en';
  try{
    h.w.STLanguage={translate:text=>language==='es'&&text==='Draft configuration — physical review required before simulation.'?'Borrador de configuración — requiere revisión física antes de simular.':text};
    h.get('open-json-import').click();h.select(selectedFile(JSON.stringify(draftConfiguration())));await h.settle();
    const technical=h.get('configuration-error').textContent.split('\n').slice(1);
    assert.match(h.get('configuration-error').textContent,/^Draft configuration/);
    language='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
    assert.match(h.get('configuration-error').textContent,/^Borrador de configuración/);
    assert.deepEqual(h.get('configuration-error').textContent.split('\n').slice(1),technical);
    assert.equal(h.dialog.open,true);assert.equal(h.calls.applied.length,0);
  }finally{h.close();}
});
