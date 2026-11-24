import {canonicalSimulationInputSignature,SIMULATION_PROVENANCE_VERSION} from '../simulation/SimulationProvenance.js';
import {plantCalendarSchedule} from '../simulation/PlantCalendarSchedule.js';

// A progress label alone is not completion evidence. Check the current model,
// requested replications, seed identities and terminal calendar/runtime exposure.
export function scenarioSourceReadiness(simulation) {
  const result=simulation?.results;
  const fail=(reason,sourceStatus='UNAVAILABLE',extra={})=>({ready:false,reason,sourceStatus,...extra});
  if(!result?.summary)return fail('NO_RESULTS');
  if(result.provisional===true)return fail('INCOMPLETE_REPLICATIONS','INCOMPLETE');
  if(!(Number.isFinite(result.durationSeconds)&&result.durationSeconds>0))return fail('INVALID_RESULT_DURATION');
  if(result.replicationStatus?.state!=='COMPLETE')return fail('INCOMPLETE_REPLICATIONS','INCOMPLETE');
  if(!result.inputSignature)return fail('MISSING_INPUT_SIGNATURE');
  let provenance;try{provenance=JSON.parse(result.inputSignature);}catch(_){return fail('INVALID_INPUT_SIGNATURE');}
  if(!provenance||typeof provenance!=='object')return fail('INVALID_INPUT_SIGNATURE');
  if(provenance.version!==SIMULATION_PROVENANCE_VERSION)return fail('PROVENANCE_VERSION_MISMATCH','HISTORICAL',{provenance:{recordedVersion:provenance.version??null,currentVersion:SIMULATION_PROVENANCE_VERSION}});
  const run={...simulation.dynamicConfig};
  if(run.durationMode==='SHIFTS')run.durationSeconds=(run.shiftHours||8)*(run.shiftCount||1)*3600;
  // With an active packing format the engine reports bottle equivalents even
  // when the case's original generic input label is "units". Do not mistake
  // that output label for the input unit recorded in the signature.
  const formatId=run.initialFormatId??run.initialProductId;
  const formatted=Array.isArray(run.productCatalog)&&run.productCatalog.some(p=>p.id===formatId);
  const inputUnit=formatted?provenance.unitOfFlow:simulation.unitOfFlow||result.unitOfFlow||'units';
  const expected=JSON.parse(canonicalSimulationInputSignature({case:{equipment:simulation.equipment,unitOfFlow:inputUnit},run}));
  if(formatted&&result.unitOfFlow!=='bottles')return fail('FLOW_UNIT_CHANGED','STALE');
  function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));return value;}
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  if(provenance.run?.engineId!==expected.run.engineId)return fail('ENGINE_MISMATCH','STALE');
  if(expected.run.engineId!=='ST_CURRENT')return fail('UNVALIDATED_SCENARIO_ENGINE');
  // Storage fills empty object fields and trims display labels. These do not
  // change equipment physics; all nested parameters, units and order remain exact.
  function storedEquipment(items){
    return Array.isArray(items)?items.map(unit=>{
      const copy={...unit};delete copy.uiExpanded;
      if(typeof copy.name==='string')copy.name=copy.name.trim();
      if(typeof copy.unitOfFlow==='string')copy.unitOfFlow=copy.unitOfFlow.trim()||undefined;
      for(const key of ['characteristics','noiseProfile','processData'])if(copy[key]===undefined)copy[key]={};
      // A declared 0/0 minor AND major pair with no active failure profile
      // has no aggregate MTBF or MTTR. Editors/older storage may represent
      // that undefined aggregate as null, omitted, or zero. Compare those
      // representations alike, without accepting changes to active failures
      // or to the declared stop categories.
      const data=copy.processData?.equipment,split=data?.stopInputs;
      if(!copy.noiseProfile?.reliability&&split&&['minor','major'].every(kind=>split[kind]?.mtbfMinutes===0&&split[kind]?.mttrMinutes===0)&&
         [data.mtbfMinutes,data.mttrMinutes].every(value=>value===undefined||value===null||value===0)){
        const normalized={...data};delete normalized.mtbfMinutes;delete normalized.mttrMinutes;
        copy.processData={...copy.processData,equipment:normalized};
      }
      return copy;
    }):items;
  }
  function difference(a,b,path){
    if(equal(a,b))return null;
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
      for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
        const next=difference(a[key],b[key],Array.isArray(a)?path+'['+key+']':path+'.'+key);
        if(next)return next;
      }
    }
    return path;
  }
  const equipmentDifference=difference(storedEquipment(provenance.equipment),storedEquipment(expected.equipment),'equipment');
  if(equipmentDifference)return fail('EQUIPMENT_CHANGED','STALE',{differencePath:equipmentDifference});
  if(provenance.unitOfFlow!==expected.unitOfFlow)return fail('FLOW_UNIT_CHANGED','STALE');
  function comparableRun(value){
    const copy={...value};
    for(const key of ['sampleDisplayUnit','displayRefreshFps','chartWindow'])delete copy[key];
    return copy;
  }
  // Numerical execution expands scheduled calendar stops and excludes disabled
  // manual events. The stored config is intentionally the editable unexpanded
  // representation. Reproduce that deterministic transformation, not its result.
  function preparedRun(value){
    const copy={...value,machineResidenceEnabled:value.machineResidenceEnabled??true};
    const calendar=copy.includePlantCalendar===false?{...copy.plantCalendar,enabled:false}:copy.plantCalendar;
    const manualEnabled=copy.eventsEnabled!==false;
    const manualStops=manualEnabled?(copy.plannedStops||[]).filter(event=>event?.source!=='PLANT_CALENDAR'):[];
    const commands=manualEnabled?copy.commands||[]:[];
    if(!calendar?.enabled||calendar.mode!=='SCHEDULED')return {...copy,plantCalendar:calendar,commands,plannedStops:manualStops};
    const schedule=plantCalendarSchedule(calendar,copy.tickSeconds);
    return {...copy,eventsEnabled:true,commands,plannedStops:manualStops.concat(schedule.events.map(event=>({...event,restartPolicy:schedule.restartPolicy,source:'PLANT_CALENDAR'}))),plantCalendar:{...calendar,application:'EVENTS',appliedHorizonSeconds:copy.durationSeconds}};
  }
  const observedRun=comparableRun(provenance.run),currentRun=comparableRun(expected.run);
  if(!equal(observedRun,currentRun)){
    let executionRun;
    try{executionRun=comparableRun(preparedRun(expected.run));}catch(_){}
    if(!executionRun||!equal(observedRun,executionRun))return fail('RUN_CONFIGURATION_CHANGED','STALE',{differencePath:difference(observedRun,executionRun||currentRun,'run')});
  }
  const rounds=expected.run.rounds,baseSeed=expected.run.seed>>>0;
  if(!Number.isInteger(rounds)||rounds<1||rounds>100)return fail('INVALID_REPLICATION_COUNT','INCOMPLETE');
  if(result.replicationStatus.rounds!==undefined&&result.replicationStatus.rounds!==rounds||result.batch&&result.batch.rounds!==rounds)return fail('REPLICATION_COUNT_MISMATCH','INCOMPLETE');
  const rows=result.batch?.rows||(rounds===1?[result]:[]);
  if(!Array.isArray(rows)||rows.length!==rounds)return fail('INCOMPLETE_REPLICATION_ROWS','INCOMPLETE',{rounds,completedRounds:Array.isArray(rows)?rows.length:0});
  const expectedSeeds=new Set(Array.from({length:rounds},(_,index)=>(baseSeed+index)>>>0));
  if(new Set(rows.map(row=>row.seed)).size!==rounds||rows.some(row=>!Number.isInteger(row.seed)||!expectedSeeds.has(row.seed)))return fail('REPLICATION_SEEDS_MISMATCH','INCOMPLETE');
  if(rows.some(row=>!row.summary||!Number.isFinite(row.summary.lineOeePercent)||row.summary.lineOeePercent<0||!Number.isFinite(row.summary.outputCount)||row.summary.outputCount<0))return fail('INVALID_REPLICATION_METRICS','INCOMPLETE');
  const target=expected.run.effectiveRuntimeTargetSeconds,horizon=expected.run.durationSeconds;
  if(!Number.isFinite(horizon)||horizon<=0)return fail('INVALID_RESULT_DURATION');
  for(const row of rows){
    const duration=row.durationSeconds??(target===undefined?result.durationSeconds:undefined);
    if(!Number.isFinite(duration)||duration<=0||duration>horizon+1e-6)return fail('INCOMPLETE_REPLICATION_HORIZON','INCOMPLETE');
    if(target===undefined){if(Math.abs(duration-horizon)>1e-6)return fail('INCOMPLETE_REPLICATION_HORIZON','INCOMPLETE');}
    else {
      const stop=row.effectiveRuntimeStop;
      if(!stop||stop.targetSeconds!==target||stop.limitSeconds!==horizon||!['REACHED','LIMIT_REACHED'].includes(stop.status))return fail('INCOMPLETE_RUNTIME_TARGET','INCOMPLETE');
      if(stop.status==='LIMIT_REACHED'&&Math.abs(duration-horizon)>1e-6)return fail('INCOMPLETE_RUNTIME_TARGET','INCOMPLETE');
      if(stop.status==='REACHED'&&(!Number.isFinite(stop.accumulatedSeconds)||stop.accumulatedSeconds+1e-6<target))return fail('INCOMPLETE_RUNTIME_TARGET','INCOMPLETE');
    }
  }
  return {ready:true,reason:null,sourceStatus:'CURRENT',rounds,completedRounds:rows.length,unitOfFlow:formatted?'bottles':expected.unitOfFlow,comparisonBasis:target===undefined?'FIXED_CALENDAR_HORIZON':'COMPLETED_RUNTIME_TARGET_OR_LIMIT'};
}
