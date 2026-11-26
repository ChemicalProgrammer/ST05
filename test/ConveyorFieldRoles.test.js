import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const src=fs.readFileSync('apps-script/ClientEquipment.html','utf8');
const slice=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)+a.length));
const fields=['population','lba','backup','overspeed','speed-mode','belt-speed','moving-gap','acc-factor','discharge-velocity','speed-factor','coding-factor','accumulated-gap','insurance','lact','lp-prime','package-length','discharge-pitch','discharge-runout','reject-runout','blocked-delay','clear-delay','stop-response','residual','downstream-ramp','restart-first-package','startup','infeed','accumulation-seconds'];
function harness(){
 const dom=new JSDOM('<article><div class="equipment-fields"></div></article>',{runScripts:'outside-only'}),w=dom.window,d=w.document,card=d.querySelector('article');
 card._fields=card.firstChild;
 for(const key of fields){
  const label=d.createElement('label'),control=d.createElement(key==='speed-mode'?'select':'input');
  control.className='format-zone-'+key;
  if(key==='speed-mode'){for(const mode of ['AUTO','MANUAL'])control.add(new w.Option(mode,mode));}else control.type='number';
  label.append(control);card._fields.append(label);
  if(['population','lba','backup','overspeed','accumulation-seconds','discharge-velocity','moving-gap'].includes(key)){
   const toggleLabel=d.createElement('label'),toggle=d.createElement('input');toggle.type='checkbox';toggle.checked=key==='moving-gap';toggle.className=control.className+'-enabled';toggleLabel.append(toggle);card._fields.append(toggleLabel);
  }
 }
 card.dataset.index='0';
 w.equipmentField=(card,selector)=>card.querySelector(selector);w.STBasicMode={isBasic:()=>true};
 w.eval(slice('    function prepareSwitchableFields','    function applyConceptTooltips')+slice('    function readFormatZoneInputs','    function mergeFormatZoneData')+slice('function numericInputValue','function parseJsonForPreview'));
 w.prepareSwitchableFields(card);
 const f=key=>card.querySelector('.format-zone-'+key);
 function check(key){f(key+'-enabled').checked=true;f(key+'-enabled').dispatchEvent(new w.Event('change'));w.syncSwitchableFields(card);}
 return {w,card,f,check,sync:()=>w.syncSwitchableFields(card),read:()=>w.readFormatZoneInputs(card),close:()=>w.close()};
}
test('geometry source switches are exclusive and derived values cannot become stored overrides',()=>{
 const h=harness();try{
  const {f,check,sync,read}=h;f('speed-mode').value='MANUAL';f('belt-speed').value='32.49';
  check('backup');f('backup').value='3000';sync();
  assert.equal(read().backupSensorPositionMm,3000);assert(f('lba').readOnly);
  check('lba');f('lba').value='34000';sync();f('backup').value='2500';
  assert(!f('backup-enabled').checked);assert(f('backup').readOnly);
  assert.equal(read().manualLbaMm,34000);assert.equal(read().backupSensorPositionMm,undefined);
  check('backup');assert(!f('lba-enabled').checked);assert.equal(f('backup').value,'3000');assert(f('lba').readOnly);
 }finally{h.close();}
});
test('speed target stores only active inputs and restores manual speed and factors after switching',()=>{
 const h=harness();try{
  const {f,check,sync,read}=h;f('speed-mode').value='MANUAL';f('belt-speed').value='32.49';f('moving-gap').value='20';f('acc-factor').value='15';sync();
  assert(f('acc-factor').readOnly);assert.equal(read().accFactorPercent,undefined);
  check('population');f('population').value='40';sync();f('belt-speed').value='44';f('moving-gap').value='100';f('acc-factor').value='80';
  assert(f('belt-speed').readOnly&&f('moving-gap').readOnly);
  assert.equal(read().targetPopulationPercent,40);assert.equal(read().conveyorSpeedMmPerSecond,undefined);assert.equal(read().movingGapMm,undefined);
  assert(Math.abs(read().inputValues.beltSpeedMmPerSecond-541.5)<1e-8);
  check('overspeed');assert(!f('population-enabled').checked);assert(f('population').readOnly);
  f('overspeed-enabled').checked=false;sync();
  assert.equal(f('belt-speed').value,'32.49');assert.equal(f('moving-gap').value,'20');assert(!f('belt-speed').readOnly);
  f('speed-mode').value='AUTO';sync();
  assert(f('belt-speed').readOnly);assert.equal(f('acc-factor').value,'15');assert.equal(read().accFactorPercent,15);
 }finally{h.close();}
});

test('declared accumulation, discharge velocity and moving gap keep independent manual references',()=>{
 const h=harness();try{
  const {f,check,sync,read}=h;sync();
  assert(f('accumulation-seconds').readOnly);assert(f('discharge-velocity').readOnly);
  f('accumulation-seconds').value='12.5';f('discharge-velocity').value='30';
  assert.equal(read().declaredAccumulationSeconds,undefined);assert.equal(read().dischargeVelocityMPerMinute,undefined);
  check('accumulation-seconds');f('accumulation-seconds').value='45';sync();assert.equal(read().declaredAccumulationSeconds,45);
  f('accumulation-seconds-enabled').checked=false;sync();f('accumulation-seconds').value='18';
  assert.equal(read().declaredAccumulationSeconds,undefined);assert.equal(read().inputValues.declaredAccumulationSeconds,45);
  check('accumulation-seconds');assert.equal(f('accumulation-seconds').value,'45');
  check('discharge-velocity');f('discharge-velocity').value='26';sync();assert.equal(read().dischargeVelocityMPerMinute,26);
  f('moving-gap').value='12';sync();f('moving-gap-enabled').checked=false;sync();f('moving-gap').value='22';
  assert(f('moving-gap').readOnly);assert.equal(read().movingGapMm,undefined);check('moving-gap');assert.equal(read().movingGapMm,12);
  check('population');assert(f('moving-gap-enabled').disabled);assert.equal(read().movingGapMm,undefined);
  f('population-enabled').checked=false;sync();assert.equal(read().movingGapMm,12);
 }finally{h.close();}
});
