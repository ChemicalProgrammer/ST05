import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';import {setup,fixture,mount,setUnplannedMinutes} from './helpers/RealDataHarness.js';
test('comparison and report share exact formulas and reported values without permanent explanation columns',()=>{
 const w=setup();try{const f=fixture();mount(w,f);
 const table=w.document.querySelector('#real-data-comparison table');assert.equal(table.tHead.rows[0].cells.length,5);
 const au=w.document.querySelector('[data-metric="au"]');assert(au.cells[0].title.includes('Effective Runtime / Plant Available Time'));assert(au.textContent.includes('Reportado: 53.8'));
 assert.equal(au.cells[2].getAttribute('aria-description'),au.cells[2].title);assert.equal(au.cells[2].tabIndex,0);
 const d=w.STRealData.compare(f.record,f.simulation,f.result,'average',{}),report=new JSDOM(w.STRealData.reportHtml(d));
 assert.equal(report.window.document.querySelector('[data-metric="au"] th').title,au.cells[0].title);assert.equal(report.window.document.querySelectorAll('section').length,3);assert.equal(report.window.document.querySelectorAll('one').length,0);report.window.close();
 }finally{w.close();}
});
test('comparison groups follow the time hierarchy, remove unexplained codes and retain selection on input',()=>{
 const w=setup();try{const f=fixture();mount(w,f);
 const panel=w.document.getElementById('real-data-comparison'),groups=[...panel.querySelectorAll('article[data-comparison-group]')];
 assert.equal(groups.length,8);assert.deepEqual(groups.map(e=>e.dataset.comparisonGroup),['calendar','planned','operation','losses','production','inputs','indicators','equipment-downtime']);
 const ids=[...panel.querySelectorAll('[data-metric]')].map(e=>e.dataset.metric);assert.equal(ids.length,new Set(ids).size);
 const allText=panel.textContent+' '+[...panel.querySelectorAll('[title]')].map(e=>e.title).join(' ');assert(!/\b(?:AEM|T[1-5])\b/.test(allText));
 panel.querySelector('[data-comparison-select="operation"]').click();
 setUnplannedMinutes(w,500);
 assert.equal(panel.querySelector('[data-comparison-group="operation"]').hidden,false);assert.equal(panel.querySelector('[data-comparison-group="losses"]').hidden,true);
 assert.equal(panel.querySelector('[data-comparison-group="calendar"]').hidden,true);
 assert.equal(panel.querySelector('[data-metric="Unplanned Downtime"]').cells[2].textContent,'500');
 const result=w.STRealData.compare(f.record,f.simulation,f.result,'average',{}),report=new JSDOM(w.STRealData.reportHtml(result));
 assert.equal(report.window.document.querySelectorAll('[data-comparison-group]').length,8);
 assert(!/\b(?:AEM|T[1-5])\b/.test([...report.window.document.querySelectorAll('[data-comparison-group]')].map(e=>e.textContent).join(' ')));report.window.close();
 }finally{w.close();}
});

test('comparison categories use shared header tabs, separate secondary headings and live English/Spanish presentation',()=>{
 const w=setup('en');try{
  const f=fixture(),original=JSON.stringify(f.result),{owner,changes}=mount(w,f);
  const snapshot=JSON.stringify(owner.metadata.realData);
  const target=w.document.getElementById('real-data-comparison');
  const nav=target.querySelector('.real-data-comparison-nav');
  const tabs=[...nav.querySelectorAll('button')];
  assert.equal(tabs.length,8);
  assert(tabs.every(b=>b.classList.contains('app-section-tab')&&b.querySelector('svg.icon')&&b.getAttribute('aria-controls')));
  assert.deepEqual(tabs.map(b=>b.textContent),['Calendar','Planned downtime','Unplanned downtime','Runtime losses','Production','Reference parameters','Performance indicators','Equipment downtime']);
  nav.querySelector('[data-comparison-select="losses"]').click();
  let page=target.querySelector('[data-comparison-group="losses"]');
  assert.equal(page.hidden,false);
  assert.equal(page.querySelector('h3').textContent,'Runtime losses and effective runtime');
  assert.equal(page.querySelector('.subsection-description').textContent,'Review rate losses and effective runtime.');
  assert.deepEqual([...page.querySelector('thead tr').cells].map(c=>c.textContent),['Parameter','Unit','Real','Simulated','Difference']);
  assert.equal(page.querySelector('[data-metric="rateLoss"] th').firstChild.nodeValue,'Production Rate Losses (gross)');
  assert.equal(w.document.getElementById('real-data-view').selectedOptions[0].textContent,'Average of rounds');
  assert.equal(w.document.querySelector('#real-data-register-title button').textContent,'Record');
  assert.equal(w.document.querySelector('#real-data-editor [data-real-field="name"]').closest('label').firstChild.nodeValue,'Record name');
  assert.equal(w.document.querySelector('#real-data-calibration [data-calibration="baseline"]').closest('table').tHead.rows[0].cells[9].textContent,'Simulator OEE[%]');
  assert.equal(target.querySelector('[data-comparison-group="equipment-downtime"] tbody th').textContent,'Filler <one>');
  const recorded=JSON.stringify(w.STRealData.compare(f.record,f.simulation,f.result,'average',{}).rows);
  w.document.documentElement.lang='es';w.dispatchEvent(new w.Event('st-language-change'));
  page=target.querySelector('[data-comparison-group="losses"]');assert.equal(page.hidden,false);
  assert.equal(page.querySelector('h3').textContent,'Pérdidas durante la marcha y tiempo efectivo');
  assert.equal(page.querySelector('.subsection-description').textContent,'Muestra las pérdidas de velocidad y el tiempo efectivo.');
  assert.equal(w.document.getElementById('real-data-view').selectedOptions[0].textContent,'Promedio de rondas');
  assert.equal(w.document.querySelector('#real-data-register-title button').textContent,'Registro');
  w.document.documentElement.lang='en';w.dispatchEvent(new w.Event('st-language-change'));
  assert.equal(target.querySelector('[data-comparison-group="losses"]').hidden,false);
  assert.equal(target.querySelector('[data-comparison-group="losses"] h3').textContent,'Runtime losses and effective runtime');
  assert.equal(JSON.stringify(owner.metadata.realData),snapshot);assert.equal(changes(),0);
  assert.equal(JSON.stringify(f.result),original);assert.equal(JSON.stringify(w.STRealData.compare(f.record,f.simulation,f.result,'average',{}).rows),recorded);
 }finally{w.close();}
});

test('comparison tabs size to their own content and animate category changes without animating data refreshes',()=>{
 const w=setup('en');try{
  const calls=[],cancelled=[],heights={calendar:180,losses:220,production:330};
  let reduced=false;
  w.STMotion={reduced:()=>reduced,duration:()=>220,cancel:el=>cancelled.push(el),
    play:(el,frames,options)=>calls.push({kind:'height',el,frames,options}),
    reveal:el=>calls.push({kind:'reveal',el})};
  const f=fixture(),{owner,changes}=mount(w,f);
  const snapshot=JSON.stringify(owner.metadata.realData);
  const target=w.document.getElementById('real-data-comparison');
  const content=target.querySelector('.real-data-explorer-content');
  content.getBoundingClientRect=()=>({height:heights[content.querySelector('article:not([hidden])')?.dataset.comparisonGroup]||250});
  const select=id=>target.querySelector('[data-comparison-select="'+id+'"]').click();
  assert.equal(calls.length,0,'Initial rendering is not animated');
  select('losses');
  assert.equal(calls.length,2);
  assert.equal(calls[0].el,content);
  assert.deepEqual(Array.from(calls[0].frames,frame=>frame.height),['180px','220px']);
  assert.equal(calls[1].el.dataset.comparisonGroup,'losses');
  assert.equal(content.querySelectorAll('article:not([hidden])').length,1);
  select('losses');assert.equal(calls.length,2,'Selecting the same category is a no-op');
  select('production');assert.equal(calls.length,4);
  assert(cancelled.includes(content),'A subsequent switch cancels the preceding height animation');
  reduced=true;select('calendar');assert.equal(calls.length,4,'Reduced motion is respected');
  reduced=false;
  w.document.documentElement.lang='es';w.dispatchEvent(new w.Event('st-language-change'));
  assert.equal(calls.length,4,'Rebuilding the tables does not replay the transition');
  assert.equal(target.querySelector('[data-comparison-select="calendar"]').getAttribute('aria-current'),'page');
  assert.equal(JSON.stringify(owner.metadata.realData),snapshot);assert.equal(changes(),0);
  const css=fs.readFileSync('apps-script/RealDataStyles.html','utf8');
  assert.match(css,/\.real-data-comparison-explorer\s*\{[^}]*grid-template-columns:fit-content\(32%\) minmax\(0,1fr\)/);
  assert.match(css,/\.real-data-comparison-nav\s*\{[^}]*justify-items:start/);
  assert.match(css,/\.real-data-comparison-tab\s*\{[^}]*width:fit-content;max-width:100%;/);
  assert.match(css,/\.real-data-comparison-tab\s*\{[^}]*transition:background-color/);
  assert.match(css,/prefers-reduced-motion:reduce[\s\S]*?\.real-data-comparison-tab\s*\{transition:none/);
 }finally{w.close();}
});
