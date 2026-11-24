import {scenarioPairedSummary,planScenarioReplications} from './ScenarioStatistics.js';
import {resolvePlannedStops} from '../simulation/PlantCalendarSchedule.js';

export const SCENARIO_SEARCH_PROFILES = Object.freeze({
  LIGHT: {explorationSeconds:300,confirmationSeconds:1800,maxCandidates:48,maxSearchMs:120000,maxWithoutImprovement:16,maxFactors:0,passes:1,finalists:4,fullHorizonFinalists:2},
  MEDIUM: {explorationSeconds:600,confirmationSeconds:1800,maxCandidates:128,maxSearchMs:300000,maxWithoutImprovement:32,maxFactors:3,passes:2,finalists:6,fullHorizonFinalists:2},
  HIGH: {explorationSeconds:900,confirmationSeconds:1800,maxCandidates:256,maxSearchMs:600000,maxWithoutImprovement:48,maxFactors:4,passes:3,finalists:6,fullHorizonFinalists:3}
});
export function scenarioSearchProfile(level) { return SCENARIO_SEARCH_PROFILES[level]||SCENARIO_SEARCH_PROFILES.MEDIUM; }
export function scenarioSearchRun(run,level,confirmation=false,rounds=3) {
  const profile=scenarioSearchProfile(level);
  // Independent What-If horizons; replay configuration and scheduled commands stay intact.
  const copy={...run,durationMode:'FIXED',durationSeconds:confirmation==='validation'?Math.max(1800,Number(run.durationSeconds)||0):confirmation?profile.confirmationSeconds:profile.explorationSeconds,rounds};
  delete copy.shiftSeconds;delete copy.shiftHours;delete copy.shiftCount;
  // A runtime-target stop changes calendar exposure as the candidate improves.
  // What-If compares complete equal calendar horizons and records that choice.
  delete copy.effectiveRuntimeTargetSeconds;
  return copy;
}

// The intermediate screen selects where to spend simulation time; it never
// certifies a gain. Selection and independent confirmation retain the full day.
export function planScenarioFinalistRanking(run,level,candidateCount,options={}) {
  const profile=scenarioSearchProfile(level),fullRun=scenarioSearchRun(run,level,'validation');
  const limit=Math.max(1,Math.min(candidateCount,Number.isInteger(options.fullHorizonFinalists)?options.fullHorizonFinalists:profile.fullHorizonFinalists));
  const screenRun=scenarioSearchRun(run,level,true);
  // A short prefix does not represent an entire shift/calendar/product program.
  // Keep every finalist when the run has explicit changes over time.
  const scheduled=!!(run.commands?.length||resolvePlannedStops({...run,tickSeconds:run.tickSeconds??.25}).events.length);
  const reason=scheduled?'SCHEDULED_CONDITIONS_REQUIRE_FULL_HORIZON':fullRun.durationSeconds<=2*screenRun.durationSeconds?'SHORT_CONFIGURED_HORIZON':candidateCount<=limit?'WITHIN_FULL_HORIZON_BUDGET':null;
  return {policy:'STAGED_FINALIST_RANKING_V1',staged:!reason,reason,screenRun,fullRun,fullHorizonFinalists:reason?candidateCount:limit,
    screeningSeedOffset:50003,rankingSeedOffset:100003,confirmationSeedOffset:1000003,
    interpretation:'A bounded intermediate screen may omit a configuration whose benefit emerges later. Final recommendations still require full-horizon ranking and independent confirmation; this is not a global optimum search.'};
}

export function selectScenarioFinalists(screened,baseline,limit) {
  const valid=screened.filter(item=>item?.changes?.length&&Number.isFinite(item.result?.throughput)&&Number.isFinite(item.result?.oee));
  // Compare paired gains only within the common intermediate horizon. Prefer
  // valid engineering, then observed OEE non-regression and throughput gain.
  const score=item=>item.result.throughput-baseline.throughput;
  valid.sort((a,b)=>Number(!!a.result.warnings?.length)-Number(!!b.result.warnings?.length)||Number(a.result.oee<baseline.oee-1e-9)-Number(b.result.oee<baseline.oee-1e-9)||score(b)-score(a));
  const chosen=[],combinations=new Set();
  const key=item=>item.changes.map(c=>c.equipmentId+':'+c.path).sort().join('|');
  function add(item){if(item&&!chosen.includes(item)){chosen.push(item);combinations.add(key(item));}}
  // Reliability interventions may show no event in a short prefix. Preserve
  // them for long-horizon review rather than declaring no benefit from silence.
  valid.filter(item=>item.changes.some(c=>c.path.startsWith('noiseProfile.reliability.'))).forEach(add);
  add(valid[0]);
  for(const item of valid)if(chosen.length<limit&&!combinations.has(key(item)))add(item);
  for(const item of valid)if(chosen.length<limit)add(item);
  return chosen;
}
export function scenarioConfirmationNeedsMore(base,candidate) {
  const a=base?.roundMetrics,b=candidate?.roundMetrics;
  if(!a||!b||a.length!==3||b.length!==3)return false;
  const differences=b.map((row,i)=>row.throughput-a[i].throughput);
  const mean=differences.reduce((sum,value)=>sum+value,0)/3;
  const sd=Math.sqrt(differences.reduce((sum,value)=>sum+(value-mean)**2,0)/2);
  // Paired 95% t interval, df=2. Extra rounds are confirmation, never winner selection.
  return mean-4.3026527299*sd/Math.sqrt(3)<=Math.max(.001,Math.abs(base.throughput)*.001);
}

export function scenarioPairedEvidence(base,candidate) {
  const a=base?.roundMetrics,b=candidate?.roundMetrics;
  if(!a||!b||a.length!==b.length||a.length<6||a.some((r,i)=>r.seed!==b[i].seed))return {stable:false,reason:'MATCHED_SIX_ROUNDS_REQUIRED'};
  const deltas=b.map((r,i)=>r.throughput-a[i].throughput);
  if(deltas.some(x=>!Number.isFinite(x)))return {stable:false,reason:'INVALID_METRICS'};
  const mean=deltas.reduce((s,x)=>s+x,0)/deltas.length;
  const sd=Math.sqrt(deltas.reduce((s,x)=>s+(x-mean)**2,0)/(deltas.length-1));
  // Six paired replications; conservative t critical also for larger sample counts.
  const lower=mean-2.5705818366*sd/Math.sqrt(deltas.length),split=Math.floor(deltas.length/2);
  const blockMeans=[deltas.slice(0,split),deltas.slice(split)].map(v=>v.reduce((s,x)=>s+x,0)/v.length);
  const threshold=Math.max(.001,Math.abs(base.throughput)*.001);
  return {mean,lower,blockMeans,threshold,rounds:deltas.length,stable:lower>threshold&&blockMeans.every(x=>x>threshold)&&candidate.oee>=base.oee-1e-9,interpretation:'Exploratory paired interval and two seed blocks; no multiple-comparison adjustment or plant guarantee.'};
}

// Decide the confirmation sample size from the finalist-ranking pilot before
// looking at the independent confirmation. No optional stopping on its p-value.
export function planScenarioConfirmation(base,candidate,methodology={}) {
  const issue=scenarioComparisonEvidenceIssue(base,candidate);
  if(issue)return {rounds:null,status:issue,policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};
  const baseSeeds=base.roundMetrics.map(row=>row.seed),candidateSeeds=candidate.roundMetrics.map(row=>row.seed);
  if(!scenarioValidConfirmationPilotSeeds(baseSeeds)||!scenarioValidConfirmationPilotSeeds(candidateSeeds)||baseSeeds.length!==candidateSeeds.length||baseSeeds.some(seed=>!candidateSeeds.includes(seed)))return {rounds:null,status:'INVALID_PILOT_REPLICATIONS',policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};
  const settings=methodology?.replications||{};
  const options={minRounds:settings.minimum??3,maxRounds:settings.maximum??30,
    confidenceLevel:settings.confidenceLevel??.95,relativePrecision:settings.relativePrecision??.005};
  if(settings.absolutePrecision!==undefined)options.absolutePrecision=settings.absolutePrecision;
  const plan=planScenarioReplications(base,candidate,options);
  let minimumPracticalGain;
  try{minimumPracticalGain=scenarioPracticalGain({throughput:plan.baselineMeanThroughput,unitOfFlow:base.unitOfFlow},methodology||{});}catch(error){return {...plan,rounds:null,status:error.message||'INVALID_CONFIRMATION_OBJECTIVE',policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};}
  return {...plan,policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION',comparisonDurationSeconds:base.durationSeconds,comparisonUnitOfFlow:base.unitOfFlow,
    pilotRole:'FINALIST_RANKING_ONLY',minimumPracticalGain,
    interpretation:'Sample size is fixed using separate pilot seeds. A capped plan may not achieve the requested precision; input and model uncertainty are not estimated by replication.'};
}

export function scenarioPracticalGain(base,methodology={}) {
  const objective=methodology.objective||{},supplied=objective.minimumPracticalGain;
  if(supplied!==undefined&&(!Number.isFinite(supplied)||supplied<0))throw Error('SCENARIO_INVALID_PRACTICAL_GAIN');
  // OEE targets are in percentage points and must never become flow-rate limits.
  if(objective.metric&& !['throughput','oee'].includes(objective.metric))throw Error('SCENARIO_INVALID_OBJECTIVE_METRIC');
  if(supplied!==undefined&&objective.metric!=='oee'&&objective.unit){
    const unit=base?.unitOfFlow||'units';
    if(objective.unit!==unit+'/min'&&!(unit==='bottles'&&objective.unit==='bpm'))throw Error('SCENARIO_INVALID_OBJECTIVE_UNIT');
  }
  return Math.max(.001,Math.abs(base?.throughput||0)*.001,objective.metric==='oee'?0:supplied??0);
}

export function assessScenarioConfirmation(base,candidate,plan,methodology={}) {
  const planIssue=scenarioConfirmationPlanIssue(plan,methodology);
  const evidenceIssue=scenarioComparisonEvidenceIssue(base,candidate,plan);
  const statisticalEvidence=scenarioPairedSummary(base,candidate,{confidenceLevel:plan?.confidenceLevel??methodology?.replications?.confidenceLevel??.95});
  const threshold=planIssue?null:plan.minimumPracticalGain,throughput=statisticalEvidence.metrics?.throughput,oee=statisticalEvidence.metrics?.oee;
  const pilotSeeds=Array.isArray(plan?.pilotSeeds)?plan.pilotSeeds:[];
  const independent=statisticalEvidence.available&&!(statisticalEvidence.seedIds||[]).some(seed=>pilotSeeds.includes(seed));
  const complete=!planIssue&&!evidenceIssue&&statisticalEvidence.available&&statisticalEvidence.n===plan?.rounds&&independent;
  const inference=throughput?.inferenceAvailable!==false&&Number.isFinite(throughput?.lower)&&Number.isFinite(throughput?.upper);
  const descriptive=throughput?.reason==='ZERO_OBSERVED_VARIANCE'&&statisticalEvidence.n>=Math.min(6,plan?.rounds||6);
  const nonRegression=Number.isFinite(oee?.mean)&&oee.mean>=-1e-9;
  const passed=!!(complete&&nonRegression&&(inference?throughput.lower>threshold:descriptive&&throughput.mean>threshold));
  const halfWidth=inference?(throughput.upper-throughput.lower)/2:null;
  return {passed,kind:inference?'PAIRED_CONFIDENCE_INTERVAL':descriptive?'DESCRIPTIVE_REPRODUCTION':'INFERENCE_UNAVAILABLE',
    reason:planIssue||evidenceIssue||(!independent?'INDEPENDENT_SEEDS_REQUIRED':!complete?'INCOMPLETE_CONFIRMATION':!nonRegression?'OEE_REGRESSION':passed?null:inference?'PRACTICAL_GAIN_NOT_ESTABLISHED':'INFERENCE_UNAVAILABLE'),
    threshold,statisticalEvidence,oeeGuard:{observedMeanDelta:oee?.mean??null,passed:nonRegression,statisticalNonInferiorityEstablished:false},precision:{targetHalfWidth:plan?.targetHalfWidth??null,achievedHalfWidth:halfWidth,
      met:halfWidth===null||!Number.isFinite(plan?.targetHalfWidth)||plan.targetHalfWidth<=0?null:halfWidth<=plan.targetHalfWidth,plannedRounds:plan?.rounds??null,requiredRounds:plan?.requiredRounds??null,capped:plan?.capped===true},
    interpretation:descriptive?'The gain repeated without observed variance; no confidence interval or statistical certainty is claimed.':
      'Paired independent confirmation applies to the simulated model and recorded conditions; it does not establish intervention feasibility, economic value or plant validation.'};
}

function scenarioValidConfirmationPilotSeeds(seeds) {
  return Array.isArray(seeds)&&seeds.length>=3&&seeds.every(Number.isInteger)&&new Set(seeds).size===seeds.length;
}

// A saved plan is evidence, not authority to reduce its own acceptance threshold.
// Reconstruct the minimum from its recorded pilot mean and current methodology;
// never derive a new threshold from the already-observed confirmation baseline.
function scenarioConfirmationPlanIssue(plan,methodology) {
  if(!plan||typeof plan!=='object'||Array.isArray(plan))return 'CONFIRMATION_PLAN_REQUIRED';
  if(plan.policy!=='FIXED_SAMPLE_INDEPENDENT_CONFIRMATION')return 'INVALID_CONFIRMATION_POLICY';
  if(!Number.isFinite(plan.baselineMeanThroughput)||plan.baselineMeanThroughput<0||!scenarioValidConfirmationPilotSeeds(plan.pilotSeeds))return 'INVALID_CONFIRMATION_PILOT';
  if(!Number.isInteger(plan.rounds)||plan.rounds<3)return 'INVALID_CONFIRMATION_SAMPLE_SIZE';
  if(!Number.isFinite(plan.confidenceLevel)||plan.confidenceLevel<=0||plan.confidenceLevel>=1)return 'INVALID_CONFIRMATION_CONFIDENCE';
  if(!Number.isFinite(plan.comparisonDurationSeconds)||plan.comparisonDurationSeconds<=0||typeof plan.comparisonUnitOfFlow!=='string'||!plan.comparisonUnitOfFlow.trim())return 'INVALID_CONFIRMATION_COMPARISON';
  if(!Number.isFinite(plan.minimumPracticalGain)||plan.minimumPracticalGain<0)return 'INVALID_PRACTICAL_GAIN_THRESHOLD';
  let minimum;
  try{minimum=scenarioPracticalGain({throughput:plan.baselineMeanThroughput,unitOfFlow:plan.comparisonUnitOfFlow},methodology||{});}catch(error){return error.message||'INVALID_CONFIRMATION_OBJECTIVE';}
  if(plan.minimumPracticalGain<minimum)return 'PRACTICAL_GAIN_THRESHOLD_REDUCED';
  return null;
}

// Shared by browser confirmation and the saved-evidence server path. Aggregates
// used in economics must describe the same complete observations as the tests.
function scenarioComparisonEvidenceIssue(base,candidate,plan) {
  if(!base||!candidate||!Number.isFinite(base.durationSeconds)||base.durationSeconds<=0||candidate.durationSeconds!==base.durationSeconds)return 'INCOMPATIBLE_CALENDAR_HORIZONS';
  if(typeof base.unitOfFlow!=='string'||!base.unitOfFlow||candidate.unitOfFlow!==base.unitOfFlow)return 'INCOMPATIBLE_FLOW_UNITS';
  if(plan?.comparisonDurationSeconds!==undefined&&plan.comparisonDurationSeconds!==base.durationSeconds)return 'CONFIRMATION_HORIZON_CHANGED';
  if(plan?.comparisonUnitOfFlow!==undefined&&plan.comparisonUnitOfFlow!==base.unitOfFlow)return 'CONFIRMATION_UNIT_CHANGED';
  for(const value of [base,candidate]){
    if(!Array.isArray(value.roundMetrics)||!value.roundMetrics.length)return 'MISSING_REPLICATION_METRICS';
    if(value.roundMetrics.some(row=>row?.durationSeconds!==value.durationSeconds))return 'INCOMPATIBLE_REPLICATION_HORIZONS';
    for(const metric of ['throughput','oee']){
      if(!Number.isFinite(value[metric])||value[metric]<0||value.roundMetrics.some(row=>!Number.isFinite(row[metric])||row[metric]<0))return 'INVALID_REPLICATION_METRICS';
      const mean=value.roundMetrics.reduce((sum,row)=>sum+row[metric],0)/value.roundMetrics.length;
      if(Math.abs(mean-value[metric])>1e-7*Math.max(1,Math.abs(mean)))return 'AGGREGATES_DO_NOT_MATCH_REPLICATIONS';
    }
  }
  return null;
}
