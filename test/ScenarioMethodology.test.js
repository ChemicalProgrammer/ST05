import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenarioStudy, evaluateScenarioEconomics } from '../src/analysis/ScenarioMethodology.js';

function fixture() {
  const simulation = { id: 'line', unitOfFlow: 'bottles', equipment: [{ id: 'filler', name: 'Filler', nominalRatePerSecond: 1 }], whatIf: { methodology: {} } };
  const evaluation = {
    sourceSimulationId: 'line', sourceSignature: 'source:100', unitOfFlow: 'bottles',
    baseline: { throughput: 10, oee: 50 }, candidate: { throughput: 100, oee: 95 },
    evaluatedChanges: [{ equipmentId: 'filler', path: 'nominalRatePerSecond', before: 1, after: 2, unit: 'units/s' }],
    independentCheck: { passed: true, durationSeconds: 3600, rounds: 6, baseline: { throughput: 10, oee: 50 }, candidate: { throughput: 20, oee: 60 } }
  };
  const config = {
    currency: 'MXN', unitOfFlow: 'bottles', investment: 200, installationCost: 0, implementationLoss: 0,
    lifeYears: 3, discountRate: 0.1, annualOperatingMinutes: 10, contributionMarginPerUnit: 1,
    annualIncrementalDemand: 100, annualAvoidableSavings: 0, annualIncrementalOpex: 0, residualValue: 0,
    benefitBasis: 'INCREMENTAL_NON_OVERLAPPING', annualizationBasis: 'REPRESENTATIVE_CONFIRMATION_RATE'
  };
  simulation.whatIf.methodology.economics = config;
  config.packageSignature = buildScenarioStudy(simulation, evaluation).evaluatedPackage.signature;
  return { simulation, evaluation, config };
}
function near(actual, expected, tolerance = 1e-9) { assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' differs from ' + expected); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('economics use the confirmed complete package with known NPV, payback and lifetime ROI', () => {
  const { simulation, evaluation } = fixture();
  const result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.status, 'ESTIMATED');
  assert.equal(result.scope, 'EVALUATED_PACKAGE');
  assert.equal(result.deltaThroughputPerMinute, 10); // Screening gain was 90.
  assert.equal(result.annualNetBenefit, 100);
  near(result.npv, -200 + 100 / 1.1 + 100 / 1.1 ** 2 + 100 / 1.1 ** 3);
  near(result.simplePaybackYears, 2); near(result.simpleLifetimeRoi, 0.5);
  assert.equal(result.paybackWithinHorizon, true);
  assert.equal(result.cashFlows.length, 4);
  assert.equal(result.plantValidated, false);
});

test('economic missing values never become zero and explicit zero demand has no production value', () => {
  const { simulation, evaluation, config } = fixture();
  delete config.annualIncrementalDemand;
  let result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.status, 'NOT_EVALUATED');
  assert.ok(result.missingInputs.includes('economics.annualIncrementalDemand'));
  assert.equal(result.npv, undefined);
  config.annualIncrementalDemand = 0;
  result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.status, 'ESTIMATED');
  assert.equal(result.annualProductionContribution, 0); assert.equal(result.npv, -200);
  assert.equal(result.simplePaybackYears, null);
  for (const value of [null, '', undefined]) {
    const other = evaluateScenarioEconomics(simulation, evaluation, { ...config, installationCost: value });
    assert.equal(other.status, 'NOT_EVALUATED');
    assert.ok(other.missingInputs.includes('economics.installationCost'));
  }
});

test('usable demand caps added output and costs, savings, residual are counted exactly once', () => {
  const { simulation, evaluation, config } = fixture();
  Object.assign(config, { investment: 5000, installationCost: 500, implementationLoss: 500, annualOperatingMinutes: 1000,
    annualIncrementalDemand: 2000, contributionMarginPerUnit: 2, annualAvoidableSavings: 100, annualIncrementalOpex: 500,
    lifeYears: 2, residualValue: 1000 });
  const result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.annualCapacityGain, 10000);
  assert.equal(result.annualUtilizedIncrement, 2000);
  assert.equal(result.annualUnutilizedCapacityGain, 8000);
  assert.equal(result.annualNetBenefit, 3600);
  assert.equal(result.initialOutlay, 6000);
  near(result.npv, -6000 + 3600 / 1.1 + 4600 / 1.1 ** 2);
  near(result.simplePaybackYears, 6000 / 3600);
  assert.equal(result.cashFlows[2].amount, 4600);
  assert.match(result.contract.benefits, /non-overlapping/);
});

test('zero rate and outlay are explicit and do not produce infinite ROI or payback', () => {
  const { simulation, evaluation, config } = fixture();
  config.discountRate = 0; config.investment = 0;
  const result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.status, 'ESTIMATED'); assert.equal(result.npv, 300);
  assert.equal(result.simpleLifetimeRoi, null); assert.equal(result.simplePaybackYears, null);
  assert.equal(JSON.stringify(result).includes('Infinity'), false);
});

test('unconfirmed, missing, stale or degraded comparisons cannot create economics', () => {
  const mutate = [
    evaluation => { delete evaluation.independentCheck; },
    evaluation => { evaluation.independentCheck.passed = false; },
    evaluation => { delete evaluation.sourceSignature; },
    evaluation => { delete evaluation.sourceSimulationId; },
    evaluation => { evaluation.sourceSimulationId = 'other-line'; },
    evaluation => { evaluation.evaluatedChanges = []; },
    evaluation => { evaluation.evaluatedChanges[0].before = 5; },
    evaluation => { evaluation.independentCheck.candidate.throughput = 9; },
    evaluation => { evaluation.independentCheck.candidate.oee = 49; },
    evaluation => { evaluation.evaluatedChanges.push({ ...evaluation.evaluatedChanges[0] }); }
  ];
  for (const change of mutate) {
    const { simulation, evaluation } = fixture(); change(evaluation);
    const result = evaluateScenarioEconomics(simulation, evaluation);
    assert.equal(result.status, 'NOT_EVALUATED'); assert.equal(result.npv, undefined);
  }
});

test('costs are tied to the full canonical package and cannot follow another proposal or intervention', () => {
  const { simulation, evaluation, config } = fixture();
  const original = buildScenarioStudy(simulation, evaluation).evaluatedPackage;
  config.packageId = original.id;
  assert.equal(evaluateScenarioEconomics(simulation, evaluation).status, 'ESTIMATED');
  evaluation.evaluatedChanges[0].after = 3;
  let result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.status, 'NOT_EVALUATED');
  assert.ok(result.invalidInputs.includes('economics.packageSignature'));
  config.packageId = result.packageId; // Matching the short id alone is insufficient.
  result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.status, 'NOT_EVALUATED');
  config.packageSignature = result.packageSignature;
  assert.equal(evaluateScenarioEconomics(simulation, evaluation).status, 'ESTIMATED');
  evaluation.evaluatedChanges[0].interventionType = 'REPLACEMENT';
  assert.equal(evaluateScenarioEconomics(simulation, evaluation).status, 'NOT_EVALUATED');
  delete config.packageSignature;
  assert.ok(evaluateScenarioEconomics(simulation, evaluation).missingInputs.includes('economics.packageSignature'));
});

test('money, dimensions, rates, annual horizon and benefit contracts are validated', () => {
  const { simulation, evaluation, config } = fixture();
  for (const patch of [{ currency: '$' }, { currency: 'mxn' }, { unitOfFlow: 'cases' }, { unitOfFlow: 'bpm' },
    { annualOperatingMinutes: 0 }, { annualOperatingMinutes: 600000 }, { lifeYears: 2.5 }, { lifeYears: 0 }, { lifeYears: 101 },
    { discountRate: 10 }, { investment: '200' }, { contributionMarginPerUnit: -1 }, { investment: Infinity },
    { annualIncrementalOpex: -1 }, { benefitBasis: 'GROSS_SALES' }, { annualizationBasis: 'UNKNOWN' }]) {
    const result = evaluateScenarioEconomics(simulation, evaluation, { ...config, ...patch });
    assert.equal(result.status, 'NOT_EVALUATED', JSON.stringify(patch)); assert.ok(result.invalidInputs.length);
  }
  evaluation.independentCheck.throughputUnit = 'bottles/s';
  assert.equal(evaluateScenarioEconomics(simulation, evaluation).status, 'NOT_EVALUATED');
  delete evaluation.independentCheck.throughputUnit;
  evaluation.independentCheck.candidate.unitOfFlow = 'cases';
  assert.equal(evaluateScenarioEconomics(simulation, evaluation).status, 'NOT_EVALUATED');
});

test('financial sensitivity propagates only a consistent independent confirmation mean interval', () => {
  const { simulation, evaluation } = fixture();
  evaluation.independentCheck.statisticalEvidence = { available: true, confidenceLevel: 0.95, n: 6,
    metrics: { throughput: { mean: 10, lower: 8, upper: 12, inferenceAvailable: true } } };
  let result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.sensitivity.status, 'ESTIMATED');
  assert.equal(result.sensitivity.lower.annualNetBenefit, 80);
  assert.equal(result.sensitivity.upper.annualNetBenefit, 100); // Still limited by demand.
  evaluation.independentCheck.statisticalEvidence.metrics.throughput.mean = 90;
  result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.sensitivity.status, 'NOT_EVALUATED');
  assert.equal(result.sensitivity.reason, 'INVALID_OR_INCONSISTENT_CONFIRMATION_INTERVAL');
});

test('zero observed simulation variance remains descriptive and a negative bound is not silently zero', () => {
  const { simulation, evaluation } = fixture();
  evaluation.independentCheck.confirmationKind = 'DESCRIPTIVE_REPRODUCTION';
  evaluation.independentCheck.statisticalEvidence = { available: true, confidenceLevel: 0.95, n: 6,
    metrics: { throughput: { mean: 10, lower: null, upper: null, inferenceAvailable: false, reason: 'ZERO_OBSERVED_VARIANCE' } } };
  let result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.status, 'ESTIMATED'); assert.equal(result.confirmation.kind, 'DESCRIPTIVE_REPRODUCTION');
  assert.equal(result.sensitivity.status, 'NOT_EVALUATED');
  evaluation.independentCheck.statisticalEvidence.metrics.throughput = { mean: 10, lower: -1, upper: 21, inferenceAvailable: true };
  result = evaluateScenarioEconomics(simulation, evaluation);
  assert.equal(result.sensitivity.lower.status, 'NOT_EVALUATED');
  assert.equal(result.sensitivity.lower.reason, 'NEGATIVE_THROUGHPUT_BOUND_REQUIRES_BASELINE_DEMAND');
  assert.equal(result.sensitivity.lower.annualNetBenefit, undefined);
});

test('study keeps diagnosis, hypotheses, simulated evidence, economics and plant reports separate', () => {
  const { simulation, evaluation } = fixture();
  simulation.whatIf.methodology.objective = { metric: 'throughput', target: 18, unit: 'bottles/min', minimumPracticalGain: 5 };
  simulation.whatIf.methodology.interventions = [{ id: 'replace-filler', equipmentId: 'filler', type: 'REPLACEMENT',
    description: 'Supplier says replacement resolves failures.', targetSource: 'Supplier statement', sourceReference: 'Quote Q1',
    feasibility: { verified: true, description: 'User report' }, pilot: { validated: true, date: '2026-11-24', result: 'Reported gain' } }];
  evaluation.lossDiagnosis = { status: 'OBSERVED', equipment: [{ equipmentId: 'filler', failureSeconds: 60, starvedSeconds: 120 }], interpretation: 'Observed time, not causal loss.' };
  evaluation.capacityDiagnosis = { capacityCeilingPercent: 80, residualLossPp: 20, accountingAvailable: true };
  evaluation.engineeringReviewAcknowledged = true;
  const study = buildScenarioStudy(simulation, evaluation);
  assert.equal(study.objective.assessment.targetMet, true);
  assert.equal(study.objective.assessment.minimumPracticalGainMet, true);
  assert.equal(study.diagnosis.causalStatus, 'HYPOTHESES_ONLY');
  assert.equal(study.hypotheses[0].classification, 'REPLACEMENT');
  assert.equal(study.hypotheses[0].costClass, 'CAPEX');
  assert.equal(study.hypotheses[0].rootCauseVerified, false);
  assert.equal(study.hypotheses[0].targetAchievabilityVerified, false);
  assert.equal(study.hypotheses[0].targetSource.status, 'REPORTED_NOT_VERIFIED');
  assert.equal(study.evidence.confirmation.status, 'MODEL_REPRODUCED');
  assert.equal(study.evidence.screening.candidate.throughput, 100);
  assert.equal(study.evidence.confirmation.candidate.throughput, 20);
  assert.equal(study.feasibility.verified, false);
  assert.equal(study.plantValidation.status, 'REPORTED_NOT_VERIFIED');
  assert.equal(study.plantValidation.verified, false);
  assert.equal(study.economics.npvPositive, true);
  assert.equal(study.economics.plantValidated, false);
});

test('exploratory targets do not inherit CAPEX or feasibility from a reported replacement', () => {
  const { simulation, evaluation } = fixture();
  evaluation.evaluatedChanges[0].analysisOnly = true;
  evaluation.evaluatedChanges[0].interventionType = 'SENSITIVITY';
  simulation.whatIf.methodology.interventions = [{ equipmentId: 'filler', type: 'REPLACEMENT', sourceReference: 'Q1' }];
  const study = buildScenarioStudy(simulation, evaluation);
  assert.equal(study.hypotheses[0].classification, 'EXPLORATORY_SENSITIVITY');
  assert.equal(study.hypotheses[0].costClass, 'UNASSIGNED');
  assert.equal(study.feasibility.exploratoryTargets, true);
});

test('objectives with incompatible units or invalid magnitudes are not reported achieved', () => {
  const { simulation, evaluation } = fixture();
  for (const objective of [{ metric: 'throughput', target: 15, unit: 'cases/min' },
    { metric: 'oee', target: 101, unit: '%' }, { metric: 'throughput', target: -1, unit: 'bpm' },
    { metric: 'throughput', target: 15, unit: 'bpm', minimumPracticalGain: -1 }]) {
    simulation.whatIf.methodology.objective = objective;
    const assessment = buildScenarioStudy(simulation, evaluation).objective.assessment;
    assert.equal(assessment.status, 'NOT_EVALUATED');
    assert.equal(assessment.targetMet, undefined);
  }
});

test('study and economics preserve immutable inputs and serialize compactly without replay or recursive studies', () => {
  const { simulation, evaluation } = fixture();
  evaluation.replay = { enormous: 'x'.repeat(100000) };
  evaluation.study = { prior: 'x'.repeat(100000) };
  evaluation.trialHistory = Array.from({ length: 50 }, () => ({ replay: evaluation.replay }));
  evaluation.independentCheck.baseline.roundMetrics = Array.from({ length: 50 }, () => ({ replay: evaluation.replay }));
  const before = JSON.stringify({ simulation, evaluation });
  freeze(simulation); freeze(evaluation);
  const study = buildScenarioStudy(simulation, evaluation);
  assert.equal(JSON.stringify({ simulation, evaluation }), before);
  const serialized = JSON.stringify(study);
  assert.ok(serialized.length < 15000);
  assert.equal(serialized.includes('enormous'), false);
  assert.equal(serialized.includes('roundMetrics'), false);
  assert.equal(serialized.includes('trialHistory'), false);
});

test('missing source prevents traceable conclusions and missing methodology produces useful unevaluated stages', () => {
  const { simulation, evaluation } = fixture();
  delete simulation.whatIf.methodology;
  delete evaluation.sourceSignature;
  const study = buildScenarioStudy(simulation, evaluation);
  assert.equal(study.source.status, 'INCOMPLETE_OR_MISMATCHED');
  assert.equal(study.evidence.confirmation.status, 'UNTRACEABLE_EVIDENCE');
  assert.equal(study.objective.status, 'NOT_DEFINED');
  assert.equal(study.economics.status, 'NOT_EVALUATED');
  assert.ok(study.economics.missingInputs.includes('evaluation.sourceSignature'));
  assert.equal(study.plantValidation.status, 'NOT_EVALUATED');
  assert.doesNotThrow(() => JSON.stringify(buildScenarioStudy(undefined, undefined)));
});

test('an asserted pass with incomplete or regressed metrics does not prove reproduction or an objective', () => {
  const { simulation, evaluation } = fixture();
  simulation.whatIf.methodology.objective = { metric: 'throughput', target: 15, unit: 'bpm' };
  delete evaluation.independentCheck.durationSeconds;
  let study = buildScenarioStudy(simulation, evaluation);
  assert.equal(study.evidence.confirmation.status, 'INVALID_OR_INCOMPLETE_CONFIRMATION');
  assert.equal(study.objective.assessment.status, 'NOT_EVALUATED');
  evaluation.independentCheck.durationSeconds = 3600;
  evaluation.independentCheck.candidate.oee = 40;
  study = buildScenarioStudy(simulation, evaluation);
  assert.equal(study.evidence.confirmation.status, 'INVALID_OR_INCOMPLETE_CONFIRMATION');
  assert.equal(study.objective.assessment.targetMet, undefined);
});

test('both confirmation OEE metrics are required for reproduced claims and economic estimates', () => {
  for (const key of ['baseline', 'candidate']) {
    const { simulation, evaluation } = fixture();
    simulation.whatIf.methodology.objective = { metric: 'throughput', target: 15, unit: 'bpm' };
    delete evaluation.independentCheck[key].oee;
    const study = buildScenarioStudy(simulation, evaluation);
    assert.equal(study.evidence.confirmation.status, 'INVALID_OR_INCOMPLETE_CONFIRMATION');
    assert.equal(study.objective.assessment.status, 'NOT_EVALUATED');
    assert.equal(study.economics.status, 'NOT_EVALUATED');
    assert.ok(study.economics.missingInputs.includes('evaluation.independentCheck.' + key + '.oee'));
  }
});

test('the fixed independent confirmation plan and achieved precision remain distinct from DOE replication', () => {
  const { simulation, evaluation } = fixture();
  evaluation.confirmationPlan = {
    status: 'PLANNED', rounds: 12, requiredRounds: 12, capped: false, pilotSeeds: [41, 42, 43], pilotRounds: 3,
    confidenceLevel: .95, minRounds: 3, maxRounds: 30, targetHalfWidth: .5, plannedHalfWidth: .4,
    comparisonDurationSeconds: 1800, comparisonUnitOfFlow: 'bottles', baselineMeanThroughput: 10, pilotStandardDeviation: .6, reason: null,
    policy: 'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION', method: 'FIXED_SAMPLE_SIZE_FROM_SEPARATE_PILOT',
    pilotRole: 'FINALIST_RANKING_ONLY', confirmationMustExcludePilotSeeds: true,
    pilotRun: { rounds: 3, durationSeconds: 1800, seed: 41, commands: [{ secret: 'Do not copy commands' }], replay: { large: true } }
  };
  evaluation.doe = { combinations: 4, analysis: { complete: true }, observations: [] };
  Object.assign(evaluation.independentCheck, { rounds: 12, confirmationKind: 'PAIRED_CONFIDENCE_INTERVAL', practicalThreshold: .1,
    reason: null, precision: { targetHalfWidth: .5, achievedHalfWidth: .45, met: true, plannedRounds: 12, requiredRounds: 12, capped: false },
    oeeGuard: { observedMeanDelta: 10, passed: true, statisticalNonInferiorityEstablished: false } });
  const study = buildScenarioStudy(simulation, evaluation);
  const actual = study.evidence.experiment.replicationPlan.actual;
  assert.equal(actual.role, 'CONFIRMATION_NOT_DOE');
  assert.equal(actual.source, 'evaluation.confirmationPlan');
  assert.equal(actual.plan.rounds, 12); assert.equal(actual.plan.pilotRounds, 3);
  assert.equal(study.evidence.confirmation.confirmationPlan.policy, 'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION');
  assert.equal(study.evidence.confirmation.confirmationPlan.comparisonDurationSeconds, 1800);
  assert.equal(study.evidence.confirmation.confirmationPlan.comparisonUnitOfFlow, 'bottles');
  assert.equal(study.evidence.confirmation.confirmationPlan.baselineMeanThroughput, 10);
  assert.equal(study.evidence.confirmation.confirmationPlan.pilotStandardDeviation, .6);
  assert.equal(study.evidence.confirmation.confirmationPlan.reason, null);
  assert.equal(study.evidence.confirmation.precision.achievedHalfWidth, .45);
  assert.equal(study.evidence.confirmation.practicalThreshold, .1);
  assert.equal(study.evidence.confirmation.reason, null);
  assert.equal(study.evidence.confirmation.oeeGuard.statisticalNonInferiorityEstablished, false);
  assert.deepEqual(study.evidence.confirmation.confirmationPlan.pilotRun, { durationSeconds: 1800, rounds: 3, seed: 41 });
  assert.equal(evaluation.confirmationPlan.pilotRun.commands[0].secret, 'Do not copy commands');
});

test('diagnosis retains provenance, separate loss rankings and hypothesis limits with bounded arrays', () => {
  const { simulation, evaluation } = fixture();
  const ranking = Array.from({ length: 80 }, (_, index) => ({ rank: index + 1, equipmentId: 'unit-' + index, value: 80 - index, basis: 'OBSERVED_EVENT_COUNT' }));
  evaluation.lossDiagnosis = { status: 'OBSERVED', sourceStatus: 'CURRENT', reason: null, durationBasis: 'MEAN_ACTUAL_REPLICATION_DURATION',
    rankings: { failureFrequency: ranking }, opportunities: [{ equipmentId: 'filler', kind: 'INTERNAL_STOP_REDUCTION', evidenceLevel: 'HYPOTHESIS', causalStatus: 'NOT_ESTABLISHED' }],
    attribution: { additive: false, basis: 'OBSERVED_EQUIPMENT_STATES', causalStatus: 'NOT_ESTABLISHED', countsInferred: false } };
  let diagnosis = buildScenarioStudy(simulation, evaluation).diagnosis.observedLosses;
  assert.equal(diagnosis.sourceStatus, 'CURRENT');
  assert.equal(diagnosis.rankings.failureFrequency.length, 64);
  assert.equal(evaluation.lossDiagnosis.rankings.failureFrequency.length, 80);
  assert.equal(diagnosis.opportunities[0].causalStatus, 'NOT_ESTABLISHED');
  assert.equal(diagnosis.attribution.additive, false);
  assert.equal(diagnosis.attribution.countsInferred, false);
  evaluation.lossDiagnosis = { status: 'NO_COMPATIBLE_RESULTS', reason: 'PROVENANCE_VERSION_MISMATCH', sourceStatus: 'HISTORICAL', provenance: { recordedVersion: 'old', currentVersion: 'current' } };
  diagnosis = buildScenarioStudy(simulation, evaluation).diagnosis.observedLosses;
  assert.equal(diagnosis.reason, 'PROVENANCE_VERSION_MISMATCH');
  assert.equal(diagnosis.sourceStatus, 'HISTORICAL');
  assert.equal(diagnosis.provenance.recordedVersion, 'old');
});

test('a saved study retains conditional DOE inputs, horizon and per-seed responses after the source evaluation disappears', () => {
  const { simulation, evaluation } = fixture();
  evaluation.explorationRun = { durationSeconds: 600, durationMode: 'FIXED', rounds: 3, seed: 100, engineId: 'ST_CURRENT', productCatalog: [{ unnecessary: true }] };
  evaluation.doe = {
    type: 'FULL_FACTORIAL_TWO_LEVEL', roundsPerCombination: 3, combinations: 2,
    factors: [{ equipmentId: 'belt', path: 'speed', before: 10, low: 10, high: 20, unit: 'm/min' }],
    fixedChanges: [{ equipmentId: 'filler', path: 'noiseProfile.reliability.mtbfMinutes', before: 30, after: 60, unit: 'min', analysisOnly: true, interventionType: 'SENSITIVITY', replay: { doNotCopy: true } }],
    observations: [-1, 1].map((level, index) => ({ index, levels: [level], feasible: true, changes: [{ duplicate: true }],
      roundMetrics: [100, 101, 102].map((seed, round) => ({ seed, throughput: 100 + level * 5 + round, oee: 50 + level + round, replay: { large: true } })) })),
    analysis: { complete: true, effects: [{ factors: [0], throughput: 10 }] },
    anova: { complete: true, primaryInference: 'PAIRED_CONTRASTS_ACROSS_INDEPENDENT_SEED_BLOCKS', confidenceLevel: .95, seedIds: [100, 101, 102], replications: 3, multiplicity: { method: 'HOLM', familySize: 2 } }
  };
  const saved = JSON.parse(JSON.stringify(buildScenarioStudy(simulation, evaluation)));
  delete evaluation.doe; delete evaluation.explorationRun;
  const experiment = saved.evidence.experiment;
  assert.equal(experiment.fixedChanges[0].after, 60);
  assert.equal(experiment.fixedChanges[0].replay, undefined);
  assert.equal(experiment.effectScope.conditionalOnFixedChanges, true);
  assert.equal(experiment.roundsPerCombination, 3);
  assert.deepEqual(experiment.run, { durationSeconds: 600, durationMode: 'FIXED', rounds: 3, seed: 100, engineId: 'ST_CURRENT' });
  assert.equal(experiment.observations.length, 2);
  assert.deepEqual(experiment.observations[1].roundResponses[2], { seed: 102, oee: 53, throughput: 107 });
  assert.deepEqual(experiment.observations[0].levels, [-1]);
  assert.equal(experiment.observations[0].feasible, true);
  assert.equal(experiment.observations[0].changes, undefined);
  assert.equal(experiment.anova.multiplicity.method, 'HOLM');
});

test('DOE evidence bounds combinations and replications and prefers the recorded DOE run', () => {
  const { simulation, evaluation } = fixture();
  evaluation.explorationRun = { durationSeconds: 600, rounds: 3, seed: 10 };
  evaluation.doe = {
    run: { durationSeconds: 900, rounds: 100, seed: 500 }, roundsPerCombination: 100,
    observations: Array.from({ length: 17 }, (_, index) => ({ index, levels: [-1, 1, -1, 1], feasible: true,
      roundMetrics: Array.from({ length: 101 }, (_, round) => ({ seed: 500 + round, oee: 80, throughput: 100 + index })) }))
  };
  const experiment = buildScenarioStudy(simulation, evaluation).evidence.experiment;
  assert.equal(experiment.run.durationSeconds, 900); assert.equal(experiment.run.seed, 500);
  assert.equal(experiment.observations.length, 16); assert.equal(experiment.observationsOmitted, 1);
  assert.equal(experiment.observations[0].roundResponses.length, 100);
  assert.equal(experiment.observations[0].roundResponsesOmitted, 1);
  assert.equal(evaluation.doe.observations.length, 17);
  assert.equal(evaluation.doe.observations[0].roundMetrics.length, 101);
});
