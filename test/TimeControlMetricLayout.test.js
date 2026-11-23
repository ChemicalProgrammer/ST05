import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';

const source=name=>fs.readFileSync(new URL('../apps-script/'+name+'.html',import.meta.url),'utf8');
const displayNumber=new Intl.NumberFormat(undefined,{maximumFractionDigits:3});
function harness(durationSeconds=3600){
  const dom=new JSDOM('<article class="live-equipment-card"><div class="live-equipment-detail-grid">'
    +'<section class="live-equipment-state-details"><div class="live-equipment-state-grid"></div></section>'
    +'<section class="live-equipment-2d-summary"><div class="live-equipment-2d-rows"></div></section>'
    +'</div></article>',{runScripts:'outside-only'});
  const w=dom.window;
  w.state={run:{configuration:{durationSeconds},result:{durationSeconds}}};
  w.eval(source('TimeControls').replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
  w.eval(source('ClientPlayback'));
  const card=w.document.querySelector('article'),host=card.querySelector('.live-equipment-state-grid');
  return {w,card,host,close:()=>w.close(),update:rows=>w.updateNumerical2DRows(host,rows,'states',card)};
}
const controlParts=host=>{
  const wrapper=host.querySelector('.st-time-output');
  return {wrapper,value:wrapper.querySelector('b'),unit:wrapper.querySelector('select')};
};
const reservedWidth=wrapper=>wrapper.style.getPropertyValue('--st-time-value-width').trim();

test('state counters retain exact values, nodes and their horizon reservation through digit changes',()=>{
  const h=harness(86400),{w,host}=h;
  try{
    let original,reservation;
    for(const seconds of [0,7572.533,7573,9928.8,9932.833,9999.999,10000,10009,10012.467,86399.999,86400]){
      h.update([['Running',seconds,'s'],['Starved',0,'s']]);
      const current=controlParts(host);
      assert.equal(current.wrapper.dataset.variant,'metric');
      assert.equal(current.wrapper.dataset.unit,'s');
      assert.equal(current.wrapper.dataset.seconds,String(seconds));
      assert.equal(current.value.textContent,displayNumber.format(seconds),'No truncation or precision loss');
      assert.equal(current.unit.tagName,'SELECT','Time units remain native accessible controls');
      assert.ok(current.unit.getAttribute('aria-label'));
      if(!original){
        original=current;reservation=reservedWidth(current.wrapper);
        assert.match(reservation,/^\d+(?:\.\d+)?ch$/);
        assert.ok(parseFloat(reservation)>=10);
      }else{
        for(const part of ['wrapper','value','unit'])assert.equal(current[part],original[part],part+' is reused');
        assert.equal(reservedWidth(current.wrapper),reservation,'A frame must not resize the reserved slot');
      }
    }
    w.updateNumerical2DRows(h.card.querySelector('.live-equipment-2d-rows'),[['Design speed','600','bpm']],'summary',h.card);
    assert.equal(h.card.querySelector('.live-equipment-2d-rows b').textContent,'600');
    assert.equal(h.card.querySelector('.live-equipment-2d-unit').textContent,'bpm');
    for(const value of [null,1,null]){
      h.update([['Ramp down',value]]);
      assert.equal(host.querySelector('b').textContent,value===null?'N/A':'1',
        'Returning to an unavailable state must replace the previous counter');
      assert.equal(Boolean(host.querySelector('.st-time-output')),value!==null);
    }
  }finally{h.close();}
});

test('changing the horizon refreshes the reservation even when the measured value has not changed',()=>{
  const h=harness(),{w,host}=h;
  try{
    const rows=[['Running',7572.533,'s']];
    h.update(rows);
    const original=controlParts(host),hourWidth=reservedWidth(original.wrapper);
    w.state.run.configuration.durationSeconds=86400;
    h.update(rows);
    assert.equal(controlParts(host).wrapper,original.wrapper);
    assert.equal(reservedWidth(original.wrapper),hourWidth,'The minimum budget already covers one day');
    w.state.run.configuration.durationSeconds=604800;
    h.update(rows);
    const weekWidth=reservedWidth(original.wrapper);
    assert.ok(parseFloat(weekWidth)>parseFloat(hourWidth),'A longer run receives more numeric room before values grow');
    assert.equal(original.value.textContent,displayNumber.format(7572.533));
    assert.equal(original.wrapper.dataset.seconds,'7572.533');
    h.update([['Running',604799.999,'s']]);
    assert.equal(reservedWidth(original.wrapper),weekWidth,'Decimals do not change the chosen budget');
    assert.equal(original.value.textContent,displayNumber.format(604799.999));
    delete w.state.run.configuration;
    w.state.run.result.durationSeconds=604800;
    h.update([['Running',604800,'s']]);
    assert.equal(reservedWidth(original.wrapper),weekWidth,'Saved results supply the horizon when configuration is absent');
  }finally{h.close();}
});

test('a unit change applies within its state group without changing seconds, nodes or other controls',()=>{
  const h=harness(86400),{w,host}=h;
  try{
    h.update([['Running',3600,'s'],['Starved',120,'s']]);
    const original=[...host.querySelectorAll('.st-time-output')].map(wrapper=>({
      wrapper,value:wrapper.querySelector('b'),unit:wrapper.querySelector('select'),
      seconds:wrapper.dataset.seconds,width:reservedWidth(wrapper)
    }));
    const unrelated=w.STTimeControls.output(90,{unit:'s'});
    w.document.body.append(unrelated);
    for(const [unit,factor] of [['min',60],['h',3600],['d',86400],['wk',604800],['s',1]]){
      original[0].unit.value=unit;
      original[0].unit.dispatchEvent(new w.Event('change',{bubbles:true}));
      for(const part of original){
        assert.equal(part.wrapper.dataset.unit,unit);
        assert.equal(part.unit.value,unit);
        assert.equal(part.wrapper.dataset.seconds,part.seconds,'Unit changes never change stored seconds');
        assert.equal(part.value.textContent,displayNumber.format(Number(part.seconds)/factor));
        assert.equal(part.wrapper.querySelector('b'),part.value);
        assert.equal(part.wrapper.querySelector('select'),part.unit);
        assert.equal(reservedWidth(part.wrapper),part.width);
      }
      assert.equal(unrelated.querySelector('select').value,'s','Other groups are not changed');
      h.update([['Running',3600,'s'],['Starved',120,'s']]);
      assert.equal(original[0].unit.value,unit,'The next playback frame preserves the chosen unit');
    }
    assert.equal(unrelated.hasAttribute('data-variant'),false,'Metric appearance never leaks to a generic control');
    assert.equal(reservedWidth(unrelated),'');
    assert.equal(unrelated.querySelector('b').classList.contains('numeric-time-value'),false);
    unrelated.querySelector('select').value='min';
    unrelated.querySelector('select').dispatchEvent(new w.Event('change',{bubbles:true}));
    assert.equal(unrelated.querySelector('b').textContent,displayNumber.format(1.5),
      'A standalone control also refreshes immediately on a unit change');
    assert.equal(unrelated.dataset.unit,'min');
    assert.equal(unrelated.dataset.seconds,'90');
  }finally{h.close();}
});

// This evaluates matching declarations and selector precedence in the complete
// generated stylesheet. JSDOM does not measure pixels: this is a cascade
// regression check, not a browser layout or visual-stability test.
function specificity(node){
  const add=(a,b)=>a.map((value,index)=>value+b[index]);
  const maximum=nodes=>nodes.map(specificity).sort(compareSpecificity).at(-1)||[0,0,0];
  if(node.type==='id')return [1,0,0];
  if(node.type==='class'||node.type==='attribute')return [0,1,0];
  if(node.type==='tag')return [0,0,1];
  if(node.type==='pseudo'){
    if(node.value===':where')return [0,0,0];
    if([':is',':not',':has'].includes(node.value))return maximum(node.nodes||[]);
    return node.value.startsWith('::')?[0,0,1]:[0,1,0];
  }
  return (node.nodes||[]).reduce((total,child)=>add(total,specificity(child)),[0,0,0]);
}
function compareSpecificity(a,b){return a[0]-b[0]||a[1]-b[1]||a[2]-b[2];}
function renderedRules(){
  const rendered=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
  const rules=[];
  for(const style of rendered.window.document.querySelectorAll('style'))postcss.parse(style.textContent).walkRules(rule=>{
    // Relevant metric declarations are unconditional; do not pretend to evaluate
    // viewport, container or feature conditions in a DOM without layout.
    for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule')return;
    const selectors=selectorParser().astSync(rule.selector).nodes;
    for(const selector of selectors)rules.push({selector:selector.toString(),specificity:specificity(selector),
      declarations:rule.nodes.filter(node=>node.type==='decl')});
  });
  rendered.window.close();
  return rules;
}
const styles=renderedRules();
function matchingDeclarations(element,property){
  const matches=[];
  styles.forEach((rule,order)=>{
    let matched=false;try{matched=element.matches(rule.selector);}catch{return;}
    if(matched)for(const declaration of rule.declarations)if(declaration.prop===property)
      matches.push({...rule,order,value:declaration.value,important:Boolean(declaration.important)});
  });
  return matches.sort((a,b)=>Number(a.important)-Number(b.important)
    ||compareSpecificity(a.specificity,b.specificity)||a.order-b.order);
}

test('generated CSS gives metric numbers the summary weight and keeps generic inheritance out of them',()=>{
  const h=harness(),{w,host,card}=h;
  try{
    h.update([['Running',7572.533,'s']]);
    w.updateNumerical2DRows(card.querySelector('.live-equipment-2d-rows'),[['Design speed','600','bpm']],'summary',card);
    const {value,unit}=controlParts(host),summary=card.querySelector('.live-equipment-2d-rows b');
    const valueWeights=matchingDeclarations(value,'font-weight');
    assert.equal(valueWeights.at(-1)?.value,matchingDeclarations(summary,'font-weight').at(-1)?.value);
    assert.equal(valueWeights.at(-1)?.value,'var(--weight-semibold)');
    assert.equal(valueWeights.some(rule=>rule.important&&rule.value==='inherit'),false,
      'The generic important inheritance rule must exclude metric values');
    assert.equal(matchingDeclarations(unit,'font-weight').at(-1)?.value,'var(--weight-regular)');
    assert.equal(matchingDeclarations(value,'white-space').at(-1)?.value,'nowrap');
    assert.ok(matchingDeclarations(value,'inline-size').at(-1)?.value.includes('--st-time-value-width'),
      'The counter uses the reserved inline size, not only an intrinsic minimum');
    assert.equal(matchingDeclarations(unit,'width').some(rule=>rule.value.includes('--time-unit-slot')),false,
      'The general trailing unit slot must not apply to compact state counters');
    const generic=w.STTimeControls.output(60,{unit:'s'});w.document.body.append(generic);
    assert.equal(matchingDeclarations(generic.querySelector('b'),'font-weight').at(-1)?.value,'inherit');
    assert.ok(matchingDeclarations(generic.querySelector('select'),'width').at(-1)?.value.includes('--time-unit-slot'));
  }finally{h.close();}
});
