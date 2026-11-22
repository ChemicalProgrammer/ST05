import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

// Prueba el diálogo real con la misma estructura y scripts de Apps Script.
test('Ctrl+Shift+S abre catálogo accesible y las pestañas funcionan',()=>{
  const source=fs.readFileSync('apps-script/DesignReference.html','utf8');
  const script=source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const time=fs.readFileSync('apps-script/TimeControls.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom=new JSDOM('<!doctype html><html><body>'+source.replace(/<script>[\s\S]*?<\/script>/,'')+'</body></html>',{runScripts:'outside-only'});
  try{
    const w=dom.window;
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    w.eval(time);
    w.eval(script);
    const modal=w.document.getElementById('design-reference-dialog');
    assert.equal(modal.open,false);
    const key=new w.KeyboardEvent('keydown',{key:'S',code:'KeyS',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true});
    w.dispatchEvent(key);
    assert.equal(modal.open,true);
    assert.equal(key.defaultPrevented,true);
    const tabs=[...modal.querySelectorAll('[role=tab]')];
    assert.equal(tabs.length,4);
    const cards=w.document.getElementById('design-ref-tab-cards');
    cards.click();
    assert.equal(cards.getAttribute('aria-selected'),'true');
    assert.equal(w.document.getElementById('design-ref-cards').hidden,false);
    assert.equal(w.document.getElementById('design-ref-controls').hidden,true);
    assert.ok(w.document.querySelector('#design-ref-time-output .st-time-output'));
    w.document.getElementById('design-reference-close').click();
    assert.equal(modal.open,false);
  }finally{dom.window.close();}
});

test('What-if tiene exportación y título en la barra de herramientas única',()=>{
  const web=fs.readFileSync('apps-script/WebApp.html','utf8');
  const a=web.indexOf('<section id="whatif-panel"'),b=web.indexOf('<section id="comparison-panel"',a);
  const fragment=web.slice(a,b);
  const heading=fragment.indexOf('id="whatif-subsection-title"');
  const exportControl=fragment.indexOf('id="export-whatif-json"');
  const content=fragment.indexOf('id="whatif-subsection-content"');
  assert.ok(heading>=0&&exportControl>heading&&content>exportControl);
  assert.match(fragment,/aria-controls="whatif-subsection-content">Scenario options<\/button>/);
  assert.equal((fragment.match(/id="export-whatif-json"/g)||[]).length,1);
  assert.match(fragment,/class="fold-tools button-row"/);
});

test('KPI, resultado y escenario tienen nombres y reglas distintas',()=>{
  const style=fs.readFileSync('apps-script/ComponentStyles.html','utf8');
  const basic=fs.readFileSync('apps-script/BasicMode.html','utf8');
  const whatif=fs.readFileSync('apps-script/WhatIf.html','utf8');
  const web=fs.readFileSync('apps-script/WebApp.html','utf8');
  assert.match(style,/\.metric-card--featured/);
  assert.match(style,/\.metric-card--result/);
  assert.match(style,/\.metric-card--scenario/);
  assert.match(style,/@media\(hover:hover\) and \(pointer:fine\)/);
  assert.match(basic,/row\.classList\.add\('metric-card','metric-card--featured'\)/);
  assert.match(whatif,/metric-card--scenario/);
  assert.match(web,/metric-card--result/);
  assert.match(web,/include_\('ComponentStyles'\)/);
});
