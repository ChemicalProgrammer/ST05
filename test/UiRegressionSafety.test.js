import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const read=(file)=>fs.readFileSync(file,'utf8');

test('V-Graph shows two accessible series swatches, not the old Settings section',()=>{
  const web=read('apps-script/WebApp.html');
  const start=web.indexOf('<div class="vgraph-legend"');
  assert.ok(start>=0,'V-Graph legend exists');
  const legend=web.slice(start,web.indexOf('</div>',start)+6).replace(/<\?[\s\S]*?\?>/g,'Series');
  const dom=new JSDOM('<!doctype html><html><body>'+legend+'</body></html>');
  try{
    const buttons=[...dom.window.document.querySelectorAll('.vgraph-color-trigger')];
    assert.equal(buttons.length,2);
    assert.deepEqual(buttons.map(b=>b.dataset.vgraphSeries),['current','recommended']);
    const vgraph=web.slice(web.indexOf('id="vgraph-profile"'),web.indexOf('id="vgraph-plot"'));
    assert.match(vgraph,/class="fold-tools vgraph-toolbar"[^>]*role="toolbar"/);
    assert.ok(vgraph.indexOf('class="vgraph-legend"')<vgraph.indexOf('id="vgraph-content"'),
      'V-Graph legend must be in the heading toolbar, not the chart body');
    for(const button of buttons){
      assert.equal(button.type,'button');
      assert.equal(button.getAttribute('aria-haspopup'),'dialog');
      assert.equal(button.getAttribute('aria-controls'),'series-color-dialog');
      assert.match(button.getAttribute('aria-label'),/Change/);
    }
    assert.doesNotMatch(web,/id="settings-vgraph-section"/);
    assert.doesNotMatch(web,/id="settings-vgraph-colors"/);
    assert.doesNotMatch(web,/id="settings-vgraph-reset"/);
    assert.match(web,/id="series-color-default"/);
  }finally{dom.window.close();}
});

test('V-Graph swatches share live graph colors and save by case with existing dialog',()=>{
  const css=read('apps-script/AnalysisStyles.html');
  const settings=read('apps-script/Settings.html');
  assert.match(css,/\.vgraph-color-trigger-current\s*\{\s*background:var\(--vgraph-current\)/);
  assert.match(css,/\.vgraph-color-trigger-recommended\s*\{\s*background:var\(--vgraph-recommended\)/);
  assert.match(css,/\.vgraph-normal\s*\{\s*stroke:\s*var\(--vgraph-current\)/);
  assert.match(css,/\.vgraph-recommended\s*\{\s*stroke:\s*var\(--vgraph-recommended\)/);
  assert.match(settings,/el\('vgraph-profile'\)\.addEventListener\('click'/);
  assert.match(settings,/openSeriesColor\('--vgraph-'\+series,series,/);
  assert.match(settings,/colorTarget=\{caseId:record\.id,key:key,kind:kind\}/);
  assert.match(settings,/record\.metadata\[kind\]\[colorTarget\.key\]=el\('series-color-hex'\)\.value\.toUpperCase\(\)/);
  assert.match(settings,/caseChanged\?\.\(\)/);
  assert.match(settings,/metadata\?\.vgraphColors/);
  assert.match(settings,/el\('series-color-default'\)\.onclick=/);
  assert.match(settings,/delete colors\[key\]/);
  assert.doesNotMatch(settings,/el\('settings-vgraph-section'\)/);
  assert.doesNotMatch(settings,/el\('settings-vgraph-reset'\)/);
});

test('Opening and closing Settings preserves a saved case name',()=>{
  const settings=read('apps-script/Settings.html');
  const cases=read('apps-script/ClientCases.html');
  const equipment=read('apps-script/ClientEquipment.html');
  assert.match(settings,/settingsCaseNameOnOpen=record\?\.name\|\|''/);
  assert.match(settings,/el\('case-name'\)\.value=settingsCaseNameOnOpen/);
  assert.match(settings,/nameInput\.value=record\.name\?\.trim\(\)\?record\.name:settingsCaseNameOnOpen/);
  assert.match(cases,/document\.getElementById\('case-name'\)\.value=state\.activeCase\.name\|\|''/);
  assert.match(equipment,/if\(!nameField\.value\.trim\(\)&&state\.activeCase\.name\?\.trim\(\)\)nameField\.value=state\.activeCase\.name/);
  assert.match(equipment,/if\(!nameField\.value\.trim\(\)\)return null/);
});

test('Saved machine/conveyor cards are mounted before shell sync and protected against empty DOM',()=>{
  const equipment=read('apps-script/ClientEquipment.html');
  const cases=read('apps-script/ClientCases.html');
  const basic=read('apps-script/BasicMode.html');
  const core=read('apps-script/ClientCore.html');
  const editor=equipment.slice(equipment.indexOf('function renderEditor()'),equipment.indexOf('function renderEditorMeta()'));
  assert.ok(editor.indexOf('renderEquipment()')>=0&&editor.indexOf('renderEquipment()')<editor.indexOf('renderEditorMeta()'));
  assert.match(equipment,/if\(!cards\.length&&savedCount>0\)return true/);
  assert.match(equipment,/EQUIPMENT_EDITOR_INCOMPLETE/);
  assert.match(basic,/var expectedParent=separate\?layout:listHome/);
  assert.match(basic,/separate===splitMounted&&list\.parentNode===expectedParent/);
  assert.match(cases,/if\(state\.activeCase\.equipment\?\.length&&!document\.querySelector\('#equipment-list \.equipment-card'\)\)renderEquipment\(\)/);
  assert.match(core,/if\(view==='editor'&&\(state\.activeCase\.equipment\?\.length\|\|0\)>0&&!document\.querySelector\('#equipment-list \.equipment-card'\)\)renderEquipment\(\)/);
  const simulation=read('apps-script/ClientSimulation.html');
  assert.match(simulation,/var isActiveSnapshot=state\.activeCase\.activeSimulationId/);
  assert.match(simulation,/state\.activeCase\.simulations\?\.\[0\]\?\.id===simulation\.id/);
  assert.match(simulation,/var useMirror=initial&&isActiveSnapshot&&stored\.length===0/);
});

test('Simulation and save use committed machine/conveyor data when editor is not mounted',()=>{
  const source=read('apps-script/ClientEquipment.html');
  const model=[
    {id:'filler-01',type:'FILLER',name:'Filler 01',nominalRatePerSecond:4},
    {id:'conveyor-01',type:'CONVEYOR',name:'Conveyor 01',nominalRatePerSecond:4}
  ];
  const context={
    state:{activeCase:{name:'Demo line',equipment:structuredClone(model)}},
    document:{querySelectorAll(selector){
      assert.equal(selector,'#equipment-list .equipment-card');
      return [];
    }},
    cloneJson:value=>JSON.parse(JSON.stringify(value)),
    showError:()=>assert.fail('Hidden editor should not create an application error'),
    STProducts:{reconcile:()=>assert.fail('No editor controls were changed')},
    renderRawJson:()=>assert.fail('No editor controls were changed')
  };
  vm.createContext(context);
  const previewStart=source.indexOf('function basicEquipmentPreview()');
  const previewEnd=source.indexOf('function refreshDesignGraph()',previewStart);
  const syncStart=source.indexOf('function syncEquipmentFromEditor()');
  const syncEnd=source.indexOf('function parseJsonObject(',syncStart);
  assert.ok(previewStart>=0&&previewEnd>previewStart&&syncStart>=0&&syncEnd>syncStart);
  vm.runInContext(source.slice(previewStart,previewEnd)+'\n'+source.slice(syncStart,syncEnd),context);
  assert.equal(context.syncEquipmentFromEditor(),true,'A hidden editor does not block simulation or save');
  assert.deepEqual(context.state.activeCase.equipment,model,'The committed equipment is preserved');
  const preview=context.basicEquipmentPreview();
  assert.deepEqual(JSON.parse(JSON.stringify(preview)),model,'Numerical previews read the model');
  preview.pop();
  assert.equal(context.state.activeCase.equipment.length,2,'Preview changes never mutate the model');
});

test('A partially rendered editor cannot silently drop machines or conveyors',()=>{
  const source=read('apps-script/ClientEquipment.html');
  const start=source.indexOf('function syncEquipmentFromEditor()');
  const end=source.indexOf('function parseJsonObject(',start);
  let failure;
  const original=[
    {id:'filler-01',type:'FILLER',name:'Filler 01'},
    {id:'conveyor-01',type:'CONVEYOR',name:'Conveyor 01'}
  ];
  const context={
    state:{activeCase:{equipment:structuredClone(original)}},
    document:{querySelectorAll:()=>[{}]},
    showError:err=>{failure=err;}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  assert.equal(context.syncEquipmentFromEditor(),false);
  assert.equal(failure.code,'EQUIPMENT_EDITOR_INCOMPLETE');
  assert.deepEqual(context.state.activeCase.equipment,original);
});

test('The global error button is solid red and announces the error count',()=>{
  const css=read('apps-script/ComponentStyles.html');
  const web=read('apps-script/WebApp.html');
  const dialogs=read('apps-script/Dialogs.html');
  assert.match(css,/#header-errors:not\(\.hidden\) #header-error-button \{/);
  assert.match(css,/background:var\(--danger\)!important;color:#fff!important/);
  assert.match(css,/#header-errors:not\(\.hidden\)::after \{[\s\S]*?content:attr\(data-count\)/);
  assert.match(web,/id="header-error-button"/);
  assert.match(dialogs,/button\.setAttribute\('aria-label',label\)/);
  assert.match(dialogs,/header\.dataset\.count=String\(count\)/);
});

test('Equipment-performance status badge is right aligned for machines and conveyors',()=>{
  const playback=read('apps-script/ClientPlayback.html');
  const css=read('apps-script/UiStandards.html');
  const markup=playback.slice(playback.indexOf("heading.className='live-equipment-heading'"),playback.indexOf("// A conveyor's PASS / FAIL action",playback.indexOf("heading.className='live-equipment-heading'")));
  assert.match(markup,/heading\.append\(symbol,cardToggle\)/);
  assert.match(markup,/visualHeader\.append\(card\.querySelector\('\.live-state'\)\)/);
  assert.doesNotMatch(markup,/heading\.append\(card\.querySelector\('\.live-state'\)\)/);
  assert.match(css,/\.numeric-equipment-header > \.live-state \{[\s\S]*?grid-column:2;grid-row:1;justify-self:end/);
  assert.match(css,/\.numeric-equipment-header-details \{grid-column:1;grid-row:1/);
  assert.match(playback,/overviewSide\.append\(visualHeader,chartAside\)/);
  assert.match(playback,/visualHeader\.append\(controlDock\)/);
  assert.match(css,/\.numeric-equipment-header > \.numeric-equipment-control-dock \{[\s\S]*?flex-flow:row wrap!important/);
  assert.match(css,/#results-body > #results-history-group \{[\s\S]*?margin-block-start:var\(--subsection-gap\)!important/);
});

test('Elegant combobox highlights selected text and checkmark in white on the solid accent',()=>{
  const css=read('apps-script/ElegantStyles.html');
  assert.match(css,/select option:checked:not\(:disabled\)\s*\{\s*color:#fff!important; background:var\(--accent\)!important;/);
  assert.match(css,/option:checked:not\(:disabled\)::checkmark\s*\{\s*color:#fff!important;/);
  assert.match(css,/option:not\(:disabled\):not\(:checked\):is\(:hover,:focus\)/,
    'Unselected hover items retain their separate style');
});
