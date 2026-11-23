import test,{after} from 'node:test';
import assert from 'node:assert/strict';
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
  const key=[width,document.documentElement.dataset.uiMode,document.documentElement.dataset.visualStyle].join(':');
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

test('subsection descriptions own the full row independently of the title toolbar',()=>{
  const copies=[...document.querySelectorAll('.fold-heading > .subsection-heading-copy, .fold-heading > div:has(> h3 > .fold-toggle)')];
  assert(copies.length>=15,'Exercise regular, legacy, simulation, results and reference headings');
  for(const width of [360,760,1440])for(const copy of copies){
    const title=copy.querySelector(':scope > h3');
    const description=copy.querySelector(':scope > .subsection-description, :scope > .subsection-playback-meta');
    assert.equal(value(copy,'display',width),'contents',title.textContent.trim());
    assert.equal(value(title,'order',width),'0');
    assert.equal(value(title,'flex',width),'1 1 auto');
    assert.ok(description);
    assert.equal(value(description,'order',width),'2');
    assert.equal(value(description,'flex',width),'1 0 100%',title.textContent.trim()+' reserves a complete descriptive row');
    assert.equal(value(description,'max-width',width),'100%');
  }
});

test('custom and native headings center titles and tools with a shared row height in every visual mode',()=>{
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
          // Center both controls in one minimum-height row. Its 4 px gap to
          // the description is shared even when the toolbar is empty.
          assert.equal(value(title,'display',width),'flex',label);
          assert.equal(value(title,'align-self',width),'center',label);
          assert.equal(value(title,'align-items',width),'center',label);
          assert.equal(value(title,'min-block-size',width),'var(--control-height)',label);
          assert.equal(value(heading,'align-items',width),'center',label);
          assert.equal(value(heading.querySelector(':scope > .fold-tools'),'align-self',width),'center',label);
          assert.equal(value(heading,'display',width),'grid',label);
          assert.equal(value(title,'grid-row',width),'1',label);
          assert.equal(value(copy.querySelector(':scope > .subsection-description, :scope > .subsection-playback-meta'),'grid-row',width),'2',label);
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
          assert.equal(value(copy,'display',width),'contents',label);
          assert.equal(value(title,'align-self',width),'center',label);
          assert.equal(value(title,'align-items',width),'center',label);
          assert.equal(value(title,'min-block-size',width),'var(--control-height)',label);
          assert.equal(value(copy.parentElement.querySelector(':scope > .fold-tools'),'align-self',width),'center',label);
          assert.equal(value(copy.parentElement,'display',width),mode==='basic'&&copy.parentElement.parentElement.id==='run-config'?'none':'grid',label);
          assert.equal(value(copy.parentElement,'row-gap',width),'var(--subsection-description-gap)',label);
          assert.equal(value(copy.querySelector('.subsection-description'),'grid-row',width),'2',label);
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

test('shared descriptions stay readable at narrow widths and toolbars can wrap',()=>{
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
      assert.equal(value(tools,'flex-wrap',width),'wrap',(tools.parentElement.parentElement.id||tools.className)+' at '+width+' px');
      assert.equal(value(tools,'max-width',width),'100%');
    }
  }
});


test('canonical grids keep wrapped tools beside the title and descriptions on their own row',()=>{
  for(const header of document.querySelectorAll('.st-subsection-header')){
    const title=header.querySelector('.subsection-heading-title,.subsection-native-title');
    const description=header.querySelector('.subsection-playback-meta')||header.querySelector('.subsection-description');
    const tools=header.querySelector(':scope > .fold-tools');
    for(const width of [360,760,1440]){
      const context=header.closest('.fold-card').id+' / '+width;
      assert.equal(value(header,'display',width),'grid',context);
      assert.equal(value(title,'grid-row',width),'1',context);
      if(description){
        assert.equal(value(description,'grid-row',width),'2',context);
        assert.equal(value(description,'grid-column',width),'1 / -1',context);
        assert.equal(value(description,'padding-inline-start',width),'var(--subsection-text-inset)',context);
      }
      if(tools){
        assert.equal(value(tools,'grid-row',width),'1',context);
        assert.equal(value(tools,'grid-column',width),'2',context);
        assert.equal(value(tools,'flex-wrap',width),'wrap',context);
      }
    }
  }
});
