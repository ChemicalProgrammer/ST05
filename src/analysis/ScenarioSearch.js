import {scenarioPairedSummary,planScenarioReplications} from './ScenarioStatistics.js';
import {resolvePlannedStops} from '../simulation/PlantCalendarSchedule.js';
import {scenarioSourceReadiness} from './ScenarioReadiness.js';
import {canonicalSimulationInputSignature} from '../simulation/SimulationProvenance.js';
import {applyScenarioChanges} from './ScenarioPlanner.js';

export const SCENARIO_SEARCH_PROFILES = Object.freeze({
  LIGHT: {explorationSeconds:300,confirmationSeconds:1800,maxCandidates:48,maxSearchMs:120000,maxWithoutImprovement:16,maxFactors:0,passes:1,finalists:4,fullHorizonFinalists:2},
  MEDIUM: {explorationSeconds:600,confirmationSeconds:1800,maxCandidates:128,maxSearchMs:300000,maxWithoutImprovement:32,maxFactors:3,passes:2,finalists:6,fullHorizonFinalists:2},
  HIGH: {explorationSeconds:900,confirmationSeconds:1800,maxCandidates:256,maxSearchMs:600000,maxWithoutImprovement:48,maxFactors:4,passes:3,finalists:6,fullHorizonFinalists:3}
});
export function scenarioSearchSettings(raw) {
  // Basic owns its experiment settings. Hidden Standard/Advance preferences
  // must not silently turn an automatic search into an exhaustive one.
  if(raw?.automaticBasic===true)return {speedProfile:'FAST',automaticBasic:true};
  return {speedProfile:['FAST','BALANCED','THOROUGH'].includes(raw?.speedProfile)?raw.speedProfile:'BALANCED'};
}
export function scenarioSearchSettingsSignature(raw) {
  const settings=scenarioSearchSettings(raw);
  return JSON.stringify([settings.automaticBasic?'SCENARIO_SEARCH_BASIC_MECHANISM_V5':'SCENARIO_SEARCH_SPEED_V1',settings]);
}
export function scenarioSearchProfile(level,settings,context) {
  const profile=SCENARIO_SEARCH_PROFILES[level]||SCENARIO_SEARCH_PROFILES.MEDIUM;
  // Execution budgets are independent of factor depth and statistical acceptance.
  // Balanced deliberately preserves the existing search, including its adaptive budget.
  let selected;switch(scenarioSearchSettings(settings).speedProfile){
    case 'FAST':selected={...profile,explorationSeconds:Math.min(300,profile.explorationSeconds),confirmationSeconds:900,maxCandidates:Math.min(48,profile.maxCandidates),passes:1,fullHorizonFinalists:1,hardCandidateLimit:true};break;
    case 'THOROUGH':selected={...profile,explorationSeconds:Math.min(1800,profile.explorationSeconds*2),confirmationSeconds:3600,maxCandidates:profile.maxCandidates*2,passes:profile.passes+1,fullHorizonFinalists:Math.min(4,profile.fullHorizonFinalists+1)};break;
    default:selected=profile;
  }
  if(settings?.automaticBasic===true)selected={...selected,maxCandidates:24,maxWithoutImprovement:12,passes:1,maxFactors:3,finalists:2,fullHorizonFinalists:1,hardCandidateLimit:true,automaticBasic:true,basicTimeLimitMs:300000};
  const run=context?.run,equipment=context?.equipment;
  if(!run||run.reliabilityEnabled===false||!Array.isArray(equipment))return selected;
  const categories=run.reliabilityCategories||{};
  const mtbf=equipment.filter(e=>e.type!=='CONVEYOR').flatMap(e=>{
    const split=e.processData?.equipment?.stopInputs;
    if(split&&['minor','major'].some(k=>split[k]))return ['minor','major'].filter(k=>categories[k]!==false&&split[k]?.mttrMinutes>0).map(k=>split[k]?.mtbfMinutes);
    return categories.general!==false&&e.noiseProfile?.reliability?.mttrMinutes>0?[e.noiseProfile.reliability.mtbfMinutes]:[];
  }).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  if(!mtbf.length)return selected;
  const median=mtbf.length%2?mtbf[(mtbf.length-1)/2]:(mtbf[mtbf.length/2-1]+mtbf[mtbf.length/2])/2;
  const full=Number(run.durationSeconds);
  if(!(full>selected.explorationSeconds))return selected;
  const floor=selected.automaticBasic?Math.min(900,Math.max(300,Math.ceil(2*median*60/300)*300)):Math.min(1800,Math.max(900,Math.ceil(2*median*60/300)*300));
  const exploration=Math.min(full,Math.max(selected.explorationSeconds,floor));
  const confirmation=Math.min(full,Math.max(selected.confirmationSeconds,Math.min(selected.automaticBasic?1800:3600,2*exploration)));
  return {...selected,explorationSeconds:exploration,confirmationSeconds:confirmation,
    fullHorizonFinalists:selected.automaticBasic?1:Math.max(2,selected.fullHorizonFinalists),
    horizonBasis:'RELIABILITY_AWARE_SCREENING',medianMtbfMinutes:median};
}

// Basic alone uses a matched, versioned low-fidelity engine. Unsupported
// topology or calendar mechanisms use the physical engine for the entire phase.
export function scenarioScreeningEligibility(run,equipment=[]){
  if(run?.engineId&&run.engineId!=='ST_CURRENT')return {supported:false,reason:'ENGINE'};
  if(run?.eventsEnabled!==false&&((run?.commands||[]).length||resolvePlannedStops({...run,tickSeconds:run?.tickSeconds??.25}).events.length))return {supported:false,reason:'SCHEDULED_CONDITIONS'};
  const belt=e=>e.type==='CONVEYOR'||e.processData?.role==='CONVEYOR';
  if(!equipment.length||belt(equipment[0])||belt(equipment.at(-1))||equipment.some((e,i)=>belt(e)&&i>0&&belt(equipment[i-1])))return {supported:false,reason:'TOPOLOGY'};
  if(equipment.some(e=>e.initialMode&&e.initialMode!=='AUTO'||e.processData?.productApplies===false||e.processData?.equipment?.macroStopScrapBottles>0||e.processData?.accumulation?.speedMode==='DYNAMIC'||run?.dynamicLineBalancingEnabled===true&&e.processData?.dynamicLineBalancing?.enabled===true))return {supported:false,reason:'COMPLEX_PHYSICAL_CONTROL'};
  const product=run?.productCatalog?.find(p=>p.id===(run.initialFormatId??run.initialProductId));
  if(product&&equipment.some(e=>product.equipment?.[e.id]?.applies===false))return {supported:false,reason:'PRODUCT_BYPASS'};
  return {supported:true,reason:null};
}
export function basicScenarioConfirmationHorizon(run,equipment=[]){
  const configured=Math.max(1800,Number(run?.durationSeconds)||0);
  const scheduled=run?.eventsEnabled!==false&&((run?.commands||[]).length||resolvePlannedStops({...run,tickSeconds:run?.tickSeconds??.25}).events.length);
  if(scheduled)return {seconds:configured,configuredSeconds:configured,reason:'SCHEDULED_CONDITIONS'};
  let seconds=Math.min(configured,3600),reason=seconds<3600?'SHORT_SOURCE_HORIZON':'ONE_HOUR';
  if(run?.reliabilityEnabled!==false){
    const categories=run?.reliabilityCategories||{};
    for(const e of equipment){
      if(e.type==='CONVEYOR'||e.processData?.role==='CONVEYOR')continue;
      const split=e.processData?.equipment?.stopInputs,r=e.noiseProfile?.reliability;
      const profiles=split?['minor','major'].filter(k=>categories[k]!==false).map(k=>split[k]):categories.general!==false?[r]:[];
      // Extend only for a material modeled downtime mechanism. A long MTBF
      // with negligible downtime should not force every category to a full day.
      for(const p of profiles)if(p?.mtbfMinutes>60&&p.mttrMinutes>0&&p.mttrMinutes/(p.mtbfMinutes+p.mttrMinutes)>=.02){
        const extended=Math.min(configured,Math.ceil(p.mtbfMinutes/60)*3600);
        if(extended>seconds){seconds=extended;reason='MATERIAL_RARE_FAILURE';}
      }
    }
  }
  return {seconds,configuredSeconds:configured,reason};
}

// A package is one intervention: every coupled field is either installed or
// absent. Binary factors never interpolate a supplier target, split a machine
// replacement or install a buffer without its corresponding sensor geometry.
export function designScenarioPackages(packages) {
  if(!Array.isArray(packages)||packages.length<1||packages.length>4)throw Error('DOE_SELECT_ONE_TO_FOUR_FACTORS');
  const ids=new Set(),fields=new Set();
  const factors=packages.map((item,index)=>{
    const packageId=String(item?.packageId||item?.id||'package-'+(index+1));
    if(ids.has(packageId)||!Array.isArray(item?.changes)||!item.changes.length)throw Error('DOE_INVALID_PACKAGE');
    ids.add(packageId);
    const packageChanges=item.changes.map(change=>{
      if(!change?.equipmentId||typeof change.path!=='string'||!(change.before===null||Number.isFinite(change.before))||!Number.isFinite(change.after)||change.before===change.after)throw Error('DOE_INVALID_PACKAGE');
      const key=change.equipmentId+':'+change.path;
      if(fields.has(key))throw Error('DOE_CONFLICTING_PACKAGES');
      fields.add(key);return JSON.parse(JSON.stringify(change));
    });
    if(packageChanges.some(change=>Array.isArray(change.packagePaths)&&change.packagePaths.some(path=>!packageChanges.some(companion=>companion.equipmentId===change.equipmentId&&companion.path===path))))throw Error('DOE_INCOMPLETE_PACKAGE');
    return {equipmentId:packageChanges[0].equipmentId,path:'scenarioPackage.'+packageId,before:0,low:0,high:1,unit:'package',packageId,label:item.label||item.name||packageId,packageChanges};
  });
  if(new Set(factors.flatMap(factor=>factor.packageChanges.map(change=>change.originTier).filter(Boolean))).size>1)throw Error('SCENARIO_CATEGORY_MISMATCH');
  return {type:'FULL_FACTORIAL_TWO_LEVEL',policy:'ATOMIC_INTERVENTION_PACKAGES_V1',factors,
    designPoints:Array.from({length:2**factors.length},(_,index)=>({index,levels:factors.map((_,i)=>(index>>i)&1?1:-1),changes:factors.flatMap((factor,i)=>(index>>i)&1?JSON.parse(JSON.stringify(factor.packageChanges)):[])})),
    interpretation:'Each factor toggles a complete intervention package. Effects belong to the package and do not identify separate effects of its coupled parameters.'};
}

// Diagnosis provides priorities; this step only allocates the bounded search.
// There is no second simulation-based screening before the small factorial.
export function planBasicScenarioSearch(targets,{tier='ZERO',maxFactors=3,screeningLimit=0}={}) {
  if(!['ZERO','MEDIUM','HIGH'].includes(tier)||!Number.isInteger(maxFactors)||maxFactors<1||maxFactors>(tier==='ZERO'?4:3))throw Error('SCENARIO_INVALID_BASIC_FACTOR_LIMIT');
  const key=change=>change.equipmentId+':'+change.path;
  const source=(Array.isArray(targets)?targets:[]).filter(item=>item?.change?.equipmentId&&typeof item.change.path==='string'&&(item.change.before===null||Number.isFinite(item.change.before))&&Number.isFinite(item.change.after)&&item.change.before!==item.change.after&&(!item.change.originTier||item.change.originTier===tier));
  const ordered=source.slice().sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)||key(a.change).localeCompare(key(b.change))||String(a.change.packageId||'').localeCompare(String(b.change.packageId||'')));
  const groups=new Map();
  function mechanism(change){return change.path.startsWith('noiseProfile.reliability.')?'RELIABILITY':/conveyorSpeed|nominalRate/.test(change.path)?'SPEED':/lactMm/.test(change.path)?'ACCUMULATION':/Sensor|sensor|TimeDelay|lpPrimeMm/.test(change.path)?'SENSOR':change.path;}
  for(const item of ordered){
    const change=item.change;
    const packageId=String(change.packageId||change.targetId||item.packageId||(tier==='ZERO'?(mechanism(change)==='RELIABILITY'?'RELIABILITY:'+change.equipmentId:key(change)):tier+':'+change.equipmentId));
    let group=groups.get(packageId);
    if(!group){group={packageId,label:item.label||change.packageLabel||packageId,changes:[],priority:Number(item.priority)||0,mechanism:tier==='MEDIUM'?'ACCUMULATION':tier==='HIGH'?'REPLACEMENT':mechanism(change),equipmentId:change.equipmentId};groups.set(packageId,group);}
    if(!group.changes.some(c=>key(c)===key(change)))group.changes.push(JSON.parse(JSON.stringify(change)));
  }
  const ranked=[...groups.values()].sort((a,b)=>b.priority-a.priority||a.packageId.localeCompare(b.packageId)),packages=[],usedFields=new Set();
  function add(group){if(!group||packages.includes(group)||packages.length>=maxFactors||group.changes.some(c=>usedFields.has(key(c))))return false;packages.push(group);group.changes.forEach(c=>usedFields.add(key(c)));return true;}
  add(ranked[0]);
  if(tier==='ZERO'){
    // Different mechanisms can interact even when one isolated local loss is
    // small. Keep reliability as one paired factor rather than two of three.
    for(const group of ranked)if(!packages.some(p=>p.mechanism===group.mechanism))add(group);
  }
  for(const group of ranked)if(!packages.some(p=>p.equipmentId===group.equipmentId))add(group);
  for(const group of ranked)add(group);
  const design=packages.length?designScenarioPackages(packages):null;
  const changes=packages.flatMap(p=>p.changes),candidatePackages=design?design.designPoints.filter(point=>point.changes.length).map(point=>({packageIds:packages.filter((_,i)=>point.levels[i]===1).map(p=>p.packageId),changes:point.changes,siteCount:new Set(point.changes.map(c=>c.equipmentId)).size})):[];
  return {policy:'BASIC_AUTOMATIC_PACKAGES_V1',tier,maxFactors,packages,changes,factors:design?.factors||[],design,candidatePackages,maximumDesignPoints:design?.designPoints.length||0,
    screeningPackages:ranked.slice(0,Math.max(0,Math.min(16,screeningLimit))),eligible:source.length,eligiblePackages:ranked.length,omitted:Math.max(0,source.length-changes.length),omittedPackages:ranked.length-packages.length,
    interpretation:'A bounded shortlist evaluates complete intervention packages and selected factorial combinations. Preliminary isolated screens can inform the shortlist; physical confirmation and original-horizon verification remain separate.'};
}
export function scenarioSearchRun(run,level,confirmation=false,rounds=3,settings,equipment) {
  const profile=scenarioSearchProfile(level,settings,{run,equipment});
  // Independent What-If horizons; replay configuration and scheduled commands stay intact.
  const copy={...run,durationMode:'FIXED',durationSeconds:confirmation==='validation'?Math.max(1800,Number(run.durationSeconds)||0):confirmation?profile.confirmationSeconds:profile.explorationSeconds,rounds};
  delete copy.shiftSeconds;delete copy.shiftHours;delete copy.shiftCount;
  // A runtime-target stop changes calendar exposure as the candidate improves.
  // What-If compares complete equal calendar horizons and records that choice.
  delete copy.effectiveRuntimeTargetSeconds;
  if(settings?.automaticBasic===true){
    const eligible=scenarioScreeningEligibility(run,equipment||[]),horizon=basicScenarioConfirmationHorizon(run,equipment||[]);
    if(confirmation==='validation'||confirmation==='ranking'){
      copy.durationSeconds=horizon.seconds;copy.numericalResolution=confirmation==='validation'?'PRECISE':'FAST';
      copy.scenarioFidelity=confirmation==='validation'?'PHYSICAL_PRECISE_V1':'PHYSICAL_FAST_V1';
    }else if(confirmation==='physical-screen'||confirmation==='control-screen'){
      copy.durationSeconds=Math.min(horizon.seconds,900);copy.numericalResolution='FAST';copy.scenarioFidelity='PHYSICAL_FAST_V1';
      if(confirmation==='control-screen'){delete copy.scenarioWarmupSeconds;copy.scenarioControlEvidenceVersion=1;}
    }else{
      copy.durationSeconds=Math.min(horizon.seconds,eligible.supported?(confirmation==='sensitivity'?Math.max(300,profile.explorationSeconds):1800):profile.explorationSeconds);
      copy.scenarioFidelity=eligible.supported?'FLUID_SCREEN_V1':'PHYSICAL_FAST_V1';
      if(!eligible.supported)copy.numericalResolution='FAST';
      else copy.scenarioWarmupSeconds=Math.min(300,copy.durationSeconds/3);
    }
  }
  return copy;
}

// The intermediate screen selects where to spend simulation time; it never
// certifies a gain. Selection and independent confirmation retain the full day.
export function planScenarioFinalistRanking(run,level,candidateCount,options={}) {
  const settings=scenarioSearchSettings(options.searchSettings),profile=scenarioSearchProfile(level,settings,{run,equipment:options.equipment}),fullRun=scenarioSearchRun(run,level,'validation',3,settings,options.equipment);
  const limit=Math.max(1,Math.min(candidateCount,Number.isInteger(options.fullHorizonFinalists)?options.fullHorizonFinalists:profile.fullHorizonFinalists));
  const screenRun=scenarioSearchRun(run,level,settings.automaticBasic?'physical-screen':true,3,settings,options.equipment);
  if(settings.automaticBasic){
    const horizon=basicScenarioConfirmationHorizon(run,options.equipment||[]),rankRun=scenarioSearchRun(run,level,'ranking',3,settings,options.equipment);
    const staged=candidateCount>1;
    return {policy:'BASIC_MULTIFIDELITY_V3',staged,reason:staged?'PHYSICAL_CHECK_OF_APPROXIMATE_RANKING':'ONE_FINALIST',screenRun,fullRun:rankRun,confirmationRun:fullRun,confirmationHorizon:horizon,fullHorizonFinalists:1,screeningSeedOffset:50003,rankingSeedOffset:100003,confirmationSeedOffset:1000003,interpretation:'Exploratory fluid ranking, physical FAST finalist checks, and independent PRECISE confirmation on the recorded comparison horizon; not a global optimum or validation of the full original calendar unless horizons coincide.'};
  }
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
// Progressive Basic gate: a negative short screen is not proof of no benefit.
 // Promote measured gains or one precautionary alternative when a short prefix
 // cannot represent the full run. Never expand the full-horizon budget.
export function selectProgressiveBasicFinalists(items,baseline,run,equipment=[],limit=1) {
  const valid=(items||[]).filter(item=>item?.changes?.length&&Number.isFinite(item.result?.throughput)&&Number.isFinite(item.result?.oee)&&(!baseline?.scenarioFidelity||item.result.scenarioFidelity===baseline.scenarioFidelity)&&(!baseline?.durationSeconds||item.result.durationSeconds===baseline.durationSeconds));
  const horizon=Number(baseline?.durationSeconds)||0,full=Math.max(1800,Number(run?.durationSeconds)||0);
  const short=horizon>0&&horizon<full,threshold=Math.max(.001,Math.abs(baseline?.throughput||0)*.001);
  const categories=run?.reliabilityCategories||{};
  const rare=run?.reliabilityEnabled!==false&&equipment.some(e=>{
    if(e.type==='CONVEYOR')return false;
    const split=e.processData?.equipment?.stopInputs,r=e.noiseProfile?.reliability;
    const pairs=split?['minor','major'].filter(k=>categories[k]!==false).map(k=>split[k]):categories.general!==false?[r]:[];
    return pairs.some(pair=>pair?.mttrMinutes>0&&pair.mtbfMinutes*60>horizon/2);
  });
  const scheduled=short&&!!(run?.commands?.length||resolvePlannedStops({...run,tickSeconds:run?.tickSeconds??.25}).events.length);
  const slowFill=short&&equipment.some(e=>{
    const length=e.processData?.geometry?.lactMm,speed=e.processData?.accumulation?.conveyorSpeedMmPerSecond;
    return e.type==='CONVEYOR'&&length>0&&speed>0&&length/speed>horizon/4;
  });
  const reasons=[...(short&&rare?['RARE_FAILURE_EXPOSURE']:[]),...(scheduled?['SCHEDULED_CONDITIONS']:[]),...(slowFill?['LONG_TRANSPORT_TRANSIT']:[]),...(short&&!(baseline?.throughput>0)?['STARTUP_OR_NO_OUTPUT']:[])];
  const baseRounds=new Map((baseline?.roundMetrics||[]).map(row=>[row.seed,row]));
  const scored=valid.map(item=>{
    const value=item.result,delta=value.throughput-baseline.throughput;
    const paired=(value.roundMetrics||[]).map(row=>row.throughput-(baseRounds.get(row.seed)?.throughput??NaN));
    const matched=paired.length>=3&&paired.length===baseRounds.size&&paired.every(Number.isFinite);
    return {item,delta,meanOee:value.oee-baseline.oee,potential:delta>threshold||(matched&&paired.some(d=>d>threshold)),uncertain:!matched};
  }).sort((a,b)=>Number(!a.potential)-Number(!b.potential)||Number(!!a.item.result.warnings?.length)-Number(!!b.item.result.warnings?.length)||Number(a.meanOee<0)-Number(b.meanOee<0)||b.delta-a.delta);
  if(scored.some(item=>item.uncertain))reasons.push('INCOMPLETE_PAIRED_SCREEN');
  const approximate=baseline?.scenarioFidelity==='FLUID_SCREEN_V1';
  if(approximate)reasons.push('APPROXIMATE_SCREEN_REQUIRES_PHYSICAL_PROBE');
  const promising=scored.filter(item=>item.potential),budget=Math.max(1,Math.min(3,limit)),chosen=[];
  const keys=row=>new Set(row.item.changes.map(c=>c.packageId||c.equipmentId+':'+c.path));
  const distance=(a,b)=>{const x=keys(a),y=keys(b);return 1-[...x].filter(k=>y.has(k)).length/new Set([...x,...y]).size;};
  if(promising.length)chosen.push(promising[0]);
  // Do not spend all physical checks on near-duplicate fluid winners. Retain
  // a distinct sensor/control hypothesis even when fluid pulses are invisible.
  if(budget>1&&chosen.length){
    const sensor=row=>row.item.changes.some(c=>/sensor|timedelay|lpPrimeMm/i.test(c.path));
    const controlOnly=row=>sensor(row)&&!row.item.changes.some(c=>c.path.startsWith('noiseProfile.reliability.')||c.interventionType==='REPLACEMENT'||c.interventionType==='ACCUMULATION');
    const control=scored.find(row=>!chosen.includes(row)&&controlOnly(row)&&(approximate||row.potential))|| (approximate?scored.find(row=>!chosen.includes(row)&&sensor(row)&&distance(row,chosen[0])>=.5):null);
    if(control)chosen.push(control);
  }
  while(chosen.length<budget&&promising.some(row=>!chosen.includes(row))){
    const pool=promising.filter(row=>!chosen.includes(row));
    chosen.push(pool.find(row=>chosen.every(prior=>distance(row,prior)>=.5))||pool[0]);
  }
  const lateMechanism=item=>item.item.changes.some(change=>change.path.startsWith('noiseProfile.reliability.')||change.interventionType==='ACCUMULATION'||change.interventionType==='REPLACEMENT');
  if(!chosen.length&&reasons.length&&scored.length)chosen.push((rare&&short?scored.find(lateMechanism):null)||scored[0]);
  if(chosen.length===1&&budget>1&&reasons.length){
    const sensor=item=>item.item.changes.some(c=>/sensor|timedelay|lpPrimeMm/i.test(c.path));
    const late=(approximate?scored.find(item=>!chosen.includes(item)&&sensor(item)):null)||scored.find(item=>!chosen.includes(item)&&lateMechanism(item))||(approximate?scored.find(item=>!chosen.includes(item)):null);
    if(late)chosen.push(late);
  }
  return {selected:chosen.map(row=>row.item),evaluated:valid.length,promising:promising.length,omitted:valid.length-chosen.length,precautionary:chosen.some(row=>!row.potential),reasons,threshold,
    outcome:chosen.length?'PROMOTE':valid.length?'NO_PROMISING_CANDIDATE':'NO_FEASIBLE_CANDIDATE',
    interpretation:'Bounded preliminary selection only. Omitted candidates may improve over a longer horizon or outside the tested levels; a promoted candidate still requires independent physical confirmation and verification on the original run.'};
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
export function planScenarioConfirmation(base,candidate,methodology={},options={}) {
  const issue=scenarioComparisonEvidenceIssue(base,candidate);
  if(options.automaticBasic&&((base?.scenarioFidelity&&base.scenarioFidelity!=='PHYSICAL_FAST_V1')||(candidate?.scenarioFidelity&&candidate.scenarioFidelity!=='PHYSICAL_FAST_V1')))return {rounds:null,status:'BASIC_PHYSICAL_PILOT_REQUIRED',policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};
  if(issue)return {rounds:null,status:issue,policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};
  const baseSeeds=base.roundMetrics.map(row=>row.seed),candidateSeeds=candidate.roundMetrics.map(row=>row.seed);
  if(!scenarioValidConfirmationPilotSeeds(baseSeeds)||!scenarioValidConfirmationPilotSeeds(candidateSeeds)||baseSeeds.length!==candidateSeeds.length||baseSeeds.some(seed=>!candidateSeeds.includes(seed)))return {rounds:null,status:'INVALID_PILOT_REPLICATIONS',policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};
  const settings=methodology?.replications||{};
  const replicationOptions={minRounds:options.automaticBasic?3:settings.minimum??3,maxRounds:options.automaticBasic?6:settings.maximum??30,
    confidenceLevel:settings.confidenceLevel??.95,relativePrecision:settings.relativePrecision??.005};
  if(settings.absolutePrecision!==undefined)replicationOptions.absolutePrecision=settings.absolutePrecision;
  const plan=planScenarioReplications(base,candidate,replicationOptions);
  let minimumPracticalGain;
  try{minimumPracticalGain=scenarioPracticalGain({throughput:plan.baselineMeanThroughput,unitOfFlow:base.unitOfFlow},methodology||{});}catch(error){return {...plan,rounds:null,status:error.message||'INVALID_CONFIRMATION_OBJECTIVE',policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};}
  return {...plan,...(options.automaticBasic?{automaticBasic:true,basicReplicationCap:6}:{}),policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION',comparisonDurationSeconds:base.durationSeconds,comparisonUnitOfFlow:base.unitOfFlow,
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
  const evidenceIssue=plan?.automaticBasic&&(base?.scenarioFidelity!=='PHYSICAL_PRECISE_V1'||candidate?.scenarioFidelity!=='PHYSICAL_PRECISE_V1')?'BASIC_PRECISE_CONFIRMATION_REQUIRED':scenarioComparisonEvidenceIssue(base,candidate,plan);
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
  if(base?.scenarioFidelity&&candidate?.scenarioFidelity&&base.scenarioFidelity!==candidate.scenarioFidelity&&base.scenarioFidelity!=='ORIGINAL_PHYSICAL_RUN')return 'INCOMPATIBLE_SCENARIO_FIDELITY';
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

// Absolute source comparison is a second, descriptive gate, not a statistical
// replication or a replacement for the independent short-window experiment.
// The saved baseline is reused only after the normal source readiness check.
export function scenarioOriginalVerificationPlan(simulation){
  const readiness=scenarioSourceReadiness(simulation);
  if(!readiness.ready)return {ready:false,reason:readiness.reason||'SOURCE_NOT_READY'};
  const result=simulation.results,provenance=JSON.parse(result.inputSignature),run={...provenance.run};
  if(run.effectiveRuntimeTargetSeconds!==undefined)return {ready:false,reason:'VARIABLE_CALENDAR_RUNTIME_TARGET'};
  const duration=result.durationSeconds,rows=result.batch?.rows||(run.rounds===1?[result]:[]);
  if(run.durationSeconds!==duration||!Array.isArray(rows)||rows.length!==run.rounds)return {ready:false,reason:'SOURCE_HORIZON_MISMATCH'};
  const roundMetrics=rows.map(row=>({seed:row.seed,durationSeconds:row.durationSeconds??duration,outputCount:row.summary?.outputCount,oee:row.summary?.lineOeePercent,throughput:row.summary?.outputCount/(row.durationSeconds??duration)*60}));
  const mean=key=>roundMetrics.reduce((sum,r)=>sum+r[key]/roundMetrics.length,0);
  const baseline={durationSeconds:duration,unitOfFlow:result.unitOfFlow||readiness.unitOfFlow,roundMetrics,oee:mean('oee'),throughput:mean('throughput'),overflowUnits:result.batch?.statistics?.totalOverflowUnits?.mean??result.summary?.totalOverflowUnits??null,cacheSource:'SAVED_ORIGINAL_SIMULATION',scenarioFidelity:'ORIGINAL_PHYSICAL_RUN'};
  const issue=scenarioComparisonEvidenceIssue(baseline,baseline);
  if(issue)return {ready:false,reason:issue};
  const reportedOee=result.batch?.statistics?.lineOeePercent?.mean??result.summary?.lineOeePercent;
  const reportedThroughput=result.batch?.statistics?.throughputPerMinute?.mean??(result.batch?.statistics?.outputCount?.mean??result.summary?.outputCount)/duration*60;
  if(!Number.isFinite(reportedOee)||!Number.isFinite(reportedThroughput)||Math.abs(reportedOee-baseline.oee)>1e-6||Math.abs(reportedThroughput-baseline.throughput)>1e-6*Math.max(1,baseline.throughput))return {ready:false,reason:'SOURCE_AGGREGATE_MISMATCH'};
  return {ready:true,run,inputUnit:provenance.unitOfFlow,baseline,sourceInputSignature:result.inputSignature};
}
export function assessScenarioOriginalVerification(simulation,candidate,changes){
  const plan=scenarioOriginalVerificationPlan(simulation),policy='MATCHED_ORIGINAL_HORIZON_V1';
  if(!plan.ready)return {policy,passed:false,status:'NOT_EVALUATED',reason:plan.reason};
  const baseline=plan.baseline,run={durationSeconds:plan.run.durationSeconds,rounds:plan.run.rounds,seed:plan.run.seed,numericalResolution:plan.run.numericalResolution||'PRECISE',engineId:plan.run.engineId,comparisonBasis:'ORIGINAL_FIXED_CALENDAR'};
  const common={policy,baseline,run,candidate:candidate||null,unitOfFlow:baseline.unitOfFlow,durationSeconds:run.durationSeconds,rounds:run.rounds,interpretation:'Descriptive comparison with the exact original horizon, resolution and seeds. Independent short-window statistical evidence is separate; one original round is not an independent confidence interval.'};
  if(!candidate)return {...common,passed:false,status:'NOT_EVALUATED',reason:'CANDIDATE_REQUIRED'};
  let expected;try{const model=applyScenarioChanges(simulation,changes,{previewOnly:true});expected=canonicalSimulationInputSignature({case:{equipment:model.equipment,unitOfFlow:plan.inputUnit},run:plan.run});}catch(_){return {...common,passed:false,status:'INVALID',reason:'CANDIDATE_CONFIGURATION_INVALID'};}
  const issue=scenarioComparisonEvidenceIssue(baseline,candidate);
  const matched=baseline.roundMetrics.length===candidate.roundMetrics?.length&&baseline.roundMetrics.every(row=>candidate.roundMetrics.some(r=>r.seed===row.seed));
  if(issue||!matched||candidate.inputSignature!==expected)return {...common,passed:false,status:'INVALID',reason:issue||(!matched?'ORIGINAL_SEEDS_MISMATCH':'ORIGINAL_INPUT_SIGNATURE_MISMATCH')};
  const delta={oeePercentagePoints:candidate.oee-baseline.oee,throughputPerMinute:candidate.throughput-baseline.throughput};
  const threshold=scenarioPracticalGain(baseline,simulation.whatIf?.methodology||{});
  const passed=delta.throughputPerMinute>threshold&&delta.oeePercentagePoints>=-1e-9;
  return {...common,passed,status:passed?'VERIFIED':'NO_ORIGINAL_HORIZON_IMPROVEMENT',reason:passed?null:'ORIGINAL_HORIZON_GAIN_NOT_ESTABLISHED',threshold,delta};
}

// Mechanism-oriented diagnostic. Never infer a PLC root cause from counts;
// use them to allocate physical experiments. Replicated scalar metrics are
// means; a legacy zone snapshot is explicitly a representative round only.
export function scenarioControlDiagnostics(result,equipment=[]){
  if(!result?.summary||!(result.durationSeconds>0))return null;
  const duration=result.durationSeconds,minutes=duration/60,rows=result.batch?.rows||[],rounds=result.batch?.rounds||1;
  const finite=v=>Number.isFinite(v)?v:null,ratio=(a,b)=>Number.isFinite(a)&&b>0?a/b:null;
  const metric=(id,key)=>{
    const mean=result.batch?.equipmentStatistics?.[id]?.[key]?.mean;
    return finite(Number.isFinite(mean)?mean:rounds===1?result.equipmentMetrics?.[id]?.[key]:null);
  };
  const machines=equipment.filter(e=>e.type!=='CONVEYOR'&&e.processData?.role!=='CONVEYOR').map(e=>{
    const output=metric(e.id,'outputCount'),ramps=metric(e.id,'startRampCount'),failures=metric(e.id,'failureCount');
    const rampSeconds=metric(e.id,'startRampSeconds'),primeSeconds=metric(e.id,'waitingForPrimeSeconds');
    return {equipmentId:e.id,name:e.name,outputCount:output,startRampCount:ramps,startRampSeconds:rampSeconds,
      stopTransitionCount:metric(e.id,'stopTransitionCount'),repairRestartCount:metric(e.id,'repairRestartCount'),
      failureCount:failures,failureSeconds:metric(e.id,'failureSeconds'),waitingForPrimeSeconds:primeSeconds,
      backupStopSeconds:metric(e.id,'backupStopSeconds'),blockedSeconds:metric(e.id,'blockedSeconds'),
      rampPercent:Number.isFinite(rampSeconds)?100*rampSeconds/duration:null,primeWaitPercent:Number.isFinite(primeSeconds)?100*primeSeconds/duration:null,
      rampsPerOutput:ratio(ramps,output),rampsPerMinute:ratio(ramps,minutes),rampFailureRatio:ratio(ramps,failures),
      repeatedStarts:Number.isFinite(ramps)&&ramps>=10&&((ratio(ramps,output)??0)>=.25||ramps>5*Math.max(1,failures??0))};
  });
  const zones=Object.values(result.accumulationZoneMetrics||{}).filter(z=>z.ownerEquipmentId).map(z=>{
    const e=equipment.find(e=>e.id===z.ownerEquipmentId),native=e?.processData;
    const observations=rows.map(row=>row.conveyorResults?.find(r=>r.id===z.id||r.ownerEquipmentId===z.ownerEquipmentId));
    const meanAvailable=observations.length===rounds&&observations.every(r=>r&&Number.isFinite(r.backupTriggerCount)&&Number.isFinite(r.primeTriggerCount));
    const read=key=>meanAvailable&&observations.every(r=>Number.isFinite(r[key]))?observations.reduce((sum,r)=>sum+r[key]/rounds,0):finite(z[key]);
    const packageLength=z.productLengthMm??native?.upstream?.packageLengthMm,speed=z.conveyorSpeedMmPerSecond;
    const pulse=ratio(packageLength,speed),delay=finite(native?.accumulation?.blockedTimeDelaySeconds??native?.speedAndSensors?.blockedTimeDelaySeconds);
    const bt=read('backupTriggerCount'),bp=read('backupPassedUnits'),pt=read('primeTriggerCount'),pp=read('primePassedUnits');
    return {equipmentId:z.ownerEquipmentId,name:e?.name||z.ownerEquipmentId,upstreamId:z.upstreamControlEquipmentId||null,downstreamId:z.downstreamControlEquipmentId||null,
      counterBasis:meanAvailable?'REPLICATION_MEAN':rounds===1?'SINGLE_ROUND':'REPRESENTATIVE_ROUND',packageLengthMm:finite(packageLength),beltSpeedMmPerSecond:finite(speed),normalPulseSeconds:pulse,blockedDelaySeconds:delay,
      pulseConflict:Number.isFinite(pulse)&&Number.isFinite(delay)&&pulse+1e-9>=delay,
      primeTriggerCount:pt,primePassedUnits:pp,backupTriggerCount:bt,backupPassedUnits:bp,primeTriggersPerPass:ratio(pt,pp),backupTriggersPerPass:ratio(bt,bp),
      backupSignalPulsingSeconds:read('backupSignalPulsingSeconds'),backupSignalBlockedSeconds:read('backupSignalBlockedSeconds'),overflowUnits:read('overflowUnits')};
  });
  return {version:1,durationSeconds:duration,rounds,machines,zones,interpretation:'Repeated starts, passage pulses and propagated blocking are diagnostic indicators, not established plant failure causes.'};
}
export function scenarioIsPhysicalControl(change){
  return change?.originTier==='ZERO'&&!change.external&&!change.analysisOnly&&/\.(blockedTimeDelaySeconds|clearTimeDelaySeconds|backupSensorPositionMm|lpPrimeMm|conveyorSpeedMmPerSecond|conveyorSpeedFactorPercent|downstreamRampUpSeconds|startupTimeSeconds)$/.test(change.path||'');
}
// Build a bounded physical experiment set from validated Zero proposals.
// Additional levels are exploratory within the installed geometry. No machine
// ramp, sensor implementation or overflow logic is overridden in the engine.
export function planScenarioControlProbes(simulation,targets,{limit=12}={}){
  const diagnostic=scenarioControlDiagnostics(simulation?.results,simulation?.equipment||[]),equipment=simulation?.equipment||[];
  const pool=[],seen=new Set(),groups=new Map();
  for(const entry of targets||[]){
    const c=entry?.change||entry;
    if(!scenarioIsPhysicalControl(c)||c.disabledReason||!(c.before===null||Number.isFinite(c.before))||!Number.isFinite(c.after)||c.before===c.after)continue;
    const id=c.packageId||c.equipmentId+':'+c.path,group=groups.get(id)||{packageId:id,changes:[],priority:0};
    if(!group.changes.some(x=>x.equipmentId===c.equipmentId&&x.path===c.path))group.changes.push(c);
    group.priority=Math.max(group.priority,Number(entry.priority)||0);groups.set(id,group);
  }
  function add(changes,priority,kind,level){
    const key=JSON.stringify(changes.map(c=>[c.equipmentId,c.path,c.after]).sort());
    if(seen.has(key)||changes.some(c=>c.before===c.after||!Number.isFinite(c.after)||c.after<0))return;
    try{applyScenarioChanges(simulation,changes,{tier:'ZERO',previewOnly:true});}catch(_){return;}
    seen.add(key);pool.push({packageId:changes[0].packageId||changes[0].equipmentId+':'+changes[0].path,changes:JSON.parse(JSON.stringify(changes)),priority,kind,level});
  }
  for(const group of groups.values()){
    const c=group.changes[0],z=diagnostic?.zones.find(row=>row.equipmentId===c.equipmentId),down=diagnostic?.machines.find(row=>row.equipmentId===z?.downstreamId),up=diagnostic?.machines.find(row=>row.equipmentId===z?.upstreamId);
    const path=c.path,delay=/TimeDelaySeconds$/.test(path),prime=/lpPrimeMm$/.test(path),backup=/backupSensorPositionMm$/.test(path),speed=/conveyorSpeed/.test(path);
    const chatter=100*Math.min(1,Math.max(z?.primeTriggersPerPass??0,z?.backupTriggersPerPass??0)),repeated=down?.repeatedStarts?40:0;
    const importance=group.priority+chatter+repeated+(z?.pulseConflict&&delay?200:0)+(Number.isFinite(up?.blockedSeconds)?20*up.blockedSeconds/(diagnostic?.durationSeconds||1):0);
    const kind=delay?'SENSOR_TIMING':prime||backup?'SENSOR_POSITION':speed?'SPEED':'RESTART_CONTROL';
    add(group.changes,importance,kind,'ENGINEERING_TARGET');
    if(group.changes.length!==1||c.packagePaths?.length>1)continue;
    const e=equipment.find(e=>e.id===c.equipmentId),length=e?.processData?.geometry?.lactMm;
    const variant=(after,bonus,level)=>add([{...c,after:Number(after.toFixed(4))}],importance+bonus,kind,level);
    if(path.endsWith('blockedTimeDelaySeconds')&&z?.pulseConflict&&z.normalPulseSeconds>0){
      variant(Math.ceil((z.normalPulseSeconds+.05)*100)/100,15,'JUST_ABOVE_NORMAL_PULSE');
      variant(Math.ceil((z.normalPulseSeconds+.30)*10)/10,10,'PULSE_MARGIN');
    }
    if(prime&&Number.isFinite(c.before)&&c.before>0&&Number.isFinite(length)){
      variant(Math.min(length,c.before*1.5),repeated?8:-20,'LARGER_PRIME_RESERVE');
      variant(Math.max(0,c.before*.25),repeated?6:-25,'SMALLER_PRIME_RESERVE');
    }
    if(backup&&Number.isFinite(c.before)&&c.before>=0)variant((c.before+c.after)/2,-5,'INTERMEDIATE_BACKUP_POSITION');
    // Delays and speeds also interact with the normal passage time. Keep the
    // existing engineering target plus a conservative intermediate speed.
    if(speed&&Number.isFinite(c.before)&&c.before>0)variant((c.before+c.after)/2,-35,'INTERMEDIATE_SPEED');
  }
  pool.sort((a,b)=>b.priority-a.priority||a.packageId.localeCompare(b.packageId)||a.level.localeCompare(b.level));
  const chosen=[],used=new Set(),budget=Math.max(0,Math.min(16,Math.floor(limit)));
  // First test the engineering proposal at each implicated field; use the
  // remaining budget for extra levels at the highest-risk controls.
  for(const p of pool.filter(x=>x.level==='ENGINEERING_TARGET')){
    if(chosen.length>=budget)break;chosen.push(p);used.add(p);
  }
  for(const p of pool){if(chosen.length>=budget)break;if(!used.has(p)){chosen.push(p);used.add(p);}}
  chosen.sort((a,b)=>b.priority-a.priority||a.packageId.localeCompare(b.packageId));
  return {policy:'PHYSICAL_CONTROL_PROBES_V1',diagnostic,probes:chosen,eligibleProbes:pool.length,omittedProbes:pool.length-chosen.length};
}
// Compare levels only within one matched physical experiment. Prefer fewer
// warning conditions, then throughput and minimal movement for near ties.
export function rankScenarioPhysicalPackages(observations,baseline){
  const groups=new Map(),threshold=Math.max(.001,Math.abs(baseline?.throughput||0)*.001);
  for(const row of observations||[]){
    const value=row?.result;
    if(!value||value.scenarioFidelity!==baseline?.scenarioFidelity||value.durationSeconds!==baseline.durationSeconds||scenarioComparisonEvidenceIssue(baseline,value))continue;
    const bseeds=new Set(baseline.roundMetrics.map(r=>r.seed));
    if(value.roundMetrics.length!==bseeds.size||value.roundMetrics.some(r=>!bseeds.has(r.seed)))continue;
    const id=row.packageId||row.changes[0]?.packageId||row.changes[0]?.equipmentId+':'+row.changes[0]?.path;
    const gain=value.throughput-baseline.throughput,warningCount=value.warnings?.length||0,positive=gain>threshold&&value.oee>=baseline.oee-1e-9;
    const item={...row,packageId:id,gain,warningCount,positive};
    const old=groups.get(id);
    if(!old||Number(item.positive)>Number(old.positive)||item.positive===old.positive&&(item.warningCount<old.warningCount||item.warningCount===old.warningCount&&item.gain>old.gain+1e-9))groups.set(id,item);
  }
  const sorted=[...groups.values()].sort((a,b)=>Number(b.positive)-Number(a.positive)||a.warningCount-b.warningCount||b.gain-a.gain||b.priority-a.priority||a.packageId.localeCompare(b.packageId));
  const positive=sorted.filter(r=>r.positive);
  // No positive isolated result is not proof of no interaction. Preserve at
  // most one precautionary package of each mechanism when necessary.
  const chosen=positive.length?positive:sorted.slice(0,3);
  return {ranked:sorted,targets:chosen.flatMap((r,i)=>r.changes.map(change=>({change,priority:100000-i*1000+Math.max(0,Math.min(999,r.gain||0))}))),threshold,interpretation:'Ranked matched physical isolated levels. Effects are conditional, not additive; factorial design tests interactions.'};
}
