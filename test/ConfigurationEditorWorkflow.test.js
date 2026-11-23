import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';
import {validateSimulationInput} from '../src/simulation/SimulationValidation.js';
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
