import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const source=fs.readFileSync('apps-script/Language.html','utf8');
const javascript=source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(javascript,'Language module must include an executable script');

function screen(initial={}) {
  const dom=new JSDOM('<!doctype html><html lang="en"><head><title>Simulation results</title></head><body>'+
    '<section id="settings-page-appearance"><label for="settings-language">Language</label>'+
    '<select id="settings-language" aria-label="Interface language">'+
    '<option value="en" data-st-no-translate>English</option><option value="es" data-st-no-translate>Español</option></select></section>'+
    '<h3 id="heading">Simulation playback</h3>'+
    '<p id="help">Play a simulation round and monitor efficiencies, output, and runtime metrics.</p>'+
    '<button id="run" title="Run simulation" aria-label="Run simulation">Run simulation</button>'+
    '<p id="state">RAMPING UP</p>'+
    '<div id="cases-list"><div class="case-identity"><strong>Settings</strong></div></div>'+
    '<select id="simulation-selector"><option value="case">Results</option></select>'+
    '<div id="dynamic"></div></body></html>',{runScripts:'outside-only'});
  const stored=new Map(Object.entries(initial));
  dom.window.STPreferences={read:key=>stored.get(key)||null,write:(key,value)=>{stored.set(key,value);return true;}};
  dom.window.eval(javascript);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded',{bubbles:true}));
  return {dom,stored,language:dom.window.STLanguage,doc:dom.window.document};
}

test('English is the default, even when the browser locale would be Spanish',()=>{
  const {dom,language,doc}=screen();
  try{
    assert.equal(language.current(),'en');
    assert.equal(doc.documentElement.lang,'en');
    assert.equal(doc.getElementById('settings-language').value,'en');
    assert.equal(doc.getElementById('heading').textContent,'Simulation playback');
    assert.equal(doc.getElementById('run').getAttribute('title'),'Run simulation');
    const web=fs.readFileSync('apps-script/WebApp.html','utf8');
    assert.match(web,/include_\('Language'\)/);
    assert.match(web,/id="settings-language"[^>]*aria-label="Interface language"/);
    assert.match(web,/<option value="en" data-st-no-translate>English<\/option><option value="es" data-st-no-translate>Español<\/option>/);
  }finally{dom.window.close();}
});

test('Spanish selection translates labels and dynamic states without modifying case names',async()=>{
  const {dom,language,stored,doc}=screen();
  try{
    doc.getElementById('settings-language').value='es';
    doc.getElementById('settings-language').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(language.current(),'es');
    assert.equal(stored.get('language'),'es');
    assert.equal(doc.documentElement.lang,'es');
    assert.equal(doc.getElementById('settings-language').value,'es');
    assert.equal(doc.getElementById('heading').textContent,'Reproducción de simulación');
    assert.match(doc.getElementById('help').textContent,/Reproduce una ronda/);
    assert.equal(doc.getElementById('run').getAttribute('aria-label'),'Ejecutar simulación');
    assert.equal(doc.getElementById('settings-language').getAttribute('aria-label'),'Idioma de la interfaz');
    assert.equal(doc.getElementById('run').title,'Ejecutar simulación');
    assert.equal(doc.getElementById('state').textContent,'ACELERANDO');
    assert.equal(doc.querySelector('#cases-list strong').textContent,'Settings','Never translate a case name');
    assert.equal(doc.querySelector('#simulation-selector option').textContent,'Results','Never translate saved simulation names');
    assert.equal(doc.querySelector('#settings-language option:first-child').textContent,'English','Language names stay readable');
    const row=doc.createElement('p');
    row.textContent='Theoretical equipment efficiency';
    doc.getElementById('dynamic').append(row);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(row.textContent,'Eficiencia teórica de equipos','Newly rendered equipment labels must translate');
    row.textContent='Ready';
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(row.textContent,'Listo','Live text updates must translate too');
    language.setLanguage('en');
    assert.equal(doc.getElementById('heading').textContent,'Simulation playback');
    assert.equal(doc.getElementById('run').title,'Run simulation');
    assert.equal(row.textContent,'Ready');
  }finally{dom.window.close();}
});

test('The chosen language survives reopening and resets with factory settings',()=>{
  const {dom,language}=screen({language:'es'});
  try{assert.equal(language.current(),'es');assert.equal(dom.window.document.documentElement.lang,'es');}
  finally{dom.window.close();}
  const preferences=fs.readFileSync('apps-script/UiPreferences.html','utf8');
  assert.match(preferences,/window\.STLanguage\?\.setLanguage\('en'\)/);
});

test('Changing languages is presentation-only and does not call any case-saving method',()=>{
  const {dom,language,stored}=screen();
  try{
    language.setLanguage('es');
    language.setLanguage('en');
    assert.equal(stored.get('language'),'en');
    assert.equal(language.translate('  Simulation playback  '),'  Simulation playback  ');
    language.setLanguage('es');
    assert.equal(language.translate(' Virtual time '),' Tiempo virtual ');
    assert.equal(language.translate('Global OEE'),'OEE global');
  }finally{dom.window.close();}
});


test('legacy Spanish labels render correctly in English, including nodes added after initialization',async()=>{
  const {dom,language,doc}=screen();
  try{
    const values=[
      ['Falta parcial de producto en la salida','Partial product starvation at output'],
      ['Rampa del equipo de salida','Output equipment ramp'],
      ['Transición de paro del equipo de salida','Output equipment stop transition'],
      ['Sin atribuir','Unassigned']
    ];
    const host=doc.getElementById('dynamic');
    for(const [es,en] of values){
      const label=doc.createElement('label');
      label.textContent=es;label.setAttribute('aria-description',es);host.append(label);
    }
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual([...host.children].map(n=>n.textContent),values.map(x=>x[1]));
    assert.deepEqual([...host.children].map(n=>n.getAttribute('aria-description')),values.map(x=>x[1]));
    language.setLanguage('es');
    assert.deepEqual([...host.children].map(n=>n.textContent),values.map(x=>x[0]));
    language.setLanguage('en');
    assert.deepEqual([...host.children].map(n=>n.textContent),values.map(x=>x[1]));
    for(const key of ['Equipment presentation','Card view','Table view','Equipment Analysis Tool']){
      language.setLanguage('es');assert.notEqual(language.translate(key),key);
    }
  }finally{dom.window.close();}
});
