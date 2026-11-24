import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {normalizeFormatCatalog,productVolumeUnits} from '../src/simulation/FormatCatalog.js';

function setup({importVersion='sheet-import-20261123-8',informational=false,rememberedTab=null,uiMode='basic'}={}){
 const dom=new JSDOM(`<button id="open-sheet-import"></button><dialog id="sheet-import-dialog"><div class="dialog-body"><form id="sheet-import-form"><input id="sheet-import-url"><input id="sheet-import-tab"><button id="sheet-import-read"></button></form><p id="sheet-import-error"></p><div id="sheet-import-preview"></div></div><footer class="dialog-actions"><input type="checkbox" id="sheet-import-ack"><button id="sheet-import-apply"></button><button id="sheet-import-close"></button><button id="sheet-import-cancel"></button></footer></dialog>`,{runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(fs.readFileSync('apps-script/TextResources.gs','utf8'));w.__ST_TEXT__=key=>w.ST_TEXT_RESOURCES[key]||key;
 for(const file of ['Icons.html','Subsection.html','SheetImportMerge.html','SheetImport.html'])w.eval(fs.readFileSync('apps-script/'+file,'utf8').replace(/<\/?script>/g,''));
 const units=Array.from({length:4},(_,i)=>({id:'sheet-row-'+(10+i),name:'Machine '+i,type:'CUSTOM',nominalRatePerSecond:2,initialMode:'AUTO',characteristics:{sourceSheetRow:10+i},noiseProfile:{},processData:{role:'MACHINE',equipment:{maximumSpeedBpm:120}}}));
 const preview={equipment:units,source:{sheetName:'Test',spreadsheetId:'test',sheetId:0},sourceRows:units.map((u,i)=>({row:10+i,values:{}})),metadata:{},notes:[],errors:[{cell:'D12:E12',message:'Invalid reliability values.'}],warnings:[{cell:'F11',message:'Confirm the speed unit.'}]};
 if(informational){preview.errors=[];preview.warnings=[{cell:'D10:E10',severity:'info',code:'NO_RELIABILITY_DATA',message:'Random failures disabled.'},{cell:'F10',severity:'info',code:'INHERITED_CONVEYOR_RATE',message:'Using upstream machine rate.'}];}
 let modelReview=!informational;
 w.SimulatorEngine={normalizeFormatCatalog,productVolumeUnits,validateSimulationInput(input){const index=input.case.equipment.findIndex(e=>e.name==='Machine 3');return modelReview&&index>=0?{ok:false,error:{details:[{path:'case.equipment['+index+'].nominalRatePerSecond',reason:'Check installed speed.'}]}}:{ok:true};}};
 w.STSheetCorrections={render(){}};w.STDialog={beginActivity(){return ()=>{};}};w.STErrors={capture(){}};
 w.google={script:{run:{withFailureHandler(){return this;},withSuccessHandler(fn){this.success=fn;return this;},previewSheetImport(request){this.lastRequest=request;this.success({ok:true,data:preview,importVersion});}}}};
 w.document.documentElement.dataset.uiMode=uiMode;
 const state={activeCase:{id:'test'},activeSimulationId:'sim',requestEpoch:1},snapshot={equipment:[],sourceImport:rememberedTab?{source:{spreadsheetId:'previous-book',sheetName:rememberedTab}}:{}};
 w.STSheetImport(state,{capture:()=>snapshot,apply:()=>true}).init();w.document.getElementById('open-sheet-import').click();w.document.getElementById('sheet-import-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 return {dom,w,d:w.document,preview,setModelReview(value){modelReview=value;}};
}

test('import dialog groups spreadsheet, equipment, formats and details with the shared subsection',()=>{
 const h=setup();
 try{
  const names=['sheet-import-spreadsheet-section','sheet-import-equipment-section',
    'sheet-import-format-section','sheet-import-details-section'];
  assert.deepEqual(names.map(id=>h.d.getElementById(id)?.querySelector(':scope > summary .subsection-native-title')?.textContent),
    ['Spreadsheet','Equipment','Format','Import details']);
  for(const id of names)assert(h.d.getElementById(id)?.classList.contains('st-subsection'),id);
  assert(h.d.getElementById('sheet-import-spreadsheet-section').contains(h.d.getElementById('sheet-import-form')));
  assert.equal(h.d.querySelectorAll('#sheet-import-spreadsheet-section > summary .subsection-description').length,1,
    'Spreadsheet heading must contain exactly one descriptive note');
  assert.equal(h.d.querySelectorAll('#sheet-import-spreadsheet-section > .fold-content > .subsection-description').length,0,
    'The source instruction must not be duplicated inside the section body');
  assert(h.d.getElementById('sheet-import-equipment-section').contains(h.d.querySelector('.sheet-equipment-choice')));
  assert(h.d.getElementById('sheet-import-details-section').contains(h.d.getElementById('sheet-import-model-review')));
  assert.equal(h.d.getElementById('sheet-import-summary'),null,'No long status note in the footer');
  const icons=[...h.d.querySelectorAll('.sheet-import-row-status')];
  assert.equal(icons.length,4);
  assert(icons[0].querySelector('svg.icon'));
  const css=fs.readFileSync('apps-script/SheetImportStyles.html','utf8');
  assert.match(css,/width:30px; height:30px/);
  assert.match(css,/stroke-width:2\.9/);
  assert.match(css,/\.sheet-equipment-choice > summary\s*\{[^}]*display:flex;align-items:center;/);
  assert.match(css,/\.sheet-equipment-summary-text\s*\{[^}]*align-items:center;align-self:center;/);
  assert.match(css,/\.sheet-import-row-status\s*\{[^}]*position:static;/);
  assert.match(css,/\.sheet-equipment-choice\[open\] > summary::before/);
 }finally{h.dom.window.close();}
});

test('dedicated Products & Formats catalog hides obsolete E1:E3 case fields',()=>{
 const h=setup();
 try{
  h.preview.source.metadataCells=['B1','B2','E1','E2','E3','B3','B4'];
  h.preview.materialCatalog={catalog:{version:3,products:[],formats:[]},errors:[]};
  h.preview.metadata={site:'Plant A',packagingLine:'Line H',formatName:'Obsolete',
    containerSize:'500 mL',bottlesPerCase:12,dateOfAnalysis:'2026-11-24',by:'Technician'};
  h.d.getElementById('sheet-import-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
  const labels=[...h.d.querySelectorAll('#sheet-import-case-meta td')].map(x=>x.textContent);
  for(const text of ['B1 · Site','B2 · Packaging line','B3 · Date of analysis','B4 · By'])assert(labels.some(s=>s.includes(text)),text);
  for(const legacy of ['E1 ·','E2 ·','E3 ·'])assert(!labels.some(s=>s.includes(legacy)),legacy);
  assert.equal(h.d.querySelectorAll('#sheet-import-case-meta tbody tr').length,4);
 }finally{h.dom.window.close();}
});

test('Format puts the catalog import checkbox in its toolbar and records directly in its content',()=>{
 const h=setup();try{
  h.preview.materialCatalog={catalog:{version:3,
    products:[{id:'water',name:'Multipurpose cleaner'}],
    formats:[{id:'box',name:'500 mL · 12 bottles per case',productId:'water',bottlesPerCase:12}]},
    errors:[]};
  h.d.getElementById('sheet-import-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
  const format=h.d.getElementById('sheet-import-format-section');
  const toolbar=format.querySelector(':scope > summary > .fold-tools');
  const input=toolbar.querySelector('#sheet-packing-enabled');
  assert(input,'The existing catalog toggle must be a toolbar control');
  assert(input.checked);
  assert.equal(format.querySelectorAll('#sheet-packing-enabled').length,1);
  const list=format.querySelector(':scope > .fold-content > .sheet-import-catalog-list');
  assert(list,'Records must be direct children of the Format content');
  assert.equal(list.children.length,2);
  assert.match(list.textContent,/Multipurpose cleaner/);
  assert.match(list.textContent,/500 mL · 12 bottles per case/);
  assert.equal(format.querySelectorAll('details > summary').length,0,'Do not nest another catalog disclosure');
  input.click();
  assert.equal(input.checked,false);
  assert(h.d.getElementById('sheet-import-apply').disabled || input.checked===false);
 }finally{h.dom.window.close();}
});

test('The Format toolbar toggle also controls the editable packing proposal',()=>{
 const h=setup();try{
  const format=h.d.getElementById('sheet-import-format-section');
  const toggle=format.querySelector(':scope > summary > .fold-tools #sheet-packing-enabled');
  const fields=h.d.getElementById('sheet-packing-fields');
  assert(toggle && fields);
  assert.equal(fields.disabled,!toggle.checked);
  toggle.click();
  assert.equal(fields.disabled,!toggle.checked);
  assert.equal(format.querySelectorAll('#sheet-packing-enabled').length,1);
 }finally{h.dom.window.close();}
});

test('Sheet import request includes mode and both contract versions',()=>{
 for(const mode of ['basic','advance']){
   const h=setup({uiMode:mode});
   try{
     const args=h.w.google.script.run.lastRequest;
     assert.equal(args.uiMode,mode==='basic'?'BASIC':'ADVANCE');
     assert.equal(args.clientImportVersion,'sheet-import-20261123-8');
     assert.equal(args.sheetTemplateVersion,'sheet-template-20261124-1');
   }finally{h.dom.window.close();}
 }
});

test('import cards show accessible right-edge success, warning and error indicators, including skipped rows',()=>{
 const h=setup();try{
  const cards=[...h.d.querySelectorAll('.sheet-equipment-choice')];assert.equal(cards.length,4);
  assert.deepEqual(cards.map(c=>c.dataset.importStatus),['ok','warning','error','warning']);
  assert.match(cards[0].querySelector('.sheet-import-row-status').getAttribute('aria-label'),/No issues detected/);
  assert(cards[0].querySelector('.sheet-equipment-issues').hidden);
  assert.match(cards[1].querySelector('.sheet-import-row-status').title,/F11.*speed unit/);
  assert.match(cards[2].querySelector('summary').textContent,/Skipped/);
  assert.match(cards[2].querySelector('.sheet-equipment-issues').textContent,/D12:E12.*Invalid reliability/);
  assert.match(cards[3].querySelector('.sheet-equipment-issues').textContent,/Model review.*Check installed speed/);
  for(const card of cards){const icon=card.querySelector('summary [role=img]');assert(icon.querySelector('svg'));assert.equal(icon.getAttribute('aria-describedby'),card.querySelector('.sheet-equipment-issues').id);}
 }finally{h.dom.window.close();}
});

test('machine destination and type selects share a responsive row',()=>{
 const h=setup();try{
  const card=h.d.querySelector('.sheet-equipment-choice');
  const row=card.querySelector(':scope > .sheet-equipment-mapping-row');
  assert(row);
  const controls=[...row.querySelectorAll(':scope > .sheet-equipment-mapping-field > select')];
  assert.equal(controls.length,2);
  assert(controls[0].classList.contains('sheet-target'));
  assert(controls[1].classList.contains('sheet-machine-type'));
  assert.equal(row.querySelectorAll('.sheet-equipment-target-reason').length,0);
  const reason=card.querySelector(':scope > .sheet-equipment-target-reason');
  assert.equal(reason,null,'A new equipment destination does not need a repeated placement note');
  assert.equal(controls[0].getAttribute('aria-describedby'),null);
  assert.equal(controls[0].value,'new');
  assert.equal(controls[1].value,'CUSTOM');
  const styles=fs.readFileSync('apps-script/SheetImportStyles.html','utf8');
  assert.match(styles,/\.sheet-equipment-mapping-row\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles,/@media\(max-width:650px\)[\s\S]*\.sheet-equipment-mapping-row\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);
 }finally{h.dom.window.close();}
});

test('new equipment hints stay hidden after changing the destination, but errors remain explained',()=>{
 const h=setup();try{
  const first=h.d.querySelector('.sheet-equipment-choice');
  assert.equal(first.querySelector(':scope > .sheet-equipment-target-reason'),null);
  const select=first.querySelector('.sheet-target');
  select.value='skip';select.onchange();
  const skipped=h.d.querySelector('.sheet-equipment-choice');
  assert.equal(skipped.querySelector(':scope > .sheet-equipment-target-reason'),null,
    'The previous new-equipment reason must not reappear when the target changes');
  h.preview.errors=[{cell:'D10',message:'Invalid MTBF for this row'}];
  h.d.getElementById('sheet-import-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
  const invalid=h.d.querySelector('.sheet-equipment-choice');
  const note=invalid.querySelector(':scope > .sheet-equipment-target-reason');
  assert(note,'Actionable row diagnostics must remain visible');
  assert.match(note.textContent,/Invalid MTBF/);
  assert.equal(invalid.querySelector('.sheet-target').getAttribute('aria-describedby'),note.id);
 }finally{h.dom.window.close();}
});

test('conveyor destination occupies the full row without a machine-type select',()=>{
 const h=setup();try{
  h.preview.equipment[0].type='CONVEYOR';
  h.preview.equipment[0].processData.role='CONVEYOR';
  h.d.getElementById('sheet-import-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
  const card=h.d.querySelector('.sheet-equipment-choice');
  const row=card.querySelector(':scope > .sheet-equipment-mapping-row');
  assert(row);
  assert.equal(row.querySelectorAll('select').length,1);
  assert.equal(row.querySelectorAll('.sheet-machine-type').length,0);
  const label=row.querySelector('.sheet-equipment-mapping-field');
  assert(label);
  const styles=fs.readFileSync('apps-script/SheetImportStyles.html','utf8');
  assert.match(styles,/\.sheet-equipment-mapping-field:only-child\s*\{\s*grid-column:1\s*\/\s*-1/);
 }finally{h.dom.window.close();}
});

test('import indicators refresh when selection or target changes without losing source warnings',()=>{
 const h=setup();try{
  h.setModelReview(false);h.d.getElementById('sheet-import-ack').click();assert.equal(h.d.querySelector('[data-source-index="3"]').dataset.importStatus,'ok');
  const select=h.d.querySelector('[data-source-index="1"] .sheet-target');select.value='skip';select.onchange();
  const card=h.d.querySelector('[data-source-index="1"]');assert.equal(card.dataset.importStatus,'warning');assert.match(card.querySelector('.sheet-equipment-issues').textContent,/Confirm the speed unit/);assert(card.open);
 }finally{h.dom.window.close();}
});


test('physical review and card issue list show the same expected Sheet cell',()=>{
 const h=setup();try{
  assert.match(h.d.getElementById('sheet-import-model-review').textContent,/F13/);
  assert.match(h.d.querySelector('[data-source-index="3"] .sheet-equipment-issues').textContent,/F13/);
  assert.match(h.d.querySelector('[data-source-index="3"] .sheet-import-row-status').title,/F13/);
 }finally{h.dom.window.close();}
});

test('normal conveyor notes use an information icon instead of a warning',()=>{
 const h=setup({informational:true});try{
  const row=h.d.querySelector('[data-source-index="0"]');assert.equal(row.dataset.importStatus,'info');assert.match(row.querySelector('.sheet-import-row-status').getAttribute('aria-label'),/no action required/);assert.match(row.querySelector('.sheet-equipment-issues').textContent,/Info · D10:E10/);assert(!row.querySelector('.sheet-equipment-issues').textContent.includes('Warning ·'));
  const details=h.d.getElementById('sheet-import-details-section');
  const notes=details.querySelector(':scope > .fold-content > .sheet-import-source-notes');
  assert(notes,'Informational notes must appear directly in Import details');
  assert.match(notes.textContent,/Random failures disabled/);
  assert.match(notes.textContent,/Using upstream machine rate/);
  assert(![...details.querySelectorAll('details > summary')].some(summary=>summary.textContent==='Source information'),
    'No nested Source information disclosure should remain');
 }finally{h.dom.window.close();}
});
test('a mixed deployment stops before previewing or applying equipment',()=>{
 const h=setup({importVersion:'sheet-import-20260917-2'});try{
  assert.match(h.d.getElementById('sheet-import-error').textContent,/Import versions differ/);assert(h.d.getElementById('sheet-import-apply').disabled);assert.equal(h.d.querySelectorAll('.sheet-equipment-choice').length,0);
 }finally{h.dom.window.close();}
});

test('a remembered worksheet cannot override a newly pasted URL gid, but an explicit worksheet can',()=>{
 const h=setup({rememberedTab:'Previous tab'});try{
  const url=h.d.getElementById('sheet-import-url'),tab=h.d.getElementById('sheet-import-tab');assert.equal(tab.value,'Previous tab');
  url.value='https://docs.google.com/spreadsheets/d/new-book/edit#gid=123';url.dispatchEvent(new h.w.Event('input'));assert.equal(tab.value,'');h.d.getElementById('sheet-import-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));assert.equal(h.w.google.script.run.lastRequest.sheetName,'');
  h.d.getElementById('open-sheet-import').click();tab.value='Explicit tab';tab.dispatchEvent(new h.w.Event('input'));url.value='new-book';url.dispatchEvent(new h.w.Event('input'));assert.equal(tab.value,'Explicit tab');h.d.getElementById('sheet-import-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));assert.equal(h.w.google.script.run.lastRequest.sheetName,'Explicit tab');
 }finally{h.dom.window.close();}
});

test('Apply explains when review is checked but no import changes are selected',()=>{
 const h=setup();try{
  [...h.d.querySelectorAll('#sheet-import-preview button')].find(button=>button.textContent==='Deselect all fields').click();h.d.getElementById('sheet-import-ack').click();assert(h.d.getElementById('sheet-import-ack').checked);assert(h.d.getElementById('sheet-import-apply').disabled);assert.match(h.d.getElementById('sheet-import-readiness-text').textContent,/No changes selected/);assert(h.d.getElementById('sheet-import-review-pending').hidden);
  h.d.getElementById('sheet-import-cancel').click();assert.equal(h.d.getElementById('sheet-import-readiness'),null);
 }finally{h.dom.window.close();}
});

