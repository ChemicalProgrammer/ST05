import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createLinePlaybackSession} from '../src/simulation/LineSimulationEngine.js';

// Model-versioned trajectory after derived moving pitch and fixed packed spacing.
// The historical pre-policy fixture remains unchanged for provenance; this
// baseline protects the new behavior and is not independent plant validation.
// Sensor labels describe physical beam coverage, including a moving packed
// queue. The diagnostic correction changes no trajectory values or timestamps.
const reference=JSON.parse(fs.readFileSync(new URL('./fixtures/conveyor-tick-reference-derived-pitch.json',import.meta.url),'utf8'));
function projection(frame){
  return JSON.parse(JSON.stringify([frame.virtualSecond,frame.outputCount,frame.effectiveRuntimeSeconds,
    frame.runtimeLossSeconds,frame.buffers,
    frame.equipment.map(unit=>[unit.id,unit.outputCount,unit.internalInventoryBottles,
      unit.availabilityState,unit.stateSeconds,unit.failureCount,unit.startRampSeconds]),
    frame.accumulationZones.map(zone=>[zone.id,zone.waitingUnits,zone.inTransitUnits,
      zone.inventoryUnits,zone.backup,zone.prime,zone.transitPositionsMm])]));
}
for(const scenario of reference.cases)test('conveyor optimization preserves the prior trajectory: '+scenario.name,()=>{
  const session=createLinePlaybackSession(scenario.input);
  assert.equal(session.tickSeconds,1/120);
  const packed=scenario.expected.find(frame=>frame[6].some(zone=>zone[1]>0&&zone[2]===0));
  assert(packed,'The reference actually reaches a stationary packed queue');
  assert(scenario.expected.at(-1)[1]>packed[1],'The same queue later releases material');
  if(scenario.input.run.reliabilityEnabled)
    assert(scenario.expected.at(-1)[5].some(unit=>unit[5]>0),'The seeded case actually exercises a failure');
  for(const expected of scenario.expected){
    const second=expected[0];
    while(!session.finished&&session.time+1e-8<second)
      session.advanceTo(second,{budgetMs:1000,maxTicks:10000});
    assert.deepEqual(projection(session.snapshot()),expected,
      'Queue, sensor timestamps, material counts and state durations at '+second+' s');
    session.drainChartSamples();
  }
  assert.equal(session.finished,true);
});
