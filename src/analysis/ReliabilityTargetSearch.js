import { diagnoseScenarioLosses, scenarioStopDataCoverage, equipmentReliabilityAssessment } from './ScenarioPlanner.js';
import { analyzeLinePerformance } from './LinePerformanceAnalysis.js';
import { productFlowUnit } from '../simulation/ProductProfiles.js';
import { scenarioPairedSummary } from './ScenarioStatistics.js';

// Exploratory inverse design: target values are model hypotheses, not evidence
// that a maintenance action or replacement can achieve them.
export async function searchReliabilityTargets(simulation,{measure,run,cancelled=()=>false,progress=()=>{},maximumMachines=12,maximumTargets=3,recoveryFraction=.9,scope='AUTO',equipmentIds=[],equipmentLimits={},automaticBasic=false}={}){
  if(simulation.dynamicConfig?.reliabilityEnabled===false)return {status:'FAILURES_DISABLED',analysisOnly:true,candidateSets:[]};
  const lossDiagnosis=diagnoseScenarioLosses(simulation);
  const line=analyzeLinePerformance(simulation.equipment,lossDiagnosis.status==='OBSERVED'?simulation.results:null);
  const reference=line.points.find(point=>point.isPacemaker);
  const copy=value=>JSON.parse(JSON.stringify(value));
  simulation=copy({id:simulation.id,unitOfFlow:simulation.unitOfFlow,equipment:simulation.equipment,dynamicConfig:simulation.dynamicConfig,results:simulation.results?{summary:simulation.results.summary,durationSeconds:simulation.results.durationSeconds}:undefined});
  const machines=(simulation.equipment||[]).filter(e=>e.type!=='CONVEYOR'&&e.noiseProfile?.reliability?.mtbfMinutes>0&&e.noiseProfile?.reliability?.mttrMinutes>0);
  if(!machines.length)return {status:'NO_ELIGIBLE_RELIABILITY',analysisOnly:true,candidateSets:[],selectedChanges:[],coverage:{screened:0,total:0},calculations:0};
  // Basic chooses its own scope; retained manual/ALL settings from a larger
  // workspace must not expand this preliminary diagnosis without a bound.
  if(automaticBasic){scope='AUTO';maximumMachines=Math.min(maximumMachines,3);maximumTargets=run?.scenarioFidelity==='FLUID_SCREEN_V1'?Math.min(2,maximumTargets):1;}
  if(!['AUTO','MANUAL','ALL'].includes(scope))throw Error('SCENARIO_RELIABILITY_SCOPE');
  if(!Number.isInteger(maximumMachines)||maximumMachines<1||!Number.isInteger(maximumTargets)||maximumTargets<1)throw Error('SCENARIO_RELIABILITY_BUDGET');
  if(scope==='MANUAL'&&(!equipmentIds.length||equipmentIds.some(id=>!machines.some(e=>e.id===id))))throw Error('SCENARIO_RELIABILITY_SELECTION');
  for(const machine of machines){const limits=equipmentLimits[machine.id]||{},r=machine.noiseProfile.reliability;
    if(limits.mtbfMaximum!==undefined&&(!Number.isFinite(limits.mtbfMaximum)||limits.mtbfMaximum<r.mtbfMinutes||limits.mtbfMaximum>1000000))throw Error('SCENARIO_RELIABILITY_MTBF_LIMIT');
    if(limits.mttrMinimum!==undefined&&(!Number.isFinite(limits.mttrMinimum)||limits.mttrMinimum<.001||limits.mttrMinimum>r.mttrMinutes))throw Error('SCENARIO_RELIABILITY_MTTR_LIMIT');
  }
  // Bound AUTO using observed own stops and capacity screening rather than
  // alphabetical IDs. Neither priority nor a nominal ceiling establishes cause.
  // Native bottle and case speeds cannot be compared without format conversion.
  const comparableSpeeds=new Set(simulation.equipment.filter(e=>e.type!=='CONVEYOR').map(e=>productFlowUnit(e))).size<=1;
  const minimumBpm=line.points.length?Math.min(...line.points.map(point=>point.configuredBpm)):null;
  const referenceIndex=simulation.equipment.findIndex(e=>e.id===line.referenceId);
  const selectionEvidence=machines.map(e=>{
    const observed=lossDiagnosis.status==='OBSERVED'?lossDiagnosis.equipment.find(row=>row.equipmentId===e.id):null;
    const point=line.points.find(row=>row.id===e.id),assessment=equipmentReliabilityAssessment(e,{...simulation.dynamicConfig,...run});
    const availableBpm=comparableSpeeds&&point?.configuredBpm>0&&assessment.availability!==null?point.configuredBpm*assessment.availability:null;
    return {equipmentId:e.id,name:e.name,lineIndex:simulation.equipment.findIndex(unit=>unit.id===e.id),
      observedOwnStopSeconds:observed?.ownStopSeconds??null,observedFailureSeconds:observed?.failureSeconds??null,observedFailureCount:observed?.failureCount??null,
      observedMinorFailureSeconds:observed?.minorFailureSeconds??null,observedMajorFailureSeconds:observed?.majorFailureSeconds??null,observedGeneralFailureSeconds:observed?.generalFailureSeconds??null,
      stopDataCoverage:scenarioStopDataCoverage(simulation,e),reliabilityAssessment:assessment,
      nominalConstraint:comparableSpeeds&&Number.isFinite(minimumBpm)&&Math.abs(point?.configuredBpm-minimumBpm)<1e-7,
      availabilityOnlyBpm:availableBpm,availabilityOnlyDeficitBpm:availableBpm!==null&&reference?.configuredBpm>0?Math.max(0,reference.configuredBpm-availableBpm):null,
      nominalScreenAvailable:comparableSpeeds,causalStatus:'NOT_ESTABLISHED'};
  });
  const priority=selectionEvidence.slice().sort((a,b)=>(b.observedFailureSeconds??0)-(a.observedFailureSeconds??0)||Number(b.nominalConstraint)-Number(a.nominalConstraint)||(b.availabilityOnlyDeficitBpm??0)-(a.availabilityOnlyDeficitBpm??0)||(b.reliabilityAssessment.unavailability??0)-(a.reliabilityAssessment.unavailability??0)||Math.abs(a.lineIndex-referenceIndex)-Math.abs(b.lineIndex-referenceIndex)||a.lineIndex-b.lineIndex);
  const priorityMachines=priority.map(row=>machines.find(e=>e.id===row.equipmentId));
  const selected=scope==='MANUAL'?machines.filter(e=>equipmentIds.includes(e.id)):scope==='ALL'?machines:priorityMachines.slice(0,maximumMachines),observations=[],targetTests=[],candidateSets=[];
  const selectedIds=new Set(selected.map(e=>e.id));
  const coverage={screened:selected.length,total:machines.length,omitted:machines.length-selected.length,omittedEquipmentIds:machines.filter(e=>!selectedIds.has(e.id)).map(e=>e.id),selectionBasis:scope==='AUTO'?'COMPATIBLE_RELIABILITY_FAILURES_THEN_NOMINAL_CAPACITY':'EXPLICIT_SCOPE',diagnosisStatus:lossDiagnosis.status,diagnosisReason:lossDiagnosis.reason??null,selectionEvidence:priority.map((row,index)=>({...row,priority:index+1,selected:selectedIds.has(row.equipmentId)}))};
  const bounded=(id,r,grade)=>({mtbfMinutes:Math.min(equipmentLimits[id]?.mtbfMaximum??1000000,r.mtbfMinutes*grade.mtbf),mttrMinutes:Math.max(equipmentLimits[id]?.mttrMinimum??.001,r.mttrMinutes*grade.mttr)});
  let calculations=0;async function evaluate(model,changes,label,measurementRun=run){if(cancelled())throw Error('BATCH_CANCELLED');progress({label,calculations});const value=await measure(model,changes,measurementRun);if(cancelled())throw Error('BATCH_CANCELLED');calculations++;if(!Number.isFinite(value?.throughput)||!Number.isFinite(value?.oee))throw Error('INVALID_RELIABILITY_METRICS');return value;}
  const baseline=await evaluate(simulation,[],'Reliability baseline'),without=copy(simulation);without.dynamicConfig={...without.dynamicConfig,reliabilityEnabled:false};
  const failureFree=await evaluate(without,[],'All MTBF / MTTR failures disabled',{...run,reliabilityEnabled:false});
  function gainEvidence(candidate){return {deltaThroughput:candidate.throughput-baseline.throughput,deltaOeePp:candidate.oee-baseline.oee,pairedEvidence:scenarioPairedSummary(baseline,candidate)};}
  for(const equipment of selected){const model=copy(simulation);delete model.equipment.find(e=>e.id===equipment.id).noiseProfile.reliability;
    const candidate=await evaluate(model,[],'Disable failures: '+equipment.name);
    const stopDataCoverage=scenarioStopDataCoverage(simulation,equipment);
    observations.push({equipmentId:equipment.id,name:equipment.name,candidate,...gainEvidence(candidate),stopDataCoverage,
      targetScope:stopDataCoverage.mode==='SPLIT'?'ALL_CONFIGURED_STOP_CLASSES':'GENERAL_UNCLASSIFIED',
      interpretation:'Conditional removal of all MTBF/MTTR stop classes with the separate MICRO_STOP process unchanged; not an additive share of line OEE, a class-specific intervention or a demonstrated physical failure cause.'});
    progress({label:'Machines screened '+observations.length+' / '+selected.length,calculations,counter:'Machines screened',completed:observations.length,total:selected.length});
  }
  const threshold=Math.max(.001,Math.abs(baseline.throughput)*.001),ranking=observations.slice().sort((a,b)=>b.deltaThroughput-a.deltaThroughput||(a.equipmentId<b.equipmentId?-1:1));
  let relevant=scope==='AUTO'?ranking.filter(o=>o.deltaThroughput>threshold&&o.candidate.oee>=baseline.oee-1e-9).slice(0,maximumTargets):ranking;
  if(scope==='AUTO'&&!relevant.length&&failureFree.throughput>baseline.throughput+threshold)relevant=ranking.slice(0,maximumTargets);
  // Basic tests four joint improvement grades on one diagnosed machine. It
  // avoids the separate MTBF and MTTR grids while retaining bounded targets,
  // matching seeds/horizon and the later independent confirmation.
  const grades=[{mtbf:1.25,mttr:.8},{mtbf:1.5,mttr:2/3},{mtbf:2,mttr:.5},{mtbf:4,mttr:.25}];
  const mechanisms=automaticBasic?['JOINT']:['MTBF','MTTR','JOINT'];
  const choices=[];
  for(const row of relevant){const equipment=machines.find(e=>e.id===row.equipmentId),r=equipment.noiseProfile.reliability,tests=[];
    const tested=new Set();
    for(const mechanism of mechanisms)for(const grade of grades){
      const values=bounded(equipment.id,r,grade);
      const fields=mechanism==='MTBF'?['mtbfMinutes']:mechanism==='MTTR'?['mttrMinutes']:['mtbfMinutes','mttrMinutes'];
      const changes=fields.map(field=>({equipmentId:equipment.id,path:'noiseProfile.reliability.'+field,before:r[field],after:values[field],unit:'min',external:true,analysisOnly:true,interventionType:'SENSITIVITY',originTier:'ZERO',packageId:'RELIABILITY:'+equipment.id,justification:'Automatically explored downtime-reduction target; an achievable operational or maintenance action has not been established.'})).filter(c=>c.before!==c.after);
      if(!changes.length)continue;
      const experiment=JSON.stringify(changes.map(c=>[c.equipmentId,c.path,c.after]));if(tested.has(experiment))continue;tested.add(experiment);
      const candidate=await evaluate(simulation,changes,equipment.name+' · '+mechanism+' · '+grade.mtbf+' / '+grade.mttr);
      const item={equipmentId:equipment.id,name:equipment.name,mechanism,grade,changes,candidate,...gainEvidence(candidate),
        stopDataCoverage:row.stopDataCoverage,targetScope:row.targetScope,
        effort:changes.reduce((sum,c)=>sum+Math.abs(Math.log(c.after/c.before)),0),effortBasis:'LOG_PARAMETER_CHANGE_NOT_MONETARY_COST'};
      targetTests.push(item);if(item.deltaThroughput>threshold&&candidate.oee>=baseline.oee-1e-9)tests.push(item);
    }
    const safe=tests.filter(t=>!(t.candidate.warnings||[]).length),pool=safe.length?safe:tests;
    const maximum=pool.length?Math.max(...pool.map(t=>t.deltaThroughput)):0;
    const choice=pool.filter(t=>t.deltaThroughput>=maximum*recoveryFraction).sort((a,b)=>a.effort-b.effort||a.changes.length-b.changes.length||b.deltaThroughput-a.deltaThroughput)[0];
    if(choice){choices.push(choice);candidateSets.push({kind:'ISOLATED_TARGET',changes:choice.changes,candidate:choice.candidate,...gainEvidence(choice.candidate)});}
  }
  // Explicit joint packages survive screening even when isolated attribution is
  // non-additive. Later ordinary search/DOE refine flow around these targets.
  for(let count=2;count<=choices.length;count++){const changes=choices.slice(0,count).flatMap(c=>c.changes),candidate=await evaluate(simulation,changes,'Joint reliability targets · '+count+' machines');candidateSets.push({kind:'JOINT_TARGETS',changes,candidate,...gainEvidence(candidate)});}
  if(relevant.length>1)for(const grade of [grades[2],grades[3]]){
    const changes=relevant.flatMap(row=>{const r=machines.find(e=>e.id===row.equipmentId).noiseProfile.reliability;return ['mtbfMinutes','mttrMinutes'].map(field=>({equipmentId:row.equipmentId,path:'noiseProfile.reliability.'+field,before:r[field],after:bounded(row.equipmentId,r,grade)[field],unit:'min',external:true,analysisOnly:true,interventionType:'SENSITIVITY',originTier:'ZERO',packageId:'RELIABILITY:'+row.equipmentId,justification:'Joint downtime-reduction target; an achievable operational or maintenance action has not been established.'}));});
    const candidate=await evaluate(simulation,changes,'Joint mechanism exploration · '+relevant.length+' machines · grade '+grade.mtbf);
    candidateSets.push({kind:'JOINT_MECHANISM_TARGETS',changes,candidate,...gainEvidence(candidate)});
  }
  const admissible=candidateSets.filter(c=>c.candidate.throughput>baseline.throughput+threshold&&c.candidate.oee>=baseline.oee-1e-9).sort((a,b)=>Number(!!a.candidate.warnings?.length)-Number(!!b.candidate.warnings?.length)||b.candidate.throughput-a.candidate.throughput);
  return {status:admissible.length?(admissible[0].candidate.warnings?.length?'TARGETS_REQUIRE_ENGINEERING_REVIEW':'EXPLORATORY_TARGETS_FOUND'):'NO_TARGET_GAIN',analysisOnly:true,classification:'ZERO',scope,equipmentIds:selected.map(e=>e.id),equipmentLimits,maximumTargets:scope==='AUTO'?maximumTargets:selected.length,run,baseline,failureFree,
    conditionalReliabilityGain:{throughput:failureFree.throughput-baseline.throughput,oeePp:failureFree.oee-baseline.oee,pairedEvidence:scenarioPairedSummary(baseline,failureFree),additive:false},
    coverage,ranking,targetTests,candidateSets,selectedChanges:admissible[0]?.changes||[],isolatedTargetChanges:choices.map(c=>c.changes),recoveryFraction,calculations,
    searchPolicy:automaticBasic?'BASIC_JOINT_RELIABILITY_V1':'BOUNDED_RELIABILITY_MECHANISMS_V1',testedMechanisms:mechanisms,
    uncertainty:{method:'PAIRED_SEED_DIFFERENCES',multipleComparisonAdjusted:false,selectionIsExploratory:true,confirmationRequired:true},
    interpretation:'Conditional failure-removal gains overlap and are not additive causal OEE shares. Aggregate MTBF/MTTR targets change all configured stop classes proportionally and leave the separate MICRO_STOP process unchanged; general inputs do not support minor/major attribution. Paired intervals describe replication uncertainty within the model, not plant uncertainty. Bounded model targets use the least parameter change recovering the configured fraction of the best isolated tested gain, then test joint packages. Screening is preliminary; full-horizon independent confirmation is required. The intervention scope is operational or maintenance downtime reduction in Zero CAPEX. Achievable actions and feasibility require review; budget amounts are outside this analysis.'};
}
