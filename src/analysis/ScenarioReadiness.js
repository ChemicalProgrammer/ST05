import {canonicalSimulationInputSignature,SIMULATION_PROVENANCE_VERSION} from '../simulation/SimulationProvenance.js';

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
  if(!equal(provenance.equipment,expected.equipment))return fail('EQUIPMENT_CHANGED','STALE');
  if(provenance.unitOfFlow!==expected.unitOfFlow)return fail('FLOW_UNIT_CHANGED','STALE');
  if(!equal(provenance.run,expected.run))return fail('RUN_CONFIGURATION_CHANGED','STALE');
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
