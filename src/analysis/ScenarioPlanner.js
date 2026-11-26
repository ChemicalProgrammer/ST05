import { analyzeLinePerformance, diagnoseLineEfficiency } from './LinePerformanceAnalysis.js';
import { calculateConveyorEngineering } from '../simulation/ConveyorEngineering.js';
import { resolveAccumulationZoneDefinition } from '../simulation/FormatGeometryAdapter.js';
import { validateSimulationInput } from '../simulation/SimulationValidation.js';
import { SIMULATION_PROVENANCE_VERSION } from '../simulation/SimulationProvenance.js';
import { applyProductProfile, productUnitFactor } from '../simulation/ProductProfiles.js';
import { scenarioSourceReadiness } from './ScenarioReadiness.js';

// Scenario policy is separate from the unchanged simulation mathematics.
export const SCENARIO_POLICY = Object.freeze({microstopLimitMinutes:4,maxChanges:64});
export const SCENARIO_DEFINITIONS = Object.freeze({
  ZERO:{scope:'Optimize installed assets and work practices without capital investment.',reliability:'Supported operational improvements; additional maintenance is OPEX, not capital.',costBasis:'Intervention scope; no assumed monetary threshold or required efficiency gain.'},
  MEDIUM:{scope:'Local component rehabilitation, monitoring or equipment retrofit.',reliability:'Documented retrofit MTBF/MTTR targets, with installation scope and target source.',costBasis:'Intervention type and physical scope only; no budget amount or monetary threshold is required.'},
  HIGH:{scope:'Complete equipment replacement or major line/transport redesign.',reliability:'Replacement can improve reliability without changing speed; use supplier or measured targets.',costBasis:'Complete replacement or major redesign defines this category; no budget amount or minimum efficiency gain is required.'}
});
export const SCENARIO_INTERVENTIONS = Object.freeze({
  OPERATIONAL:{tier:'ZERO',costClass:'NONE',label:'Existing resources / work practices'},
  MAINTENANCE:{tier:'ZERO',costClass:'OPEX',label:'Additional maintenance / repair resources'},
  RETROFIT:{tier:'MEDIUM',costClass:'CAPEX',label:'Local retrofit / rehabilitation'},
  REPLACEMENT:{tier:'HIGH',costClass:'CAPEX',label:'Complete equipment replacement'}
});
// Input classes are declarations, not causes inferred from mean stop duration.
// The independent MICRO_STOP process is distinct from MINOR reliability events.
export function scenarioStopDataCoverage(simulation,equipment){
  const reliability=equipment?.noiseProfile?.reliability,split=equipment?.processData?.equipment?.stopInputs;
  const validPair=pair=>pair&&Number.isFinite(pair.mtbfMinutes)&&Number.isFinite(pair.mttrMinutes)&&
    (pair.mtbfMinutes>0&&pair.mttrMinutes>0||pair.mtbfMinutes===0&&pair.mttrMinutes===0);
  const mode=split!==undefined?(['minor','major'].every(kind=>validPair(split?.[kind]))?'SPLIT':'INVALID_SPLIT'):
    reliability?.mtbfMinutes>0&&reliability?.mttrMinutes>0?'GENERAL':'NOT_CONFIGURED';
  const enabled=equipment?.type!=='CONVEYOR'&&equipment?.processData?.role!=='CONVEYOR'&&simulation?.dynamicConfig?.reliabilityEnabled!==false&&!!reliability;
  const categories=simulation?.dynamicConfig?.reliabilityCategories||{};
  const enabledClasses=!enabled?[]:mode==='SPLIT'?['minor','major'].filter(kind=>split[kind].mtbfMinutes>0&&categories[kind]!==false).map(kind=>kind.toUpperCase()):
    mode==='GENERAL'&&categories.general!==false?['GENERAL']:[];
  return {mode,source:mode==='SPLIT'?'DECLARED_EQUIPMENT_STOP_CLASSES':mode==='GENERAL'?'AGGREGATE_RELIABILITY_INPUT':'NO_VALID_CLASS_INPUT',
    enabledClasses,classSpecificAnalysisAvailable:mode==='SPLIT',breakdownRequiredForClassSpecificAttribution:mode==='GENERAL',
    microStopProcessConfigured:(equipment?.noiseProfile?.microStop?.probabilityPerMinute||0)>0,
    causeClassification:'NOT_ESTABLISHED',classesInferred:false,
    interpretation:'MINOR and MAJOR use supplied stop classes; GENERAL remains unclassified. MICRO_STOP is a separate modeled process. Duration alone does not establish a failure cause, maintenance action or replacement.'};
}
export function scenarioCategoryAllows(change,tier){
  if(change.analysisOnly)return false;
  if(change.replacementMaximumBpm!==undefined)return tier==='HIGH'&&change.path==='nominalRatePerSecond'&&change.interventionType==='REPLACEMENT'&&change.external===true;
  if(change.path.startsWith('noiseProfile.reliability.')){
    const intervention=SCENARIO_INTERVENTIONS[change.interventionType];
    return !!intervention&&intervention.tier===tier;
  }
  return tier==='HIGH'||tier==='MEDIUM'&&change.path!=='processData.geometry.lactMm'||tier==='ZERO'&&!change.external&&change.path!=='processData.geometry.lactMm';
}
// Explicit exploratory levels are diagnostics, never implementation targets.
export function reliabilitySensitivityCandidates(simulation,{mtbfMultiplier=2,mttrMultiplier=.5}={}){
  if(simulation.dynamicConfig?.reliabilityEnabled===false)return [];
  if(!(mtbfMultiplier>1&&mtbfMultiplier<=10&&mttrMultiplier>0&&mttrMultiplier<1))throw Error('SCENARIO_INVALID_SENSITIVITY_LEVEL');
  const diagnosis=diagnoseScenarioLosses(simulation);
  return (simulation.equipment||[]).filter(e=>e.type!=='CONVEYOR'&&e.noiseProfile?.reliability?.mtbfMinutes>0&&e.noiseProfile?.reliability?.mttrMinutes>0).flatMap(e=>{
    const changes=['mtbfMinutes','mttrMinutes'].map((key,i)=>({...scenarioChange(e,'noiseProfile.reliability.'+key,Math.max(SCENARIO_FIELDS['noiseProfile.reliability.'+key][0],Math.min(SCENARIO_FIELDS['noiseProfile.reliability.'+key][1],e.noiseProfile.reliability[key]*(i?mttrMultiplier:mtbfMultiplier)))),external:true,analysisOnly:true,interventionType:'SENSITIVITY',justification:'Exploratory sensitivity level; not an achievable intervention target.'}));
    const observed=diagnosis.equipment.find(r=>r.equipmentId===e.id);
    const stopData= scenarioStopDataCoverage(simulation,e);
    const assessment=equipmentReliabilityAssessment(e,simulation.dynamicConfig);
    return ['MTBF','MTTR','JOINT'].map((kind,i)=>({equipmentId:e.id,equipmentName:e.name,kind,changes:i===2?changes:[changes[i]],ownStopPercent:observed?.ownStopPercent??null,
      failureSeconds:observed?.failureSeconds??null,reliabilityAssessment:assessment,stopDataCoverage:stopData,targetScope:stopData.mode==='SPLIT'?'ALL_CONFIGURED_STOP_CLASSES':'GENERAL_UNCLASSIFIED',
      availabilityBefore:e.noiseProfile.reliability.mtbfMinutes/(e.noiseProfile.reliability.mtbfMinutes+e.noiseProfile.reliability.mttrMinutes)}));
  }).sort((a,b)=>(b.failureSeconds??0)-(a.failureSeconds??0));
}
export const SCENARIO_FIELDS = Object.freeze({
  'nominalRatePerSecond':[0.001,1000000,'units/s'],
  'noiseProfile.reliability.mtbfMinutes':[0.001,1000000,'min'],
  'noiseProfile.reliability.mttrMinutes':[0.001,1000000,'min'],
  'processData.accumulation.conveyorSpeedMmPerSecond':[0.001,1000000,'mm/s'],
  'processData.accumulation.conveyorSpeedFactorPercent':[0,1000,'%'],
  'processData.accumulation.blockedTimeDelaySeconds':[0,3600,'s'],
  'processData.accumulation.clearTimeDelaySeconds':[0,3600,'s'],
  'processData.accumulation.backupSensorPositionMm':[0,1000000,'mm'],
  'processData.geometry.lactMm':[1,1000000,'mm'],
  'processData.geometry.lpPrimeMm':[0,1000000,'mm'],
  'processData.accumulation.downstreamRampUpSeconds':[0,3600,'s'],
  'processData.upstream.startupTimeSeconds':[0,3600,'s']
});
function scenarioCopy(value){return JSON.parse(JSON.stringify(value));}
function scenarioGet(e,path){return path.split('.').reduce((value,key)=>value?.[key],e);}
function scenarioSet(e,path,value){const parts=path.split('.'),key=parts.pop();let node=e;parts.forEach(p=>{node[p]=node[p]||{};node=node[p];});node[key]=value;}
function stableScenarioValue(value){
  if(Array.isArray(value))return value.map(stableScenarioValue);
  if(value&&typeof value==='object')return Object.keys(value).sort().reduce((result,key)=>{
    if(value[key]!==undefined)result[key]=stableScenarioValue(value[key]);
    return result;
  },{});
  return value;
}
export function scenarioSignature(simulation){
  // CaseService normalizes each equipment record on write. Hash only the
  // persisted input fields and sort nested keys so JSON editor formatting and
  // key insertion order cannot invalidate a proposal with identical inputs.
  const equipment=(simulation.equipment||[]).map(unit=>({
    id:unit.id,type:unit.type,name:typeof unit.name==='string'?unit.name.trim():unit.name,
    nominalRatePerSecond:Number(unit.nominalRatePerSecond),initialMode:unit.initialMode,
    characteristics:unit.characteristics&&typeof unit.characteristics==='object'?unit.characteristics:{},
    noiseProfile:unit.noiseProfile&&typeof unit.noiseProfile==='object'?unit.noiseProfile:{},
    processData:unit.processData&&typeof unit.processData==='object'?unit.processData:{}
  }));
  const config=simulation.dynamicConfig&&typeof simulation.dynamicConfig==='object'&&!Array.isArray(simulation.dynamicConfig)?{...simulation.dynamicConfig}:{};
  delete config.chartWindow;
  if(config.numericalResolution==='PRECISE')delete config.numericalResolution;
  const unitOfFlow=simulation.unitOfFlow||simulation.results?.unitOfFlow||simulation.results?.replay?.unitOfFlow||'units';
  const text=JSON.stringify(stableScenarioValue(["SCENARIO_STREAMS_V5",SIMULATION_PROVENANCE_VERSION,simulation.id,unitOfFlow,equipment,config]));
  let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16)+':'+text.length;
}
function scenarioActiveProduct(simulation){
  const run=simulation.dynamicConfig||simulation.run||{},id=run.initialFormatId??run.initialProductId;
  return Array.isArray(run.productCatalog)?run.productCatalog.find(product=>product.id===id):undefined;
}
function scenarioEngineeringEquipment(simulation){
  const equipment=simulation.equipment||[],product=scenarioActiveProduct(simulation);
  // The runtime applies the active format before resolving conveyor geometry.
  // In particular, a Case Packer's bottle input rate differs from its case output.
  // Apply the same profile on copies; persisted rates and proposal baselines stay native.
  return product?applyProductProfile(equipment,product):equipment;
}
export function scenarioAudit(simulation){
  const equipment=scenarioEngineeringEquipment(simulation);
  return equipment.flatMap((e,index)=>{
    if(e.type!=='CONVEYOR')return [];
    const zone=resolveAccumulationZoneDefinition(equipment,index).definition;
    return [{equipmentId:e.id,equipmentName:e.name,engineering:zone?.engineering||null,upstreamId:zone?.upstreamControlEquipmentId,downstreamId:zone?.downstreamControlEquipmentId}];
  });
}
// Screening policy, not a manufacturer requirement or an automatic replacement rule.
// All time inputs are in minutes, except explicitly named Seconds fields.
export const EQUIPMENT_RELIABILITY_POLICY=Object.freeze({availabilityTarget:.95,mtbfTargetMinutes:60,mttrTargetMinutes:10});
export function equipmentReliabilityAssessment(equipment,config={},policy=EQUIPMENT_RELIABILITY_POLICY){
  const e=equipment||{},r=e.noiseProfile?.reliability,split=e.processData?.equipment?.stopInputs;
  const target=Number.isFinite(policy.availabilityTarget)&&policy.availabilityTarget>0&&policy.availabilityTarget<1?policy.availabilityTarget:.95;
  const bfTarget=Number.isFinite(policy.mtbfTargetMinutes)&&policy.mtbfTargetMinutes>0?policy.mtbfTargetMinutes:60;
  const trTarget=Number.isFinite(policy.mttrTargetMinutes)&&policy.mttrTargetMinutes>0?policy.mttrTargetMinutes:10;
  const thresholds={availabilityTarget:target,mtbfTargetMinutes:bfTarget,mttrTargetMinutes:trTarget};
  const base={equipmentId:e.id,name:e.name,thresholds,status:'NOT EVALUATED',action:'NOT_EVALUATED',replacementRequired:null,
    source:'CONFIGURED_MODEL',classes:[],mtbfMinutes:null,mttrMinutes:null,availability:null,unavailability:null,ratio:null};
  const none=reason=>({...base,reason});
  if(e.type==='CONVEYOR'||e.processData?.role==='CONVEYOR')return none('CONVEYOR');
  if(e.processData?.productApplies===false)return none('NOT_APPLICABLE');
  if(config.reliabilityEnabled===false)return none('FAILURES_DISABLED');
  const positive=p=>Number.isFinite(p?.mtbfMinutes)&&p.mtbfMinutes>0&&Number.isFinite(p?.mttrMinutes)&&p.mttrMinutes>0;
  const zero=p=>p?.mtbfMinutes===0&&p?.mttrMinutes===0;
  const categories=config.reliabilityCategories||{};
  let classes=[],mode;
  if(split!==undefined){
    if(!['minor','major'].every(k=>positive(split?.[k])||zero(split?.[k])))return none('INVALID_INPUTS');
    const configured=['minor','major'].filter(k=>positive(split[k]));
    if(!configured.length)return none('NO_MODELED_FAILURES');
    if(!positive(r))return none('INVALID_INPUTS');
    classes=configured.filter(k=>categories[k]!==false).map(k=>({kind:k.toUpperCase(),mtbfMinutes:split[k].mtbfMinutes,mttrMinutes:split[k].mttrMinutes}));
    mode='SPLIT';
  }else{
    if(!r||zero(r))return none('NO_MODELED_FAILURES');
    if(!positive(r))return none('INVALID_INPUTS');
    if(categories.general!==false)classes=[{kind:'GENERAL',mtbfMinutes:r.mtbfMinutes,mttrMinutes:r.mttrMinutes}];
    mode='GENERAL';
  }
  if(!classes.length)return none('CATEGORIES_DISABLED');
  // Independent failure clocks share exposure; durations are frequency-weighted.
  const totalRate=classes.reduce((s,p)=>s+1/p.mtbfMinutes,0);
  const mtbfMinutes=1/totalRate,mttrMinutes=classes.reduce((s,p)=>s+(1/p.mtbfMinutes)*p.mttrMinutes,0)/totalRate;
  const availability=mtbfMinutes/(mtbfMinutes+mttrMinutes),ratio=mtbfMinutes/mttrMinutes;
  if(![mtbfMinutes,mttrMinutes,availability,ratio].every(Number.isFinite))return none('INVALID_INPUTS');
  const frequent=mtbfMinutes<bfTarget,long=mttrMinutes>trTarget,belowTarget=availability+1e-12<target;
  // A declared major class may be long even when its weighted mean is short.
  const longClass=classes.some(p=>p.mttrMinutes>trTarget);
  const action=frequent&&(long||longClass)&&belowTarget?'REBUILD_OR_REPLACE_REVIEW':
    frequent&&(long||longClass)?'JOINT_RELIABILITY_REVIEW':frequent?'IMPROVE_MTBF':long||longClass?'IMPROVE_MTTR':
    belowTarget?'JOINT_RELIABILITY_REVIEW':'KEEP_MONITOR';
  const status=belowTarget?'FAIL':action==='KEEP_MONITOR'?'PASS':'REVIEW';
  const requiredMtbfMinutes=target/(1-target)*mttrMinutes,requiredMttrMinutes=(1-target)/target*mtbfMinutes;
  const severity=availability>=.99?'EXCELLENT':availability>=.98?'VERY_GOOD':availability>=.95?'GOOD':
    availability>=.9?'FAIR':availability>=.8?'POOR':availability>=.5?'CRITICAL':'SEVERE';
  return {...base,status,action,reason:belowTarget?'BELOW_TARGET':status==='REVIEW'?'PATTERN_REVIEW':'TARGET_MET',mode,
    classes:classes.map(p=>({...p,eventShare:(1/p.mtbfMinutes)/totalRate,failuresPerOperatingHour:60/p.mtbfMinutes})),
    mtbfMinutes,mttrMinutes,availability,unavailability:1-availability,ratio,severity,frequent,long,longClass,
    failuresPerOperatingHour:60/mtbfMinutes,failuresPerDay:1440/(mtbfMinutes+mttrMinutes),
    downtimeMinutesPerDay:1440*(1-availability),requiredMtbfMinutes,requiredMttrMinutes,
    mtbfImprovementFactor:Math.max(1,requiredMtbfMinutes/mtbfMinutes),
    mttrReductionPercent:Math.max(0,100*(1-requiredMttrMinutes/mttrMinutes))};
}
export function analyzeEquipmentReliability(simulation,equipmentId,{observed,audits,policy,includeSavedEvidence=true}={}){
  const equipment=simulation?.equipment||[],config=simulation?.dynamicConfig||simulation?.run||{},e=equipment.find(x=>x.id===equipmentId);
  const assessment=equipmentReliabilityAssessment(e,config,policy);
  const report={...assessment,observed:null,bufferCoverage:[],capacity:null,counterfactual:null,
    feasibility:'NOT_ESTABLISHED',replacementRequired:null};
  if(!e||e.type==='CONVEYOR'||e.processData?.role==='CONVEYOR')return report;
  // A completed compatible result uses replication means; a UI may supply a
  // current single-run observation explicitly, separately from the design inputs.
  if(observed===undefined&&simulation.results){
    try{
      const diagnosis=diagnoseScenarioLosses(simulation);
      const row=diagnosis.status==='OBSERVED'?diagnosis.equipment.find(x=>x.equipmentId===equipmentId):null;
      if(row)observed={...row,durationSeconds:diagnosis.durationSeconds,basis:diagnosis.rounds>1?'REPLICATION_MEAN':'COMPLETED_RUN'};
    }catch(_){}
  }
  const finite=v=>Number.isFinite(v)&&v>=0?v:null;
  if(observed&&observed.durationSeconds>0){
    const duration=observed.durationSeconds,failureSeconds=finite(observed.failureSeconds),count=finite(observed.failureCount),exposure=finite(observed.reliabilityExposureSeconds);
    report.observed={basis:observed.basis||'RECORDED_RUN',durationSeconds:duration,failureSeconds,failureCount:count,
      reliabilityExposureSeconds:exposure,failurePercent:failureSeconds===null?null:100*failureSeconds/duration,
      microStopSeconds:finite(observed.microStopSeconds),starvedSeconds:finite(observed.starvedSeconds),blockedSeconds:finite(observed.blockedSeconds),
      waitingForPrimeSeconds:finite(observed.waitingForPrimeSeconds),backupStopSeconds:finite(observed.backupStopSeconds),
      observedExposurePerFailureMinutes:count>0&&exposure!==null?exposure/count/60:null,
      observedFaultTimePerFailureMinutes:count>0&&failureSeconds!==null?failureSeconds/count/60:null,
      interpretation:'Observed stop exposure; unfinished repairs and short runs may bias ratios. Local losses are not additive line losses.'};
  }
  // Use the engineering model's populated accumulation reserve / free-space
  // estimate, not nominal conveyor length or an assumed full/empty buffer.
  if(assessment.mttrMinutes>0){
    let list=audits;
    if(!list){try{list=scenarioAudit(simulation);}catch(_){list=[];}}
    for(const [direction,idKey,timeKey] of [['UPSTREAM','downstreamId','antiBlockSeconds'],['DOWNSTREAM','upstreamId','antiStarveSeconds']]){
      const connected=(list||[]).filter(a=>a[idKey]===equipmentId);
      const estimates=connected.map(a=>finite(a.engineering?.calculated?.[timeKey]));
      const seconds=connected.length&&estimates.every(v=>v!==null)?Math.min(...estimates):null;
      report.bufferCoverage.push({direction,conveyorIds:connected.map(a=>a.equipmentId),seconds,
        ratio:seconds===null?null:seconds/(assessment.mttrMinutes*60),
        classCoverage:assessment.classes.map(p=>({kind:p.kind,ratio:seconds===null?null:seconds/(p.mttrMinutes*60)})),
        basis:'ENGINEERING_DESIGN_POPULATION',status:seconds===null?'NOT EVALUATED':seconds+1e-9>=assessment.mttrMinutes*60?'PASS':'FAIL'});
    }
  }
  // Capacity screening is compared only in a common material-flow unit.
  try{
    const models=scenarioEngineeringEquipment(simulation),product=scenarioActiveProduct(simulation);
    const machine=models.find(x=>x.id===equipmentId),line=analyzeLinePerformance(models,null),point=line.points.find(x=>x.id===equipmentId),reference=line.points.find(x=>x.isPacemaker);
    const ref=models.find(x=>x.id===reference?.id);
    const flow=x=>String(x?.processData?.flowUnits?.output??x?.unitOfFlow??simulation.unitOfFlow??'units').toUpperCase();
    const factor=x=>product?productUnitFactor(x,product):1;
    const comparable=point&&reference&&ref&&machine&&(product||flow(machine)===flow(ref));
    if(point){
      const f=factor(machine),rate=point.configuredBpm*f,maximum=point.maximumBpm==null?null:point.maximumBpm*f;
      const referenceRate=comparable?reference.configuredBpm*factor(ref):null;
      const effective=assessment.availability===null?null:rate*assessment.availability;
      report.capacity={configuredRatePerMinute:finite(rate),maximumRatePerMinute:finite(maximum),referenceRatePerMinute:finite(referenceRate),
        availabilityOnlyRatePerMinute:finite(effective),maximumAvailabilityOnlyRatePerMinute:maximum!==null&&assessment.availability!==null?finite(maximum*assessment.availability):null,
        unit:product?'BOTTLE_EQUIVALENTS':flow(machine),referenceId:reference?.id??null,
        nominalDeficit:referenceRate>0&&Number.isFinite(rate)?Math.max(0,referenceRate-rate):null,
        availabilityOnlyDeficit:referenceRate>0&&effective!==null?Math.max(0,referenceRate-effective):null,
        basis:'STATIC_CAPACITY_SCREEN_NOT_THROUGHPUT'};
    }
  }catch(_){}
  if(includeSavedEvidence&&simulation.id&&simulation.whatIf?.evaluations?.length){
    try{
      const signature=scenarioSignature(simulation);
      const entries=simulation.whatIf.evaluations.filter(x=>x.sourceSimulationId===simulation.id&&x.sourceSignature===signature&&!['RUNNING','VALIDATING','INTERRUPTED'].includes(x.status))
        .slice().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
      for(const entry of entries){
        const search=entry.reliabilityTargetSearch??entry.sensitivityScreening?.reliabilityTargetSearch;
        const row=search?.ranking?.find(x=>x.equipmentId===equipmentId);
        if(!row||!Number.isFinite(row.deltaThroughput)||!Number.isFinite(row.deltaOeePp))continue;
        report.counterfactual={deltaThroughput:row.deltaThroughput,deltaOeePp:row.deltaOeePp,
          throughputUnit:entry.unitOfFlow||simulation.unitOfFlow||'units',run:search.run||null,updatedAt:entry.updatedAt||null,
          basis:'MATCHED_FAILURE_REMOVAL_EXPLORATORY',plantValidated:false};
        break;
      }
    }catch(_){}
  }
  return report;
}

// Catalog lists model-supported inputs even when the planner has no proposal.
// Targets start at the baseline: the user supplies bounds; no gains are invented.
export function scenarioVariableCatalog(simulation){
  const referenceId=analyzeLinePerformance(simulation.equipment,simulation.results).referenceId;
  return (simulation.equipment||[]).flatMap(e=>Object.keys(SCENARIO_FIELDS).filter(path=>
    e.type==='CONVEYOR'?path.startsWith('processData.'):path==='nominalRatePerSecond'||path.startsWith('noiseProfile.reliability.')||path==='processData.upstream.startupTimeSeconds'
  ).map(path=>{
    const before=scenarioGet(e,path)??null,external=path.startsWith('noiseProfile.reliability.');
    let disabledReason=Number.isFinite(before)?null:'Set a numeric baseline in Equipment first.';
    if(external&&!(before>0))disabledReason='Set a positive reliability baseline in Equipment first.';
    if(path==='nominalRatePerSecond'){
      if(e.id===referenceId)disabledReason='Reference machine speed is fixed by the current scenario policy.';
      else if(!(Number(e.processData?.equipment?.maximumSpeedBpm)>0))disabledReason='Set the installed maximum speed in Equipment first.';
    }
    if(e.type==='CONVEYOR'&&path.endsWith('conveyorSpeedMmPerSecond')&&e.processData?.accumulation?.speedMode!=='MANUAL')disabledReason='Select manual conveyor speed in Equipment first.';
    if(e.type==='CONVEYOR'&&path.endsWith('conveyorSpeedFactorPercent')&&['MANUAL','DYNAMIC'].includes(e.processData?.accumulation?.speedMode))disabledReason='Specified speed mode uses conveyor speed instead of its automatic factor.';
    return {equipmentId:e.id,path,before,after:before,unit:SCENARIO_FIELDS[path][2],external,disabledReason,catalogOnly:true};
  }));
}
export function applyScenarioChanges(simulation,changes){
  if(!Array.isArray(changes)||!changes.length||changes.length>SCENARIO_POLICY.maxChanges)throw new Error('SCENARIO_INVALID_CHANGES');
  const copy=scenarioCopy(simulation),seen=new Set();
  changes.forEach(change=>{
    const rule=Object.hasOwn(SCENARIO_FIELDS,change.path)?SCENARIO_FIELDS[change.path]:null;
    const unit=copy.equipment.find(e=>e.id===change.equipmentId),key=change.equipmentId+':'+change.path;
    if(!unit||!rule||seen.has(key)||typeof change.after!=='number'||!Number.isFinite(change.after)||change.after<rule[0]||change.after>rule[1])throw new Error('SCENARIO_INVALID_FIELD');
    if(!Object.hasOwn(change,'before')||(scenarioGet(unit,change.path)??null)!==change.before)throw new Error('SCENARIO_STALE');
    if((change.path.includes('accumulation')||change.path.includes('geometry'))&&unit.type!=='CONVEYOR')throw new Error('SCENARIO_INVALID_FIELD');
    if(change.path==='nominalRatePerSecond'){
      let maximum=Number(unit.processData?.equipment?.maximumSpeedBpm)/60;
      if(change.replacementMaximumBpm!==undefined){
        if(!(maximum>0)||change.external!==true||change.interventionType!=='REPLACEMENT'||typeof change.justification!=='string'||!change.justification.trim()||!Number.isFinite(change.replacementMaximumBpm)||change.replacementMaximumBpm<=maximum*60||change.replacementMaximumBpm>SCENARIO_FIELDS.nominalRatePerSecond[1]*60||change.after<change.before)throw Error('SCENARIO_REPLACEMENT_EVIDENCE_REQUIRED');
        maximum=change.replacementMaximumBpm/60;
      }
      if(unit.type==='CONVEYOR'||unit.id===analyzeLinePerformance(simulation.equipment,simulation.results).referenceId||!(maximum>0)||change.after>maximum)throw new Error('SCENARIO_INSTALLED_SPEED_LIMIT');
    }
    if(change.path.startsWith('noiseProfile.reliability.')){
      if(unit.type==='CONVEYOR'||!(change.before>0)||change.external!==true||typeof change.justification!=='string'||!change.justification.trim()||(!SCENARIO_INTERVENTIONS[change.interventionType]&&!(change.analysisOnly===true&&change.interventionType==='SENSITIVITY')))throw new Error('SCENARIO_EXTERNAL_EVIDENCE_REQUIRED');
      if(change.path.endsWith('mtbfMinutes')?change.after<change.before:change.after>change.before)throw new Error('SCENARIO_RELIABILITY_DIRECTION');
    }
    if(change.replacementMaximumBpm!==undefined){if(change.path!=='nominalRatePerSecond')throw Error('SCENARIO_INVALID_FIELD');scenarioSet(unit,'processData.equipment.maximumSpeedBpm',change.replacementMaximumBpm);}
    if(change.path.startsWith('noiseProfile.reliability.')&&unit.processData?.equipment?.stopInputs){
      const field=change.path.split('.').at(-1),factor=change.after/change.before;
      for(const category of Object.values(unit.processData.equipment.stopInputs))category[field]*=factor;
      unit.processData.equipment[field]=change.after;
    }
    seen.add(key);scenarioSet(unit,change.path,change.after);
  });
  if(changes.every(c=>c.before===c.after))throw new Error('SCENARIO_NO_CHANGE');
  const check=validateSimulationInput({case:{id:'scenario-preview',equipment:copy.equipment},run:Object.assign({durationSeconds:60,tickSeconds:.25,sampleEverySeconds:1,seed:1,commands:[]},copy.dynamicConfig)});
  if(!check.ok)throw new Error('SCENARIO_INVALID_PHYSICS');
  copy.scenarioWarnings=[];
  const before=scenarioAudit(simulation),after=scenarioAudit(copy);
  after.forEach((item,index)=>{
    (item.engineering?.audit?.goals||[]).forEach(goal=>{
      const previous=before[index]?.engineering?.audit?.goals?.find(g=>g.id===goal.id);
      if(previous?.status==='PASS'&&goal.status!=='PASS')copy.scenarioWarnings.push({equipmentId:item.equipmentId,rule:goal.id,before:previous.status,after:goal.status});
    });
  });
  copy.results=null;return copy;
}
function scenarioChange(e,path,after){return {equipmentId:e.id,path,before:scenarioGet(e,path)??null,after,unit:SCENARIO_FIELDS[path][2]};}
function scenarioGoal(engineering,id){return engineering?.audit?.goals?.find(g=>g.id===id)?.status;}
function scenarioRecoveryPlan(engineering,requiredSeconds=0){
  const input=engineering?.input;if(!input||!(input.installedLengthMm>0))return null;
  function evaluate(length){
    const first=calculateConveyorEngineering({...input,installedLengthMm:length}),backup=Math.ceil(first.calculated.recommendedBackupSensorPositionMm);
    if(!Number.isFinite(backup))return null;
    const check=calculateConveyorEngineering({...input,installedLengthMm:length,backupSensorPositionMm:backup});
    const passes=['INSTALLED_LENGTH','SMOOTH_RECOVERY','BACKUP_POSITION'].every(id=>scenarioGoal(check,id)==='PASS');
    return {length,backup,check,passes:passes&&(!requiredSeconds||check.calculated.antiStarveSeconds>=requiredSeconds)};
  }
  let low=Math.ceil(input.installedLengthMm),high=low,plan=evaluate(high),limit=Math.min(1000000,Math.max(high+50000,high*5));
  while(plan&&!plan.passes&&high<limit){low=high;high=Math.min(limit,high+Math.max(100,Math.ceil(high*.2)));plan=evaluate(high);}
  if(!plan?.passes)return null;
  while(high-low>1){const mid=Math.floor((low+high)/2),trial=evaluate(mid);if(trial?.passes){high=mid;plan=trial;}else low=mid;}
  return evaluate(high);
}
// Losses describe observed states, not proven causal attribution.
export function diagnoseScenarioLosses(simulation){
  const result=simulation.results,readiness=scenarioSourceReadiness(simulation);
  if(!readiness.ready)return {status:'NO_COMPATIBLE_RESULTS',...readiness,equipment:[],referenceId:null,rankings:{},opportunities:[]};
  const referenceId=analyzeLinePerformance(simulation.equipment,result).referenceId;
  const rounds=result.batch?.rounds||1,replications=result.batch?.rows;
  const hasActualDurations=Array.isArray(replications)&&replications.length===rounds&&replications.every(r=>Number.isFinite(r.durationSeconds)&&r.durationSeconds>0);
  const durationSeconds=hasActualDurations?replications.reduce((sum,r)=>sum+r.durationSeconds,0)/rounds:result.durationSeconds;
  const durationBasis=hasActualDurations?'MEAN_ACTUAL_REPLICATION_DURATION':'RECORDED_RESULT_DURATION';
  const rows=(simulation.equipment||[]).filter(e=>e.type!=='CONVEYOR').map(e=>{
    const stats=result.batch?.equipmentStatistics?.[e.id],metrics=result.equipmentMetrics?.[e.id];
    // A replicated report must not silently substitute round one's observation
    // when a replication mean is missing.
    const read=key=>{const value=rounds>1?stats?.[key]?.mean:stats?.[key]?.mean??metrics?.[key];return Number.isFinite(value)&&value>=0?value:null;};
    const failureSeconds=read('failureSeconds'),microStopSeconds=read('microStopSeconds'),starvedSeconds=read('starvedSeconds'),blockedSeconds=read('blockedSeconds');
    const ownStopSeconds=failureSeconds!==null&&microStopSeconds!==null?failureSeconds+microStopSeconds:null;
    const failureCount=read('failureCount'),microStopCount=read('microStopCount');
    const minorFailureSeconds=read('minorFailureSeconds'),majorFailureSeconds=read('majorFailureSeconds'),generalFailureSeconds=read('generalFailureSeconds');
    const minorFailureCount=read('minorFailureCount'),majorFailureCount=read('majorFailureCount'),generalFailureCount=read('generalFailureCount');
    const stopDataCoverage=scenarioStopDataCoverage(simulation,e);
    stopDataCoverage.recordedCategoryDurations=[minorFailureSeconds,majorFailureSeconds,generalFailureSeconds].every(value=>value!==null);
    stopDataCoverage.recordedCategoryCounts=[minorFailureCount,majorFailureCount,generalFailureCount].every(value=>value!==null);
    stopDataCoverage.classSpecificAnalysisAvailable=stopDataCoverage.classSpecificAnalysisAvailable&&stopDataCoverage.recordedCategoryDurations;
    const causes=[['FAILURE',failureSeconds],['MICROSTOP',microStopSeconds],['STARVATION',starvedSeconds],['BLOCKING',blockedSeconds],['WAITING_PRIME',read('waitingForPrimeSeconds')],['BACKUP_STOP',read('backupStopSeconds')]].filter(x=>x[1]!==null).sort((a,b)=>b[1]-a[1]);
    return {equipmentId:e.id,name:e.name,isReference:e.id===referenceId,failureSeconds,microStopSeconds,ownStopSeconds,starvedSeconds,blockedSeconds,
      minorFailureSeconds,majorFailureSeconds,generalFailureSeconds,minorFailureCount,majorFailureCount,generalFailureCount,stopDataCoverage,
      reliabilityAssessment:equipmentReliabilityAssessment(e,simulation.dynamicConfig),
      failureCount,microStopCount,countBasis:rounds>1?'MEAN_PER_REPLICATION':'RECORDED_RUN',
      failureCategories:['general','minor','major'].map(kind=>({kind:kind.toUpperCase(),count:read(kind+'FailureCount'),seconds:read(kind+'FailureSeconds')})),
      reliabilityExposureSeconds:read('reliabilityExposureSeconds'),
      waitingForPrimeSeconds:read('waitingForPrimeSeconds'),backupStopSeconds:read('backupStopSeconds'),dominantLoss:causes[0]?.[1]>0?causes[0][0]:'NONE',
      ownStopPercent:ownStopSeconds===null?null:100*ownStopSeconds/durationSeconds,
      starvationPercent:starvedSeconds===null?null:100*starvedSeconds/durationSeconds,
      blockingPercent:blockedSeconds===null?null:100*blockedSeconds/durationSeconds,
      dataCoverage:{ownStopDuration:ownStopSeconds!==null,failureCount:failureCount!==null,microStopCount:microStopCount!==null,
        declaredStopClasses:stopDataCoverage.mode==='SPLIT',classSpecificAnalysis:stopDataCoverage.classSpecificAnalysisAvailable}};
  });
  function rank(field,basis){return rows.filter(row=>row[field]!==null).slice().sort((a,b)=>b[field]-a[field]||a.equipmentId.localeCompare(b.equipmentId)).map((row,index)=>({rank:index+1,equipmentId:row.equipmentId,name:row.name,value:row[field],basis,...(basis==='DURATION_SECONDS'?{percentOfRun:100*row[field]/durationSeconds}:{countBasis:row.countBasis})}));}
  const rankings={ownStopDuration:rank('ownStopSeconds','DURATION_SECONDS'),failureDuration:rank('failureSeconds','DURATION_SECONDS'),microStopDuration:rank('microStopSeconds','DURATION_SECONDS'),
    minorFailureDuration:rank('minorFailureSeconds','DURATION_SECONDS'),majorFailureDuration:rank('majorFailureSeconds','DURATION_SECONDS'),generalFailureDuration:rank('generalFailureSeconds','DURATION_SECONDS'),
    minorFailureFrequency:rank('minorFailureCount','OBSERVED_EVENT_COUNT'),majorFailureFrequency:rank('majorFailureCount','OBSERVED_EVENT_COUNT'),generalFailureFrequency:rank('generalFailureCount','OBSERVED_EVENT_COUNT'),
    starvationDuration:rank('starvedSeconds','DURATION_SECONDS'),blockingDuration:rank('blockedSeconds','DURATION_SECONDS'),waitingForPrimeDuration:rank('waitingForPrimeSeconds','DURATION_SECONDS'),backupStopDuration:rank('backupStopSeconds','DURATION_SECONDS'),failureFrequency:rank('failureCount','OBSERVED_EVENT_COUNT'),microStopFrequency:rank('microStopCount','OBSERVED_EVENT_COUNT')};
  const opportunities=[];
  for(const row of rows){
    const base={equipmentId:row.equipmentId,name:row.name,evidenceLevel:'HYPOTHESIS',causalStatus:'NOT_ESTABLISHED'};
    if(row.waitingForPrimeSeconds>0||row.backupStopSeconds>0)opportunities.push({...base,kind:'SENSOR_CONTROL_AND_FLOW_RECOVERY',
      observed:{waitingForPrimeSeconds:row.waitingForPrimeSeconds,backupStopSeconds:row.backupStopSeconds},
      mechanismsToTest:['NORMAL_PACKAGE_PULSE','BACKUP_DEBOUNCE','PRIME_RESERVE','FLOW_BALANCE'],
      interpretation:'Waiting for Prime and Back-up can be propagated control losses. Check actual passage time, buffer geometry and matched simulation sensitivity before attributing the loss.'});
    if(row.failureSeconds>0)opportunities.push({...base,kind:'INTERNAL_STOP_REDUCTION',observed:{failureSeconds:row.failureSeconds,failureCount:row.failureCount,
      minorFailureSeconds:row.minorFailureSeconds,majorFailureSeconds:row.majorFailureSeconds,generalFailureSeconds:row.generalFailureSeconds},
      targetScope:row.stopDataCoverage.mode==='SPLIT'?'ALL_CONFIGURED_STOP_CLASSES':'GENERAL_UNCLASSIFIED',
      mechanismsToTest:['MTBF','MTTR'],requiredEvidence:['Failure-mode history with class and cause','Paired line-output counterfactual','Achievable intervention target'],
      interpretation:'Reliability stop exposure identifies a hypothesis. Aggregate MTBF/MTTR changes affect all configured stop classes; they do not alter the separate MICRO_STOP process or determine an intervention category.'});
    if((row.minorFailureSeconds||0)+(row.microStopSeconds||0)>0)opportunities.push({...base,kind:'SHORT_STOP_FLOW_RECOVERY',
      observed:{minorFailureSeconds:row.minorFailureSeconds,microStopSeconds:row.microStopSeconds},mechanismsToTest:['SENSOR_CONTROL','FLOW_BALANCE','EXISTING_BUFFER_RECOVERY'],
      interpretation:'Test recovery and propagation around declared minor stops or the separate MICRO_STOP process. Sensor and speed adjustments do not directly improve modeled failure MTBF/MTTR or eliminate stop events.'});
    if(row.majorFailureSeconds>0)opportunities.push({...base,kind:'MAJOR_STOP_CAUSE_REVIEW',observedSeconds:row.majorFailureSeconds,
      mechanismsToTest:['CAUSE_STRATIFICATION','DOCUMENTED_INTERVENTION'],requiredEvidence:['Stop cause and internal/external origin','Maintenance history or replacement target'],
      interpretation:'A declared major stop is not proof of an external cause, irreparable equipment or a replacement requirement. CAPEX follows the supported intervention scope.'});
    if(row.stopDataCoverage.mode==='GENERAL')opportunities.push({...base,kind:'STOP_CLASS_DATA_REQUIRED',observedSeconds:row.generalFailureSeconds,
      requiredEvidence:['Separate minor and major stop frequencies and durations on the same operating exposure','Cause and internal/external origin'],
      interpretation:'General inputs remain usable for line-flow experiments. Class-specific conclusions require measured or explicitly documented classes; no split is inferred from the aggregate MTTR.'});
    if(row.starvedSeconds>0)opportunities.push({...base,kind:'UPSTREAM_SUPPLY_OR_BUFFER',observedSeconds:row.starvedSeconds,mechanismsToTest:['UPSTREAM_CAPACITY','UPSTREAM_RELIABILITY','BUFFER_RECOVERY','SENSOR_CONTROL'],interpretation:'Missing input may be propagated from upstream. Starvation does not prove a fault in this equipment.'});
    if(row.blockedSeconds>0)opportunities.push({...base,kind:'DOWNSTREAM_CAPACITY_OR_BUFFER',observedSeconds:row.blockedSeconds,mechanismsToTest:['DOWNSTREAM_CAPACITY','DOWNSTREAM_RELIABILITY','BUFFER_RECOVERY','SENSOR_CONTROL'],interpretation:'Restricted discharge may be propagated from downstream. Blocking does not prove a fault in this equipment.'});
  }
  return {status:rows.some(r=>r.failureSeconds!==null||r.microStopSeconds!==null||r.starvedSeconds!==null||r.blockedSeconds!==null)?'OBSERVED':'MISSING_METRICS',sourceStatus:'CURRENT',referenceId,durationSeconds,durationBasis,rounds,equipment:rows,rankings,opportunities,
    stopDataQuality:{splitEquipmentIds:rows.filter(row=>row.stopDataCoverage.mode==='SPLIT').map(row=>row.equipmentId),
      generalEquipmentIds:rows.filter(row=>row.stopDataCoverage.mode==='GENERAL').map(row=>row.equipmentId),
      classSpecificEquipmentIds:rows.filter(row=>row.stopDataCoverage.classSpecificAnalysisAvailable).map(row=>row.equipmentId),
      splitInferred:false,scope:'STOP_CLASSES_NOT_ROOT_CAUSES',flowOptimizationRequiresSplit:false},
    attribution:{additive:false,basis:'OBSERVED_EQUIPMENT_STATES',causalStatus:'NOT_ESTABLISHED',countsInferred:false},
    interpretation:'Observed losses and possible propagation paths; inactivity alone does not establish a line bottleneck. Equipment losses overlap and are not additive global OEE contributions. Event counts are reported only when recorded. MINOR/MAJOR reliability classes and the independent MICRO_STOP process are retained separately; general stops are not split or assigned a cause.'};
}
function scenarioLossEvidence(simulation,diagnosis,equipment,kind){
  if(diagnosis.status!=='OBSERVED')return {priorityBonus:0};
  const index=simulation.equipment.findIndex(e=>e.id===equipment.id),referenceIndex=simulation.equipment.findIndex(e=>e.id===diagnosis.referenceId);
  const ids=equipment.type==='CONVEYOR'?[simulation.equipment[index-1]?.id,simulation.equipment[index+1]?.id]:[equipment.id];
  const local=diagnosis.equipment.filter(r=>ids.includes(r.equipmentId)),reference=diagnosis.equipment.find(r=>r.isReference);
  const reliabilityTarget=kind==='RELIABILITY_INTERVENTION';
  const seconds=local.reduce((sum,r)=>sum+(reliabilityTarget?(r.failureSeconds||0):(r.minorFailureSeconds||0)+(r.microStopSeconds||0))+(r.starvedSeconds||0)+(r.blockedSeconds||0)+(reliabilityTarget?0:(r.waitingForPrimeSeconds||0)+(r.backupStopSeconds||0)),0);
  const direction=index<referenceIndex?'UPSTREAM':index>referenceIndex?'DOWNSTREAM':'REFERENCE';
  const referenceLoss=direction==='UPSTREAM'?reference?.starvedSeconds:direction==='DOWNSTREAM'?reference?.blockedSeconds:0;
  const bonus=Math.min(30,seconds/diagnosis.durationSeconds*20+(referenceLoss||0)/diagnosis.durationSeconds*20);
  return {priorityBonus:bonus,priorityBasis:reliabilityTarget?'RELIABILITY_FAILURE_EXPOSURE_AND_PROPAGATION':'MINOR_STOP_EXPOSURE_AND_FLOW_PROPAGATION',
    observedLosses:local,referenceInteraction:{direction,seconds:referenceLoss||0},
    reliabilityPriority:reliabilityTarget,interpretation:reliabilityTarget?'Diagnostic priority for documented reliability interventions, not a demonstrated causal gain.':
      'Flow priority uses declared minor stops, the separate MICRO_STOP process and propagated starvation/blocking. Major and unclassified own-stop durations do not boost this priority. Flow adjustments do not directly change reliability stop parameters or establish the origin of propagated losses.'};
}
// Opportunity screening does not create undocumented implementation targets.
export function scenarioProposalNeeds(simulation){
  const equipment=scenarioEngineeringEquipment(simulation),product=scenarioActiveProduct(simulation),line=analyzeLinePerformance(equipment,null),reference=line.points.find(p=>p.isPacemaker),options=(simulation.whatIf?.externalOptions||[]).filter(o=>{try{if(!o.changes?.length||!o.changes.every(c=>scenarioCategoryAllows(c,o.tier)))return false;applyScenarioChanges(simulation,o.changes);return true;}catch(_){return false;}}).flatMap(o=>o.changes),needs=[];
  if(!reference)return needs;
  const factors=new Map(equipment.map(item=>[item.id,product?productUnitFactor(item,product):1]));
  const referenceBpm=reference.configuredBpm*factors.get(reference.id);
  for(const point of line.points){
    const unit=equipment.find(e=>e.id===point.id),r=unit.noiseProfile?.reliability;
    // Compare like units without rewriting installed/native machine limits.
    const configuredBpm=point.configuredBpm*factors.get(point.id),maximumBpm=point.maximumBpm===null?null:point.maximumBpm*factors.get(point.id);
    const hasCapacity=options.some(c=>c.equipmentId===point.id&&c.replacementMaximumBpm!==undefined);
    if(!point.isPacemaker&&configuredBpm<referenceBpm-1e-6&&(!maximumBpm||maximumBpm<referenceBpm)&&!hasCapacity)needs.push({kind:'CAPACITY_TARGET_REQUIRED',equipmentId:point.id,name:point.name,configuredBpm,installedMaximumBpm:maximumBpm,referenceBpm,requiredInput:'Documented replacement operating speed, new maximum capacity and source. No target is inferred from the reference.'});
    if(simulation.dynamicConfig?.reliabilityEnabled!==false&&r?.mtbfMinutes>0&&r?.mttrMinutes>0){
      const availability=r.mtbfMinutes/(r.mtbfMinutes+r.mttrMinutes),effective=configuredBpm*availability;
      const hasReliability=options.some(c=>c.equipmentId===point.id&&c.path.startsWith('noiseProfile.reliability.'));
      if(effective<referenceBpm-1e-6&&!hasReliability)needs.push({kind:'RELIABILITY_TARGET_REQUIRED',equipmentId:point.id,name:point.name,availabilityPercent:100*availability,availabilityOnlyBpm:effective,referenceBpm,requiredInput:'Evaluate sensitivity, then supply an achievable MTBF/MTTR target, intervention type and source. Availability-only capacity is screening, not simulated throughput.'});
    }
  }
  return needs.sort((a,b)=>(a.availabilityOnlyBpm??a.configuredBpm)-(b.availabilityOnlyBpm??b.configuredBpm));
}
export function planScenarios(simulation){
  const audit=scenarioAudit(simulation),engineeringEquipment=scenarioEngineeringEquipment(simulation),diagnosis=diagnoseScenarioLosses(simulation);
  const capacityDiagnosis=diagnoseLineEfficiency(simulation.equipment,diagnosis.status==='OBSERVED'?simulation.results:null);
  const result=diagnosis.status==='OBSERVED'?simulation.results:null;
  const candidates=[],checks=[];
  const equipmentReliability=(simulation.equipment||[]).filter(e=>e.type!=='CONVEYOR'&&e.processData?.role!=='CONVEYOR').map(e=>equipmentReliabilityAssessment(e,simulation.dynamicConfig));
  equipmentReliability.forEach(r=>checks.push({equipmentId:r.equipmentId,rule:'EQUIPMENT_RELIABILITY',status:r.status==='NOT EVALUATED'?'NOT_EVALUATED':r.status,assessment:r,interpretation:'Engineering screening thresholds; not a replacement mandate.'}));
  function add(kind,tier,equipment,changes,evidence,priority,basis){
    changes=changes.filter(c=>c.before!==c.after);if(!changes.length)return;
    let disabledReason=null;try{applyScenarioChanges(simulation,changes);}catch(error){disabledReason=error.message;}
    const losses=scenarioLossEvidence(simulation,diagnosis,equipment,kind);evidence={...evidence,...losses,
      reliabilityParametersChanged:changes.some(change=>change.path.startsWith('noiseProfile.reliability.')),
      classificationBasis:'INTERVENTION_SCOPE',budgetUsed:false};priority+=losses.priorityBonus;if(diagnosis.status==='OBSERVED')basis='HYBRID';
    candidates.push({id:kind+':'+equipment.id,kind,tier,titleKey:'scenario.'+kind.toLowerCase(),equipmentId:equipment.id,equipmentName:equipment.name,changes,evidence,priority,basis,canApply:!disabledReason,disabledReason,sourceSimulationId:simulation.id,sourceSignature:scenarioSignature(simulation)});
  }
  audit.forEach(item=>{
    const e=simulation.equipment.find(x=>x.id===item.equipmentId),engineering=item.engineering;
    const zone=resolveAccumulationZoneDefinition(engineeringEquipment,simulation.equipment.indexOf(e)).definition;
    // An isolated package must not be mistaken for a continuously blocked
    // photoeye. Use the actual resolved belt velocity and package length,
    // independently of the completeness of the worksheet engineering audit.
    const delayPath='processData.accumulation.blockedTimeDelaySeconds';
    const blockedDelay=scenarioGet(e,delayPath);
    const normalPulse=zone?.productLengthMm>0&&zone?.conveyorSpeedMmPerSecond>0
      ?zone.productLengthMm/zone.conveyorSpeedMmPerSecond:null;
    const pulseConflict=Number.isFinite(normalPulse)&&Number.isFinite(blockedDelay)&&blockedDelay>=0&&
      Number.isFinite(zone?.backupSensorPositionMm)&&zone.backupSensorPositionMm>=0&&
      zone.backupSensorPositionMm<=zone.usableLengthMm&&blockedDelay<=normalPulse+1e-9;
    if(pulseConflict){
      // A small explicit screening margin, not a validated PLC setting.
      const target=Math.ceil((normalPulse+.15)*10)/10;
      const measuredZone=Object.values(result?.accumulationZoneMetrics||{}).find(z=>z.ownerEquipmentId===e.id);
      if(target<=SCENARIO_FIELDS[delayPath][1])add('SENSOR_DEBOUNCE','ZERO',e,[scenarioChange(e,delayPath,target)],{
        targetBasis:'ACTUAL_PACKAGE_PASS_TIME',pulseSeconds:normalPulse,blockedDelaySeconds:blockedDelay,
        proposedDelaySeconds:target,screeningMarginSeconds:.15,actualBeltSpeedMmPerSecond:zone.conveyorSpeedMmPerSecond,
        packageLengthMm:zone.productLengthMm,backupTriggerCount:measuredZone?.backupTriggerCount??null,
        backupPassedUnits:measuredZone?.backupPassedUnits??null,counterBasis:'REPRESENTATIVE_ROUND_IF_AVAILABLE',
        engineeringReviewRequired:true,interpretation:'Hypothesis: normal package pulses may trigger Back-up. Confirm PLC response, installed sensor location, stopping distance and overflow reserve before changing a plant setting.'
      },110,'STATIC');
      checks.push({equipmentId:e.id,rule:'ACTUAL_SENSOR_PULSE',status:'REVIEW',pulseSeconds:normalPulse,blockedDelaySeconds:blockedDelay,targetSeconds:target});
    }
    if(!engineering){checks.push({equipmentId:e.id,rule:'GEOMETRY',status:'NOT_EVALUATED'});return;}
    const input=engineering.input,c=engineering.calculated;
    checks.push(...engineering.audit.goals.map(g=>({equipmentId:e.id,rule:g.id,status:g.status})));
    const speed=c.recommendedConveyorSpeedFactorPercent;
    if(e.processData?.accumulation?.speedMode==='MANUAL'&&Number.isFinite(c.recommendedInfeedConveyorSpeedMmPerSecond))add('SPEED_BALANCE','ZERO',e,[scenarioChange(e,'processData.accumulation.conveyorSpeedMmPerSecond',c.recommendedInfeedConveyorSpeedMmPerSecond)],{recommendedSpeedMmPerSecond:c.recommendedInfeedConveyorSpeedMmPerSecond},64,'STATIC');
    if(!['MANUAL','DYNAMIC'].includes(e.processData?.accumulation?.speedMode)&&Number.isFinite(speed)&&speed>=0&&Math.abs(speed-input.conveyorSpeedFactorPercent)>=.25){
      add('SPEED_BALANCE','ZERO',e,[scenarioChange(e,'processData.accumulation.conveyorSpeedFactorPercent',Number(speed.toFixed(2)))],{recommendedSpeedMmPerSecond:c.recommendedInfeedConveyorSpeedMmPerSecond},64,'STATIC');
    }
    if(!pulseConflict&&scenarioGoal(engineering,'SENSOR_DEBOUNCE')==='WARNING'&&Number.isFinite(c.packagePassSensorSeconds)&&Number.isFinite(c.sensorClearGapSeconds)){
      const greater=v=>Math.ceil((v+.01)*100)/100;
      add('SENSOR_DEBOUNCE','ZERO',e,[scenarioChange(e,'processData.accumulation.blockedTimeDelaySeconds',Math.max(input.blockedTimeDelaySeconds,greater(c.packagePassSensorSeconds))),scenarioChange(e,'processData.accumulation.clearTimeDelaySeconds',Math.max(input.clearTimeDelaySeconds,greater(c.sensorClearGapSeconds)))],{pulseSeconds:c.packagePassSensorSeconds,gapSeconds:c.sensorClearGapSeconds},82,'STATIC');
    }
    // Search existing sensor locations on every supported conveyor, even when
    // worksheet targets pass. These are hypotheses, not promised gains.
    if(zone?.usableLengthMm>0){
      const bound=Math.min(zone.usableLengthMm,zone.primeSensorPositionMm,zone.backupRestartPositionMm??Infinity),current=e.processData?.accumulation?.backupSensorPositionMm;
      const engineeringTargetAvailable=Number.isFinite(c.recommendedBackupSensorPositionMm);
      let backup=engineeringTargetAvailable?Math.min(c.recommendedBackupSensorPositionMm,bound):NaN;
      // A missing worksheet speed factor must not remove an installed sensor
      // from the search. Reuse its bounded range as an explicit hypothesis;
      // do not fill in the missing engineering data or claim a calculated target.
      if(!engineeringTargetAvailable&&Number.isFinite(current)&&current>=0&&current<=bound&&
        Number.isFinite(zone.primeSensorPositionMm)&&zone.primeSensorPositionMm<=zone.usableLengthMm&&
        (zone.backupRestartPositionMm===undefined||Number.isFinite(zone.backupRestartPositionMm)&&zone.backupRestartPositionMm<=zone.usableLengthMm))backup=current*.5;
      if(backup===e.processData?.accumulation?.backupSensorPositionMm)backup=Math.min(zone.primeSensorPositionMm,zone.backupRestartPositionMm??Infinity)*.5;
      if(Number.isFinite(backup)&&backup>=0)add('SENSOR_POSITION','ZERO',e,[scenarioChange(e,'processData.accumulation.backupSensorPositionMm',Math.min(bound,Number(backup.toFixed(2))))],{installedLengthMm:zone.usableLengthMm,engineeringTargetAvailable,targetBasis:engineeringTargetAvailable?'ENGINEERING_TARGET':'EXISTING_SENSOR_RANGE'},75,'STATIC');
    }
    if(zone?.usableLengthMm>0&&e.processData?.geometry?.lpPrimeMm>0){
      add('SENSOR_WINDOW','ZERO',e,[scenarioChange(e,'processData.geometry.lpPrimeMm',e.processData.geometry.lpPrimeMm*.5)],{installedLengthMm:zone.usableLengthMm},72,'STATIC');
    }
    const upstream=simulation.equipment.find(x=>x.id===item.upstreamId),stopData=scenarioStopDataCoverage(simulation,upstream);
    const minorMttr=stopData.enabledClasses.includes('MINOR')?upstream.processData.equipment.stopInputs.minor.mttrMinutes:null;
    const coverage=minorMttr>0&&Number.isFinite(c.antiStarveSeconds)?c.antiStarveSeconds/(minorMttr*60):null;
    checks.push({equipmentId:e.id,rule:'ACCUMULATION_1_TO_2_MTTR',status:coverage===null?'NOT_EVALUATED':coverage>=1&&coverage<=2?'PASS':'REVIEW',coverage,referenceEquipmentId:upstream?.id,
      stopClass:minorMttr>0?'MINOR':null,mttrMinutes:minorMttr,basis:minorMttr>0?'DECLARED_MINOR_STOP_MTTR':'MINOR_STOP_INPUT_REQUIRED',
      interpretation:'Buffer coverage uses the declared minor-stop MTTR. Aggregate MTTR is not classified as a microstop by a duration cutoff.'});
    const recoveryFailed=['INSTALLED_LENGTH','SMOOTH_RECOVERY','BACKUP_POSITION'].some(id=>['FAIL','WARNING'].includes(scenarioGoal(engineering,id)));
    const observedDownstream=diagnosis.equipment.find(r=>r.equipmentId===item.downstreamId);
    const observedStarvation=diagnosis.status==='OBSERVED'&&(observedDownstream?.starvedSeconds||0)>diagnosis.durationSeconds*.01;
    if(recoveryFailed||(coverage!==null&&coverage<1)||observedStarvation){
      const plan=scenarioRecoveryPlan(engineering,minorMttr>0?minorMttr*60:0);
      if(plan){
        const losses=result?.accumulationZoneMetrics&&Object.values(result.accumulationZoneMetrics).find(x=>x.ownerEquipmentId===e.id);
        if(plan.length>input.installedLengthMm){
          add('BUFFER_RECOVERY','HIGH',e,[scenarioChange(e,'processData.accumulation.backupSensorPositionMm',plan.backup),scenarioChange(e,'processData.geometry.lactMm',plan.length)],{recoveryLengthMm:c.recoveryLengthMm,requiredOverflowMm:c.overflowLengthMm,addedLengthMm:plan.length-input.installedLengthMm,coverage,
            bufferStopTarget:minorMttr>0?{stopClass:'MINOR',mttrMinutes:minorMttr,basis:'DECLARED_INPUT'}:null,overflowUnits:losses?.overflowUnits??null},96+(losses?.overflowUnits>0?5:0),losses?'HYBRID':'STATIC');
        }else{
          // Existing length plus a sensor adjustment is an operational change,
          // not a capital project merely because recovery sizing found it.
          if(!candidates.some(candidate=>candidate.kind==='SENSOR_POSITION'&&candidate.equipmentId===e.id))
            add('SENSOR_POSITION','ZERO',e,[scenarioChange(e,'processData.accumulation.backupSensorPositionMm',plan.backup)],{installedLengthMm:input.installedLengthMm,recoveryWithinInstalledLength:true},75,'STATIC');
          checks.push({equipmentId:e.id,rule:'RECOVERY_WITHIN_INSTALLED_LENGTH',status:'PASS',classification:'ZERO',addedLengthMm:0});
        }
      }
    }
    // The supplied design brief requires data not present in the current import contract.
    checks.push({equipmentId:e.id,rule:'TURN_TRAP_AND_FILLED_DIAMETER',status:'NOT_EVALUATED'});
  });
  (simulation.equipment||[]).filter(e=>e.type!=='CONVEYOR').forEach(e=>{
    const r=e.noiseProfile?.reliability;if(!(r?.mtbfMinutes>0&&r?.mttrMinutes>0))return;
    const stopData=scenarioStopDataCoverage(simulation,e);
    if(stopData.mode==='GENERAL')checks.push({equipmentId:e.id,rule:'STOP_CLASS_BREAKDOWN_REQUIRED_FOR_TARGETED_DIAGNOSIS',status:'NOT_EVALUATED',
      blocksFlowOptimization:false,interpretation:'Supply minor/major data to target a stop class. General reliability remains usable; its mean duration is not a class or cause.'});
    if(stopData.enabledClasses.includes('MAJOR'))checks.push({equipmentId:e.id,rule:'MAJOR_STOPS_REQUIRE_CAUSE_AND_INTERVENTION_REVIEW',status:'REVIEW',
      replacementRequired:null,interpretation:'A declared major stop does not determine its external/internal cause or the intervention category.'});
    if(stopData.enabledClasses.includes('MINOR')&&e.processData.equipment.stopInputs.minor.mttrMinutes>SCENARIO_POLICY.microstopLimitMinutes)checks.push({equipmentId:e.id,
      rule:'LONG_DECLARED_MINOR_STOP_BUFFER_TARGET',status:'REVIEW',stopClass:'MINOR',interpretation:'Review the long declared minor-stop buffer target; the input is not reclassified by duration.'});
  });
  analyzeLinePerformance(simulation.equipment,result).points.forEach(point=>{
    if(point.isPacemaker||!(point.maximumBpm>0)||!(point.recommendedBpm>0))return;
    const equipment=simulation.equipment.find(e=>e.id===point.id),target=Math.min(point.maximumBpm,point.recommendedBpm)/60;
    add('V_CURVE','ZERO',equipment,[scenarioChange(equipment,'nominalRatePerSecond',target)],{maximumBpm:point.maximumBpm,recommendedBpm:point.recommendedBpm},70,'STATIC');
  });
  checks.push({rule:'PACEMAKER_DESIRED_STATE_AND_V_GRAPH',status:'NOT_EVALUATED'});
  (simulation.whatIf?.externalOptions||[]).forEach(option=>{
    if(simulation.dynamicConfig?.reliabilityEnabled===false&&option.changes?.some(c=>c.path.startsWith('noiseProfile.reliability.')))return;
    if(!['ZERO','MEDIUM','HIGH'].includes(option.tier)||!option.changes?.length||!option.changes.every(c=>scenarioCategoryAllows(c,option.tier)))return;
    const equipment=simulation.equipment.find(e=>e.id===option.changes[0].equipmentId);if(!equipment)return;
    add(option.changes.some(c=>c.replacementMaximumBpm!==undefined)?'CAPACITY_REPLACEMENT':'RELIABILITY_INTERVENTION',option.tier,equipment,option.changes,{targetSource:'USER_DOCUMENTED',interventionType:option.changes[0].interventionType,costClass:SCENARIO_INTERVENTIONS[option.changes[0].interventionType]?.costClass,interpretation:'Supported intervention hypothesis; dynamic benefit and shifted constraints require evaluation.'},option.changes.some(c=>c.replacementMaximumBpm!==undefined)&&capacityDiagnosis.limitingEquipment.some(e=>e.id===equipment.id)?120:90,'STATIC');
  });
  const projects=['ZERO','MEDIUM','HIGH'].map(tier=>{
    const choices=candidates.filter(p=>p.tier===tier).sort((a,b)=>Number(b.canApply)-Number(a.canApply)||b.priority-a.priority);
    return choices[0]||{tier,canApply:false,titleKey:'scenario.no_proposal',basis:'STATIC',changes:[],evidence:{},disabledReason:'SCENARIO_INSUFFICIENT_EVIDENCE'};
  });
  return {sourceReadiness:scenarioSourceReadiness(simulation),proposalNeeds:scenarioProposalNeeds(simulation),equipmentReliability,capacityDiagnosis,definitions:SCENARIO_DEFINITIONS,interventions:SCENARIO_INTERVENTIONS,reliabilityOpportunities:reliabilitySensitivityCandidates(simulation),projects,checks,candidates,diagnosis,hasDynamicEvidence:diagnosis.status==='OBSERVED'};
}


