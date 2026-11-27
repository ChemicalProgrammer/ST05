import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateLine, createLinePlaybackSession} from '../src/simulation/LineSimulationEngine.js';

const CASE_RATE = 19 / 60;
const unit = (id, rate = CASE_RATE, flow = 'CASES') => ({
  id, name: id, type: 'CUSTOM', initialMode: 'AUTO', nominalRatePerSecond: rate,
  unitOfFlow: flow.toLowerCase(), processData: {flowUnits: {input: flow, output: flow}}
});
function conveyor(id, {length = 37500, productLength = 310, speed = 541.5,
  prime = 32500, ramp = 2, flow = 'CASES'} = {}) {
  return {...unit(id, CASE_RATE, flow), type: 'CONVEYOR', processData: {
    flowUnits: {input: flow, output: flow},
    accumulation: {
      speedMode: 'MANUAL', usableLengthMm: length, productLengthMm: productLength,
      conveyorSpeedMmPerSecond: speed,
      ...(prime === null ? {} : {primeSensorPositionMm: prime}),
      upstreamStopResponseSeconds: 0, bottlesDischargedAtStop: 0,
      downstreamRampUpSeconds: ramp
    }
  }};
}
function cases(run = {}, prime = 32500) {
  return {
    case: {id: 'basic-discrete-service', unitOfFlow: 'cases', equipment: [
      unit('source'), conveyor('belt', {prime}), unit('sink')
    ]},
    run: {durationSeconds: 900, tickSeconds: .25, sampleEverySeconds: 1,
      seed: 20260909, reliabilityEnabled: false, machineResidenceEnabled: true,
      machineDesignEnabled: false, numericalResolution: 'PRECISE', ...run}
  };
}
function calculate(input) {
  const response = simulateLine(input);
  assert(response.ok, JSON.stringify(response.error));
  return response.result;
}
const machine = (frame, id = 'sink') => frame.equipment.find(item => item.id === id);
const atOrAfter = (result, second) => result.samples.find(frame => frame.virtualSecond + 1e-7 >= second);
function assertConservation(result) {
  const balance = result.summary.materialBalance;
  assert.equal(balance.residualUnits, 0);
  assert(Math.abs(balance.inputUnits - balance.outputUnits - balance.inventoryUnits -
    balance.overflowUnits - (balance.clearoutUnits || 0)) < 1e-6);
}
function assertBasicWork(result, ids = ['source', 'sink']) {
  for (const frame of result.samples) for (const id of ids) {
    const item = machine(frame, id);
    assert(Number.isFinite(item.processingInventoryUnits), `${id}: explicit material in process`);
    assert(item.processingInventoryUnits >= 0 && item.processingInventoryUnits <= 1 + 1e-6,
      `${id}: Basic holds at most one output lot`);
    assert(item.processingServiceUnits >= -1e-6 &&
      item.processingServiceUnits <= item.processingInventoryUnits + 1e-6,
      `${id}: service cannot be earned without admitted material`);
    assert.equal(item.internalCapacityBottles, undefined, 'Basic does not enable advanced storage');
  }
}

test('Basic sustains nominal case cadence after Prime, without a ramp for each conveyor handoff', () => {
  for (const prime of [37000, 32500]) {
    const input = cases({}, prime), original = structuredClone(input), result = calculate(input);
    const first = atOrAfter(result, 600), last = result.samples.at(-1);
    const cpm = 60 * (last.outputCount - first.outputCount) / (last.virtualSecond - first.virtualSecond);
    assert(cpm >= 18.9 && cpm <= 19.1, `Prime ${prime}: sustained ${cpm} cases/min for a 19 cpm machine`);
    assert.equal(result.equipmentMetrics.sink.startRampCount, 1);
    const stable = result.samples.filter(frame => frame.virtualSecond >= 200);
    assert(stable.every(frame => !['STARVED', 'WAITING_FOR_PRIME'].includes(machine(frame).availabilityState)),
      'the normal advance of the next box is not a new lack of supply');
    assert(stable.some(frame => machine(frame).processingInventoryUnits > 0));
    const trigger = result.events.find(event => event.type === 'PRIME_SENSOR_TRIGGERED');
    assert(trigger, 'initial physical reserve must authorize the first start');
    assert(result.samples.filter(frame => frame.virtualSecond <= trigger.atVirtualSecond)
      .every(frame => machine(frame).outputCount === 0));
    assert.equal(result.accumulationZoneMetrics['belt--physical-zone'].primeTriggerCount, 1);
    assertConservation(result);
    assertBasicWork(result);
    assert.deepEqual(input, original);
  }
});

test('actual supply depletion rearms Prime; a distant arriving box does not bypass the reserve', () => {
  const result = calculate(cases({durationSeconds: 800, commands: [
    {equipmentId: 'source', atVirtualSecond: 200, action: 'STOP'},
    {equipmentId: 'source', atVirtualSecond: 500, action: 'RUN'}
  ]}));
  const waiting = result.samples.filter(frame => frame.virtualSecond >= 400 && frame.virtualSecond <= 500);
  assert(waiting.length > 20);
  assert(waiting.every(frame => machine(frame).availabilityState === 'WAITING_FOR_PRIME'));
  assert(waiting.every(frame => machine(frame).processingInventoryUnits === 0));
  assert(waiting.every(frame => frame.outputCount === waiting[0].outputCount));
  const recoveries = result.events.filter(event => event.type === 'PRIME_SENSOR_TRIGGERED' && event.atVirtualSecond > 500);
  assert.equal(recoveries.length, 1);
  assert(recoveries[0].atVirtualSecond > 600, 'travel plus the full 17-box reserve is still required');
  assert.equal(result.equipmentMetrics.sink.startRampCount, 2);
  assert(result.summary.outputCount > waiting[0].outputCount);
  assertConservation(result);
});

test('PAUSE and STOP retain the admitted Basic lot and its service credit', () => {
  for (const action of ['PAUSE', 'STOP']) {
    const result = calculate(cases({durationSeconds: 300, sampleEverySeconds: .25, commands: [
      {equipmentId: 'sink', atVirtualSecond: 180.5, action},
      {equipmentId: 'sink', atVirtualSecond: 200.5, action: 'RUN'}
    ]}));
    const stopped = result.samples.filter(frame => frame.virtualSecond >= 181 && frame.virtualSecond <= 200);
    const held = machine(stopped[0]);
    assert(held.processingInventoryUnits > 0, `${action} interrupts an admitted box`);
    assert(stopped.every(frame => machine(frame).outputCount === held.outputCount));
    assert(stopped.every(frame => machine(frame).processingInventoryUnits === held.processingInventoryUnits));
    assert(stopped.every(frame => machine(frame).processingServiceUnits === held.processingServiceUnits));
    assert(result.equipmentMetrics.sink.outputCount > held.outputCount);
    assertConservation(result);
    assertBasicWork(result);
  }
});

test('a failed Basic machine retains its box and resumes without an opt-out repair ramp', () => {
  const input = cases({durationSeconds: 360, sampleEverySeconds: .25, reliabilityEnabled: true});
  input.case.equipment[2].noiseProfile = {reliability: {mtbfMinutes: .7, mttrMinutes: .1}};
  const result = calculate(input), metrics = result.equipmentMetrics.sink;
  const failures = result.samples.filter(frame => machine(frame).availabilityState === 'FAILURE');
  assert(metrics.failureCount > 0 && metrics.repairRestartCount > 0);
  assert(failures.some(frame => machine(frame).processingInventoryUnits > 0));
  let checked = 0;
  for (let i = 1; i < result.samples.length; i++) {
    const previous = result.samples[i - 1], current = result.samples[i];
    const a = machine(previous), b = machine(current);
    // Separate repair episodes can be closer than the bounded sample interval.
    // Work between them is legitimate even if both retained frames say FAILURE.
    if (a.availabilityState !== 'FAILURE' || b.availabilityState !== 'FAILURE' ||
      a.failureCount !== b.failureCount ||
      current.virtualSecond - previous.virtualSecond > .5) continue;
    assert.equal(b.outputCount, a.outputCount);
    assert.equal(b.processingInventoryUnits, a.processingInventoryUnits);
    assert.equal(b.processingServiceUnits, a.processingServiceUnits);
    checked++;
  }
  assert(checked > 5, 'inspect multiple ticks inside real repair intervals');
  assert.equal(metrics.startRampCount, 1, 'repair does not repeat the initial Prime ramp');
  assertConservation(result);
});

test('a completed Basic lot is retained while its outlet is blocked', () => {
  const input = cases({durationSeconds: 350});
  input.case.equipment[2].id = input.case.equipment[2].name = 'middle';
  input.case.equipment.push(conveyor('outlet', {length: 5000, prime: 4690, ramp: 0}),
    {...unit('sink', 1), initialMode: 'STOP'});
  input.run.commands = [{equipmentId: 'sink', atVirtualSecond: 250, action: 'RUN'}];
  const result = calculate(input);
  const blocked = result.samples.filter(frame => frame.virtualSecond >= 200 && frame.virtualSecond <= 240)
    .map(frame => machine(frame, 'middle'));
  assert(blocked.length > 20);
  assert(blocked.every(item => item.availabilityState === 'BLOCKED'));
  assert(blocked.every(item => item.processingInventoryUnits === 1 && item.processingServiceUnits === 1));
  assert(blocked.every(item => item.outputCount === blocked[0].outputCount));
  assert(result.equipmentMetrics.middle.outputCount > blocked[0].outputCount);
  assertConservation(result);
  assertBasicWork(result, ['source', 'middle', 'sink']);
});

test('Back-up and STOP run-out cannot manufacture a second residual box and still account for overflow', () => {
  for (const cause of ['BACKUP', 'STOP']) {
    const input = cases({durationSeconds: 20, sampleEverySeconds: .05});
    input.case.equipment = [unit('source', 1),
      conveyor('belt', {length: 4000, speed: 1000, prime: 3690, ramp: 0}),
      {...unit('sink', 1), initialMode: 'STOP'}];
    Object.assign(input.case.equipment[1].processData.accumulation, {
      bottlesDischargedAtStop: 2, backupSensorPositionMm: 1000,
      blockedTimeDelaySeconds: cause === 'BACKUP' ? .5 : 30, clearTimeDelaySeconds: .5
    });
    if (cause === 'STOP') input.run.commands = [{equipmentId: 'source',
      atVirtualSecond: 11.25, action: 'STOP'}];
    const result = calculate(input);
    const trigger = result.events.find(event => cause === 'BACKUP'
      ? event.type === 'BACKUP_SENSOR_BLOCKED'
      : event.type === 'COMMAND_APPLIED' && event.action === 'STOP');
    assert(trigger);
    const before = result.samples.filter(frame => frame.virtualSecond < trigger.atVirtualSecond - .05).at(-1);
    const held = machine(before, 'source'), end = result.equipmentMetrics.source;
    assert.equal(held.processingInventoryUnits, 1, 'exactly one real lot exists when run-out starts');
    assert.equal(end.outputCount - held.outputCount, 1,
      'configured run-out of two is capped by the single admitted lot');
    assert.equal(end.processingInventoryUnits, 0);
    assert.equal(end.processingServiceUnits, 0);
    assert(result.samples.filter(frame => frame.virtualSecond >= 13)
      .every(frame => machine(frame, 'source').availabilityState ===
        (cause === 'BACKUP' ? 'BACKUP_STOP' : 'STOPPED')),
      'run-out completes instead of waiting forever for a nonexistent second lot');
    assert.equal(result.summary.materialBalance.overflowUnits, 1,
      'the actual residual box spills when the conveyor entry is already occupied');
    assert.equal(input.case.equipment[1].processData.accumulation.bottlesDischargedAtStop, 2);
    assertConservation(result);
    assertBasicWork(result);
  }
});

function packingCase(changeover = false) {
  const input = cases({durationSeconds: 90, sampleEverySeconds: .25});
  input.case.unitOfFlow = 'bottles';
  input.case.equipment = [unit('source', 8, 'BOTTLES'),
    conveyor('belt', {length: 5000, productLength: 50, speed: 1000, prime: 4900, ramp: 2, flow: 'BOTTLES'}),
    {...unit('packer', 1, 'CASES'), type: 'CASE_PACKER', processData: {flowUnits: {input: 'BOTTLES', output: 'CASES'}}}];
  input.run.productCatalog = [
    {id: 'twelve', name: '12 bottles', bottlesPerCase: 12, bottleLengthMm: 50, caseLengthMm: 310},
    {id: 'six', name: '6 bottles', bottlesPerCase: 6, bottleLengthMm: 50, caseLengthMm: 310}
  ];
  input.run.initialProductId = 'twelve';
  if (changeover) input.run.plannedStops = [{category: 'changeoverMinutes', startSeconds: 40,
    endSeconds: 42, targetProductId: 'six', restartPolicy: 'RESTART'}];
  return input;
}

test('Basic packs whole 12-bottle cases while retaining and accounting for partial input lots', () => {
  const result = calculate(packingCase());
  const packs = result.samples.map(frame => machine(frame, 'packer'));
  assert(packs.some(item => item.processingInventoryUnits > 0 && item.processingInventoryUnits < 1),
    'individual bottles occupy a partial output lot before a whole case can be discharged');
  assert(packs.every(item => Number.isInteger(item.outputCount)));
  assert(result.equipmentMetrics.packer.outputCount > 0);
  assert.equal(result.summary.outputCount, 12 * result.equipmentMetrics.packer.outputCount);
  assertBasicWork(result, ['source', 'packer']);
  assertConservation(result);
});

test('a format change clears Basic work in process using the old 12-bottle factor before switching to six', () => {
  const result = calculate(packingCase(true));
  const rows = result.products.rows;
  assert.equal(rows.length, 2);
  assert(rows.every(row => row.outputNative > 0 && Number.isInteger(row.outputNative)));
  for (const row of rows) assert.equal(row.outputBottleEquivalents, row.outputNative * row.bottlesPerCase);
  assert.equal(result.summary.outputCount, rows.reduce((sum, row) => sum + row.outputBottleEquivalents, 0));
  assert(result.summary.materialBalance.clearoutUnits > 0);
  assert.equal(result.summary.materialBalance.clearoutUnits, rows[0].clearoutBottleEquivalents);
  assertBasicWork(result, ['source', 'packer']);
  assertConservation(result);
});

test('Basic handoffs retain nominal cadence at both physical resolutions', () => {
  const precise = calculate(cases()), fast = calculate(cases({numericalResolution: 'FAST'}));
  assert(Math.abs(precise.summary.outputCount - fast.summary.outputCount) <= 1,
    'changing the integration step must not charge a new transfer interval per box');
  assert.equal(fast.equipmentMetrics.sink.startRampCount, 1);
  assertConservation(fast);
});

test('incremental playback preserves the same Basic processing state as a complete run', () => {
  const input = cases({durationSeconds: 180});
  const complete = calculate(input), playback = createLinePlaybackSession(input);
  for (let target = 11; target < 180; target += 11)
    playback.advanceTo(target, {budgetMs: 100000, maxTicks: 100000});
  const frame = playback.advanceTo(180, {budgetMs: 100000, maxTicks: 100000});
  assert(playback.finished);
  assert.equal(frame.outputCount, complete.summary.outputCount);
  for (const id of ['source', 'sink']) {
    const a = machine(frame, id), b = complete.equipmentMetrics[id];
    assert(Number.isFinite(a.processingInventoryUnits) && Number.isFinite(a.processingServiceUnits));
    assert.equal(a.outputCount, b.outputCount);
    assert.equal(a.processingInventoryUnits, b.processingInventoryUnits);
    assert.equal(a.processingServiceUnits, b.processingServiceUnits);
  }
});
