import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
function setup(type='CONVEYOR',profile={},data={}){
 const dom=new JSDOM('<article id="card"><section class="fields"><div class="equipment-grid"><select class="equipment-type"><option>CONVEYOR</option><option>FILLER</option></select></div><textarea class="equipment-noise-profile"></textarea><textarea class="equipment-process-data"></textarea></section></article>',{runScripts:'outside-only'}),w=dom.window;
 w.__ST_TEXT__=x=>x;w.STBasicMode={isBasic:()=>false};const card=w.document.getElementById('card');card._fields=card.querySelector('.fields');card.querySelector('select').value=type;card.querySelector('.equipment-noise-profile').value=JSON.stringify(profile);card.querySelector('.equipment-process-data').value=JSON.stringify(data);
 w.eval(fs.readFileSync('apps-script/ConfigurationEditor.html','utf8').replace(/^<script>|<\/script>\s*$/g,''));w.STReliabilityControls(card);
 return {w,card,toggle:card.querySelector('.reliability-enabled'),noise:()=>JSON.parse(card.querySelector('.equipment-noise-profile').value),data:()=>JSON.parse(card.querySelector('.equipment-process-data').value)};
}
test('conveyors never expose or enable own random failures',()=>{
 const h=setup();try{
  assert.equal(h.toggle.checked,false);assert(h.toggle.disabled&&h.toggle.parentElement.hidden);
  for(const key of ['mtbfMinutes','mttrMinutes'])assert(h.card.querySelector('.reliability-'+key).parentElement.hidden);
  assert(h.card.textContent.includes('Conveyors have no own random failures.'));
  h.toggle.checked=true;h.toggle.dispatchEvent(new h.w.Event('change'));assert.equal(h.toggle.checked,false);assert.equal(h.noise().reliability,undefined);assert(h.w.STReliabilityControls.valid(h.card));
 }finally{h.w.close();}
});

test('legacy conveyor failure data cannot become active on save',()=>{
 const rel={mtbfMinutes:120,mttrMinutes:3},split={minor:{mtbfMinutes:120,mttrMinutes:3},major:{mtbfMinutes:0,mttrMinutes:0}},h=setup('CONVEYOR',{reliability:rel},{equipment:{...rel,stopInputs:split},geometry:{lactMm:1000}});try{
  assert(!h.toggle.checked);assert(h.w.STReliabilityControls.valid(h.card));
  assert.equal(h.noise().reliability,undefined);assert.equal(h.data().equipment.stopInputs,undefined);assert.deepEqual(h.data().equipment.stopInputDrafts,split);assert.equal(h.data().geometry.lactMm,1000);
 }finally{h.w.close();}
});

test('machines allow failures and both sets of reliability fields stay visible',()=>{
 const h=setup('FILLER');try{
  assert(h.toggle.checked);assert(h.toggle.parentElement.hidden);assert(h.toggle.disabled);
  const general=h.card.querySelector('.reliability-mtbfMinutes'),minor=h.card.querySelector('[data-stop-class=minor]');
  assert(!general.parentElement.hidden&&!general.disabled);assert(!minor.parentElement.hidden&&minor.disabled);
  h.card.querySelector('select').value='CONVEYOR';h.card.querySelector('select').dispatchEvent(new h.w.Event('change'));assert(general.parentElement.hidden&&!h.toggle.checked);
  h.card.querySelector('select').value='FILLER';h.card.querySelector('select').dispatchEvent(new h.w.Event('change'));assert(!general.parentElement.hidden&&h.toggle.checked);
 }finally{h.w.close();}
});
