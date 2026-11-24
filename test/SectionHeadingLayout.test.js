import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';

// Evaluate the actual generated markup and winning stylesheet declarations.
// These checks protect the responsive layout contract, not measured browser pixels.
const dom=new JSDOM(renderAppsScript().html,{runScripts:'outside-only',virtualConsole:new VirtualConsole()});
const document=dom.window.document,rules=[];
dom.window.eval([...document.scripts].find(script=>script.textContent.includes('window.STSubsection=')).textContent);
dom.window.STSubsection.init();
after(()=>dom.window.close());
function compare(a,b){return a[0]-b[0]||a[1]-b[1]||a[2]-b[2];}
function specificity(node){
  if(node.type==='id')return [1,0,0];
  if(node.type==='class'||node.type==='attribute')return [0,1,0];
  if(node.type==='tag')return [0,0,1];
  if(node.type==='pseudo'){
    if(node.value===':where')return [0,0,0];
    if([':is',':not',':has'].includes(node.value))return node.nodes.map(specificity).sort(compare).at(-1)||[0,0,0];
    return node.value.startsWith('::')?[0,0,1]:[0,1,0];
  }
  return (node.nodes||[]).map(specificity).reduce((sum,next)=>sum.map((value,index)=>value+next[index]),[0,0,0]);
}
for(const style of document.querySelectorAll('style'))postcss.parse(style.textContent).walkRules(rule=>{
  const conditions=[];
  for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule')conditions.push(parent);
  for(const selector of selectorParser().astSync(rule.selector).nodes)rules.push({
    selector:selector.toString(),specificity:specificity(selector),conditions,
    declarations:rule.nodes.filter(node=>node.type==='decl')
  });
});
function applies(rule,width){
  return rule.conditions.every(condition=>{
    if(condition.name!=='media')return false;
    const query=condition.params.match(/^\s*\((max|min)-width\s*:\s*(\d+)px\)\s*$/);
    return Boolean(query)&&(query[1]==='max'?width<=Number(query[2]):width>=Number(query[2]));
  });
}
const matchingCache=new WeakMap();
function value(element,property,width=1440){
  let cache=matchingCache.get(element);
  if(!cache){cache=new Map();matchingCache.set(element,cache);}
  const key=[width,document.documentElement.dataset.uiMode,document.documentElement.dataset.visualStyle,
    document.documentElement.dataset.headerView,document.documentElement.dataset.basicView,
    document.documentElement.dataset.equipmentLayout].join(':');
  if(!cache.has(key))cache.set(key,rules.map((rule,order)=>({...rule,order})).filter(rule=>{
    if(!applies(rule,width))return false;
    try{return element.matches(rule.selector);}catch{return false;}
  }));
  const matches=[];
  cache.get(key).forEach(rule=>{
    for(const declaration of rule.declarations)if(declaration.prop===property)
      matches.push({...rule,value:declaration.value,important:Boolean(declaration.important)});
  });
  return matches.sort((a,b)=>Number(a.important)-Number(b.important)
    ||compare(a.specificity,b.specificity)||a.order-b.order).at(-1)?.value;
}

test('subsection copy keeps title and description in one compact column',()=>{
  const copies=[...document.querySelectorAll('.fold-heading > .subsection-heading-copy, .fold-heading > div:has(> h3 > .fold-toggle)')];
  assert(copies.length>=15,'Exercise regular, legacy, simulation, results and reference headings');
  for(const width of [360,760,1440])for(const copy of copies){
    const title=copy.querySelector(':scope > h3');
    const description=copy.querySelector(':scope > .subsection-description, :scope > .subsection-playback-meta');
    assert.equal(value(copy,'display',width),'flex',title.textContent.trim());
    assert.equal(value(copy,'flex-direction',width),'column');
    assert.equal(value(copy,'gap',width),'var(--subsection-description-gap)');
    assert.equal(value(title,'order',width),'0');
    assert.equal(value(title,'flex',width),'0 1 auto');
    assert.ok(description);
    assert.equal(value(description,'order',width),'2');
    assert.equal(value(description,'flex',width),'0 1 auto',title.textContent.trim()+' keeps the description at its text height');
    assert.equal(value(description,'max-width',width),'100%');
  }
});

test('custom and native headings center tools against the complete compact copy in every visual mode',()=>{
  const root=document.documentElement;
  const originalMode=root.getAttribute('data-ui-mode'),originalStyle=root.getAttribute('data-visual-style');
  const copies=[...document.querySelectorAll('.fold-heading > .subsection-heading-copy, .fold-heading > div:has(> h3 > .fold-toggle)')];
  const nativeCopies=[...document.querySelectorAll('.fold-native > summary > .subsection-heading-copy')];
  for(const id of ['results-title','results-loss-title','simulation-equipment-title']){
    const title=document.getElementById(id);
    assert(copies.includes(title.parentElement),'Cover the reported Results and Equipment performance headings');
    assert.ok(title.closest('.fold-heading').querySelector(':scope > .fold-tools'));
  }
  assert.ok(copies.some(copy=>copy.closest('.design-reference-subsection')),'The reusable example shares the production rule');
  assert.ok(nativeCopies.some(copy=>copy.closest('#results-production-group')),'Compare against the compact native Results heading');
  assert.ok(nativeCopies.some(copy=>copy.closest('.design-reference-native-preview')),'The native example has no local gap override');
  try{
    for(const mode of ['basic','advance'])for(const style of ['classic','elegant']){
      root.setAttribute('data-ui-mode',mode);
      root.setAttribute('data-visual-style',style);
      for(const width of [360,760,1440]){
        const context=mode+'/'+style+' at '+width+' px';
        assert.equal(value(root,'--subsection-description-gap',width),'var(--space-1)',context);
        for(const copy of copies){
          const heading=copy.parentElement,title=copy.querySelector(':scope > h3'),toggle=title.querySelector('.fold-toggle');
          const label=context+' / '+title.textContent.trim();
          assert.equal(value(heading,'row-gap',width),'var(--subsection-description-gap)',label);
          // Center the whole text column against the toolbar; the title must
          // keep its natural height instead of inheriting button height.
          assert.equal(value(title,'display',width),'flex',label);
          assert.equal(value(title,'align-self',width),'stretch',label);
          assert.equal(value(title,'align-items',width),'center',label);
          assert.equal(value(title,'min-block-size',width),'0',label);
          assert.equal(value(heading,'align-items',width),'center',label);
          assert.equal(value(heading.querySelector(':scope > .fold-tools'),'align-self',width),'center',label);
          assert.equal(value(heading,'display',width),'grid',label);
          assert.equal(value(copy,'grid-row',width),'1',label);
          assert.equal(value(copy,'align-self',width),'center',label);
          assert.equal(value(copy,'gap',width),'var(--subsection-description-gap)',label);
          assert.equal(value(title,'margin',width),'0',label);
          assert.equal(value(title,'min-width',width),'0',label);
          assert.equal(value(toggle,'padding',width),'0',label);
          assert.equal(value(toggle,'margin',width),'0',label);
          assert.equal(value(toggle,'min-height',width),'0',label);
          assert.equal(value(toggle,'font',width),'inherit',label);
          for(const description of copy.querySelectorAll('.subsection-description'))
            assert.equal(value(description,'margin',width),'0',label);
        }
        for(const copy of nativeCopies){
          const title=copy.querySelector('.subsection-native-title');
          const label=context+' / '+title.textContent.trim();
          assert.equal(value(copy,'display',width),'flex',label);
          assert.equal(value(copy,'flex-direction',width),'column',label);
          assert.equal(value(copy,'align-self',width),'center',label);
          assert.equal(value(copy,'gap',width),'var(--subsection-description-gap)',label);
          assert.equal(value(title,'align-self',width),'stretch',label);
          assert.equal(value(title,'align-items',width),'center',label);
          assert.equal(value(title,'min-block-size',width),'0',label);
          assert.equal(value(copy.parentElement.querySelector(':scope > .fold-tools'),'align-self',width),'center',label);
          assert.equal(value(copy.parentElement,'display',width),mode==='basic'&&copy.parentElement.parentElement.id==='run-config'?'none':'grid',label);
          assert.equal(value(copy.parentElement,'row-gap',width),'var(--subsection-description-gap)',label);
          assert.equal(value(copy.querySelector('.subsection-description'),'flex',width),'0 1 auto',label);
          assert.equal(value(copy.querySelector('.subsection-description'),'margin',width),'0',label);
        }
      }
    }
  }finally{
    for(const [attribute,original] of [['data-ui-mode',originalMode],['data-visual-style',originalStyle]]){
      if(original===null)root.removeAttribute(attribute);else root.setAttribute(attribute,original);
    }
  }
});

test('numerical and 2D headings share the description and progress row without changing control targets',()=>{
  for(const [sectionId,stateId,progressId,contentId] of [
    ['simulation-playback','playback-status','playback-progress','simulation-playback-content'],
    ['simulation2d-results','simulation2d-playback-state','simulation2d-progress','simulation2d-content']
  ]){
    const section=document.getElementById(sectionId),state=document.getElementById(stateId),progress=document.getElementById(progressId);
    const meta=state.closest('.subsection-playback-meta');
    assert.ok(meta,sectionId+' groups the description and progress in one row');
    const description=meta.querySelector('.subsection-description'),status=state.parentElement;
    assert.equal(progress.parentElement,status);
    assert.equal(status.parentElement,meta);
    assert.equal(section.querySelector('.fold-toggle').getAttribute('aria-controls'),contentId);
    assert.ok(document.getElementById(contentId));
    for(const width of [360,760,1440]){
      assert.equal(value(meta,'display',width),'flex');
      assert.equal(value(meta,'flex-wrap',width),'wrap');
      assert.equal(value(meta,'align-items',width),'baseline');
      assert.equal(value(description,'flex',width),'0 1 auto');
      assert.equal(value(status,'display',width),'inline-flex');
      assert.equal(value(status,'white-space',width),'nowrap');
      assert.equal(value(status,'margin-inline-start',width),'0');
    }
  }
});

test('shared descriptions stay readable and toolbars stay on one row',()=>{
  const descriptions=[...document.querySelectorAll('.fold-heading .subsection-description, .fold-native > summary .subsection-description')];
  assert(descriptions.length>=20,'Exercise native details and regular subsection descriptions');
  for(const width of [360,760,1440]){
    for(const description of descriptions){
      assert.equal(value(description,'display',width),'block');
      assert.equal(value(description,'max-width',width),'100%');
      assert.equal(value(description,'white-space',width),'normal');
      assert.equal(value(description,'overflow',width),'visible');
      assert.equal(value(description,'text-overflow',width),'clip');
      assert.equal(value(description,'-webkit-line-clamp',width),undefined,'No hidden descriptive lines');
      assert.equal(value(description,'line-clamp',width),undefined);
    }
    for(const tools of document.querySelectorAll('.fold-heading > .fold-tools')){
      assert.equal(value(tools,'order',width),'1');
      assert.equal(value(tools,'flex-wrap',width),'nowrap',(tools.parentElement.parentElement.id||tools.className)+' at '+width+' px');
      assert.equal(value(tools,'max-width',width),'100%');
    }
  }
});


test('canonical Subsection headers use the same subtle secondary gradient in every mode and theme',()=>{
  assert.equal(value(root,'--subsection-header-shade'), 'color-mix(in srgb, var(--secondary) 12%, var(--surface))');
  assert.equal(value(root,'--subsection-header-gradient'),
    'linear-gradient(180deg, var(--subsection-header-shade) 0%, var(--surface) 100%)');
  const headers=[...document.querySelectorAll('.st-subsection > .st-subsection-header')];
  assert(headers.length>=20,'Expected multiple reusable Subsection headers');
  const modes=['basic','advance'],styles=['classic','elegant'],themes=['light','dark'];
  const previous={ui:root.dataset.uiMode,style:root.dataset.visualStyle,theme:root.dataset.theme};
  try{
    for(const mode of modes)for(const style of styles)for(const theme of themes){
      root.dataset.uiMode=mode;root.dataset.visualStyle=style;root.dataset.theme=theme;
      for(const header of headers){
        assert.equal(value(header,'background-image'),'var(--subsection-header-gradient)');
        assert.equal(value(header,'background-color'),'var(--surface)');
        assert.equal(value(header,'border-radius'),'var(--radius-sm) var(--radius-sm) 0 0');
        // The existing border/toolbar/grid mechanics remain unchanged.
        assert.equal(value(header,'display'),'grid');
      }
    }
  }finally{
    for(const [attribute,previousValue] of [
      ['data-ui-mode',previous.ui],['data-visual-style',previous.style],['data-theme',previous.theme]
    ]){
      if(previousValue===undefined)root.removeAttribute(attribute);
      else root.setAttribute(attribute,previousValue);
    }
  }
});

test('canonical grids center wrapped tools beside the entire title and description column',()=>{
  for(const header of document.querySelectorAll('.st-subsection-header')){
    const copy=header.querySelector(':scope > .subsection-heading-copy');
    const description=header.querySelector('.subsection-playback-meta')||header.querySelector('.subsection-description');
    const tools=header.querySelector(':scope > .fold-tools');
    for(const width of [360,760,1440]){
      const context=header.closest('.fold-card').id+' / '+width;
      assert.equal(value(header,'display',width),'grid',context);
      assert.equal(value(copy,'grid-row',width),'1',context);
      assert.equal(value(copy,'grid-column',width),'1',context);
      assert.equal(value(copy,'display',width),'flex',context);
      assert.equal(value(copy,'flex-direction',width),'column',context);
      assert.equal(value(copy,'align-self',width),'center',context);
      if(description){
        assert.equal(description.parentElement,copy,context);
        assert.equal(value(description,'flex',width),'0 1 auto',context);
        assert.equal(value(description,'padding-inline-start',width),'var(--subsection-text-inset)',context);
      }
      if(tools){
        assert.equal(value(tools,'grid-row',width),width<=900?'2':'1',context);
        assert.equal(value(tools,'grid-column',width),width<=900?'1':'2',context);
        assert.equal(value(tools,'align-self',width),'center',context);
        assert.equal(value(tools,'flex-wrap',width),'nowrap',context);
      }
    }
  }
});

test('Registro toolbar retains one horizontal row on desktop',()=>{
  const section=document.getElementById('real-data-record')?.closest('.st-subsection');
  assert.ok(section,'Registro should be mounted');
  const bar=section.querySelector('.real-data-toolbar');
  assert.ok(bar);
  for(const width of [1024,1440,1900]){
    assert.equal(value(bar,'flex-wrap',width),'nowrap');
    assert.equal(value(bar.querySelector('.button-row'),'flex-wrap',width),'nowrap');
    assert.equal(value(bar.querySelector('select'),'margin-inline-start',width),'0');
    assert.equal(value(bar,'grid-row',width),'1');
  }
});

test('the first visible Equipment subsection does not inherit spacing from CSS-hidden Basic options',()=>{
  const root=document.documentElement,equipment=document.getElementById('equipment-section');
  const saved=['data-ui-mode','data-header-view','data-basic-view'].map(name=>[name,root.getAttribute(name)]);
  let options=document.getElementById('basic-run-options'),created=false;
  if(!options){
    options=document.createElement('section');options.id='basic-run-options';options.className='fold-card';
    equipment.before(options);created=true;
  }
  try{
    for(const [mode,view,expected] of [['advance','equipment','0'],['advance','conveyors','0'],
      ['basic','conveyors','0'],['basic','equipment','var(--subsection-gap)']]){
      root.dataset.uiMode=mode;root.dataset.headerView=view;root.dataset.basicView=view;
      for(const width of [360,760,1440])
        assert.equal(value(equipment,'margin-block-start',width),expected,mode+'/'+view+'/'+width);
    }
  }finally{
    if(created)options.remove();
    for(const [name,original] of saved)if(original===null)root.removeAttribute(name);else root.setAttribute(name,original);
  }
});

test('numeric status and both conveyor verdicts use the same shared pill geometry',()=>{
  const card=document.createElement('article');card.className='live-equipment-card state-running';
  card.innerHTML='<header class="numeric-equipment-header"><span class="live-state st-status-pill">Running</span>'
    +'<button class="live-equipment-geometry-verdict numeric-conveyor-verdict st-status-pill is-pass">PASS</button></header>';
  document.body.append(card);
  const verdict=document.createElement('button');verdict.className='simulation2d-analysis-action simulation2d-verdict-pass st-status-pill';
  document.getElementById('simulation2d-panel').append(verdict);
  try{
    const pills=[card.querySelector('.live-state'),card.querySelector('.numeric-conveyor-verdict'),verdict];
    for(const pill of pills)for(const width of [360,1440]){
      assert.equal(value(pill,'height',width),'var(--status-pill-height)');
      assert.equal(value(pill,'font-size',width),'var(--status-pill-font-size)');
      assert.equal(value(pill,'font-weight',width),'var(--status-pill-font-weight)');
      assert.equal(value(pill,'font-family',width),'var(--status-pill-font-family)');
      assert.equal(value(pill,'padding',width),'0 var(--status-pill-padding-x)');
      assert.equal(value(pill,'gap',width),'var(--status-pill-gap)');
      assert.equal(value(pill,'box-shadow',width),'none');
    }
    for(const pill of pills.slice(1)){
      assert.equal(value(pill,'background'),'var(--success-soft)');
      assert.equal(value(pill,'color'),'var(--success)');
    }
  }finally{card.remove();verdict.remove();}
});

test('checkbox cards keep input and text in one horizontal row in static and dynamic Settings',()=>{
  const source=fs.readFileSync('apps-script/Settings.html','utf8');
  const prompts=source.slice(source.indexOf('  function renderPrompts('),source.indexOf('  function activeCase('));
  const categories=source.slice(source.indexOf('  function renderRateLossSettings('),source.indexOf('  // Modo predeterminado'));
  new Function('document',`
    const el=id=>document.getElementById(id);
    const promptDefinitions=[{id:'layout-check',label:'Agent prompt',defaultText:'Saved content'}];
    const promptBudget=()=>{},promptVisibility=()=>{};
    const STPreferences={caseOptions:()=>({})};
    const STReports={rateLossCategories:[{id:'general',label:'General stops'}]};
    ${prompts}${categories}
    renderPrompts({});renderRateLossSettings();
  `)(document);
  const root=document.documentElement;
  const saved=['data-ui-mode','data-visual-style'].map(name=>[name,root.getAttribute(name)]);
  const cards=[...document.querySelectorAll('label.st-checkbox-card')];
  assert.ok(cards.some(card=>card.closest('#settings-rate-loss-categories')));
  assert.ok(cards.some(card=>card.closest('#gemini-prompt-editor')));
  try{
    for(const mode of ['basic','advance'])for(const style of ['classic','elegant']){
      root.dataset.uiMode=mode;root.dataset.visualStyle=style;
      for(const width of [360,1440])for(const card of cards){
        const context=mode+'/'+style+'/'+width+' '+card.textContent.trim();
        assert.equal(value(card,'display',width),'flex',context);
        assert.equal(value(card,'flex-direction',width),'row',context);
        assert.equal(value(card,'flex-wrap',width),'nowrap',context);
        assert.equal(value(card,'align-items',width),'center',context);
        assert.equal(value(card,'border',width),'var(--border-width) solid var(--line)',context);
        assert.ok(card.querySelector(':scope > input[type=checkbox]'),context);
      }
    }
  }finally{
    for(const [name,original] of saved)if(original===null)root.removeAttribute(name);else root.setAttribute(name,original);
    document.getElementById('settings-rate-loss-categories').replaceChildren();
    document.getElementById('gemini-prompt-editor').replaceChildren();
  }
});

test('active configuration and raw-result JSON sections are Advance-only in both equipment layouts',()=>{
  const root=document.documentElement;
  const saved=['data-ui-mode','data-visual-style','data-equipment-layout','data-basic-view'].map(name=>[name,root.getAttribute(name)]);
  const sections=[document.getElementById('simulation-json-section'),document.getElementById('simulation-json-preview').closest('details')];
  try{
    for(const layout of ['split','combined'])for(const style of ['classic','elegant'])for(const view of ['equipment','conveyors']){
      root.dataset.equipmentLayout=layout;root.dataset.visualStyle=style;root.dataset.basicView=view;
      for(const mode of ['basic','advance']){
        root.dataset.uiMode=mode;
        for(const section of sections)for(const width of [360,1440]){
          if(mode==='basic')assert.equal(value(section,'display',width),'none');
          else assert.notEqual(value(section,'display',width),'none');
        }
      }
    }
  }finally{for(const [name,original] of saved)if(original===null)root.removeAttribute(name);else root.setAttribute(name,original);}
});
