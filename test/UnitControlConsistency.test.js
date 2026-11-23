import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';

const rendered=renderAppsScript().html;
const page=new JSDOM(rendered,{virtualConsole:new VirtualConsole()});
const timeControls=[...page.window.document.querySelectorAll('script')]
  .map(node=>node.textContent).find(source=>/window\.STTimeControls\s*=/.test(source));
assert.ok(timeControls,'Expected the served time control module');
const rules=[];
function compare(a,b){return a[0]-b[0]||a[1]-b[1]||a[2]-b[2];}
function specificity(node){
  if(node.type==='id')return [1,0,0];
  if(node.type==='class'||node.type==='attribute')return [0,1,0];
  if(node.type==='tag')return [0,0,1];
  if(node.type==='pseudo'){
    if(node.value===':where')return [0,0,0];
    if([':is',':not',':has'].includes(node.value))return (node.nodes||[]).map(specificity).sort(compare).at(-1)||[0,0,0];
    return node.value.startsWith('::')?[0,0,1]:[0,1,0];
  }
  return (node.nodes||[]).map(specificity).reduce((sum,part)=>sum.map((value,index)=>value+part[index]),[0,0,0]);
}
for(const style of page.window.document.querySelectorAll('style'))postcss.parse(style.textContent).walkRules(rule=>{
  // Compare the unconditional component contract and theme/mode selectors.
  // This does not claim to measure browser geometry or evaluate media queries.
  for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule')return;
  for(const selector of selectorParser().astSync(rule.selector).nodes)rules.push({
    selector:selector.toString(),specificity:specificity(selector),
    declarations:rule.nodes.filter(node=>node.type==='decl')
  });
});
page.window.document.querySelectorAll('script,style,link').forEach(node=>node.remove());
const markup=page.window.document.documentElement.outerHTML;
page.window.close();

const inherited=new Set(['font-family','font-size','font-weight','line-height','color']);
function presentation(){
  const cache=new WeakMap(),matchedRules=new WeakMap();
  function value(element,property){
    if(!element)return undefined;
    let row=cache.get(element);if(!row){row=new Map();cache.set(element,row);}
    if(row.has(property))return row.get(property);
    const matches=[];
    let selected=matchedRules.get(element);
    if(!selected){
      selected=[];
      rules.forEach((rule,order)=>{try{if(element.matches(rule.selector))selected.push({rule,order});}catch{}});
      matchedRules.set(element,selected);
    }
    selected.forEach(({rule,order})=>{
      for(const declaration of rule.declarations)if(declaration.prop===property)
        matches.push({value:declaration.value,important:Boolean(declaration.important),specificity:rule.specificity,order});
    });
    const declared=matches.sort((a,b)=>Number(a.important)-Number(b.important)||compare(a.specificity,b.specificity)||a.order-b.order).at(-1)?.value;
    let resolved;
    if(declared==='inherit'||declared===undefined&&(property.startsWith('--')||inherited.has(property)))
      resolved=value(element.parentElement,property);
    else if(declared!==undefined)resolved=declared.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g,
      (_,token,fallback)=>value(element,token)??fallback??'');
    row.set(property,resolved);return resolved;
  }
  return value;
}
function dom(attributes={}){
  const instance=new JSDOM(markup,{runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  for(const [name,value] of Object.entries(attributes))instance.window.document.documentElement.setAttribute(name,value);
  instance.window.eval(timeControls);
  instance.window.STTimeControls.syncInputs();
  return instance;
}
const controlIds=['run-duration','run-sample-interval','simulation2d-limit'];
function parts(document,id){
  const input=document.getElementById(id),wrapper=input.parentElement;
  assert(wrapper.classList.contains('time-value-control'),id+' must use the shared component in the shipped HTML');
  const unit=wrapper.querySelector('select,.time-input-unit');
  assert(unit,id+' has a separate unit element');
  return {input,wrapper,unit};
}

test('duration, recording and 2D inputs share value/unit presentation in every mode and theme',()=>{
  for(const attributes of [
    {'data-ui-mode':'advance','data-theme':'light'},
    {'data-ui-mode':'basic','data-theme':'light'},
    {'data-ui-mode':'advance','data-visual-style':'elegant','data-theme':'light'},
    {'data-ui-mode':'basic','data-visual-style':'elegant','data-theme':'dark'}
  ]){
    const instance=dom(attributes),d=instance.window.document,css=presentation();
    try{
      for(const id of controlIds){
        const {input,wrapper,unit}=parts(d,id);
        assert.equal(css(input,'font-size'),'.8125rem',id+' uses input size independently of its label');
        assert.equal(css(input,'font-weight'),'400',id+' uses the normal input weight');
        for(const property of ['font-size','font-weight','line-height'])
          assert.equal(css(unit,property),css(input,property),id+' unit and value match for '+property);
        assert.equal(css(wrapper,'gap'),'8px',id+' uses the approved input-to-unit gap');
        assert.equal(css(input,'padding-inline-end'),'8px',id+' has the same internal trailing padding');
        assert.equal(css(unit,'padding'),'0',id+' does not add a second hidden unit gap');
        assert.equal(css(unit,'color'),css(unit,'--muted'),id+' unit follows the same muted theme color');
        assert.equal(css(wrapper,'display'),'inline-grid',id+' keeps the input and unit in one shared row');
        assert.equal(css(wrapper,'width'),'100%',id+' preserves its outer width');
        assert.equal(css(wrapper,'grid-template-columns').replace(/\s+/g,''),'minmax(0,1fr)max-content',
          id+' gives the input the remaining width after the selected unit');
        assert.equal(css(input,'width'),'100%',id+' fills its flexible column');
        assert.equal(css(input,'min-width'),'0',id+' can shrink without overflowing its row');
        if(unit.tagName==='SELECT'){
          assert.ok(unit.getAttribute('aria-label'));
          assert.equal(css(unit,'background-image'),'none');
          assert.equal(css(unit,'width'),'100%',id+' fills only the selected-label column');
          assert.equal(css(unit,'position'),'absolute',id+' cannot reserve the longest option width');
          const measure=wrapper.querySelector('.time-input-unit-measure');
          assert.ok(measure);assert.equal(measure.textContent,unit.selectedOptions[0].label);
          assert.equal(css(measure,'visibility'),'hidden');
          assert.equal(css(measure,'grid-area'),css(unit,'grid-area'));
          for(const property of ['font-size','font-weight','line-height'])
            assert.equal(css(measure,property),css(unit,property),id+' measures the same selected-unit typography');
        }else{
          assert.equal(css(unit,'width'),'auto',id+' fixed unit uses its natural text width');
        }
      }
    }finally{instance.window.close();}
  }
});

test('locking a value also dims its unit and preserves the same spacing and type',()=>{
  const instance=dom({'data-visual-style':'elegant','data-theme':'dark'}),d=instance.window.document;
  try{
    for(const id of controlIds){
      const {input,unit}=parts(d,id);input.disabled=true;
      if(unit.tagName==='SELECT')unit.disabled=true;
    }
    const css=presentation();
    for(const id of controlIds){
      const {input,wrapper,unit}=parts(d,id);
      assert.equal(css(input,'color'),css(input,'--disabled'));
      assert.equal(css(unit,'color'),css(input,'color'),id+' cannot leave its disabled unit in the accent color');
      assert.equal(css(input,'background'),css(input,'--disabled-bg'));
      assert.equal(css(unit,'background'),'transparent');
      assert.equal(css(wrapper,'gap'),'8px');
      assert.equal(css(unit,'font-size'),css(input,'font-size'));
      assert.equal(css(unit,'font-weight'),css(input,'font-weight'));
    }
  }finally{instance.window.close();}
});

test('shared result units match time units while keeping numbers and labels separate',()=>{
  const instance=dom(),w=instance.window,d=w.document;
  try{
    const card=d.createElement('article');card.className='metric-card metric-card--result';
    card.innerHTML='<span>Throughput</span><strong class="metric-value"><b class="metric-number">343.7</b><span class="metric-unit">bpm</span></strong>';
    d.getElementById('results-kpis').append(card);
    w.STTimeControls.setOutput(d.getElementById('metric-runtime-losses'),54.6,{unit:'min'});
    const css=presentation(),rate=card.querySelector('.metric-unit'),time=d.querySelector('#metric-runtime-losses .st-time-unit');
    for(const property of ['font-size','font-weight','line-height','color','vertical-align'])
      assert.equal(css(rate,property),css(time,property),'Fixed and selectable KPI units match for '+property);
    assert.equal(css(rate,'font-size'),'1rem');assert.equal(css(rate,'font-weight'),'600');
    assert.equal(css(rate.parentElement,'gap'),'2px');
    assert.equal(css(rate.parentElement,'align-items'),'baseline');
    assert.equal(card.querySelector('.metric-number').textContent,'343.7');
    assert.equal(rate.textContent,'bpm');
  }finally{w.close();}
});
