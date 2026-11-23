import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync('apps-script/'+path,'utf8');

test('Equipment stores stable IDs internally but exposes no ID or initial-mode editor',()=>{
  const source=read('ClientEquipment.html');
  const a=source.indexOf('card.innerHTML = ('),b=source.indexOf('      var conveyorFields=',a);
  assert.ok(a>=0&&b>a);
  const html=new Function('__ST_HTML_TEXT__','var card={};'+source.slice(a,b)+'return card.innerHTML;')(key=>key);
  for(const field of ['equipment-id','equipment-mode','equipment-json-details','equipment-options-button']){
    assert.doesNotMatch(html,new RegExp('class="'+field+'"'),field+' is not a visible editor property');
  }
  assert.match(html,/class="equipment-stored-parameters" hidden/);
  assert.equal((html.match(/<textarea\b/g)||[]).length,3);
  for(const tag of ['label','select','textarea']){
    assert.equal((html.match(new RegExp('<'+tag+'(?=[ >])','g'))||[]).length,
      (html.match(new RegExp('</'+tag+'>','g'))||[]).length,tag+' tags must remain balanced');
  }
  assert.match(source,/id: card\.dataset\.equipmentId/);
  assert.match(source,/initialMode: 'AUTO'/);
  assert.doesNotMatch(source,/equipmentField\(card, '\.equipment-id'\)/);
  assert.doesNotMatch(source,/STEquipmentOptions/);
});

test('Critical machine is available for physical machines in Basic and Advance',()=>{
  const roles=read('EquipmentRoles.html'),css=read('BasicModeStyles.html');
  assert.match(roles,/equipment-critical-field/);
  assert.match(roles,/\['pacemaker','checkbox'/);
  assert.match(roles,/if\(spec\[0\]==='pacemaker'\)/);
  assert.match(css,/> \.equipment-pacemaker\)\)/);
  assert.doesNotMatch(css,/label:has\(> \.equipment-mode\)/);
});

test('Removed equipment-only dialogs, additional options and JSON examples have no application source',()=>{
  const web=read('WebApp.html'),inspector=read('EquipmentInspector.html');
  assert.ok(!fs.existsSync('apps-script/EquipmentOptions.html'));
  for(const text of ["include_('EquipmentOptions')",'json-help-dialog','json-help-code'])assert.ok(!web.includes(text),text);
  for(const text of ['showExample(', 'json-example','json-help-','equipment-id','equipment-mode'])
    assert.ok(!inspector.includes(text),text);
});

test('Case saving is exclusively manual and the JSON fields preference was removed',()=>{
  const web=read('WebApp.html'),preferences=read('UiPreferences.html'),
    cases=read('ClientCases.html'),settings=read('Settings.html');
  for(const id of ['settings-autosave','settings-autosave-seconds','settings-json-fields']){
    assert.ok(!web.includes('id="'+id+'"'));
    assert.ok(!settings.includes(id));
  }
  assert.ok(web.includes('id="save-case"'));
  assert.ok(!preferences.includes('applyJsonFields'));
  assert.ok(!preferences.includes('autosaveEnabled'));
  assert.ok(!preferences.includes('autosaveSeconds'));
  assert.match(cases,/function automaticSaving\(\)\{return false;\}/);
  assert.match(cases,/autosave\.configure\(\{enabled:false,intervalMs:10000\}\)/);
});

test('Real Data and Comparison are Advance-only in navigation and workspace tabs',()=>{
  const basic=read('BasicMode.html'),core=read('ClientCore.html'),
    simulation=read('ClientSimulation.html');
  assert.ok(basic.includes("nav.querySelector('[data-basic-view=realdata]').classList.toggle('hidden',enabled||"));
  assert.ok(basic.includes("nav.querySelector('[data-basic-view=comparison]').classList.toggle('hidden',enabled||"));
  assert.match(core,/view==='realdata'\|\|view==='comparison'/);
  assert.match(simulation,/if\(!window\.STBasicMode\?\.isBasic\(\)&&simulations\.length>1\)/);
  assert.match(simulation,/if\(window\.STBasicMode\?\.isBasic\(\)\)return false/);
});

test('Gemini uses the same full Advance prompt settings in both UI modes',()=>{
  const settings=read('Settings.html'),service=read('GeminiService.gs');
  assert.match(settings,/el\('gemini-generation-section'\)\.classList\.remove\('hidden'\)/);
  assert.match(settings,/\['basic','basicCapex'\]\.includes\(def\.id\)/);
  assert.match(service,/return !\['basic','basicCapex'\]\.includes\(def\.id\)/);
});
