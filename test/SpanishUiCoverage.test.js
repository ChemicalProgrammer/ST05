import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const read = path => fs.readFileSync(path,'utf8');
const resourceSource = read('apps-script/TextResources.gs');
const languageSource = read('apps-script/Language.html');
const webSource = read('apps-script/WebApp.html');
const languageScript = languageSource.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const resources = new Function(resourceSource+'\nreturn ST_TEXT_RESOURCES;')();
function translationCatalog(){
  const first=languageSource.match(/var translations=(\{[^\n]*\});/);
  assert.ok(first,'The English/Spanish translation catalog is required');
  const entries=[JSON.parse(first[1])];
  for(const match of languageSource.matchAll(/Object\.assign\(translations,(\{[^\n]*\})\);/g))
    entries.push(JSON.parse(match[1]));
  const mapped=Object.assign({},...entries);
  for(const [key,value] of Object.entries({...mapped}))
    if(key.trim()&&!Object.prototype.hasOwnProperty.call(mapped,key.trim()))
      mapped[key.trim()]=value.trim();
  return mapped;
}
const dict=translationCatalog();

test('Every canonical text resource has a Spanish entry or an explicit technical identity',()=>{
  const missing=Object.entries(resources).filter(([key,value])=>
    String(value).trim()&&!Object.prototype.hasOwnProperty.call(dict,String(value).trim()));
  assert.deepEqual(missing.map(([key,value])=>key+': '+value),[],
    'Register all new user-facing ST_TEXT_RESOURCES in Language.html before merging');
  for(const name of ['Initial format','Base equipment settings','Duration method',
    'Elapsed time','Number of shifts','Date and time range','Until Effective Runtime target',
    'Time limit (legacy)','Effective Runtime target (min)','Calendar time limit',
    'Enable failures and repairs (MTBF / MTTR)','Include plant calendar'])
    assert.ok(dict[name]&&dict[name]!==name,'Missing Spanish translation for '+name);
});

test('Main app static UI labels and accessibility metadata have translation coverage',()=>{
  // Expand canonical template labels so the audit includes all five major Settings tabs,
  // run configuration and the dialogs without evaluating their scripts.
  const raw=webSource.replace(/<\?!=?[\s\S]*?\?>/g,tag=>{
      const match=tag.match(/__ST_TEXT__\('([^']+)'\)/);
      return match?resources[match[1]]||'':'';
    }).replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'');
  const texts=[...raw.matchAll(/>([^<>]+)</g)].map(m=>m[1].trim())
    .filter(v=>v&&/[a-zA-Z]/.test(v)&&v.length<190);
  const attributes=[...raw.matchAll(/(?:title|aria-label|placeholder|data-label)="([^"]+)"/g)]
    .map(m=>m[1].trim()).filter(Boolean);
  // Unit symbols, model identifiers and parser fragments must not be translated.
  const technical=new Set(['0 s','s','h','d','wk','R','G','B','gemini-2.5-flash']);
  const unmatched=[...new Set([...texts,...attributes])].filter(v=>
    !dict[v]&&!technical.has(v)&&!v.startsWith('" ')&&
    !v.startsWith('<?')&&!v.startsWith('$')&&!v.startsWith('{{'));
  assert.deepEqual(unmatched,[],
    'Untranslated static text or tooltip in WebApp.html. Add it to Language.html.');
});

test('Simulation setup is completely bilingual, including its duration methods',()=>{
  const start=webSource.indexOf('<section id="simulation-duration-controls"');
  const end=webSource.indexOf('</section>',start);
  assert.ok(start>=0&&end>start);
  const frag=webSource.slice(start,end+10).replace(/<\?=[\s\S]*?\?>/g,tag=>{
    const m=tag.match(/__ST_TEXT__\('([^']+)'\)/);
    return m?resources[m[1]]||'':'';
  });
  const dom=new JSDOM('<!doctype html><html lang="en"><body>'+
    '<select id="settings-language"><option value="en">English</option><option value="es">Español</option></select>'+
    frag+'</body></html>',{runScripts:'outside-only'});
  try{
    const {window}=dom;
    window.STPreferences={read:()=>null,write:()=>true};
    window.eval(languageScript);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const doc=window.document;
    const runInitial=doc.getElementById('run-initial-format');
    const method=doc.getElementById('duration-mode');
    assert.equal(runInitial.closest('label').firstChild.textContent.trim(),'Initial format');
    assert.equal(method.closest('label').firstChild.textContent.trim(),'Duration method');
    window.STLanguage.setLanguage('es');
    assert.equal(runInitial.closest('label').firstChild.textContent.trim(),'Formato inicial');
    assert.equal(runInitial.options[0].textContent,'Configuración base de equipos');
    assert.equal(method.closest('label').firstChild.textContent.trim(),'Método de duración');
    assert.deepEqual([...method.options].map(x=>x.textContent),[
      'Tiempo transcurrido','Número de turnos','Intervalo de fechas y horas',
      'Hasta alcanzar el tiempo efectivo de operación','Límite de tiempo (anterior)'
    ]);
    assert.deepEqual([...method.options].map(x=>x.value),[
      'FIXED','SHIFTS','DATES','EFFECTIVE_RUNTIME','INDEFINITE'
    ],'Changing language must not alter simulation enums');
    assert.equal(doc.getElementById('run-effective-target').closest('label').textContent.trim(),
      'Objetivo de tiempo efectivo de operación (min)');
    window.STLanguage.setLanguage('en');
    assert.equal(runInitial.closest('label').firstChild.textContent.trim(),'Initial format');
    assert.equal(method.closest('label').firstChild.textContent.trim(),'Duration method');
  }finally{dom.window.close();}
});

test('Dynamic duration reporting translates components without changing input values',()=>{
  const runOptions=read('apps-script/RunOptions.html');
  const simulation=read('apps-script/ClientSimulation.html');
  assert.match(runOptions,/function renderDurationSummary\(\)/);
  assert.match(runOptions,/window\.addEventListener\('st-language-change',renderDurationSummary\)/);
  assert.match(runOptions,/label\('days'\)/);
  assert.match(runOptions,/label\('complete shifts'\)/);
  assert.match(simulation,/var isSpanish=window\.STLanguage\?\.current\(\)==='es'/);
  assert.match(simulation,/window\.removeEventListener\('st-language-change',onLanguageChange\)/);
  assert.match(simulation,/periodNote\.textContent=tr\('Simulation period:'\)/);
});

test('The runtime duration summary switches languages without editing simulation inputs',()=>{
  const source=read('apps-script/RunOptions.html');
  const code=source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(code);
  const fields={
    'duration-mode':{value:'SHIFTS'},
    'run-duration':{value:'300'},
    'run-duration-unit':{value:'MINUTES'},
    'run-start-at':{value:''},
    'run-end-at':{value:''},
    'run-effective-target':{value:'978'},
    'run-time-zone':{value:'America/Mexico_City'},
    'run-shift-hours':{value:'8'},
    'run-shift-count':{value:'2'},
    'run-track-shifts':{checked:true},
    'run-duration-summary':{textContent:''}
  };
  let locale='en',listener;
  const window={STLanguage:{
    current:()=>locale,
    translate:word=>locale==='es'?({
      days:'días',hours:'horas','complete shifts':'turnos completos',
      'of one shift':'de un turno'
    }[word]||word):word
  },addEventListener(name,fn){if(name==='st-language-change')listener=fn;}};
  const document={getElementById:id=>fields[id]};
  new Function('window','document',code)(window,document);
  assert.equal(typeof listener,'function');
  listener();
  assert.match(fields['run-duration-summary'].textContent,/16 hours.*2 complete shifts/);
  locale='es';listener();
  assert.match(fields['run-duration-summary'].textContent,/16 horas.*2 turnos completos/);
  assert.equal(fields['run-shift-count'].value,'2');
  assert.equal(fields['run-duration'].value,'300');
});
