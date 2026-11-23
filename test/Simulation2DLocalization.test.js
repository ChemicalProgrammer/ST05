import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const web=fs.readFileSync('apps-script/WebApp.html','utf8');
const simulation2d=fs.readFileSync('apps-script/Simulation2D.html','utf8');
const language=fs.readFileSync('apps-script/Language.html','utf8');
const script=language.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Missing language runtime');

function buildScreen(){
  const start=web.indexOf('<section id="simulation2d-panel"');
  const end=web.indexOf('<section id="run-panel"',start);
  assert.ok(start>=0&&end>start,'Simulation 2D panel markup is present');
  const fragment=web.slice(start,end).replace(/<\?[\s\S]*?\?>/g,'');
  const dom=new JSDOM('<!doctype html><html lang="en"><body>'+
    '<select id="settings-language"><option value="en">English</option><option value="es">Español</option></select>'+
    fragment+'</body></html>',{runScripts:'outside-only'});
  const stored=new Map();
  dom.window.STPreferences={read:k=>stored.get(k)||null,write:(k,v)=>stored.set(k,v)};
  dom.window.eval(script);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return {dom,doc:dom.window.document,lang:dom.window.STLanguage,stored};
}
const content=(doc,selector)=>doc.querySelector(selector)?.textContent?.trim();

test('Simulation 2D Options divider is removed, but the three options remain',()=>{
  const {dom,doc}=buildScreen();
  try{
    const fieldset=doc.querySelector('#simulation2d-settings .simulation2d-setting-toggles');
    assert.ok(fieldset,'A single semantic group remains for the checkboxes');
    assert.equal(fieldset.tagName,'FIELDSET');
    assert.equal(fieldset.querySelector('legend'),null,'No Options caption');
    assert.equal(fieldset.classList.contains('subsection-fieldset'),false,'No reusable separator styling');
    assert.equal(fieldset.querySelectorAll('input[type="checkbox"]').length,3);
    assert.deepEqual(['simulation2d-dimensions','simulation2d-failures','simulation2d-show-events'],
      [...fieldset.querySelectorAll('input')].map(input=>input.id));
    assert.equal(fieldset.getAttribute('aria-label'),'2D simulation options');
    assert.doesNotMatch(simulation2d,/\.simulation2d-setting-toggles\s*\{[^}]*border-top/);
  }finally{dom.window.close();}
});

test('Spanish mode translates all visible 2D Settings and Layout labels in the screenshot',()=>{
  const {dom,doc,lang}=buildScreen();
  try{
    assert.equal(content(doc,'#simulation2d-title'),'Layout','English remains default');
    lang.setLanguage('es');
    assert.equal(doc.documentElement.lang,'es');
    const wanted=[
      ['#simulation2d-settings-title','Configuración'],
      ['#simulation2d-settings .subsection-description','Selecciona la duración, fuente y opciones visuales de la reproducción.'],
      ['.simulation2d-time-field > span','Tiempo'],
      ['#simulation2d-source option[value=independent]','Simulación independiente'],
      ['#simulation2d-source option[value=representative]','Semilla de la ronda representativa'],
      ['#simulation2d-results #simulation2d-title','Distribución de línea'],
      ['#simulation2d-results .subsection-description','Observa la distribución de la línea y el comportamiento de los equipos y transportadores durante la ejecución.'],

    ];
    for(const [selector,expected] of wanted.filter(row=>row[1]))
      assert.equal(content(doc,selector),expected,selector);
    const sourceLabel=doc.querySelector('#simulation2d-source').closest('label');
    assert.ok(sourceLabel.textContent.includes('Fuente'));
    const checkboxText=content(doc,'.simulation2d-setting-toggles');
    assert.match(checkboxText,/Mostrar cotas/);
    assert.match(checkboxText,/Fallas MTBF \/ MTTR/);
    assert.match(checkboxText,/Mostrar eventos y calendario/);
    assert.equal(doc.querySelector('.simulation2d-setting-toggles').getAttribute('aria-label'),'Opciones de simulación 2D');
    const captions=[...doc.querySelectorAll('#simulation2d-results .simulation2d-metrics dt')].map(dt=>dt.textContent.trim());
    assert.deepEqual(captions,['Tiempo transcurrido','Botellas producidas','En transportadores','Máquinas en marcha','Back-up activo']);
    assert.deepEqual([...doc.querySelectorAll('#simulation2d-viewports option')].map(o=>o.textContent.trim()),['1 vista','2 vistas','3 vistas','4 vistas']);
    assert.equal(content(doc,'#simulation2d-legend .run'),'En marcha / descargando');
    assert.equal(doc.querySelector('#simulation2d-appearance').getAttribute('aria-label'),'Apariencia de la distribución');
    assert.equal(doc.querySelector('#simulation2d-fullscreen').getAttribute('title'),'Abrir diagrama a pantalla completa');
    assert.equal(content(doc,'#simulation2d-playback-state'),'Listo');
    assert.equal(content(doc,'#simulation2d-time'),'0 s');
  }finally{dom.window.close();}
});

test('Switching back to English restores labels, and newly inserted 2D content is translated',async()=>{
  const {dom,doc,lang}=buildScreen();
  try{
    lang.setLanguage('es');
    const dynamic=doc.createElement('span');
    dynamic.textContent='Layout appearance';
    doc.getElementById('simulation2d-results').append(dynamic);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(dynamic.textContent,'Apariencia de la distribución');
    lang.setLanguage('en');
    assert.equal(doc.documentElement.lang,'en');
    assert.equal(content(doc,'#simulation2d-title'),'Layout');
    assert.equal(content(doc,'#simulation2d-results .simulation2d-metrics dt'),'Elapsed');
    assert.equal(content(doc,'#simulation2d-source option[value=independent]'),'Independent simulation');
    assert.equal(dynamic.textContent,'Layout appearance');
  }finally{dom.window.close();}
});

test('2D dynamic status/engineering UI is localized without changing internal states',()=>{
  assert.match(simulation2d,/function localize2D\(value\)/);
  assert.match(simulation2d,/message\.textContent=validation\?localize2D\(validation\):localize2D\(runState\)/);
  assert.match(simulation2d,/playbackState\.textContent=localize2D\(runState\)/);
  assert.match(simulation2d,/measureTelemetry\(model\.line\|\|\[\]\);/);
  assert.match(simulation2d,/text\(localize2D\(label\),parameterX,baseline/);
  assert.match(simulation2d,/context\.fillText\(localize2D\('Production'\)/);
  assert.match(simulation2d,/localize2D\('calendar stops'\)/);
  const languageHandler=simulation2d.indexOf("window.addEventListener('st-language-change'");
  const returnApi=simulation2d.indexOf('return {pause,capture,isRunning');
  assert.ok(languageHandler>=0&&returnApi>languageHandler,'The language-change listener must be registered before the module returns');
  assert.ok(!simulation2d.includes('runState=localize2D('),'Do not mutate simulation enums');
});
