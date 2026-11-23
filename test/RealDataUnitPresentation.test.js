import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';

const read=name=>fs.readFileSync(new URL('../apps-script/'+name+'.html',import.meta.url),'utf8');
function harness(){
  const errors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(read('RealDataPanel'),{runScripts:'outside-only',virtualConsole}),w=dom.window;
  for(const name of ['Subsection','AemComparison','RealDataModel','RealData'])
    w.eval(read(name).replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
  const model=w.STRealDataModel,record=model.normalize({...model.empty(),id:'observed',name:'Observed production',
    durationSeconds:7200,rateLossSeconds:300,aem:{scrapSeconds:60,reworkSeconds:0},
    timeBreakdown:{external:{enabled:true,productionDayLossesSeconds:600},
      decision:{enabled:true,breaksSeconds:120},unplanned:{enabled:true,processShortagesSeconds:180}}});
  const state={activeCase:{id:'case',metadata:{realData:{schema:model.VERSION,records:[record]}}}};
  const simulation={id:'simulation',name:'Test simulation',equipment:[]};
  let changed=0;
  w.STRealData.init(state,{changed(){changed++;}});
  w.STRealData.render(state.activeCase,simulation,null);
  const query=selector=>w.document.querySelector(selector),input=id=>query('[data-time-value="'+id+'"]');
  const edit=(element,value)=>{element.value=value;element.dispatchEvent(new w.Event('input',{bubbles:true}));};
  return {w,state,model,errors,query,input,edit,toggle:id=>query('[data-time-toggle="'+id+'"]').click(),
    current:()=>state.activeCase.metadata.realData.records[0],changes:()=>changed,
    close:()=>w.close()};
}

test('real-data time controls use the shared input-unit wrapper and persistent effective-result nodes',()=>{
  const h=harness();
  try{
    for(const id of h.model.timeSectionIds){
      const input=h.input(id),wrapper=input.parentElement,group=wrapper.parentElement;
      assert.equal(wrapper.className,'time-value-control',id+' uses the shared unit typography and spacing');
      assert.equal(group.classList.contains('real-data-time-switch'),true);
      assert.equal(group.querySelector(':scope > input[type="checkbox"]').dataset.timeToggle,id,
        'The mode checkbox remains separate from the value-unit control');
      assert.equal(wrapper.querySelector(':scope > .time-input-unit').textContent,'min');
      assert.match(input.getAttribute('aria-label'),/\(min\)$/);
      assert.equal(input.readOnly,true);
      assert.equal(input.disabled,false,'Calculated values remain focusable read-only controls');
    }
    assert.equal(h.input('runtime').value,'105');
    const effective=h.input('effective');
    assert.equal(effective.tagName,'OUTPUT');
    assert.equal(effective.classList.contains('metric-value'),true);
    assert.equal(effective.querySelector('.metric-number').textContent,'99');
    assert.equal(effective.querySelector('.metric-unit').textContent,'min');
    assert.equal(effective.textContent,'99 min','Copying the result keeps a readable separator');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('manual overrides keep seconds, update dependent balances and retain units through mode changes',()=>{
  const h=harness();
  try{
    const runtime=h.input('runtime'),runtimeWrapper=runtime.parentElement,unit=runtimeWrapper.querySelector('.time-input-unit');
    const effective=h.input('effective'),number=effective.querySelector('.metric-number'),effectiveUnit=effective.querySelector('.metric-unit');
    h.toggle('runtime');
    assert.equal(runtime.readOnly,false);
    assert.equal(h.current().timeOverrides.runtime.enabled,true);
    h.edit(runtime,'95.5');
    assert.equal(h.current().timeOverrides.runtime.valueSeconds,5730,'Input minutes are still stored as seconds');
    assert.equal(h.model.timeHierarchy(h.current()).values.effective,5370);
    assert.equal(number.textContent,'89.5');
    h.toggle('runtime');
    assert.equal(runtime.readOnly,true);
    assert.equal(runtime.value,'105');
    assert.equal(number.textContent,'99');
    assert.equal(h.current().timeOverrides.runtime.valueSeconds,5730,'Calculated mode preserves the manual capture');
    h.toggle('runtime');
    assert.equal(runtime.value,'95.5');
    assert.equal(number.textContent,'89.5');
    assert.equal(runtime.parentElement,runtimeWrapper);
    assert.equal(runtimeWrapper.querySelector('.time-input-unit'),unit);
    assert.equal(effective.querySelector('.metric-number'),number);
    assert.equal(effective.querySelector('.metric-unit'),effectiveUnit);
    assert.equal(effective.textContent,'89.5 min');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('time mode checkboxes retain dependent-field locking and reject invalid manual input',()=>{
  const h=harness();
  try{
    const external=h.input('external'),concept=h.query('[data-real-field="timeBreakdown.external.productionDayLossesSeconds"]');
    const unit=external.parentElement.querySelector('.time-input-unit');
    assert.equal(concept.disabled,false);
    h.toggle('external');
    assert.equal(concept.disabled,true);
    assert.equal(external.readOnly,false);
    h.edit(external,'12.5');
    assert.equal(h.current().timeOverrides.external.valueSeconds,750);
    assert.equal(h.input('plant').value,'107.5');
    assert.equal(h.input('effective').querySelector('.metric-number').textContent,'96.5');
    const before=h.changes();
    h.edit(external,'-1');
    assert.equal(external.checkValidity(),false);
    assert.equal(h.changes(),before);
    assert.equal(h.current().timeOverrides.external.valueSeconds,750);
    h.toggle('external');
    assert.equal(concept.disabled,false);
    assert.equal(external.readOnly,true);
    assert.equal(external.value,'10');
    h.edit(concept,'15');
    assert.equal(h.current().timeBreakdown.external.productionDayLossesSeconds,900);
    assert.equal(external.value,'15');
    assert.equal(h.input('effective').querySelector('.metric-number').textContent,'94');
    assert.equal(external.parentElement.querySelector('.time-input-unit'),unit);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});
