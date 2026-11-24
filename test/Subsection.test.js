import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';
import {fixture as realDataFixture,mount as mountRealData} from './helpers/RealDataHarness.js';

const page=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
const scripts=[...page.window.document.querySelectorAll('script')].map(node=>node.textContent);
function source(name){
  const value=scripts.find(text=>new RegExp('window\\.'+name+'\\s*=').test(text));
  assert.ok(value,'Expected generated module '+name);return value;
}
page.window.document.querySelectorAll('script,style,link').forEach(node=>node.remove());
const application=page.window.document.body.innerHTML;
page.window.close();

function harness(markup=''){
  const errors=[],console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(markup,{runScripts:'outside-only',virtualConsole:console}),w=dom.window,d=w.document;
  w.eval(source('STSubsection'));
  return {w,d,errors,api:w.STSubsection,close:()=>w.close()};
}

test('factory treats title, description and content as text and makes independent accessible sections',()=>{
  const h=harness();
  try{
    const title='<img src=x onerror=alert(1)>',description='<script>unsafe()</script>';
    const native=h.api.create({title,description,content:'<strong>Text content</strong>',titleId:'native-title'});
    h.d.body.append(native.section);
    assert.equal(native.section.tagName,'DETAILS');assert.equal(native.section.open,true);
    assert.equal(native.title.textContent,title);assert.equal(native.description.textContent,description);
    assert.equal(native.body.textContent,'<strong>Text content</strong>');
    assert.equal(native.section.querySelector('img,script,strong'),null,'String options are never interpreted as markup');
    assert.equal(native.section.getAttribute('aria-labelledby'),'native-title');
    const first=h.api.create({title:'First',native:false,open:false});
    const second=h.api.create({title:'Second',native:false});
    h.d.body.append(first.section,second.section);
    assert.notEqual(first.body.id,second.body.id);assert.ok(first.body.id);
    const firstToggle=first.title.querySelector('button');
    assert.equal(firstToggle.getAttribute('aria-controls'),first.body.id);
    assert.equal(firstToggle.getAttribute('aria-expanded'),'false');assert.equal(first.body.hidden,true);assert.equal(first.body.inert,true);
    assert.equal(second.title.querySelector('button').getAttribute('aria-expanded'),'true');assert.equal(second.body.hidden,false);
    assert.equal(first.description,null);assert.equal(second.description,null);
    assert.throws(()=>h.api.create({description:'Missing title'}),/title is required/);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('tool descriptors provide names, selected state and callbacks while existing controls retain identity',()=>{
  const h=harness();
  try{
    const icons=[];h.w.STIcons={button:(button,icon)=>icons.push({button,icon})};
    const existing=h.d.createElement('select');existing.id='existing-tool';existing.innerHTML='<option value="a">A</option><option value="b">B</option>';existing.value='b';
    let clicks=0,changes=0;existing.addEventListener('change',()=>changes++);
    const control=h.api.create({title:'Tools',tools:[
      {id:'export-tool',label:'Export',icon:'download',pressed:true,onClick:()=>clicks++},
      {label:'Disabled action',disabled:true,onClick:()=>clicks++},existing
    ]});
    h.d.body.append(control.section);
    const button=h.d.getElementById('export-tool');
    assert.equal(button.type,'button');assert.equal(button.getAttribute('aria-label'),'Export');assert.equal(button.title,'Export');
    assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(icons[0].button,button);assert.equal(icons[0].icon,'download');
    button.click();assert.equal(clicks,1);control.tools.querySelector('[disabled]').click();assert.equal(clicks,1);
    assert.equal(h.d.getElementById('existing-tool'),existing);assert.equal(existing.value,'b');
    existing.dispatchEvent(new h.w.Event('change'));assert.equal(changes,1);
    assert.throws(()=>h.api.create({title:'Missing tool label',tools:[{icon:'download'}]}),/require a label/);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('legacy enhancement keeps existing nodes, edited values, focus and listeners and is idempotent',()=>{
  const h=harness('<section id="legacy" class="fold-card"><div class="fold-heading"><h3 id="old-title"><button id="old-toggle" type="button" class="fold-toggle" data-subsection-toggle aria-expanded="false" aria-controls="old-body">Legacy title</button></h3><p id="old-description" class="subsection-description">Legacy description</p><select id="view"><option value="a">A</option><option value="b">B</option></select></div><div id="old-body" class="fold-content" hidden><input id="existing-value" value="1"></div></section>');
  try{
    const section=h.d.getElementById('legacy'),title=h.d.getElementById('old-title'),toggle=h.d.getElementById('old-toggle'),description=h.d.getElementById('old-description'),body=h.d.getElementById('old-body'),select=h.d.getElementById('view'),input=h.d.getElementById('existing-value');
    let clicks=0,changes=0;toggle.addEventListener('click',()=>clicks++);select.addEventListener('change',()=>changes++);
    input.value='23';select.value='b';select.focus();
    const control=h.api.enhance(section);
    assert.equal(control.title,title);assert.equal(control.description,description);assert.equal(control.body,body);
    assert.equal(h.d.getElementById('old-toggle'),toggle);assert.equal(h.d.getElementById('existing-value'),input);
    assert.equal(input.value,'23');assert.equal(select.value,'b');assert.equal(body.hidden,true);
    assert.equal(h.d.activeElement,select,'Reparenting a header control must restore its focus');
    assert.ok(control.tools.contains(select));assert.equal(toggle.getAttribute('aria-controls'),'old-body');
    toggle.click();select.dispatchEvent(new h.w.Event('change'));assert.equal(clicks,1);assert.equal(changes,1);
    assert.equal(h.api.enhance(section),control);h.api.init(section);h.api.init();
    assert.equal(h.api.enhance(section),control);assert.equal(section.querySelectorAll('.subsection-heading-copy').length,1);
    assert.equal(section.querySelectorAll('.fold-tools').length,1);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('native enhancement preserves native open state and summary/body identity including plain-text legacy headings',()=>{
  const h=harness('<details id="native" class="fold-card fold-native" open><summary id="summary"><span class="subsection-heading-copy"><span id="title" class="subsection-native-title">Production and calendar</span><span id="description" class="subsection-description">Description</span></span></summary><div id="body" class="fold-content">Content</div></details><details id="plain" class="fold-card"><summary>Plain legacy title</summary><div class="fold-content">Plain content</div></details>');
  try{
    const section=h.d.getElementById('native'),summary=h.d.getElementById('summary'),title=h.d.getElementById('title'),description=h.d.getElementById('description'),body=h.d.getElementById('body');
    let clicks=0;summary.addEventListener('click',()=>clicks++);
    const control=h.api.enhance(section);
    assert.equal(control.header,summary);assert.equal(control.title,title);assert.equal(control.description,description);assert.equal(control.body,body);
    assert.equal(section.open,true);summary.click();assert.equal(clicks,1);assert.equal(section.open,false);
    const plain=h.api.enhance(h.d.getElementById('plain'));
    assert.equal(plain.title.textContent,'Plain legacy title');assert.equal(plain.section.open,false);
    assert.equal(plain.description,null);assert.equal(plain.header.querySelectorAll('.subsection-native-title').length,1);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('boot normalizes every static application subsection without replacing title, description or toolbar controls',()=>{
  const h=harness(application);
  try{
    const sections=[...h.d.querySelectorAll('.fold-card')];
    assert.ok(sections.length>=25,'Cover the current static subsections in the application and catalog');
    assert.ok(sections.includes(h.d.getElementById('simulation-json-section')),'The JSON viewer uses the same subsection contract');
    const originals=new Map([...h.d.querySelectorAll('[id]')].map(node=>[node.id,node]));
    h.d.dispatchEvent(new h.w.Event('DOMContentLoaded'));
    for(const section of sections){
      const control=h.api.enhance(section);
      assert.ok(control,'Missing canonical header for '+(section.id||section.className));
      assert.ok(section.classList.contains('st-subsection'));assert.ok(control.header.classList.contains('st-subsection-header'));
      assert.equal(control.title.parentElement,control.header.querySelector(':scope > .subsection-heading-copy'));
      if(control.description)assert.equal(control.description.parentElement,control.title.parentElement);
      if(control.tools)assert.equal(control.tools.parentElement,control.header);
    }
    for(const [id,node] of originals)assert.equal(h.d.getElementById(id),node,'Replaced existing #'+id);
    const view=h.d.getElementById('real-data-view');assert.ok(view.closest('.fold-tools'),'Legacy Real Data selector becomes a header tool');
    h.api.init();assert.equal(h.d.querySelectorAll('.st-subsection').length,sections.length);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('existing and dynamically created subsections remain translatable after enhancement',async()=>{
  const h=harness('<section class="fold-card"><div class="fold-heading"><h3><button class="fold-toggle">Performance summary</button></h3><p class="subsection-description">Production and calendar</p></div><div class="fold-content"></div></section>');
  try{
    h.w.eval(source('STLanguage'));h.w.STLanguage.setLanguage('es');
    const old=h.d.querySelector('.fold-card'),control=h.api.enhance(old);
    assert.equal(control.title.textContent,'Resumen de desempeño');assert.equal(control.description.textContent,'Producción y calendario');
    const dynamic=h.api.create({title:'Performance summary',description:'Production and calendar',tools:[{label:'Export',text:'Export'}]});
    h.d.body.append(dynamic.section);
    await new Promise(resolve=>h.w.setTimeout(resolve,0));
    assert.equal(dynamic.title.textContent,'Resumen de desempeño');assert.equal(dynamic.description.textContent,'Producción y calendario');
    h.w.STLanguage.setLanguage('en');
    assert.equal(control.title.textContent,'Performance summary');assert.equal(control.description.textContent,'Production and calendar');
    assert.equal(dynamic.title.textContent,'Performance summary');assert.equal(dynamic.description.textContent,'Production and calendar');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('Single product and format use one subsection; multiple mode restores machine and conveyor overrides',async()=>{
  const h=harness('<section id="products-workspace"></section><select id="run-initial-format"></select>');
  try{
    h.w.eval(fs.readFileSync('apps-script/ClientUtils.html','utf8'));
    h.w.eval(source('STIcons'));h.w.eval(source('SimulatorEngine'));h.w.eval(source('STProducts'));
    const simulation={id:'simulation',name:'Test',equipment:[
      {id:'filler',name:'Filler',type:'FILLER',processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'}}},
      {id:'belt',name:'Conveyor',type:'CONVEYOR',processData:{role:'CONVEYOR',flowUnits:{input:'BOTTLES',output:'BOTTLES'}}}
    ],dynamicConfig:{}};
    const state={uiView:'products',activeSimulationId:simulation.id,
      activeCase:{id:'case',metadata:{},equipment:[],simulations:[simulation]}};
    h.w.STProducts.init(state,{simulation:()=>simulation,locked:()=>false,capture:()=>true,changed(){},edited(){}});
    await h.w.STProducts.open(true);
    const sections=()=>[...h.d.querySelectorAll('.product-subsection')];
    const titles=()=>sections().map(group=>group.querySelector('.fold-toggle').textContent);
    assert.deepEqual(titles(),['Products & Formats']);
    assert.equal(h.d.querySelector('.formats-tabs,.product-material-picker,.product-add-menu'),null);
    assert.ok(h.d.querySelector('[aria-label="Product name"]'));
    assert.ok(h.d.querySelector('[aria-label="Format name"]'));
    assert.equal(state.activeCase.metadata.formatCatalog,undefined,'Opening the editor alone does not save generated defaults');
    const name=h.d.querySelector('[aria-label="Product name"]');
    name.value='Example';name.dispatchEvent(new h.w.Event('input',{bubbles:true}));
    assert.equal(state.activeCase.metadata.formatCatalog.products[0].name,'Example');
    assert.equal(state.activeCase.metadata.formatCatalog.products.length,1);
    assert.equal(state.activeCase.metadata.formatCatalog.formats.length,1);
    // El modo Single nunca aplica overrides ocultos de perfiles múltiples.
    state.activeCase.metadata.formatCatalog.formats[0].equipment.filler={enabled:true,ratePerMinute:123,inputUnit:'BOTTLES',outputUnit:'BOTTLES'};
    assert.deepEqual(Object.keys(h.w.STProducts.formats()[0].equipment),[]);
    assert.equal(simulation.dynamicConfig.initialFormatId,state.activeCase.metadata.formatCatalog.formats[0].id);

    state.activeCase.metadata.productFormatMode='multiple';
    h.d.getElementById('products-workspace').replaceChildren();
    await h.w.STProducts.open(true);
    assert.deepEqual(titles(),['Products & Formats','Machines','Conveyors']);
    const picker=h.d.querySelector('.product-material-picker');
    assert.ok(picker);assert.equal(picker.querySelectorAll('optgroup').length,2);
    assert.ok(h.d.querySelector('.product-add-menu > summary'));
    picker.value='formats:'+state.activeCase.metadata.formatCatalog.formats[0].id;
    picker.dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.deepEqual(titles(),['Products & Formats','Machines','Conveyors']);
    const ids=[...h.d.querySelectorAll('.product-settings-table tbody tr[data-equipment-id]')].map(row=>row.dataset.equipmentId);
    assert.ok(ids.includes('filler'),'A format can override bottle equipment');
    assert.ok(ids.includes('belt'),'Tables use equipment from the selected simulation');
    h.d.querySelector('.product-add-menu button').click();
    assert.equal(state.activeCase.metadata.formatCatalog.products.length,2);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('Basic mode builds a canonical subsection and preserves the efficiency body when moving it between views',()=>{
  const h=harness(application);
  try{
    h.w.STPreferences={caseOptions:()=>({equipmentLayout:'combined',showRealData:true}),applyFontScale(){},applyJsonFields(){},applyPalette(){}};
    h.w.STIcons={decorate(){}};
    h.w.STEquipmentInspector={release(){},hide(){},refreshTitle(){}};h.w.STEquipmentFilter={set(){}};
    h.w.STScenarios={audit:()=>[]};
    h.w.eval(source('STBasicMode'));
    const state={bootstrap:{uiMode:'BASIC'},activeCase:null,uiView:'editor',basicView:'equipment',run:{result:null}};
    h.w.STBasicMode.init(state,{navigate(){},refresh(){}});
    const section=h.d.getElementById('basic-run-options'),body=h.d.getElementById('basic-efficiencies');
    assert.ok(section.classList.contains('st-subsection'));const control=h.api.enhance(section);
    assert.equal(control.body,body);assert.equal(control.title.id,'basic-run-options-title');
    assert.equal(control.title.querySelector('button').getAttribute('aria-controls'),'basic-efficiencies');
    state.activeCase={id:'case',equipment:[],simulations:[]};state.uiView='simulation';h.w.STBasicMode.sync(state);
    assert.equal(h.d.getElementById('basic-efficiencies'),body);
    assert.equal(body.parentElement.id,'simulation-playback-efficiencies');
    control.title.querySelector('button').setAttribute('aria-expanded','false');
    state.uiView='editor';state.basicView='equipment';h.w.STBasicMode.sync(state);
    assert.equal(body.parentElement,section);assert.equal(body.hidden,true);
    assert.equal(section.querySelectorAll('#basic-efficiencies').length,1);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('Real Data normalizes each newly generated comparison header before preserving the explorer view',()=>{
  const h=harness(application);
  try{
    for(const module of ['STAemComparison','STRealDataModel','STRealData'])h.w.eval(source(module));
    const batches=[];
    h.w.STSubsection={...h.api,init(root){
      h.api.init(root);
      batches.push({root,sections:[...root.querySelectorAll('.fold-card')]});
    }};
    const f=realDataFixture(),saved=JSON.stringify(f.result);mountRealData(h.w,f);
    assert.equal(batches.length,1);assert.equal(batches[0].root.id,'real-data-comparison');
    assert.ok(batches[0].sections.length>1);
    batches[0].sections.forEach(section=>{
      assert.ok(section.classList.contains('st-subsection'));const control=h.api.enhance(section);
      assert.ok(control.description);assert.equal(control.description.parentElement,control.title.parentElement);
    });
    const nav=h.d.querySelector('nav[aria-label="Rubros de comparación"]');assert.ok(nav);
    const button=nav.querySelector('[data-comparison-select="equipment-downtime"]');button.click();
    assert.equal(button.getAttribute('aria-current'),'page');
    const panel=h.d.getElementById(button.getAttribute('aria-controls'));assert.equal(panel.hidden,false);assert.ok(panel.querySelector('table'));
    assert.equal(JSON.stringify(f.result),saved);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});
