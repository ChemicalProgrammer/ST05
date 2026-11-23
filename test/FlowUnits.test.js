import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Load the actual formatter without state, translation resources or a case.
// Unit selection belongs to callers; formatting does not infer a bottle factor.
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../apps-script/ClientUtils.html',import.meta.url),'utf8'),context);
const labels=unit=>JSON.parse(JSON.stringify(context.flowUnitLabels(unit)));

test('flow labels normalize bottle and case aliases regardless of language or case',()=>{
  for(const unit of ['bottle','bottles','BOTTLES','botella','botellas','  BoTeLlAs  '])
    assert.deepEqual(labels(unit),{count:'bottles',rate:'bpm'},unit);
  for(const unit of ['case','cases','CASES','caja','cajas','  CaJaS  '])
    assert.deepEqual(labels(unit),{count:'cases',rate:'cpm'},unit);
});

test('generic and unknown flow labels keep their declared meaning',()=>{
  for(const unit of ['unit','units','unidad','unidades','UNITS','',null,undefined,'  '])
    assert.deepEqual(labels(unit),{count:'units',rate:'units/min'},String(unit));
  for(const unit of ['pallets','Trays','kg','L'])
    assert.deepEqual(labels(unit),{count:unit,rate:unit+'/min'});
  assert.deepEqual(labels('  pallets  '),{count:'pallets',rate:'pallets/min'});
});

test('per-minute formatting changes the time basis once and preserves native bottle or case quantities',()=>{
  const rate=437.9/60,number=context.formatNumber(437.9);
  assert.equal(context.formatRatePerMinute(rate,'bottles'),number+' bpm');
  assert.equal(context.formatRatePerMinute(rate,'cases'),number+' cpm',
    'A case rate is not multiplied by a pack size');
  assert.equal(context.formatRatePerMinute(7,'BOTTLES'),context.formatNumber(420)+' bpm');
  assert.equal(context.formatRatePerMinute(347.83/60,'botellas'),context.formatNumber(347.83)+' bpm');
  assert.equal(context.formatRatePerMinute(rate,'pallets'),number+' pallets/min');
  assert.equal(context.formatRatePerMinute(rate),number+' units/min');
  assert.equal(context.formatRatePerMinute(0,'cajas'),'0 cpm');
});
