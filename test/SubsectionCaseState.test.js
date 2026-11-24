import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const code=fs.readFileSync('apps-script/Subsection.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
test('subsection A/B state is case-specific, survives serialization and dynamic recreation, and restores without editing inputs',()=>{
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'}),w=dom.window;
  w.STMotion={reduced:()=>true};w.eval(code);
  let record={id:'A',metadata:{unrelated:true},simulations:[{results:{complete:true}}]},changes=0;
  const api=w.STSubsection;api.connectCase(()=>record,()=>changes++);
  const make=(title,variant,open=true)=>api.create({title,variant,native:false,persistKey:'test:'+variant,open});
  const a=make('Title','A'),b=make('Compact','B');w.document.body.append(a.section,b.section);
  api.userToggle(a.title.querySelector('button'),false);api.userToggle(b.title.querySelector('button'),false);
  assert.equal(changes,2);assert.equal(a.body.hidden,true);assert.equal(b.body.inert,true);
  const saved=JSON.parse(JSON.stringify(record));assert.equal(saved.metadata.unrelated,true);assert.equal(saved.simulations[0].results.complete,true);
  record={id:'B',metadata:{}};api.restoreAll();assert.equal(a.body.hidden,false);assert.equal(b.body.hidden,false);assert.equal(changes,2);
  record=saved;api.restoreAll();assert.equal(a.body.hidden,true);assert.equal(b.body.hidden,true);assert.equal(changes,2);
  const rebuilt=make('Translated title','B');w.document.body.append(rebuilt.section);assert.equal(rebuilt.body.hidden,true);assert.equal(changes,2);
  dom.window.close();
});
test('native details restore on case switch and a user toggle is saved without a spurious restore write',()=>{
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'}),w=dom.window;w.eval(code);
  let record={id:'A',metadata:{}},changes=0;const api=w.STSubsection;api.connectCase(()=>record,()=>changes++);
  const group=api.create({title:'Results',native:true,persistKey:'native-results',open:true});w.document.body.append(group.section);
  group.section.open=false;group.section.dispatchEvent(new w.Event('toggle'));
  assert.equal(record.metadata.subsectionStates['section:native-results'],false);assert.equal(changes,1);
  const saved=JSON.parse(JSON.stringify(record));record={id:'B',metadata:{}};api.restoreAll();group.section.dispatchEvent(new w.Event('toggle'));assert.equal(group.section.open,true);assert.equal(changes,1);
  record=saved;api.restoreAll();group.section.dispatchEvent(new w.Event('toggle'));assert.equal(group.section.open,false);assert.equal(changes,1);
  dom.window.close();
});
test('Settings has no saved label, but retains retry and error reporting',()=>{
  const html=fs.readFileSync('apps-script/WebApp.html','utf8'),settings=fs.readFileSync('apps-script/Settings.html','utf8');
  assert.doesNotMatch(html,/id="settings-unsaved"/);assert.doesNotMatch(settings,/settings-unsaved/);
  assert.match(html,/id="settings-retry"/);assert.match(settings,/settings-error/);
});
