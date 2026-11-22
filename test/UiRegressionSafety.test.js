import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  assert.match(equipment,/if\(!cards\.length&&\(state\.activeCase\.equipment\?\.length\|\|0\)>0\)/);
  assert.match(equipment,/EQUIPMENT_EDITOR_NOT_RENDERED/);
  assert.match(basic,/var expectedParent=separate\?layout:listHome/);
  assert.match(basic,/separate===splitMounted&&list\.parentNode===expectedParent/);
  assert.match(cases,/if\(state\.activeCase\.equipment\?\.length&&!document\.querySelector\('#equipment-list \.equipment-card'\)\)renderEquipment\(\)/);
  assert.match(core,/if\(view==='editor'&&\(state\.activeCase\.equipment\?\.length\|\|0\)>0&&!document\.querySelector\('#equipment-list \.equipment-card'\)\)renderEquipment\(\)/);
  const simulation=read('apps-script/ClientSimulation.html');
  assert.match(simulation,/var isActiveSnapshot=state\.activeCase\.activeSimulationId/);
  assert.match(simulation,/state\.activeCase\.simulations\?\.\[0\]\?\.id===simulation\.id/);
  assert.match(simulation,/var useMirror=initial&&isActiveSnapshot&&stored\.length===0/);
});
