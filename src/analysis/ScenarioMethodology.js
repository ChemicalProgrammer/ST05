// Scenario evidence is conditional on the model. Reported sources, quotations
// and pilots never become verified causes, feasible targets or plant validation.
// The standard study is technical: no budget amounts or financial ranking.
// The separate explicit economics API concerns the complete checked package.
import { scenarioStopDataCoverage } from './ScenarioPlanner.js';

const scenarioStudyEconomicNumbers = Object.freeze({
  investment: [0, Infinity], installationCost: [0, Infinity], implementationLoss: [0, Infinity],
  lifeYears: [1, 100], discountRate: [0, 1], annualOperatingMinutes: [0, 527040],
  contributionMarginPerUnit: [0, Infinity], annualIncrementalDemand: [0, Infinity],
  annualAvoidableSavings: [0, Infinity], annualIncrementalOpex: [0, Infinity], residualValue: [0, Infinity]
});
const scenarioStudyExcludedKeys = new Set(['__proto__', 'constructor', 'prototype', 'replay', 'study', 'trialHistory', 'roundMetrics', 'inputSignature']);

// Canonical technical inputs for cache/confirmation identity. Monetary sections
// are intentionally excluded only at the top level; qualitative intervention
// types and costClass, replication settings and all other technical data remain.
export function scenarioTechnicalMethodology(methodology={}) {
  if(!scenarioStudyRecord(methodology))return {};
  const monetary=new Set(['economics','budget','capexBudget','investmentBudget']);
  function canonical(value,ancestors=new Set()){
    if(!value||typeof value!=='object')return value;
    if(ancestors.has(value))throw Error('SCENARIO_INVALID_METHODOLOGY_CYCLE');
    const next=new Set(ancestors);next.add(value);
    if(Array.isArray(value))return value.map(item=>canonical(item,next));
    return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key],next)]));
  }
  return canonical(Object.fromEntries(Object.entries(methodology).filter(([key])=>!monetary.has(key))));
}

function scenarioStudyText(value, limit = 2000) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
}
function scenarioStudyNumber(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function scenarioStudyRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
// Bounded, JSON-safe copies also make externally supplied evidence non-recursive.
function scenarioStudyCopy(value, depth = 0, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 4000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== 'object' || depth > 5 || ancestors.has(value)) return null;
  const next = new Set(ancestors); next.add(value);
  if (Array.isArray(value)) return value.slice(0, 64).map(item => scenarioStudyCopy(item, depth + 1, next));
  const copy = {};
  Object.keys(value).filter(key => !scenarioStudyExcludedKeys.has(key)).slice(0, 48).forEach(key => {
    copy[key] = scenarioStudyCopy(value[key], depth + 1, next);
  });
  return copy;
}
function scenarioStudyPick(value, keys) {
  const result = {};
  if (scenarioStudyRecord(value)) keys.forEach(key => {
    if (Object.hasOwn(value, key)) result[key] = scenarioStudyCopy(value[key]);
  });
  return result;
}
function scenarioStudyFlowUnit(value) {
  const unit = scenarioStudyText(value)?.toLowerCase();
  return { bottle: 'bottles', bottles: 'bottles', case: 'cases', cases: 'cases', pallet: 'pallets', pallets: 'pallets', unit: 'units', units: 'units' }[unit] || null;
}
function scenarioStudyGet(value, path) {
  if (typeof path !== 'string' || path.split('.').some(key => scenarioStudyExcludedKeys.has(key))) return undefined;
  return path.split('.').reduce((current, key) => current?.[key], value);
}
function scenarioStudyMetrics(value) {
  return { throughput: scenarioStudyNumber(value?.throughput), oee: scenarioStudyNumber(value?.oee) };
}
function scenarioStudyConfirmationPlan(value) {
  if (!scenarioStudyRecord(value)) return null;
  const plan = scenarioStudyPick(value, ['status', 'reason', 'rounds', 'requiredRounds', 'requiredRoundsLowerBound', 'capped',
    'targetHalfWidth', 'plannedHalfWidth', 'pilotSeeds', 'pilotRounds', 'confidenceLevel', 'minRounds', 'maxRounds',
    'confirmationMustExcludePilotSeeds', 'method', 'policy', 'pilotRole', 'minimumPracticalGain', 'comparisonBasis',
    'comparisonDurationSeconds', 'comparisonUnitOfFlow', 'baselineMeanThroughput', 'pilotStandardDeviation',
    'sourceEffectiveRuntimeTargetSeconds', 'interpretation']);
  if (value.pilotRun) plan.pilotRun = scenarioStudyPick(value.pilotRun, ['durationSeconds', 'rounds', 'seed', 'durationMode', 'engineId']);
  return plan;
}
function scenarioStudyDOEObservations(value) {
  const observations = Array.isArray(value) ? value : [];
  return observations.slice(0, 16).map(observation => {
    const responses = Array.isArray(observation?.roundMetrics) ? observation.roundMetrics :
      Array.isArray(observation?.roundResponses) ? observation.roundResponses : [];
    return {
      index: scenarioStudyNumber(observation?.index),
      levels: Array.isArray(observation?.levels) ? observation.levels.slice(0, 4).map(scenarioStudyNumber) : [],
      feasible: typeof observation?.feasible === 'boolean' ? observation.feasible : null,
      roundResponses: responses.slice(0, 100).map(response => ({ seed: scenarioStudyNumber(response?.seed),
        oee: scenarioStudyNumber(response?.oee), throughput: scenarioStudyNumber(response?.throughput) })),
      roundResponsesOmitted: Math.max(0, responses.length - 100)
    };
  });
}
function scenarioStudyChanges(evaluation) {
  return Array.isArray(evaluation?.evaluatedChanges) ? evaluation.evaluatedChanges : [];
}
function scenarioStudyPackageIdentity(evaluation) {
  const changes = scenarioStudyChanges(evaluation).map(change => ({
    equipmentId: scenarioStudyText(change?.equipmentId), path: scenarioStudyText(change?.path),
    before: scenarioStudyNumber(change?.before), after: scenarioStudyNumber(change?.after),
    unit: scenarioStudyText(change?.unit), interventionType: scenarioStudyText(change?.interventionType),
    external: change?.external === true, analysisOnly: change?.analysisOnly === true,
    replacementMaximumBpm: scenarioStudyNumber(change?.replacementMaximumBpm)
  })).sort((a, b) => {
    const left = JSON.stringify([a.equipmentId, a.path]), right = JSON.stringify([b.equipmentId, b.path]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const text = JSON.stringify(['ST_SCENARIO_PACKAGE_V1', scenarioStudyText(evaluation?.sourceSimulationId), scenarioStudyText(evaluation?.sourceSignature), changes]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return { id: 'scenario-package-' + (hash >>> 0).toString(16), signature: text };
}
function scenarioStudySourceIssues(simulation, evaluation) {
  const missingInputs = [], invalidInputs = [];
  if (!scenarioStudyText(evaluation?.sourceSignature)) missingInputs.push('evaluation.sourceSignature');
  if (!scenarioStudyText(evaluation?.sourceSimulationId)) missingInputs.push('evaluation.sourceSimulationId');
  else if (evaluation.sourceSimulationId !== simulation?.id) invalidInputs.push('evaluation.sourceSimulationId');
  const changes = scenarioStudyChanges(evaluation);
  if (!changes.length) missingInputs.push('evaluation.evaluatedChanges');
  if (changes.length > 64) invalidInputs.push('evaluation.evaluatedChanges');
  const seen = new Set();
  changes.forEach((change, index) => {
    const key = 'evaluation.evaluatedChanges[' + index + ']';
    const identity = change?.equipmentId + ':' + change?.path;
    if (!scenarioStudyText(change?.equipmentId) || !scenarioStudyText(change?.path) || seen.has(identity) ||
        scenarioStudyNumber(change?.before) === null || scenarioStudyNumber(change?.after) === null || change.before === change.after) {
      invalidInputs.push(key); return;
    }
    seen.add(identity);
    const equipment = (Array.isArray(simulation?.equipment) ? simulation.equipment : []).find(item => item?.id === change.equipmentId);
    if (!equipment || scenarioStudyGet(equipment, change.path) !== change.before) invalidInputs.push(key + '.baseline');
  });
  return { missingInputs, invalidInputs };
}
function scenarioStudyFinancialCase(deltaThroughput, config) {
  if (!Number.isFinite(deltaThroughput) || deltaThroughput < 0) return {
    status: 'NOT_EVALUATED', reason: 'NEGATIVE_THROUGHPUT_BOUND_REQUIRES_BASELINE_DEMAND', deltaThroughputPerMinute: deltaThroughput
  };
  const annualCapacityGain = deltaThroughput * config.annualOperatingMinutes;
  const annualUtilizedIncrement = Math.min(annualCapacityGain, config.annualIncrementalDemand);
  const annualProductionContribution = annualUtilizedIncrement * config.contributionMarginPerUnit;
  const annualNetBenefit = annualProductionContribution + config.annualAvoidableSavings - config.annualIncrementalOpex;
  const initialOutlay = config.investment + config.installationCost + config.implementationLoss;
  const cashFlows = [{ year: 0, amount: -initialOutlay, discountedAmount: -initialOutlay }];
  let npv = -initialOutlay;
  for (let year = 1; year <= config.lifeYears; year++) {
    const amount = annualNetBenefit + (year === config.lifeYears ? config.residualValue : 0);
    const discountedAmount = amount / (1 + config.discountRate) ** year;
    cashFlows.push({ year, amount, discountedAmount }); npv += discountedAmount;
  }
  const simplePaybackYears = initialOutlay > 0 && annualNetBenefit > 0 ? initialOutlay / annualNetBenefit : null;
  const simpleLifetimeRoi = initialOutlay > 0 ? (annualNetBenefit * config.lifeYears + config.residualValue - initialOutlay) / initialOutlay : null;
  const numbers = [annualCapacityGain, annualUtilizedIncrement, annualProductionContribution, annualNetBenefit, initialOutlay, npv,
    ...cashFlows.flatMap(row => [row.amount, row.discountedAmount])];
  if (numbers.some(value => !Number.isFinite(value)) || simplePaybackYears !== null && !Number.isFinite(simplePaybackYears) ||
      simpleLifetimeRoi !== null && !Number.isFinite(simpleLifetimeRoi)) return { status: 'NOT_EVALUATED', reason: 'NON_FINITE_CALCULATION' };
  return {
    status: 'ESTIMATED', deltaThroughputPerMinute: deltaThroughput, annualCapacityGain, annualUtilizedIncrement,
    annualUnutilizedCapacityGain: annualCapacityGain - annualUtilizedIncrement,
    annualProductionContribution, annualAvoidableSavings: config.annualAvoidableSavings,
    annualIncrementalOpex: config.annualIncrementalOpex, annualNetBenefit, initialOutlay, npv, cashFlows,
    simplePaybackYears, paybackWithinHorizon: simplePaybackYears === null ? null : simplePaybackYears <= config.lifeYears,
    simpleLifetimeRoi, npvPositive: npv > 0
  };
}

/**
 * Optional config is simulation.whatIf.methodology.economics by default.
 * Monetary inputs share `currency`; throughput and margin share `unitOfFlow`.
 * Costs/savings/residual and demand are explicit numbers, including zero.
 * packageSignature must equal buildScenarioStudy(...).evaluatedPackage.signature;
 * packageId may additionally be supplied and must match. Full canonical equality
 * prevents both hash collisions and inherited costs for a different package.
 * discountRate is a fraction, lifeYears an integer, all annual amounts are constant.
 * annualIncrementalDemand is unmet usable demand, not total plant demand.
 * contributionMarginPerUnit excludes incremental unit costs; annualAvoidableSavings
 * must exclude those costs and the added contribution, and OPEX must not be counted
 * again in margin or savings. Initial costs must not be counted in annual cash flow.
 */
export function evaluateScenarioEconomics(simulation, evaluation, config) {
  const supplied = config === undefined ? simulation?.whatIf?.methodology?.economics : config;
  const economics = scenarioStudyRecord(supplied) ? supplied : {};
  const identity = scenarioStudyPackageIdentity(evaluation);
  const sourceIssues = scenarioStudySourceIssues(simulation, evaluation);
  const missingInputs = [...sourceIssues.missingInputs], invalidInputs = [...sourceIssues.invalidInputs];
  const check = evaluation?.independentCheck;
  const blockers = [];
  if (!scenarioStudyRecord(supplied)) missingInputs.push('economics');
  if (!scenarioStudyText(economics.packageSignature)) missingInputs.push('economics.packageSignature');
  else if (economics.packageSignature !== identity.signature) invalidInputs.push('economics.packageSignature');
  if (economics.packageId !== undefined && economics.packageId !== identity.id) invalidInputs.push('economics.packageId');
  for (const [key, [minimum, maximum]] of Object.entries(scenarioStudyEconomicNumbers)) {
    const value = economics[key];
    if (value === undefined || value === null || value === '') missingInputs.push('economics.' + key);
    else if (scenarioStudyNumber(value) === null || value < minimum || value > maximum || key === 'lifeYears' && !Number.isInteger(value)) invalidInputs.push('economics.' + key);
  }
  if (economics.annualOperatingMinutes === 0) invalidInputs.push('economics.annualOperatingMinutes');
  const currency = scenarioStudyText(economics.currency);
  if (!currency) missingInputs.push('economics.currency');
  else if (!/^[A-Z]{3}$/.test(currency)) invalidInputs.push('economics.currency');
  const unitOfFlow = scenarioStudyFlowUnit(economics.unitOfFlow);
  if (!scenarioStudyText(economics.unitOfFlow)) missingInputs.push('economics.unitOfFlow');
  else if (!unitOfFlow) invalidInputs.push('economics.unitOfFlow');
  const sourceUnit = scenarioStudyFlowUnit(evaluation?.unitOfFlow || simulation?.unitOfFlow);
  if (!sourceUnit) missingInputs.push('evaluation.unitOfFlow');
  else if (unitOfFlow && unitOfFlow !== sourceUnit) invalidInputs.push('economics.unitOfFlow');
  const providedUnits = [evaluation?.unitOfFlow, simulation?.unitOfFlow, check?.unitOfFlow, check?.baseline?.unitOfFlow, check?.candidate?.unitOfFlow].filter(value => value !== undefined && value !== null);
  if (providedUnits.some(value => !scenarioStudyFlowUnit(value) || scenarioStudyFlowUnit(value) !== sourceUnit)) invalidInputs.push('evaluation.unitOfFlow');
  for (const [key, required] of [['benefitBasis', 'INCREMENTAL_NON_OVERLAPPING'], ['annualizationBasis', 'REPRESENTATIVE_CONFIRMATION_RATE']]) {
    if (!scenarioStudyText(economics[key])) missingInputs.push('economics.' + key);
    else if (economics[key] !== required) invalidInputs.push('economics.' + key);
  }
  if (!check) missingInputs.push('evaluation.independentCheck');
  if (check?.passed !== true) blockers.push('INDEPENDENT_CONFIRMATION_NOT_PASSED');
  for (const key of ['baseline', 'candidate']) {
    const metric = scenarioStudyNumber(check?.[key]?.throughput);
    if (metric === null) missingInputs.push('evaluation.independentCheck.' + key + '.throughput');
    else if (metric < 0) invalidInputs.push('evaluation.independentCheck.' + key + '.throughput');
    const oee = scenarioStudyNumber(check?.[key]?.oee);
    if (oee === null) missingInputs.push('evaluation.independentCheck.' + key + '.oee');
    else if (oee < 0) invalidInputs.push('evaluation.independentCheck.' + key + '.oee');
    const rateUnit = check?.[key]?.throughputUnit || check?.throughputUnit;
    if (rateUnit !== undefined && !['per_minute', 'units/min', unitOfFlow + '/min', unitOfFlow === 'bottles' ? 'bpm' : null].includes(rateUnit)) invalidInputs.push('evaluation.independentCheck.' + key + '.throughputUnit');
  }
  if (!(scenarioStudyNumber(check?.durationSeconds) > 0)) missingInputs.push('evaluation.independentCheck.durationSeconds');
  if (!(Number.isInteger(check?.rounds) && check.rounds > 0)) missingInputs.push('evaluation.independentCheck.rounds');
  if (scenarioStudyNumber(check?.baseline?.oee) !== null && scenarioStudyNumber(check?.candidate?.oee) !== null && check.candidate.oee < check.baseline.oee - 1e-9) blockers.push('CONFIRMED_OEE_REGRESSION');
  const baselineThroughput = scenarioStudyNumber(check?.baseline?.throughput), candidateThroughput = scenarioStudyNumber(check?.candidate?.throughput);
  const delta = baselineThroughput !== null && candidateThroughput !== null ? candidateThroughput - baselineThroughput : null;
  if (delta !== null && delta < 0) blockers.push('CONFIRMED_THROUGHPUT_REGRESSION');
  const output = {
    version: 1, status: 'NOT_EVALUATED', scope: 'EVALUATED_PACKAGE', packageId: identity.id, packageSignature: identity.signature,
    missingInputs: [...new Set(missingInputs)], invalidInputs: [...new Set(invalidInputs)], blockers,
    currency, unitOfFlow, sourceSignature: scenarioStudyText(evaluation?.sourceSignature),
    basis: 'INDEPENDENT_CONFIRMATION_THROUGHPUT', inputs: scenarioStudyPick(economics, [...Object.keys(scenarioStudyEconomicNumbers), 'currency', 'unitOfFlow', 'benefitBasis', 'annualizationBasis']),
    inputEvidence: 'REPORTED_NOT_VERIFIED', plantValidated: false,
    contract: {
      annualization: 'Constant annual operating time and incremental unmet demand; confirmation rate is explicitly reported representative.',
      benefits: 'Incremental utilized output times contribution margin, plus separately avoidable savings, less non-overlapping incremental OPEX.',
      cashFlow: 'Initial investment, installation and implementation loss at year zero; constant annual net benefit at year end; residual at final year.',
      payback: 'Initial outlay divided by positive annual net benefit, undiscounted and excluding terminal residual; null for zero outlay or non-positive benefit.',
      roi: 'Undiscounted net benefit over the full life including residual, less initial outlay, divided by initial outlay; a fraction, not an annualized return.',
      limitations: 'No inferred sale of unused capacity, taxes, financing or inflation. Positive NPV is a conditional estimate, not investment approval or plant validation.'
    }
  };
  if (output.missingInputs.length || output.invalidInputs.length || blockers.length) return output;
  const estimate = scenarioStudyFinancialCase(delta, economics);
  Object.assign(output, estimate);
  if (estimate.status !== 'ESTIMATED') return output;
  output.confirmation = { baselineThroughput, candidateThroughput, durationSeconds: check.durationSeconds, rounds: check.rounds,
    kind: scenarioStudyText(check.confirmationKind || evaluation?.confirmationKind) || 'MODEL_REPRODUCTION' };
  const statistics = check.statisticalEvidence;
  const interval = statistics?.metrics?.throughput;
  output.sensitivity = { status: 'NOT_EVALUATED', reason: 'CONFIRMATION_INTERVAL_UNAVAILABLE' };
  if (statistics?.available === true && interval?.inferenceAvailable === true &&
      scenarioStudyNumber(interval.lower) !== null && scenarioStudyNumber(interval.upper) !== null &&
      interval.lower <= interval.upper && scenarioStudyNumber(interval.mean) !== null &&
      Math.abs(interval.mean - delta) <= Math.max(1e-8, Math.abs(delta) * 1e-8) && interval.lower <= delta && interval.upper >= delta &&
      scenarioStudyNumber(statistics.confidenceLevel) > 0 && statistics.confidenceLevel < 1) {
    output.sensitivity = {
      status: 'ESTIMATED', basis: 'CONFIRMATION_MEAN_THROUGHPUT_INTERVAL', confidenceLevel: statistics.confidenceLevel,
      lower: scenarioStudyFinancialCase(interval.lower, economics), upper: scenarioStudyFinancialCase(interval.upper, economics),
      interpretation: 'Only simulation mean uncertainty is propagated; input, engineering, demand, cost and plant-model uncertainty are not included.'
    };
  } else if (interval?.inferenceAvailable === true) output.sensitivity.reason = 'INVALID_OR_INCONSISTENT_CONFIRMATION_INTERVAL';
  return output;
}

function scenarioStudyHypotheses(simulation, evaluation, metadata) {
  const groups = new Map(), reported = Array.isArray(metadata?.interventions) ? metadata.interventions : [];
  scenarioStudyChanges(evaluation).slice(0, 64).forEach(change => {
    if (!scenarioStudyRecord(change) || !scenarioStudyText(change.equipmentId) || !scenarioStudyText(change.path)) return;
    const record = reported.find(item => item?.equipmentId === change.equipmentId && (!Array.isArray(item.paths) || item.paths.includes(change.path)));
    const exploratory = change.analysisOnly === true || change.interventionType === 'SENSITIVITY';
    const explicitType = scenarioStudyText(record?.type || change.interventionType);
    const classification = exploratory ? 'EXPLORATORY_SENSITIVITY' : explicitType ||
      (change.path?.startsWith('noiseProfile.reliability.') ? 'INTERVENTION_UNSPECIFIED' :
        change.path==='processData.geometry.lactMm' ? 'LINE_REDESIGN' : 'OPERATING_PARAMETER_ADJUSTMENT');
    const key = change.equipmentId + ':' + classification + ':' + (record?.id || '');
    if (!groups.has(key)) {
      const equipment = (Array.isArray(simulation?.equipment) ? simulation.equipment : []).find(item => item?.id === change.equipmentId);
      groups.set(key, {
        id: key, equipmentId: change.equipmentId, equipmentName: scenarioStudyText(equipment?.name), classification,
        classificationBasis: exploratory ? 'EXPLORATORY_TARGET' : explicitType ? 'REPORTED_INTERVENTION' : 'PARAMETER_TYPE_ONLY',
        costClass: ({ OPERATIONAL: 'NONE', MAINTENANCE: 'OPEX', RETROFIT: 'CAPEX', REPLACEMENT: 'CAPEX' })[classification] || 'UNASSIGNED',
        capexClassification: {tier:({OPERATIONAL:'ZERO',MAINTENANCE:'ZERO',RETROFIT:'MEDIUM',REPLACEMENT:'HIGH',LINE_REDESIGN:'HIGH',OPERATING_PARAMETER_ADJUSTMENT:'ZERO'})[classification]||'UNASSIGNED',
          basis:'INTERVENTION_SCOPE',budgetUsed:false},
        stopDataCoverage:scenarioStopDataCoverage(simulation,equipment),
        modeledStopEffect:{reliabilityParametersChanged:false,microStopParametersChanged:false,flowEffectsRequireSimulation:true},
        description: scenarioStudyText(record?.description || change.justification),
        diagnosticEvidence: (Array.isArray(evaluation?.lossDiagnosis?.equipment) ? evaluation.lossDiagnosis.equipment : []).filter(item => item?.equipmentId === change.equipmentId).slice(0, 1).map(item =>
          scenarioStudyPick(item, ['equipmentId', 'failureSeconds', 'microStopSeconds', 'minorFailureSeconds', 'majorFailureSeconds', 'generalFailureSeconds',
            'failureCategories', 'stopDataCoverage', 'starvedSeconds', 'blockedSeconds', 'dominantLoss', 'ownStopPercent'])),
        capacityEvidence: (Array.isArray(evaluation?.capacityDiagnosis?.limitingEquipment) ? evaluation.capacityDiagnosis.limitingEquipment : []).filter(item => item?.id === change.equipmentId).slice(0, 1).map(item =>
          scenarioStudyPick(item, ['id', 'name', 'bpm', 'maximumBpm'])),
        targetSource: { status: record?.targetSource || record?.sourceReference || change.targetSource || change.justification ? 'REPORTED_NOT_VERIFIED' : 'NOT_PROVIDED',
          reported: scenarioStudyCopy(record?.targetSource || change.targetSource || null), sourceReference: scenarioStudyCopy(record?.sourceReference || null) },
        rootCauseVerified: false, targetAchievabilityVerified: false, changes: [],
        reportedFeasibility: record?.feasibility === undefined ? null : { status: 'REPORTED_NOT_VERIFIED', reported: scenarioStudyCopy(record.feasibility) },
        reportedPilot: record?.pilot === undefined ? null : { status: 'REPORTED_NOT_VERIFIED', reported: scenarioStudyCopy(record.pilot) }
      });
    }
    const hypothesis=groups.get(key);
    if(change.path.startsWith('noiseProfile.reliability.')){
      hypothesis.modeledStopEffect.reliabilityParametersChanged=true;
      hypothesis.modeledStopEffect.reliabilityScope=hypothesis.stopDataCoverage.mode==='SPLIT'?'ALL_CONFIGURED_STOP_CLASSES':'GENERAL_UNCLASSIFIED';
      hypothesis.modeledStopEffect.interpretation='Aggregate MTBF/MTTR edits scale all configured reliability stop classes proportionally; the separate MICRO_STOP process is unchanged.';
    }else if(!hypothesis.modeledStopEffect.reliabilityParametersChanged){
      hypothesis.modeledStopEffect.interpretation='Operating or geometry changes affect line flow and recovery; they do not directly reduce the frequency or duration of configured reliability or MICRO_STOP events.';
    }
    hypothesis.changes.push(scenarioStudyPick(change, ['equipmentId', 'path', 'before', 'after', 'unit', 'external', 'analysisOnly', 'replacementMaximumBpm']));
  });
  return [...groups.values()];
}

/** Compact, immutable evidence chain for persisted evaluations and scenarios. */
export function buildScenarioStudy(simulation, evaluation) {
  const metadata = scenarioStudyRecord(simulation?.whatIf?.methodology) ? simulation.whatIf.methodology : {};
  const check = evaluation?.independentCheck;
  const issues = scenarioStudySourceIssues(simulation, evaluation);
  const traceable = !issues.missingInputs.length && !issues.invalidInputs.length;
  const hypotheses = scenarioStudyHypotheses(simulation, evaluation, metadata);
  const pilots = hypotheses.filter(item => item.reportedPilot).map(item => ({ interventionId: item.id, ...item.reportedPilot }));
  const actualBase = scenarioStudyMetrics(check?.baseline), actualCandidate = scenarioStudyMetrics(check?.candidate);
  const validConfirmation = actualBase.throughput !== null && actualBase.throughput >= 0 && actualCandidate.throughput !== null &&
    actualCandidate.throughput >= actualBase.throughput && scenarioStudyNumber(check?.durationSeconds) > 0 &&
    Number.isInteger(check?.rounds) && check.rounds > 0 &&
    actualBase.oee !== null && actualBase.oee >= 0 && actualCandidate.oee !== null && actualCandidate.oee >= 0 &&
    actualCandidate.oee >= actualBase.oee - 1e-9;
  const stats = scenarioStudyPick(check?.statisticalEvidence, ['available', 'n', 'seedIds', 'confidenceLevel', 'metrics', 'reason']);
  const confirmationPlan = scenarioStudyConfirmationPlan(evaluation?.confirmationPlan);
  const rankingPlan=evaluation?.rankingPlan,finalistScreen=evaluation?.phaseAudit?.finalistScreening,ranking=evaluation?.phaseAudit?.ranking;
  const doe = evaluation?.doe;
  const fixedChanges = (Array.isArray(doe?.fixedChanges) ? doe.fixedChanges : []).slice(0, 64).map(change =>
    scenarioStudyPick(change, ['equipmentId', 'path', 'before', 'after', 'unit', 'external', 'analysisOnly', 'interventionType', 'replacementMaximumBpm']));
  const objective = scenarioStudyRecord(metadata.objective) ? scenarioStudyPick(metadata.objective, ['metric', 'target', 'unit', 'minimumPracticalGain', 'description']) : null;
  const objectiveMetric = objective?.metric === 'throughput' ? 'throughput' : objective?.metric === 'oee' ? 'oee' : null;
  const flowUnit = scenarioStudyFlowUnit(evaluation?.unitOfFlow || simulation?.unitOfFlow);
  const objectiveUnits = objectiveMetric === 'oee' ? ['%', 'percent'] : [flowUnit + '/min', ...(flowUnit === 'bottles' ? ['bpm'] : [])];
  const objectiveValid = objectiveMetric && scenarioStudyNumber(objective?.target) !== null && objective.target >= 0 &&
    (objectiveMetric !== 'oee' || objective.target <= 100) && objectiveUnits.includes(objective.unit) &&
    (objective.minimumPracticalGain === undefined || scenarioStudyNumber(objective.minimumPracticalGain) !== null && objective.minimumPracticalGain >= 0);
  const objectiveEvaluable = traceable && check?.passed === true && validConfirmation && objectiveValid && actualCandidate[objectiveMetric] !== null;
  const changes = scenarioStudyChanges(evaluation);
  const identity = scenarioStudyPackageIdentity(evaluation);
  const constraints = [
    'Observed equipment downtime and propagated starvation/blocking are not additive causal line losses.',
    'A simulated target does not establish the physical intervention, attainable reliability or supplier performance.',
    'DOE and independent confirmation support this model and evaluated package; they do not prove a global optimum or plant outcome.',
    'Minor/major stop classes require supplied data; general stops are not split by duration, and stop class does not establish root cause.',
    'CAPEX classification uses intervention type and scope; budget amounts and financial evaluation are outside the current technical study.',
    'Reported source references are not independently verified.'
  ];
  const confirmationStatus = !check ? 'NOT_EVALUATED' : !traceable ? 'UNTRACEABLE_EVIDENCE' : check.passed !== true ? 'NOT_REPRODUCED' :
    validConfirmation ? 'MODEL_REPRODUCED' : 'INVALID_OR_INCOMPLETE_CONFIRMATION';
  return {
    version: 1,
    analysisScope:{objective:'TECHNICAL_LINE_EFFICIENCY',capexClassificationBasis:'INTERVENTION_SCOPE',budgetAmountsUsed:false},
    source: {
      simulationId: scenarioStudyText(simulation?.id), sourceSimulationId: scenarioStudyText(evaluation?.sourceSimulationId),
      sourceSignature: scenarioStudyText(evaluation?.sourceSignature), status: traceable ? 'RECORDED' : 'INCOMPLETE_OR_MISMATCHED',
      signatureVerification: 'CALLER_MUST_VERIFY_CURRENT_SIGNATURE', missingInputs: issues.missingInputs, invalidInputs: issues.invalidInputs
    },
    evaluatedPackage: { ...identity, changeCount: changes.length, equipmentIds: [...new Set(changes.map(change => change?.equipmentId).filter(value => typeof value === 'string'))].slice(0, 64), scope: 'WHOLE_PACKAGE' },
    objective: { status: objective ? 'REPORTED' : 'NOT_DEFINED', reported: objective,
      assessment: objectiveEvaluable ? { status: 'MODEL_COMPARISON', achieved: actualCandidate[objectiveMetric], target: objective.target,
        targetMet: actualCandidate[objectiveMetric] >= objective.target,
        minimumPracticalGainMet: scenarioStudyNumber(objective.minimumPracticalGain) !== null && actualBase[objectiveMetric] !== null ? actualCandidate[objectiveMetric] - actualBase[objectiveMetric] >= objective.minimumPracticalGain : null } : { status: 'NOT_EVALUATED', reason: objective && !objectiveValid ? 'INVALID_OBJECTIVE_OR_UNIT' : 'OBJECTIVE_OR_CONFIRMATION_MISSING' } },
    baseline: { status: check?.baseline ? 'CONFIRMATION_BASELINE' : evaluation?.baseline ? 'SCREENING_BASELINE' : 'MISSING',
      metrics: check?.baseline ? actualBase : scenarioStudyMetrics(evaluation?.baseline), unitOfFlow: scenarioStudyFlowUnit(evaluation?.unitOfFlow || simulation?.unitOfFlow),
      run: scenarioStudyPick(check || evaluation?.run, ['durationSeconds', 'rounds', 'seed']) },
    diagnosis: {
      causalStatus: 'HYPOTHESES_ONLY',
      observedLosses: scenarioStudyPick(evaluation?.lossDiagnosis, ['status', 'reason', 'sourceStatus', 'provenance', 'referenceId', 'durationSeconds', 'durationBasis',
        'rounds', 'equipment', 'rankings', 'opportunities', 'stopDataQuality', 'attribution', 'interpretation']),
      capacity: scenarioStudyPick(evaluation?.capacityDiagnosis, ['reason', 'sourceStatus', 'referenceId', 'referenceBpm', 'minimumBpm', 'capacityCeilingPercent', 'limitingEquipment', 'achievedPercent', 'capacityGapPp', 'residualLossPp', 'accountingAvailable', 'interpretation']),
      reliabilitySensitivity: scenarioStudyPick(evaluation?.reliabilityTargetSearch, ['status', 'analysisOnly', 'classification', 'conditionalReliabilityGain', 'coverage', 'ranking', 'interpretation'])
    },
    hypotheses,
    evidence: {
      screening: { baseline: scenarioStudyMetrics(evaluation?.baseline), candidate: scenarioStudyMetrics(evaluation?.candidate), role: 'EXPLORATION_ONLY' },
      finalistSelection:{status:rankingPlan?'RECORDED':'NOT_RECORDED',role:'EXPLORATORY_SELECTION_NOT_CONFIRMATION',
        policy:scenarioStudyText(rankingPlan?.policy),staged:rankingPlan?.staged===true,reason:scenarioStudyText(rankingPlan?.reason),
        intermediateRun:scenarioStudyPick(finalistScreen?.run||rankingPlan?.screenRun,['durationSeconds','rounds','seed','engineId']),
        fullRun:scenarioStudyPick(ranking?.run||rankingPlan?.fullRun,['durationSeconds','rounds','seed','engineId']),
        candidatesScreened:Array.isArray(finalistScreen?.observations)?finalistScreen.observations.length:null,
        selected:scenarioStudyNumber(finalistScreen?.selected),omitted:scenarioStudyNumber(finalistScreen?.omitted),
        protectedReliabilityCandidates:scenarioStudyNumber(finalistScreen?.protectedReliabilityCandidates),
        fullHorizonFinalists:scenarioStudyNumber(ranking?.finalists)??scenarioStudyNumber(rankingPlan?.fullHorizonFinalists),
        shortScreenMayMissLateBenefits:rankingPlan?.staged===true,
        interpretation:scenarioStudyText(rankingPlan?.interpretation)||'Selection allocates simulation effort; only the full-horizon independent confirmation supports a reproduced improvement.'},
      experiment: {
        status: doe ? doe.analysis?.complete === true ? 'COMPLETE_DESIGN' : 'INCOMPLETE_DESIGN' : 'NOT_PERFORMED',
        type: scenarioStudyText(doe?.type || doe?.design?.type),
        factors: scenarioStudyCopy(doe?.factors || doe?.design?.factors || []),
        fixedChanges,
        effectScope: { conditionalOnFixedChanges: fixedChanges.length > 0,
          interpretation: 'Effects apply to the tested factor region conditional on these fixed changes and the saved baseline; they are not isolated causal shares or guarantees outside that region.' },
        combinations: scenarioStudyNumber(doe?.combinations) ?? (Array.isArray(doe?.observations) ? doe.observations.length : null),
        roundsPerCombination: scenarioStudyNumber(doe?.roundsPerCombination),
        run: doe ? scenarioStudyPick(doe.run || evaluation?.explorationRun, ['durationSeconds', 'durationMode', 'rounds', 'seed', 'engineId', 'sampleIntervalSeconds']) : {},
        observations: scenarioStudyDOEObservations(doe?.observations),
        observationsOmitted: Math.max(0, (Array.isArray(doe?.observations) ? doe.observations.length : 0) - 16),
        analysis: scenarioStudyPick(doe?.analysis, ['complete', 'reason', 'effects', 'interpretation']),
        anova: scenarioStudyPick(doe?.anova, ['complete', 'model', 'primaryInference', 'alpha', 'confidenceLevel', 'seedIds', 'replications', 'multiplicity', 'metrics', 'reason', 'interpretation']),
        replicationPlan: { status: metadata.replications ? 'REPORTED' : 'NOT_PROVIDED', reported: scenarioStudyPick(metadata.replications, ['minimum', 'maximum', 'confidenceLevel', 'relativePrecision', 'absolutePrecision']),
          actual: confirmationPlan ? { role: 'CONFIRMATION_NOT_DOE', source: 'evaluation.confirmationPlan', plan: confirmationPlan } : null }
      },
      confirmation: { status: confirmationStatus, reportedPassed: check?.passed === true,
        kind: scenarioStudyText(check?.confirmationKind || evaluation?.confirmationKind),
        baseline: actualBase, candidate: actualCandidate, run: scenarioStudyPick(check, ['durationSeconds', 'rounds', 'seed']),
        confirmationPlan,
        precision: scenarioStudyPick(check?.precision, ['targetHalfWidth', 'achievedHalfWidth', 'met', 'plannedRounds', 'requiredRounds', 'capped']),
        practicalThreshold: scenarioStudyNumber(check?.practicalThreshold), reason: scenarioStudyText(check?.reason),
        oeeGuard: scenarioStudyPick(check?.oeeGuard, ['observedMeanDelta', 'passed', 'statisticalNonInferiorityEstablished']),
        delta: { throughputPerMinute: actualBase.throughput !== null && actualCandidate.throughput !== null ? actualCandidate.throughput - actualBase.throughput : null,
          oeePercentagePoints: actualBase.oee !== null && actualCandidate.oee !== null ? actualCandidate.oee - actualBase.oee : null },
        statisticalEvidence: stats,
        interpretation: 'Independent simulation evidence; descriptive reproduction is distinct from statistical inference and plant validation.' }
    },
    feasibility: { status: 'REQUIRES_ENGINEERING_REVIEW', verified: false,
      exploratoryTargets: hypotheses.some(item => item.classification === 'EXPLORATORY_SENSITIVITY'),
      warnings: scenarioStudyCopy(evaluation?.warnings || []),
      reportedAcknowledgement: evaluation?.engineeringReviewAcknowledged === true,
      interpretation: 'Parameter checks or reported acknowledgement do not establish engineering feasibility, installation scope or target achievability.' },
    economics: {status:'NOT_EVALUATED',reason:'OUT_OF_SCOPE',scope:'TECHNICAL_SCENARIO_ANALYSIS',monetaryInputsRequired:false,
      usedForClassification:false,usedForRanking:false,missingInputs:[],invalidInputs:[],plantValidated:false,
      interpretation:'This study compares technical line performance and classifies the intervention scope. No budget amount is requested or used. Financial estimates require a separate explicit API call.'},
    plantValidation: { status: pilots.length ? 'REPORTED_NOT_VERIFIED' : 'NOT_EVALUATED', verified: false, reports: pilots },
    limitations: constraints
  };
}
