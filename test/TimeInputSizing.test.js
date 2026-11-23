import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';

// Use the generated application resources. These tests exercise DOM behavior;
// CSS geometry is covered as a contract, not measured in this layout-free DOM.
const page=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
const scripts=[...page.window.document.querySelectorAll('script')].map(node=>node.textContent);
function servedModule(name){
  const source=scripts.find(source=>new RegExp('window\\.'+name+'\\s*=').test(source));
  assert.ok(source,'Missing served module '+name);return source;
}
const client=scripts.find(source=>source.includes('function applyScenarioRunInputs('));
assert.ok(client);
page.window.document.querySelectorAll('script,style,link').forEach(node=>node.remove());
const markup=page.window.document.body.innerHTML;
page.window.close();

function harness(){
  const errors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(markup,{runScripts:'outside-only',virtualConsole}),w=dom.window,d=w.document;
  w.eval(servedModule('STTimeControls'));
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert.equal(typeof w.__ST_TEXT__,'undefined');
  assert.equal(typeof w.__ST_HTML_TEXT__,'undefined');
  return {w,d,errors,node:id=>d.getElementById(id),close:()=>w.close()};
}
function parts(select){
  const wrapper=select.parentElement,input=wrapper.querySelector(':scope > input');
  return {wrapper,input,select,measure:wrapper.querySelector(':scope > .time-input-unit-measure')};
}
function assertFitted(control){
  assert.ok(control.measure);
  assert.equal(control.measure.textContent,control.select.selectedOptions[0].label);
  assert.equal(control.measure.getAttribute('aria-hidden'),'true');
  assert.ok(control.measure.hasAttribute('data-st-no-translate'));
  assert.ok(control.wrapper.classList.contains('time-value-control--fitted-unit'));
  assert.equal(control.wrapper.querySelectorAll('.time-input-unit-measure').length,1);
}

test('DOM-ready setup fits duration, sampling and the design-reference input without replacing native controls',()=>{
  const h=harness();
  try{
    const selects=[...h.d.querySelectorAll('.time-value-control > select')];
    assert.equal(selects.length,3,'The actual page includes both simulation inputs and the catalog example');
    for(const select of selects){
      const control=parts(select),value=control.input.value;
      assertFitted(control);assert.ok(select.getAttribute('aria-label'));
      h.w.STTimeControls.syncInputs();h.w.STTimeControls.syncInputs(control.wrapper);
      assertFitted(parts(select));
      assert.equal(parts(select).input,control.input);assert.equal(parts(select).measure,control.measure);
      assert.equal(control.input.value,value);
    }
    const fixed=h.node('simulation2d-limit').parentElement;
    assert.equal(fixed.querySelector('.time-input-unit').textContent,'min');
    assert.equal(fixed.querySelector('.time-input-unit-measure'),null,'Fixed units already have intrinsic text width');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('native changes fit every selected abbreviation while preserving the number, focus, nodes and output controls',()=>{
  const h=harness();
  try{
    const output=h.w.STTimeControls.output(9000,{unit:'min'});
    const live=h.w.STTimeControls.output(9000,{unit:'s',variant:'metric',reserveSeconds:86400});
    h.d.body.append(output,live);
    const snapshots=[output,live].map(node=>({node,html:node.outerHTML,value:node.querySelector('b'),unit:node.querySelector('select')}));
    for(const select of h.d.querySelectorAll('.time-value-control > select')){
      const dialog=select.closest('dialog');if(dialog)dialog.open=true;
      const control=parts(select);control.input.value='12.345';
      for(const option of select.options){
        select.focus();select.value=option.value;
        select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
        assertFitted(parts(select));
        assert.equal(h.d.activeElement,select,'A unit change must preserve native keyboard focus');
        assert.equal(parts(select).wrapper,control.wrapper);assert.equal(parts(select).input,control.input);
        assert.equal(parts(select).measure,control.measure);assert.equal(control.input.value,'12.345');
      }
      control.input.focus();h.w.STTimeControls.syncInputs();
      assert.equal(h.d.activeElement,control.input,'Refreshing units must not steal input focus');
    }
    for(const snapshot of snapshots){
      assert.equal(snapshot.node.outerHTML,snapshot.html,'Input sizing must not modify generic or live output reservations');
      assert.equal(snapshot.node.querySelector('b'),snapshot.value);
      assert.equal(snapshot.node.querySelector('select'),snapshot.unit);
    }
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('new controls and translated or long option labels use the displayed text instead of hardcoded unit lengths',()=>{
  const h=harness();
  try{
    const wrapper=h.d.createElement('span');wrapper.className='time-value-control';
    wrapper.innerHTML='<input type="number" value="1234.5"><select aria-label="Example unit"><option value="short">s</option><option value="long">kg/(m²·s)</option></select>';
    h.d.body.append(wrapper);h.w.STTimeControls.syncInputs(wrapper);
    const control=parts(wrapper.querySelector('select'));assertFitted(control);
    control.select.value='long';control.select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.equal(control.measure.textContent,'kg/(m²·s)');
    control.select.selectedOptions[0].label='kilogramos/(m²·s)';
    h.w.dispatchEvent(new h.w.CustomEvent('st-language-change',{detail:{language:'es'}}));
    assert.equal(control.measure.textContent,'kilogramos/(m²·s)','The native option label determines its visible width');
    control.select.value='short';control.select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.equal(control.measure.textContent,'s');assert.equal(control.input.value,'1234.5');
    assert.equal(parts(control.select).measure,control.measure);assertFitted(control);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('saved duration and sample units resize through real apply/sync without synthetic change events',()=>{
  const h=harness(),{w}=h;
  try{
    w.eval(servedModule('STRunOptions'));
    const start=client.indexOf('    function applyScenarioRunInputs(');
    const end=client.indexOf('\n    function cloneJson(',start);
    assert.ok(start>=0&&end>start);w.eval(client.slice(start,end));
    // Isolate the surrounding engine lock state. The actual restore function,
    // unit conversion, STRunOptions.apply and final sync all execute unchanged.
    w.syncDurationControls=()=>w.STRunOptions.sync(false);
    const duration=parts(h.node('run-duration-unit')),sample=parts(h.node('run-sample-interval-unit'));
    let changes=0;
    h.d.addEventListener('change',()=>changes++);
    const runs=[
      {durationMode:'FIXED',durationSeconds:3600,durationOptions:{method:'FIXED',amount:1,unit:'HOURS'},sampleDisplayUnit:'MINUTES',sampleEverySeconds:120},
      {durationMode:'FIXED',durationSeconds:172800,durationOptions:{method:'FIXED',amount:2,unit:'DAYS'},sampleDisplayUnit:'WEEKS',sampleEverySeconds:604800}
    ];
    for(const run of runs){
      w.applyScenarioRunInputs(run);
      for(const control of [duration,sample]){
        assertFitted(parts(control.select));
        assert.equal(parts(control.select).input,control.input);assert.equal(parts(control.select).measure,control.measure);
      }
      assert.equal(duration.input.value,String(run.durationOptions.amount));
      assert.equal(duration.select.value,run.durationOptions.unit);
      assert.equal(w.STRunOptions.durationSeconds(),run.durationSeconds);
      assert.equal(sample.select.value,run.sampleDisplayUnit);
      assert.equal(w.STTimeControls.inputSeconds(sample.input.value,sample.select.value),run.sampleEverySeconds);
    }
    duration.select.value='SECONDS';sample.select.value='SECONDS';w.STRunOptions.sync(true);
    assert.equal(duration.measure.textContent,'s');assert.equal(sample.measure.textContent,'s');
    assert.equal(duration.input.disabled,true);assert.equal(duration.select.disabled,true);
    assert.equal(changes,0,'Applying a saved configuration must not synthesize edits or invalidate results');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});
