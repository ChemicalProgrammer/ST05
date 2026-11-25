import { planDiscretePackages, addDiscretePackets } from './DiscretePackageEngine.js';
import { stopReliabilityProfile, selectReliabilityStop, createFailureHistory, startFailureEpisode, closeFailureEpisode, chargeFailureEpisode, snapshotFailureHistory, summarizeFailureOverlap } from './StopReliability.js';
import { applyProductProfile, productUnitFactor, productFlowUnit, productPackSize } from './ProductProfiles.js';
import { plantCalendarSchedule, resolvePlannedStops } from './PlantCalendarSchedule.js';
import { createEquipmentRandom } from './SeededRandom.js';
import { validateSimulationInput, resolveDynamicBeltSettings,dynamicBeltEnabled } from './SimulationValidation.js';
import { isConveyorEquipment, resolveAccumulationZoneDefinition } from './FormatGeometryAdapter.js';

// Prepare field names once rather than concatenate them for every packet/tick.
// Backup must still be processed before prime: sensor events share the same clock.
const PHOTOEYE_FIELDS = {
  backup: {name:'backup',enabled:'hasBackupSensor',position:'backupSensorPositionMm',at:'backupAtVirtualSecond',fraction:'backupPassedFraction',units:'backupPassedUnits',last:'backupLastPassAtVirtualSecond',pulse:'backupPulseUntilVirtualSecond'},
  prime: {name:'prime',enabled:'hasPrimeSensor',position:'primeSensorPositionMm',at:'primeAtVirtualSecond',fraction:'primePassedFraction',units:'primePassedUnits',last:'primeLastPassAtVirtualSecond',pulse:'primePulseUntilVirtualSecond'}
};
const TRANSPORT_PHOTOEYES = [PHOTOEYE_FIELDS.backup, PHOTOEYE_FIELDS.prime];

// Residence calculations retain the historical 120-Hz step unless the user
// explicitly selects a coarser resolution. Apply it to every execution path,
// including replications and numerical playback, rather than only background work.
const RESIDENCE_TIME_STEPS = {PRECISE:1/120,BALANCED:1/60,FAST:1/20};
export function resolveSimulationNumerics(run) {
  const resolution=run.numericalResolution||'PRECISE';
  const requestedTickSeconds=run.tickSeconds;
  const preciseTick=run.machineResidenceEnabled?Math.min(requestedTickSeconds,1/120):requestedTickSeconds;
  const effectiveTickSeconds=run.machineResidenceEnabled
    ?Math.min(requestedTickSeconds,RESIDENCE_TIME_STEPS[resolution]):requestedTickSeconds;
  return {resolution,requestedTickSeconds,effectiveTickSeconds,
    coarserThanPrecise:effectiveTickSeconds>preciseTick};
}

export function simulateLine(input) {
  const validation = validateSimulationInput(input);
  if (!validation.ok) return validation;

  const runtime = createRuntime(input);
  applyDueCommands(runtime);
  updatePlantCalendar(runtime, false);
  initializeInitialMaterialStates(runtime);
  recordStateTransitions(runtime);
  addSample(runtime);
  executeTicks(runtime);
  if(runtime.samples.at(-1)?.virtualSecond!==runtime.virtualSecond)addSample(runtime);
  updatePlantCalendar(runtime,false);
  return { ok: true, result: createResult(runtime) };
}

// Playback owns an incremental copy of the same physical runtime as a complete
// run. It follows the viewer's requested time instead of replaying the sparse
// archive. Full frames do not accumulate; chart points and the measured-rate
// window are separately bounded, independently of the configured horizon.
export function createLinePlaybackSession(input) {
  const validation=validateSimulationInput(input);
  if(!validation.ok)throw Object.assign(new Error(validation.error.message),validation.error);
  const runtime=createRuntime(JSON.parse(JSON.stringify(input)));
  runtime.playbackOnly=true;
  runtime.captureEvents=false;
  runtime.captureStateTransitions=false;
  runtime.events.length=0;
  runtime.playbackChartInterval=Math.ceil((runtime.run.sampleEverySeconds||runtime.run.tickSeconds)/runtime.run.tickSeconds)*runtime.run.tickSeconds;
  runtime.nextPlaybackChartAt=0;
  runtime.playbackChartSamples=[];
  runtime.playbackRateCapacity=Math.max(2,Math.ceil(1/runtime.run.tickSeconds)+1);
  runtime.playbackRateWindow=new Array(runtime.playbackRateCapacity);
  runtime.playbackRateIndex=0;
  runtime.playbackRateLength=0;
  applyDueCommands(runtime);
  updatePlantCalendar(runtime,false);
  initializeInitialMaterialStates(runtime);
  recordPlaybackObservation(runtime);
  let frame;
  const finished=()=>runtime.virtualSecond+1e-8>=runtime.run.durationSeconds||effectiveRuntimeTargetReached(runtime);
  function snapshot(){
    if(frame?.virtualSecond===runtime.virtualSecond)return frame;
    const next=createSample(runtime,true);
    const rates=playbackMeasuredRates(runtime);
    next.instantaneousOutputRatePerSecond=rates.output;
    // Whole packages appear as impulses at the selected physical tick.
    // Display the measured count delta over the last physical second, using
    // the same window regardless of worker chunks or display FPS.
    next.equipment.forEach((unit,index)=>{
      Object.assign(unit,rates.equipment[index]);
      // Tick impulses are not extrema of the measured one-second flow curve.
      // Omitting them lets charts scale from the actual measured points.
      delete unit.minRatePerSecond;delete unit.maxRatePerSecond;
    });
    const reference=resolveLineOeeReference(runtime.equipment)?.nominalRatePerSecond;
    const ideal=runtime.product?runtime.idealBottleOutput:(reference||0)*runtime.virtualSecond;
    next.lineOeePercent=ideal>0?round(100*clampUnit(runtime.outputCount/ideal)):null;
    next.lineOeePacemakerRatePerSecond=reference??null;
    frame=next;
    return frame;
  }
  snapshot();
  return {
    get time(){return runtime.virtualSecond;},
    get finished(){return finished();},
    get tickSeconds(){return runtime.run.tickSeconds;},
    get durationSeconds(){return runtime.run.durationSeconds;},
    // Exposed as coverage metadata, not as a mutable history array.
    get retainedSampleCount(){return runtime.samples.length;},
    get retainedChartSampleCount(){return runtime.playbackChartSamples.length;},
    get chartIntervalSeconds(){return runtime.playbackChartInterval;},
    drainChartSamples(){const samples=runtime.playbackChartSamples;runtime.playbackChartSamples=[];return samples;},
    snapshot,
    advanceTo(targetVirtualSecond,options={}){
      if(!Number.isFinite(targetVirtualSecond)||targetVirtualSecond<0)
        throw Object.assign(new Error('Playback time must be a finite, non-negative number.'),{code:'INVALID_PLAYBACK_TIME'});
      // A complete run includes its final whole physical tick. Retain that
      // convention at a non-aligned horizon; intermediate requests never
      // advance beyond their requested instant.
      const finalTick=Math.ceil((runtime.run.durationSeconds-1e-8)/runtime.run.tickSeconds);
      const targetTick=targetVirtualSecond+1e-8>=runtime.run.durationSeconds?finalTick:
        Math.floor((targetVirtualSecond+1e-8)/runtime.run.tickSeconds);
      const target=Math.min(finalTick,targetTick)*runtime.run.tickSeconds;
      if(target+1e-8<runtime.virtualSecond)
        throw Object.assign(new Error('Create a new playback session to seek backwards.'),{code:'PLAYBACK_REWIND_REQUIRED'});
      if(!finished()&&target>runtime.virtualSecond+1e-8){
        const budgetMs=Number.isFinite(options.budgetMs)?Math.max(0,options.budgetMs):8;
        const maxTicks=Number.isFinite(options.maxTicks)?Math.max(1,Math.floor(options.maxTicks)):2048;
        if(budgetMs>0)executeTicks(runtime,target,{deadline:simulationClockNow()+budgetMs,maxTicks});
      }
      return snapshot();
    }
  };
}

function playbackMeasuredRates(runtime){
  const firstIndex=(runtime.playbackRateIndex-runtime.playbackRateLength+runtime.playbackRateCapacity)%runtime.playbackRateCapacity;
  const first=runtime.playbackRateWindow[firstIndex];
  const elapsed=first?runtime.virtualSecond-first.virtualSecond:0;
  return {
    output:elapsed>0?round((runtime.outputCount-first.outputCount)/elapsed):0,
    equipment:runtime.equipment.map((unit,index)=>{
      const rate=elapsed>0?round((unit.outputCount-first.equipment[index])/elapsed):0;
      return {actualRatePerSecond:rate,meanRatePerSecond:rate};
    })
  };
}

function recordPlaybackObservation(runtime){
  runtime.playbackRateWindow[runtime.playbackRateIndex]={virtualSecond:runtime.virtualSecond,
    outputCount:runtime.outputCount,equipment:runtime.equipment.map(unit=>unit.outputCount)};
  runtime.playbackRateIndex=(runtime.playbackRateIndex+1)%runtime.playbackRateCapacity;
  runtime.playbackRateLength=Math.min(runtime.playbackRateCapacity,runtime.playbackRateLength+1);
  if(runtime.virtualSecond+1e-8<runtime.nextPlaybackChartAt)return;
  const rates=playbackMeasuredRates(runtime);
  runtime.playbackChartSamples.push({virtualSecond:runtime.virtualSecond,outputCount:round(runtime.outputCount),
    equipment:runtime.equipment.map((unit,index)=>({id:unit.id,...rates.equipment[index]}))});
  if(runtime.playbackChartSamples.length>601)runtime.playbackChartSamples.shift();
  runtime.nextPlaybackChartAt=(Math.floor((runtime.virtualSecond+1e-8)/runtime.playbackChartInterval)+1)*runtime.playbackChartInterval;
}

function simulationClockNow(){
  return typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now();
}

// Same tick operations as a single run, yielding between chunks for UI cancellation.
export async function simulateLineAsync(input, options = {}) {
  const validation = validateSimulationInput(input);
  if (!validation.ok) return validation;
  if(input.run.shiftSeconds!==undefined&&(!Number.isFinite(input.run.shiftSeconds)||input.run.shiftSeconds<=0||input.run.shiftSeconds%input.run.tickSeconds!==0))throw new Error('INVALID_SHIFT_DURATION');
  const runtime = createRuntime(input);
  runtime.summaryOnly=options.summaryOnly===true;
  runtime.captureEvents=options.detail===true;
  runtime.captureStateTransitions=options.detail!==false&&!runtime.summaryOnly;
  // Dedicated lightweight Live telemetry is transient browser data. It does
  // not consume the bounded history sample budget or change simulation ticks.
  if(options.onPartial&&input.run.calculationMode==='LIVE'&&!runtime.summaryOnly){
    runtime.liveTelemetry=[];
    runtime.liveTelemetryInterval=Math.max(runtime.run.tickSeconds,
      Math.ceil(runtime.run.durationSeconds/5000/runtime.run.tickSeconds)*runtime.run.tickSeconds);
    runtime.nextLiveTelemetryAt=0;
  }
  if(runtime.summaryOnly){runtime.omittedEvents+=runtime.events.length;runtime.events.length=0;}
  applyDueCommands(runtime); updatePlantCalendar(runtime, false); initializeInitialMaterialStates(runtime); recordStateTransitions(runtime); addSample(runtime);
  if(runtime.liveTelemetry)recordLiveTelemetry(runtime);
  // Stream only newly available frames/telemetry. No artificial bottle totals.
  let publishedSamples=0,publishedTransitions=0,publishedTelemetry=0,lastPartialAt=0;
  function publishPartial(){
    if(!options.onPartial||runtime.summaryOnly||(runtime.samples.length===publishedSamples
      &&(runtime.liveTelemetry?.length||0)===publishedTelemetry))return;
    const now=Date.now();if(publishedSamples&&now-lastPartialAt<100&&runtime.virtualSecond<runtime.run.durationSeconds)return;lastPartialAt=now;
    const partial=createResult(runtime,true);
    partial.samples=runtime.samples.slice(publishedSamples);publishedSamples=runtime.samples.length;
    partial.stateTransitions=runtime.stateTransitions.slice(publishedTransitions);publishedTransitions=runtime.stateTransitions.length;
    partial.liveTelemetry=runtime.liveTelemetry?.slice(publishedTelemetry)||[];
    publishedTelemetry=runtime.liveTelemetry?.length||0;
    partial.events=[]; // The bounded event log is sent once with the completed result.
    partial.provisional=true;partial.calculatedThroughSeconds=runtime.virtualSecond;
    options.onPartial(partial);
  }
  publishPartial();
  const shifts = []; let previous = {outputCount:0,idealBottleOutput:0,totalStarvedSeconds:0,totalBlockedSeconds:0,totalFailureSeconds:0};
  const shiftSeconds = input.run.shiftSeconds || input.run.durationSeconds;
  let nextShift = shiftSeconds;
  while (runtime.virtualSecond < input.run.durationSeconds && !effectiveRuntimeTargetReached(runtime)) {
    if (options.cancelled?.()) throw new Error('BATCH_CANCELLED');
    const chunkTicks=options.onPartial&&runtime.virtualSecond===0?32:input.run.calculationMode==='FAST'||input.run.calculationMode==='SUMMARY'?5000:1000;
    const until = Math.min(runtime.virtualSecond + runtime.run.tickSeconds * chunkTicks, nextShift, input.run.durationSeconds);
    // Worker jobs may run their full chunk. The main-thread fallback must
    // return control after a short wall-time budget, including residence runs
    // whose effective physical tick is much smaller than the requested tick.
    executeTicks(runtime,until,options.yieldBetweenChunks===false?undefined:
      {deadline:simulationClockNow()+8,maxTicks:chunkTicks});
    if (runtime.virtualSecond >= nextShift || runtime.virtualSecond >= input.run.durationSeconds || effectiveRuntimeTargetReached(runtime)) {
      const summary = createSummary(runtime);
      const duration = Math.min(shiftSeconds, runtime.virtualSecond - shifts.length * shiftSeconds);
      const output = summary.outputCount - previous.outputCount;
      shifts.push({shift:shifts.length+1,durationSeconds:duration,outputCount:output,throughputPerMinute:output/duration*60,
        lineOeePercent:runtime.product?(summary.idealBottleOutput>previous.idealBottleOutput?Math.min(100,100*output/(summary.idealBottleOutput-previous.idealBottleOutput)):0):summary.lineOeePacemakerRatePerSecond>0?Math.min(100,100*output/(summary.lineOeePacemakerRatePerSecond*duration)):0,
        starvedSeconds:summary.totalStarvedSeconds-previous.totalStarvedSeconds,blockedSeconds:summary.totalBlockedSeconds-previous.totalBlockedSeconds,failureSeconds:summary.totalFailureSeconds-previous.totalFailureSeconds});
      previous=summary; nextShift+=shiftSeconds;
    }
    options.progress?.(effectiveRuntimeTargetReached(runtime)?1:runtime.virtualSecond/input.run.durationSeconds,
      runtime.run.effectiveRuntimeTargetSeconds===undefined?undefined:{
        elapsedSeconds:runtime.virtualSecond,
        accumulatedSeconds:runtime.lineRateReferenceValid?round(runtime.lineRunSeconds-runtime.lineRateShortfallSeconds):null,
        outputCount:round(runtime.outputCount)
      });
    publishPartial();
    if(options.yieldBetweenChunks!==false)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(runtime.samples.at(-1)?.virtualSecond!==runtime.virtualSecond)addSample(runtime);
  updatePlantCalendar(runtime,false);
  const result=createResult(runtime); result.shifts=shifts; result.detailCoverage=recordingCoverage(runtime);
  if(runtime.liveTelemetry)result.liveTelemetry=runtime.liveTelemetry;
  return {ok:true,result};
}

function createRuntime(input) {
  const numerics=resolveSimulationNumerics(input.run);
  if(input.run.machineResidenceEnabled)input={...input,run:{...input.run,discretePackages:true,tickSeconds:numerics.effectiveTickSeconds}};
  const product=input.run.productCatalog?.find(p=>p.id===(input.run.initialFormatId??input.run.initialProductId));
  const baseEquipment=input.case.equipment;
  if(product)input={...input,case:{...input.case,equipment:applyProductProfile(baseEquipment,product)}};
  const equipment = input.case.equipment.map((model) => createEquipmentRuntime(model, input.run.seed, input.run.reliabilityEnabled !== false, input.run.reliabilityCategories,input.run.machineResidenceEnabled));
  const zones = equipment.slice(0, -1).map((equipment, index) => createAccumulationZoneRuntime(
    equipment,
    input.case.equipment[index + 1],
    input.case.equipment,
    index,
    input.run.tickSeconds, input.run
  ));

  equipment.forEach((equipment, index) => {
    const incomingZone = zones.find((zone) => zone.downstreamControlEquipmentId === equipment.id && zone.hasPrimeSensor);
    const outgoingZone = zones[index];
    if ((equipment.type === 'CONVEYOR' || equipment.processData?.role === 'CONVEYOR') && outgoingZone?.physicalModelEnabled) {
      equipment.nominalRatePerSecond = outgoingZone.conveyorSpeedMmPerSecond / outgoingZone.productPitchMm;
    }
    equipment.primeZoneId = index === 0 ? undefined : incomingZone?.id;
    equipment.primeStartAuthorized = !equipment.primeZoneId;
    equipment.startupDelaySeconds = resolveStartupDelaySeconds(equipment);
    equipment.restartRampUpSeconds = resolveRestartRampUpSeconds(equipment);
    equipment.startDelayRemainingSeconds = 0;
    equipment.startRampDurationSeconds = 0;
    equipment.startRampElapsedSeconds = 0;
    equipment.startReason = null;
    equipment.backupControl = null;
    if(!product&&!['BOTTLE','BOTTLES'].includes(String(equipment.unitOfFlow||input.case.unitOfFlow||'').toUpperCase())){
      equipment.startRampBottleEquivalents=null;equipment.stopTransitionBottleEquivalents=null;
    }
  });

  const runtime = {
    caseId: input.case.id,
    unitOfFlow: product ? 'bottles' : input.case.unitOfFlow,
    baseEquipment, product, productRows:{}, productTimeline:[], sourceInputUnits:0, overflowBottleEquivalents:0, clearoutBottleEquivalents:0, idealBottleOutput:0,
    run: input.run,
    numerics,
    virtualSecond: 0,
    equipment,
    equipmentById: new Map(equipment.map(unit => [unit.id, unit])),
    zones,
    events: [],
    samples: [],zoneDefinitions:{},
    stateTransitions:[],lastRecordedStates:[],omittedStateTransitions:0,
    captureStateTransitions:true,
    outputCount: 0,
    lineRateLossStarvationSeconds:0,lineRateLossRampSeconds:0,lineRateLossStopTransitionSeconds:0,
    lineRunSeconds: 0, lineEffectiveRuntimeSeconds: 0, lineRateShortfallSeconds: 0, lineRateRecoverySeconds: 0,
    lineRateShortfallOutputEquivalents: 0, lineRateRecoveryOutputEquivalents: 0,
    lineRateReferenceValid: true, lineReferenceRate: resolveLineOeeReference(equipment)?.nominalRatePerSecond,
    commandIndex: 0,
    calendar: resolvePlannedStops(input.run),
    calendarIndex: 0,calendarActive: null,calendarStopSeconds: 0,
    commands: sortCommands(input.run.eventsEnabled===false?[]:input.run.commands || []),
    omittedEvents:0,captureEvents:true,
    sampleInterval: Math.ceil(Math.max(input.run.sampleEverySeconds||input.run.tickSeconds,input.run.durationSeconds/(input.run.calculationMode==='SUMMARY'?1:999))/input.run.tickSeconds)*input.run.tickSeconds,
    nextSampleAt:0,historyTicks:0
  };

  if(product) { configureProductFactors(runtime); runtime.productTimeline.push({productId:product.id,name:product.name,startSeconds:0}); }
  const push=runtime.events.push.bind(runtime.events);
  runtime.events.push=(...items)=>{if(runtime.captureEvents&&!runtime.summaryOnly&&runtime.events.length+items.length<=2000)return push(...items);runtime.omittedEvents+=items.length;return runtime.events.length;};
  const source = runtime.equipment[0];
  if (source && isOperationalMode(source) && hasStartProfile(source)) {
    requestEquipmentStart(runtime, source, 'INITIAL_START');
  }

  return runtime;
}

// ST_EXCLUSIVE_STATES_V1: observe, never feed counters back into physics.
function createStateAccounting(){
  return {schema:'ST_EXCLUSIVE_STATES_V1',stateSeconds:{},outputUnitsByState:{},
    accountedSeconds:0,outputUnits:0,productiveSeconds:0,productiveDesignOutputUnits:0,
    positiveOutputSeconds:0,productiveNoOutputSeconds:0,outputOutsideProductiveUnits:0,
    backupActive:false,backupEpisodes:0,observedBackupStops:0,episodeStopped:false,
    endedAfterObservedStop:0,endedWithoutObservedStop:0};
}
function accountStateTick(ledger,state,seconds,output,designRate,machine,backupActive){
  if(!ledger)return;
  const flow=output-ledger.outputUnits;
  ledger.outputUnits=output;
  ledger.accountedSeconds+=seconds;
  ledger.stateSeconds[state]=(ledger.stateSeconds[state]||0)+seconds;
  if(flow>0){
    ledger.positiveOutputSeconds+=seconds;
    ledger.outputUnitsByState[state]=(ledger.outputUnitsByState[state]||0)+flow;
  }
  if(!machine)return;
  const productive=state==='RUNNING'||state==='RAMP_UP'||state==='RAMP_DOWN'||state==='STOP_RESPONSE'||state==='DISCHARGING';
  if(productive){
    ledger.productiveSeconds+=seconds;
    ledger.productiveDesignOutputUnits+=designRate*seconds;
    if(!(flow>0))ledger.productiveNoOutputSeconds+=seconds;
  }else if(flow>0)ledger.outputOutsideProductiveUnits+=flow;
  if(backupActive&&!ledger.backupActive){
    ledger.backupEpisodes++;ledger.episodeStopped=false;
  }
  if(backupActive&&state==='BACKUP_STOP'&&!ledger.episodeStopped){
    ledger.observedBackupStops++;ledger.episodeStopped=true;
  }
  if(!backupActive&&ledger.backupActive){
    if(ledger.episodeStopped)ledger.endedAfterObservedStop++;
    else ledger.endedWithoutObservedStop++;
    ledger.episodeStopped=false;
  }
  ledger.backupActive=backupActive;
}
function stateAccountingSnapshot(ledger,elapsed,output,designRate,machine,exposure,charged,detail=true){
  if(!ledger)return null;
  const tidy=value=>Number.isFinite(value)?Number(value.toFixed(6)):null;
  const states=ledger.stateSeconds,time=name=>states[name]||0;
  const ownDowntime=time('FAILURE')+time('MICRO_STOP');
  const productive=ledger.productiveSeconds,ideal=ledger.productiveDesignOutputUnits;
  let efficiency=null;
  if(machine){
    const availability=productive+ownDowntime>0?productive/(productive+ownDowntime):null;
    const runtimeEfficiency=ideal>0?output/ideal:null;
    const operationalEfficiency=availability!==null&&runtimeEfficiency!==null?availability*runtimeEfficiency:null;
    const weightedDesign=productive>0?ideal/productive:designRate;
    const intrinsicAvailability=elapsed>0?1-(ownDowntime+time('STOPPED')+time('EMERGENCY_STOP')+time('PLANNED_STOP'))/elapsed:null;
    const intrinsicOee=intrinsicAvailability!==null&&runtimeEfficiency!==null?intrinsicAvailability*runtimeEfficiency:null;
    // Good output already excludes physical rejects. Keep above-design discrepancies visible.
    efficiency={availability:tidy(availability),runtimeEfficiency:tidy(runtimeEfficiency),
      operationalEfficiency:tidy(operationalEfficiency),throughput:tidy(operationalEfficiency===null?null:operationalEfficiency*weightedDesign),
      productionSpeed:tidy(productive>0?output/productive:null),designSpeed:tidy(weightedDesign),
      quality:1,intrinsicAvailability:tidy(intrinsicAvailability),intrinsicOee:tidy(intrinsicOee)};
  }
  const result={schema:ledger.schema,stateSeconds:Object.fromEntries(Object.entries(states).map(([k,v])=>[k,tidy(v)])),
    productiveSeconds:machine?tidy(productive):null,productiveDesignOutputUnits:machine?tidy(ideal):null,
    ownDowntimeSeconds:machine?tidy(ownDowntime):null,efficiency};
  if(detail){
    const byState=ledger.outputUnitsByState;
    Object.assign(result,{accountedSeconds:tidy(ledger.accountedSeconds),
      timeResidualSeconds:tidy(elapsed-Object.values(states).reduce((a,b)=>a+b,0)),
      outputUnitsByState:Object.fromEntries(Object.entries(byState).map(([k,v])=>[k,tidy(v)])),
      outputResidualUnits:tidy(output-Object.values(byState).reduce((a,b)=>a+b,0)),
      positiveOutputSeconds:tidy(ledger.positiveOutputSeconds),
      productiveNoOutputSeconds:machine?tidy(ledger.productiveNoOutputSeconds):null,
      outputOutsideProductiveUnits:machine?tidy(ledger.outputOutsideProductiveUnits):null,
      outputAboveDesignUnits:machine?tidy(Math.max(0,output-ideal)):null,
      exceedsDesignBeyondOnePackage:machine?output-ideal>1+1e-6:null,
      reliabilityExposureSeconds:machine?tidy(exposure):null,reliabilityChargedSeconds:machine?tidy(charged):null,
      backup:machine?{observedEpisodes:ledger.backupEpisodes,observedStops:ledger.observedBackupStops,
        endedAfterObservedStop:ledger.endedAfterObservedStop,endedWithoutObservedStop:ledger.endedWithoutObservedStop,
        open:ledger.backupActive,openReachedStop:ledger.backupActive&&ledger.episodeStopped}:null});
  }
  return result;
}

function createEquipmentRuntime(model, seed, reliabilityEnabled = true, reliabilityCategories, residenceEnabled) {
  const failureRandom=createEquipmentRandom(seed,model.id,"failure");
  const microStopRandom=createEquipmentRandom(seed,model.id,"microstop-occurrence");
  const microStopDurationRandom=createEquipmentRandom(seed,model.id,"microstop-duration");
  const reliability = reliabilityEnabled ? stopReliabilityProfile(model, reliabilityCategories) : null;
  const failureTargetSeconds=reliability?randomExponentialSeconds(failureRandom,reliability.mtbfMinutes*60):null;
  return {
    ...model,
    nominalRatePerSecond: machineOperatingRatePerSecond(model),
    residence: isConveyorEquipment(model)||(!residenceEnabled&&model.processData?.equipment?.internalCapacityBottles==null)?null:{clock:0,positionClock:0,inventory:0,ready:0,queue:[],head:0,intakeCredit:1},
    mode: model.initialMode,
    availabilityState: model.initialMode,
    actualRatePerSecond: 0,
    microStopRemainingSeconds: 0,
    microStopSeconds: 0,
    failureRemainingSeconds: 0,
    failureSeconds: 0,
    failureCount: 0,
    ...(model.processData?.equipment?.macroStopScrapBottles>0?{macroScrap:{requestedBottles:0,actualBottles:0,pendingBottles:0,stopCount:0,nativeEquivalent:0}}:{}),
    stopReliability:reliability,
    stopClassRandom:createEquipmentRandom(seed,model.id,'failure-class'),
    activeStopClass:null,
    repairStopClass:null,
    minorFailureCount:0,majorFailureCount:0,generalFailureCount:0,
    minorFailureSeconds:0,majorFailureSeconds:0,generalFailureSeconds:0,
    reliabilityExposureSeconds: 0,
    reliabilityChargedSeconds: 0,
    stateAccounting: createStateAccounting(),
    repairRestartPending: false,
    repairRestartCount: 0,
    emergencyStopLatched: false,
    emergencyStopSeconds: 0,
    failureRandom,microStopRandom,microStopDurationRandom,
    failureHistory:createFailureHistory(),
    failureTargetSeconds,
    timeToFailureRemainingSeconds:failureTargetSeconds,
    outputCount: 0,
    runningSeconds: 0,
    runningDesignOutput: 0,
    pausedSeconds: 0,
    stoppedSeconds: 0,
    starvedSeconds: 0,
    blockedSeconds: 0,
    rampRateLossSeconds:0,stopTransitionRateLossSeconds:0,
    partialStarvationLossSeconds: 0,
    partialBlockingLossSeconds: 0,
    waitingForPrimeSeconds: 0,
    backupStopSeconds: 0,
    startRampSeconds: 0,
    startRampOutputUnits: 0,
    startRampBottleEquivalents: 0,
    startRampCount: 0,
    stopTransitionSeconds: 0,
    stopTransitionOutputUnits: 0,
    stopTransitionBottleEquivalents: 0,
    stopTransitionCount: 0,
    startSequenceId: 0,
    lastAccountedStartSequenceId: null,
    lastAccountedStopControl: null,
    stateSeconds: {}
  };
}

function createAccumulationZoneRuntime(owner, downstreamModel, allEquipment, ownerIndex, tickSeconds, run) {
  const resolvedDefinition = resolveAccumulationZoneDefinition(allEquipment, ownerIndex);
  const definition = resolvedDefinition.definition;
  const isInternalHandoff = definition?.kind === 'INTERNAL_HANDOFF';
  const physical = !isInternalHandoff && definition ? normalizePhysicalZone(definition) : null;
  const capacityUnits = isInternalHandoff
    ? createHandoffCapacityUnits(owner, downstreamModel, tickSeconds)
    : physical?.capacityUnits;
  const upstreamControlEquipmentId = definition?.upstreamControlEquipmentId || owner.id;
  const downstreamControlEquipmentId = definition?.downstreamControlEquipmentId || downstreamModel.id;
  const dynamic=physical&&dynamicBeltEnabled(owner,run)
    ?createDynamicBeltRuntime(resolveDynamicBeltSettings(definition,owner.processData.dynamicLineBalancing,downstreamModel)):null;

  return {
    ...(dynamic?{dynamic}:{}),
    id: definition?.id || owner.id + '--to--' + downstreamModel.id,
    name: definition?.name || owner.name + ' to ' + downstreamModel.name,
    ownerEquipmentId: owner.id,
    upstreamControlEquipmentId,
    downstreamControlEquipmentId,
    visible: Boolean(physical),
    internalHandoff: isInternalHandoff,
    physicalModelEnabled: Boolean(physical),
    transportPhotoeyes: physical ? TRANSPORT_PHOTOEYES.filter(sensor => physical[sensor.enabled]) : [],
    modelOrigin: resolvedDefinition.origin,
    geometrySources: resolvedDefinition.sources || {},
    formatAssumptions: resolvedDefinition.assumptions || [],
    engineering: physical?.engineering || null,
    capacityUnits,
    usableLengthMm: physical?.usableLengthMm || null,
    productPitchMm: physical?.productPitchMm || null,
    accumulatedPitchMm: physical?.accumulatedPitchMm || null,
    productLengthMm: physical?.productLengthMm || null,
    gapMm: physical?.gapMm || null,
    conveyorSpeedMmPerSecond: physical?.conveyorSpeedMmPerSecond || null,
    travelSeconds: physical?.travelSeconds || 0,
    packagePassSensorSeconds: physical?.packagePassSensorSeconds ?? null,
    sensorClearGapSeconds: physical?.sensorClearGapSeconds ?? null,
    sensorCycleSeconds: physical?.sensorCycleSeconds ?? null,
    primeSensorPositionMm: physical?.primeSensorPositionMm ?? null,
    primeTravelSeconds: physical?.primeTravelSeconds ?? null,
    primeTriggerWaitingUnits: physical?.primeTriggerWaitingUnits ?? null,
    hasPrimeSensor: physical?.hasPrimeSensor || false,
    primeDetected: false,
    primeDetectedAtVirtualSecond: null,
    primeTriggerCount: 0,
    primeSignalState: 'CLEAR',
    primePulseUntilVirtualSecond: 0,
    primePassedUnits: 0,
    primeLastPassAtVirtualSecond: null,
    downstreamRampUpSeconds: physical?.downstreamRampUpSeconds || 0,
    backupSensorPositionMm: physical?.backupSensorPositionMm ?? null,
    backupRestartPositionMm: physical?.backupRestartPositionMm ?? null,
    backupTriggerWaitingUnits: physical?.backupTriggerWaitingUnits ?? null,
    backupRestartWaitingUnits: physical?.backupRestartWaitingUnits ?? null,
    hasBackupSensor: physical?.hasBackupSensor || false,
    backupActive: false,
    backupSignalState: 'CLEAR',
    backupPulseUntilVirtualSecond: 0,
    backupPassedUnits: 0,
    backupLastPassAtVirtualSecond: null,
    backupBlockedCandidateSeconds: 0,
    backupClearCandidateSeconds: 0,
    backupTriggeredAtVirtualSecond: null,
    backupTriggerCount: 0,
    blockedTimeDelaySeconds: physical?.blockedTimeDelaySeconds || 0,
    clearTimeDelaySeconds: physical?.clearTimeDelaySeconds || 0,
    upstreamStopResponseSeconds: physical?.upstreamStopResponseSeconds || 0,
    bottlesDischargedAtStop: physical?.bottlesDischargedAtStop || 0,
    upstreamRestartDelaySeconds: physical?.upstreamRestartDelaySeconds ?? null,
    upstreamRestartRampUpSeconds: physical?.upstreamRestartRampUpSeconds ?? null,
    transit: [],
    waitingUnits: 0,
    overflowUnits: 0,
    overflowEvents: 0,
    blockingEquivalentSeconds: 0,
    starvingEquivalentSeconds: 0,
    constraintLossEquivalentSeconds: 0,
    lastPartialBlockingSeconds: 0,
    lastPartialStarvingSeconds: 0,
    inventoryIntegralUnitSeconds: 0,
    minimumInventoryUnits: 0,
    maximumInventoryUnits: 0,
    emptyInventorySeconds: 0,
    backupSignalBlockedSeconds: 0,
    backupSignalPulsingSeconds: 0,
    backupSignalClearSeconds: 0
  };
}

function createHandoffCapacityUnits(owner, downstreamModel, tickSeconds) {
  const rate = Math.max(owner?.nominalRatePerSecond || 0, downstreamModel?.nominalRatePerSecond || 0, 1);
  return Math.max(1, Math.ceil(rate * Math.max(tickSeconds || 1, 1) * 2));
}

function normalizePhysicalZone(definition) {
  const productPitchMm = definition.productPitchMm || ((definition.productLengthMm || 0) + (definition.gapMm || 0));
  const usableLengthMm = definition.usableLengthMm;
  const accumulatedPitchMm = definition.accumulatedPitchMm ?? productPitchMm;
  const capacityUnits = Math.floor(usableLengthMm / accumulatedPitchMm);
  const conveyorSpeedMmPerSecond = definition.conveyorSpeedMmPerSecond;
  const productLengthMm = definition.productLengthMm ?? null;
  const gapMm = definition.gapMm ?? (isFiniteNumber(productLengthMm) ? productPitchMm - productLengthMm : null);
  const hasPrimeSensor = definition.primeSensorPositionMm !== undefined && definition.primeSensorPositionMm !== null;
  const hasBackupSensor = definition.backupSensorPositionMm !== undefined && definition.backupSensorPositionMm !== null;
  const backupRestartPositionMm = hasBackupSensor
    ? definition.backupRestartPositionMm ?? definition.backupSensorPositionMm
    : null;
  return {
    engineering: definition.engineering || null,
    usableLengthMm,
    productPitchMm,
    accumulatedPitchMm,
    productLengthMm,
    gapMm,
    conveyorSpeedMmPerSecond,
    capacityUnits,
    travelSeconds: usableLengthMm / conveyorSpeedMmPerSecond,
    packagePassSensorSeconds: firstFinite(
      definition.packagePassSensorSeconds,
      safePositiveDivide(productLengthMm, conveyorSpeedMmPerSecond)
    ),
    sensorClearGapSeconds: firstFinite(
      definition.sensorClearGapSeconds,
      safeNonNegativeDivide(gapMm, conveyorSpeedMmPerSecond)
    ),
    sensorCycleSeconds: firstFinite(
      definition.sensorCycleSeconds,
      safePositiveDivide(productPitchMm, conveyorSpeedMmPerSecond)
    ),
    hasPrimeSensor,
    primeSensorPositionMm: hasPrimeSensor ? definition.primeSensorPositionMm : null,
    primeTravelSeconds: hasPrimeSensor ? definition.primeSensorPositionMm / conveyorSpeedMmPerSecond : null,
    primeTriggerWaitingUnits: hasPrimeSensor
      ? Math.max(1, Math.min(capacityUnits, Math.ceil((usableLengthMm - definition.primeSensorPositionMm) / accumulatedPitchMm)))
      : null,
    hasBackupSensor,
    backupSensorPositionMm: hasBackupSensor ? definition.backupSensorPositionMm : null,
    backupRestartPositionMm,
    backupTriggerWaitingUnits: hasBackupSensor
      ? Math.max(1, Math.ceil((usableLengthMm - definition.backupSensorPositionMm) / accumulatedPitchMm))
      : null,
    backupRestartWaitingUnits: hasBackupSensor
      ? Math.max(0, Math.floor((usableLengthMm - backupRestartPositionMm) / accumulatedPitchMm))
      : null,
    blockedTimeDelaySeconds: definition.blockedTimeDelaySeconds || 0,
    clearTimeDelaySeconds: definition.clearTimeDelaySeconds || 0,
    upstreamStopResponseSeconds: definition.upstreamStopResponseSeconds || 0,
    bottlesDischargedAtStop: definition.bottlesDischargedAtStop || 0,
    downstreamRampUpSeconds: definition.downstreamRampUpSeconds || 0,
    upstreamRestartDelaySeconds: definition.upstreamRestartDelaySeconds ?? null,
    upstreamRestartRampUpSeconds: definition.upstreamRestartRampUpSeconds ?? null
  };
}

function effectiveRuntimeTargetReached(runtime) {
  return runtime.run.effectiveRuntimeTargetSeconds !== undefined && runtime.lineRateReferenceValid &&
    runtime.lineRunSeconds-runtime.lineRateShortfallSeconds+1e-8 >= runtime.run.effectiveRuntimeTargetSeconds;
}

function executeTicks(runtime, until = runtime.run.durationSeconds, limits) {
  const startedAtTick=runtime.tickCount||0;
  while (runtime.virtualSecond < until-1e-8 && !effectiveRuntimeTargetReached(runtime)) {
    applyDueCommands(runtime);
    updatePlantCalendar(runtime);
    updateReliabilityFailures(runtime);
    updateMicroStops(runtime);
    advanceAccumulationZones(runtime);
    processLineFromDownstream(runtime);
    recordZoneStatistics(runtime);
    if(runtime.product){
      const ideal=runtime.productReferenceRate*runtime.run.tickSeconds;
      runtime.idealBottleOutput+=ideal;
      const row=currentProductRow(runtime);row.durationSeconds+=runtime.run.tickSeconds;row.idealBottleOutput+=ideal;
      runtime.equipment.forEach(e=>{e.idealNativeOutput=(e.idealNativeOutput||0)+e.nominalRatePerSecond*runtime.run.tickSeconds;});
    }
    runtime.equipment.forEach((item,index) => {
      accountNumericalState(runtime,item,index);
      item.stateSeconds[item.availabilityState] = (item.stateSeconds[item.availabilityState] || 0) + runtime.run.tickSeconds;
      if(!runtime.summaryOnly&&!runtime.playbackOnly){const rate=item.actualRatePerSecond||0;item.historySum=(item.historySum||0)+rate;item.historyMin=Math.min(item.historyMin??rate,rate);item.historyMax=Math.max(item.historyMax??rate,rate);}
    });
    if(!runtime.summaryOnly&&!runtime.playbackOnly)runtime.historyTicks++;
    advanceEquipmentControlTimers(runtime);
    runtime.tickCount=(runtime.tickCount||0)+1;
    runtime.virtualSecond=runtime.tickCount*runtime.run.tickSeconds;
    if(runtime.playbackOnly)recordPlaybackObservation(runtime);
    recordStateTransitions(runtime);
    addSampleIfDue(runtime);
    if(runtime.liveTelemetry&&runtime.virtualSecond+1e-8>=runtime.nextLiveTelemetryAt)
      recordLiveTelemetry(runtime);
    if(limits){
      const completed=(runtime.tickCount||0)-startedAtTick;
      if(completed>=limits.maxTicks||completed%16===0&&simulationClockNow()>=limits.deadline)break;
    }
  }
}

// Keep legacy availability states and rate-loss accounting untouched.
function accountNumericalState(runtime,item,index){
  const machine=!isConveyorEquipment(item),control=activeBackupControl(item);
  let state=item.availabilityState;
  if(state==='RAMPING_UP')state='RAMP_UP';
  else if(state==='RAMPING_DOWN')state='RAMP_DOWN';
  else if(state==='BACKUP_STOPPING'){
    // Response delay is not evidence of a physical linear ramp-down.
    state=control?.responseRemainingSeconds>0?'STOP_RESPONSE':'DISCHARGING';
  }
  if(!machine&&['RUNNING','STARVED','IDLE'].includes(state)){
    const zone=runtime.zones[index];
    if(zone?.physicalModelEnabled&&zone.ownerEquipmentId===item.id){
      const items=zone.discreteItems;
      if(items){
        const head=items[0],tail=items.at(-1),previous=items.at(-2);
        const packedTail=previous&&zone.accumulatedPitchMm+1e-6<zone.productPitchMm&&previous.x-tail.x<=zone.accumulatedPitchMm+1e-6;
        state=!head?'EMPTY':head.x+zone.productLengthMm/2>=zone.usableLengthMm-1e-6||
          (zone.accountingPackedPairIndex??-1)>=1||packedTail?'ACCUMULATING':'FLOWING';
      }else state=getZoneInventory(zone)<=1e-8?'EMPTY':zone.waitingUnits>1e-8?'ACCUMULATING':'FLOWING';
    }
  }
  accountStateTick(item.stateAccounting,state||'UNKNOWN',runtime.run.tickSeconds,item.outputCount,
    machine?machineDesignRatePerSecond(item):0,machine,Boolean(control));
}
function numericalAccountingSnapshot(item,elapsed,detail=true){
  const value=stateAccountingSnapshot(item.stateAccounting,elapsed,item.outputCount,machineDesignRatePerSecond(item),
    !isConveyorEquipment(item),item.reliabilityExposureSeconds,item.reliabilityChargedSeconds,detail);
  if(value?.efficiency&&item.macroScrap){
    const gross=item.outputCount+item.macroScrap.nativeEquivalent;
    value.efficiency.quality=gross>0?round(item.outputCount/gross):1;
    value.efficiency.productionSpeed=value.productiveSeconds>0?round(gross/value.productiveSeconds):null;
  }
  if(detail&&value&&!isConveyorEquipment(item)){
    value.legacyRunningSeconds=round(item.runningSeconds);
    value.legacyRunningDesignOutputUnits=round(item.runningDesignOutput||0);
  }
  return value;
}

function recordZoneStatistics(runtime) {
  runtime.zones.forEach((zone) => {
    if (!zone.visible) return;
    const up=getEquipment(runtime,zone.upstreamControlEquipmentId),down=getEquipment(runtime,zone.downstreamControlEquipmentId),tick=runtime.run.tickSeconds;
    const partialBlock=Math.max(0,(up?.partialBlockingLossSeconds||0)-zone.lastPartialBlockingSeconds);
    const partialStarve=Math.max(0,(down?.partialStarvationLossSeconds||0)-zone.lastPartialStarvingSeconds);
    zone.lastPartialBlockingSeconds=up?.partialBlockingLossSeconds||0;zone.lastPartialStarvingSeconds=down?.partialStarvationLossSeconds||0;
    const blocked=up?.availabilityState==='BLOCKED'||up?.availabilityState==='BACKUP_STOP'&&up.backupControl?.zoneId===zone.id;
    const starved=['STARVED','WAITING_FOR_PRIME'].includes(down?.availabilityState);
    const blockLoss=blocked?tick:Math.min(tick,partialBlock),starveLoss=starved?tick:Math.min(tick,partialStarve);
    zone.blockingEquivalentSeconds+=blockLoss;zone.starvingEquivalentSeconds+=starveLoss;
    // Concurrent constraints count once; partial losses use their larger weight.
    zone.constraintLossEquivalentSeconds+=Math.max(blockLoss,starveLoss);
    const inventoryUnits = getZoneInventory(zone);
    zone.inventoryIntegralUnitSeconds += inventoryUnits * runtime.run.tickSeconds;
    zone.minimumInventoryUnits = Math.min(zone.minimumInventoryUnits, inventoryUnits);
    zone.maximumInventoryUnits = Math.max(zone.maximumInventoryUnits, inventoryUnits);
    if (inventoryUnits <= 0) zone.emptyInventorySeconds += runtime.run.tickSeconds;
  });
}

function initializeInitialMaterialStates(runtime) {
  runtime.equipment.forEach((equipment, index) => {
    equipment.actualRatePerSecond = 0;

    if (equipment.emergencyStopLatched) {
      equipment.availabilityState = 'EMERGENCY_STOP';
    } else if (equipment.calendarStopped) {
      equipment.availabilityState = 'PLANNED_STOP';
    } else if (equipment.mode === 'PAUSE') {
      equipment.availabilityState = 'PAUSED';
    } else if (!isOperationalMode(equipment)) {
      equipment.availabilityState = 'STOPPED';
    } else if (requiresPrime(equipment)) {
      equipment.availabilityState = 'WAITING_FOR_PRIME';
    } else if (isStartDelayed(equipment)) {
      equipment.availabilityState = 'STARTING';
    } else if (isRampingUp(equipment)) {
      equipment.availabilityState = 'RAMPING_UP';
    } else if (index === 0) {
      equipment.availabilityState = 'READY';
    } else {
      equipment.availabilityState = 'STARVED';
    }
  });
}

// Whole packages keep their physical positions, including a packed queue. Sensors and
// entry space must observe the same geometry, rather than a fluid transit band.
function createDynamicBeltRuntime(settings){
  return {...settings,actualSpeedMmPerSecond:settings.nominalSpeedMmPerSecond,targetSpeedMmPerSecond:settings.nominalSpeedMmPerSecond,
    mode:'NOMINAL',boost:false,confirmedSeconds:0,candidate:null,dwellSeconds:0,boostRequests:0,
    boostSeconds:0,nominalSeconds:0,stoppedSeconds:0,rampSeconds:0,speedIntegral:0,observedSeconds:0,peakSpeedMmPerSecond:0};
}
// Update from the previous completed physical tick, before belt motion.
// S Low/High observe an outlet-anchored compact queue, not passing beam pulses.
function updateDynamicBelt(runtime,zone,stopped){
  const c=zone.dynamic,dt=runtime.run.tickSeconds,nominal=c.nominalSpeedMmPerSecond,high=c.highSpeedMmPerSecond;
  const downstream=getEquipment(runtime,zone.downstreamControlEquipmentId);
  const lowCovered=zone.waitingUnits>=c.lowUnits,highCovered=zone.waitingUnits>=c.highUnits;
  const permitted=!stopped&&!zone.backupActive&&downstream&&isAvailable(downstream)&&!activeBackupControl(downstream);
  const supply=getTransitUnits(zone)>0;
  c.lowCovered=lowCovered;c.highCovered=highCovered;
  c.dwellSeconds+=dt;
  if(!permitted||!supply){
    if(c.boost)c.dwellSeconds=0;
    c.boost=false;c.confirmedSeconds=0;c.candidate=null;
  }else{
    const desired=c.boost?!highCovered:!lowCovered;
    if(desired===c.boost){c.confirmedSeconds=0;c.candidate=null;}
    else{
      if(c.candidate!==desired){c.candidate=desired;c.confirmedSeconds=0;}
      c.confirmedSeconds+=dt;
      if(c.confirmedSeconds+1e-8>=c.confirmSeconds&&c.dwellSeconds+1e-8>=c.minDwellSeconds){
        c.boost=desired;c.dwellSeconds=0;c.confirmedSeconds=0;c.candidate=null;
        if(desired)c.boostRequests++;
      }
    }
  }
  c.observedSeconds+=dt;
  if(stopped){
    // Existing machine/belt interlocks retain priority. No motion or boost
    // while stopped; normal restart is the historical instantaneous nominal.
    c.actualSpeedMmPerSecond=0;c.targetSpeedMmPerSecond=0;c.mode='STOPPED';
    c.stoppedSeconds+=dt;zone.conveyorSpeedMmPerSecond=nominal;return;
  }
  const target=c.boost?high:nominal;
  const previous=Math.max(nominal,c.actualSpeedMmPerSecond);
  const slope=(high-nominal)/(target>previous?c.accelerationSeconds:c.decelerationSeconds);
  const speed=target>previous?Math.min(target,previous+slope*dt):Math.max(target,previous-slope*dt);
  c.actualSpeedMmPerSecond=speed;c.targetSpeedMmPerSecond=target;
  // Integrate the linear ramp exactly, including the part of a tick
  // after reaching the setpoint. All physical paths use this same speed.
  const rampTime=Math.min(dt,Math.abs(target-previous)/slope);
  zone.conveyorSpeedMmPerSecond=((previous+speed)*rampTime/2+target*(dt-rampTime))/dt;
  c.mode=speed<target-1e-8?'RAMP_UP':speed>target+1e-8?'RAMP_DOWN':c.boost?'BOOST':'NOMINAL';
  if(Math.abs(speed-previous)>1e-8)c.rampSeconds+=dt;
  if(zone.conveyorSpeedMmPerSecond>nominal+1e-8)c.boostSeconds+=dt;else c.nominalSeconds+=dt;
  c.speedIntegral+=zone.conveyorSpeedMmPerSecond*dt;
  c.peakSpeedMmPerSecond=Math.max(c.peakSpeedMmPerSecond,speed);
}
function dynamicBeltSnapshot(c){
  return {schema:'ST_DYNAMIC_BELT_V1',mode:c.mode,boostRequested:c.boost,
    lowSensorPositionMm:c.lowPositionMm,highSensorPositionMm:c.highPositionMm,
    lowThresholdUnits:c.lowUnits,highThresholdUnits:c.highUnits,
    lowCovered:c.lowCovered??false,highCovered:c.highCovered??false,
    nominalSpeedMmPerSecond:c.nominalSpeedMmPerSecond,highSpeedMmPerSecond:c.highSpeedMmPerSecond,
    maxSpeedMmPerSecond:c.maxSpeedMmPerSecond,actualSpeedMmPerSecond:round(c.actualSpeedMmPerSecond),
    targetSpeedMmPerSecond:round(c.targetSpeedMmPerSecond),peakSpeedMmPerSecond:round(c.peakSpeedMmPerSecond),
    averageSpeedMmPerSecond:c.observedSeconds>0?round(c.speedIntegral/c.observedSeconds):null,
    boostRequests:c.boostRequests,boostSeconds:round(c.boostSeconds),nominalSeconds:round(c.nominalSeconds),
    rampSeconds:round(c.rampSeconds),stoppedSeconds:round(c.stoppedSeconds),observedSeconds:round(c.observedSeconds)};
}

function advanceDiscreteConveyor(runtime,zone,stopped){
  zone.discreteItems??=[];
  const items=zone.discreteItems,tick=runtime.run.tickSeconds;
  const half=zone.productLengthMm/2,end=zone.usableLengthMm-half;
  const pitch=zone.accumulatedPitchMm,speed=zone.conveyorSpeedMmPerSecond;
  const distance=(stopped?0:speed)*tick,endSecond=runtime.virtualSecond+tick;
  const backup=zone.hasBackupSensor,prime=zone.hasPrimeSensor;
  const backupPosition=zone.backupSensorPositionMm,primePosition=zone.primeSensorPositionMm;
  const canPack=pitch+1e-6<zone.productPitchMm;
  const stationary=zone.stationaryPacked;
  if(stationary&&stationary.count===items.length&&stationary.first===items[0]
    &&stationary.last===items.at(-1)&&stationary.end===end&&stationary.pitch===pitch
    &&stationary.half===half&&stationary.productPitch===zone.productPitchMm
    &&stationary.backup===backup&&stationary.backupPosition===backupPosition){
    // A fully packed queue cannot move until a package is removed. No transit
    // positions or sensor crossings change, but debounce/start timers still
    // receive every physical tick. Format changes build new zone runtimes.
    zone.waitingUnits=items.length;zone.physicalPrimeReady=items.length>=zone.primeTriggerWaitingUnits;
    zone.accountingPackedPairIndex=canPack?items.length-1:-1;
    updatePrimeSensorSignal(runtime,zone);
    updateBackupSensorSegment(runtime,zone,tick,stationary.occupied,endSecond);
    return;
  }
  let limit=end,previousCenter,queued=0,beam=false,packed=false,unmoved=true,packedPairIndex=-1;
  // Packages remain ordered downstream-to-upstream. Fuse the position, queue
  // and sensor passes without changing the integration step or crossing rules.
  // Keeping the previous center in a local also avoids an array per belt/tick.
  for(let index=0;index<items.length;index++){
    const item=items[index],oldCenter=item.x;
    item.x=Math.min(limit,oldCenter+distance);
    if(item.x!==oldCenter)unmoved=false;
    limit=item.x-pitch;
    if(queued===index&&item.x>=end-index*pitch-1e-6)queued++;
    item.units=1;item.initialUnits=1;item.entryDurationSeconds=0;
    item.arrivesAtVirtualSecond=endSecond+(end-item.x)/speed;
    if(backup&&oldCenter+half<backupPosition&&item.x+half>=backupPosition){
      zone.backupPassedUnits++;zone.backupLastPassAtVirtualSecond=endSecond;
    }
    if(prime&&oldCenter+half<primePosition&&item.x+half>=primePosition){
      zone.primePassedUnits++;zone.primeLastPassAtVirtualSecond=endSecond;
    }
    if(backup&&!beam&&Math.abs(item.x-backupPosition)<=half+1e-6)beam=true;
    if(canPack&&index>0&&previousCenter-item.x<=pitch+1e-6){
      packedPairIndex=index;
      if(!packed&&backupPosition>=item.x&&backupPosition<=previousCenter)packed=true;
    }
    previousCenter=item.x;
  }
  zone.accountingPackedPairIndex=packedPairIndex;
  zone.waitingUnits=queued;
  zone.transit=items.slice(queued);
  zone.physicalPrimeReady=queued>=zone.primeTriggerWaitingUnits;
  zone.stationaryPacked=unmoved&&items.length>0&&queued===items.length
    ?{count:items.length,first:items[0],last:items.at(-1),end,pitch,half,
      productPitch:zone.productPitchMm,backup,backupPosition,occupied:beam||packed}:null;
  updatePrimeSensorSignal(runtime,zone);
  updateBackupSensorSegment(runtime,zone,tick,beam||packed,endSecond);
}

function advanceAccumulationZones(runtime) {
  runtime.zones.forEach((zone) => {
    // Internal handoffs have no travel, moving packets or photoeyes. Their
    // inventory is transferred directly by processEquipmentFlow/addFlowToZone;
    // running the belt transport pass for them performs no physical work.
    if(!zone.physicalModelEnabled)return;
    const owner = getEquipment(runtime, zone.ownerEquipmentId);
    const conveyorStopped = zone.physicalModelEnabled && owner && (!isAvailable(owner) || isStartDelayed(owner));
    if(runtime.run.discretePackages&&zone.physicalModelEnabled){
      if(zone.dynamic)updateDynamicBelt(runtime,zone,conveyorStopped);
      advanceDiscreteConveyor(runtime,zone,conveyorStopped);return;
    }
    if (conveyorStopped) {
      zone.transit.forEach((packet) => {
        delayTransitPacket(packet, runtime.run.tickSeconds);
      });
      if(zone.transit.length&&zone.lastPackageEntry!==undefined)zone.lastPackageEntry+=runtime.run.tickSeconds;
      updateZonePhotoeyes(runtime, zone);
      return;
    }

    // A moving head packet awaiting this tick's discharge is not a stationary
    // queue. Subtract the discharge the downstream can accept before locating
    // the tail; otherwise equal-rate flow falsely compresses on every tick.
    const downstream = getEquipment(runtime, zone.downstreamControlEquipmentId);
    const downstreamIndex = runtime.equipment.indexOf(downstream);
    const canDischarge = downstream && isAvailable(downstream) && !requiresPrime(downstream) && !activeBackupControl(downstream);
    const plannedDischarge = canDischarge ? Math.min(getRequestedFlow(downstream, runtime.run.tickSeconds),
      getDownstreamSpace(runtime, downstreamIndex), zone.conveyorSpeedMmPerSecond / zone.accumulatedPitchMm * runtime.run.tickSeconds) : 0;
    let stationaryQueueUnits = Math.max(0, zone.waitingUnits - plannedDischarge);
    const remainingTransit = [];
    const endSecond = runtime.virtualSecond + runtime.run.tickSeconds;
    zone.transit.forEach((packet) => {
      const queueTailMm = Math.max(0, zone.usableLengthMm - stationaryQueueUnits * zone.accumulatedPitchMm);
      const queueArrival = stationaryQueueUnits > 1e-9
        ? packet.arrivesAtVirtualSecond - (zone.usableLengthMm - queueTailMm) / zone.conveyorSpeedMmPerSecond
        : packet.arrivesAtVirtualSecond;
      const arrivedFraction = Math.max(packet.arrivedFraction,
        fractionPassed(endSecond, queueArrival, packet.entryDurationSeconds));
      // Each packet represents uniform flow during its entry tick. Split a
      // crossing packet instead of rounding its whole travel to the next tick.
      // This prevents discretization from becoming a fictitious bottleneck.
      for (const sensor of zone.transportPhotoeyes) {
        const position = zone[sensor.position];
        if (position > queueTailMm && stationaryQueueUnits > 1e-9) continue;
        const fraction = fractionPassed(endSecond, packet[sensor.at], packet.entryDurationSeconds);
        const previous = packet[sensor.fraction] || 0;
        if (fraction > previous) {
          recordNormalPhotoeyePass(runtime, zone, sensor.name, (fraction - previous) * packet.initialUnits);
          packet[sensor.fraction] = fraction;
        }
      }
      const arrivals = Math.min(packet.units, Math.max(0, arrivedFraction - packet.arrivedFraction) * packet.initialUnits);
      zone.waitingUnits += arrivals;
      packet.units = Math.max(0, packet.units - arrivals);
      packet.arrivedFraction = arrivedFraction;
      stationaryQueueUnits = Math.max(0, zone.waitingUnits - plannedDischarge);
      if (packet.units > 1e-9) remainingTransit.push(packet);
    });
    zone.transit = remainingTransit;
    updateZonePhotoeyes(runtime, zone);
  });
}

function fractionPassed(second, start, duration) {
  return duration===0 ? Number(second+1e-8>=start) : Math.max(0, Math.min(1, (second - start) / duration));
}

function delayTransitPacket(packet, tickSeconds) {
  if (packet.backupAtVirtualSecond !== null) packet.backupAtVirtualSecond += tickSeconds;
  if (packet.primeAtVirtualSecond !== null) packet.primeAtVirtualSecond += tickSeconds;
  packet.arrivesAtVirtualSecond += tickSeconds;
}

function updateZonePhotoeyes(runtime, zone) {
  updatePrimeSensorSignal(runtime, zone);
  updateBackupSensor(runtime, zone);
}

function updatePrimeSensorSignal(runtime, zone) {
  if (!zone.hasPrimeSensor) return;
  const queueCoversPrime = zone.discreteItems?zone.physicalPrimeReady:zone.waitingUnits + 1e-8 >= zone.primeTriggerWaitingUnits;
  if (queueCoversPrime) triggerPrimeSensor(runtime, zone);
  zone.primeSignalState = queueCoversPrime
    ? 'BLOCKED'
    : isNormalPulseActive(zone.primePulseUntilVirtualSecond, runtime.virtualSecond)
      ? 'PULSING'
      : 'CLEAR';
}

function recordNormalPhotoeyePass(runtime, zone, sensor, units) {
  const duration = sensorBlockedDurationSeconds(zone, units);
  const fields = PHOTOEYE_FIELDS[sensor];
  zone[fields.units] += units;
  zone[fields.last] = runtime.virtualSecond;
  if (!(duration > 0)) return;
  const untilField = fields.pulse;
  zone[untilField] = Math.max(runtime.virtualSecond, zone[untilField] || 0) + duration;
}

function sensorBlockedDurationSeconds(zone, units) {
  return isFiniteNumber(zone.packagePassSensorSeconds) && units > 0
    ? zone.packagePassSensorSeconds * units
    : 0;
}

function isNormalPulseActive(pulseUntilVirtualSecond, virtualSecond) {
  return isFiniteNumber(pulseUntilVirtualSecond) && pulseUntilVirtualSecond > virtualSecond;
}

function triggerPrimeSensor(runtime, zone) {
  if (zone.primeDetected) return;
  const downstream = getEquipment(runtime, zone.downstreamControlEquipmentId);
  if (!downstream || !isAvailable(downstream) || activeBackupControl(downstream) ||
      !isTransportAvailable(getEquipment(runtime, zone.ownerEquipmentId))) return;
  zone.primeDetected = true;
  zone.primeDetectedAtVirtualSecond = runtime.virtualSecond;
  zone.primeTriggerCount += 1;
  downstream.primeStartAuthorized = true;
  const pending = downstream.primeStartRequest;
  downstream.primeStartRequest = null;
  if (!pending?.resume || downstream.repairRestartPending) {
    requestEquipmentStart(runtime, downstream, pending?.reason ?? 'PRIME_SENSOR', {
      ...(pending?.options ?? {rampUpSeconds: zone.downstreamRampUpSeconds}),
      primeAuthorized: true
    });
  }
  runtime.events.push({
    type: 'PRIME_SENSOR_TRIGGERED',
    atVirtualSecond: runtime.virtualSecond,
    zoneId: zone.id,
    downstreamEquipmentId: zone.downstreamControlEquipmentId,
    sensorPositionMm: zone.primeSensorPositionMm
  });
}

function updateBackupSensor(runtime,zone){
  updateBackupSensorSegment(runtime,zone,runtime.run.tickSeconds,
    isNormalPulseActive(zone.backupPulseUntilVirtualSecond,runtime.virtualSecond),runtime.virtualSecond);
}

function updateBackupSensorSegment(runtime, zone, seconds, occupied, atSecond) {
  if (!zone.hasBackupSensor) return;
  const queueCoversBackup = !zone.discreteItems&&zone.waitingUnits >= zone.backupTriggerWaitingUnits;
  const signalState=queueCoversBackup?'BLOCKED':occupied?'PULSING':'CLEAR';
  zone.backupSignalState = signalState;
  recordBackupSignalDuration(zone, signalState, seconds);

  // Complete packages obstruct the same physical photoeye as an accumulated queue.
  // A long passing product must also satisfy the blocked-delay timer.
  if (!zone.backupActive && (signalState === 'BLOCKED' || zone.discreteItems && signalState === 'PULSING')) {
    zone.backupBlockedCandidateSeconds += seconds;
    if (zone.backupBlockedCandidateSeconds+1e-8 < zone.blockedTimeDelaySeconds) return;
    zone.backupActive = true;
    zone.backupBlockedCandidateSeconds = 0;
    zone.backupClearCandidateSeconds = 0;
    zone.backupTriggeredAtVirtualSecond = atSecond;
    zone.backupTriggerCount += 1;
    const upstream = getEquipment(runtime, zone.upstreamControlEquipmentId);
    if (upstream) {
      upstream.backupControl = {
        zoneId: zone.id,
        active: true,
        responseRemainingSeconds: zone.upstreamStopResponseSeconds,
        // CAT L21/L52 stores native packages, including cases. The
        // residence inventory is already in output-package equivalents.
        residualRemainingUnits: upstream.residence
          ? Math.min(Math.floor(zone.bottlesDischargedAtStop),Math.floor(upstream.residence.inventory+1e-8))
          : zone.bottlesDischargedAtStop
      };
    }
    runtime.events.push({
      type: 'BACKUP_SENSOR_BLOCKED',
      atVirtualSecond: atSecond,
      zoneId: zone.id,
      upstreamEquipmentId: zone.upstreamControlEquipmentId,
      waitingUnits: round(zone.waitingUnits),
    queueLengthMm: round(zone.waitingUnits * zone.accumulatedPitchMm),
    queueTailPositionMm: round(Math.max(0, zone.usableLengthMm - zone.waitingUnits * zone.accumulatedPitchMm)),
      thresholdUnits: round(zone.backupTriggerWaitingUnits)
    });
    return;
  }

  if (!zone.backupActive) {
    zone.backupBlockedCandidateSeconds = 0;
    return;
  }

  // The signal must stay continuously clear. A passing package restarts the
  // clear timer instead of releasing an upstream stop from one normal gap.
  if (zone.backupActive && signalState === 'CLEAR' && (zone.discreteItems||zone.waitingUnits<=zone.backupRestartWaitingUnits)) {
    zone.backupClearCandidateSeconds += seconds;
    if (zone.backupClearCandidateSeconds+1e-8 < zone.clearTimeDelaySeconds) return;
    zone.backupActive = false;
    zone.backupClearCandidateSeconds = 0;
    zone.backupBlockedCandidateSeconds = 0;
    const upstream = getEquipment(runtime, zone.upstreamControlEquipmentId);
    if (upstream && upstream.backupControl?.zoneId === zone.id) {
      const completedBackupStop = (upstream.residence||upstream.backupControl.responseRemainingSeconds <= 0) &&
        upstream.backupControl.residualRemainingUnits <= 0;
      upstream.backupControl.active = false;
      upstream.backupControl = null;
      if (completedBackupStop && isOperationalMode(upstream) && !upstream.emergencyStopLatched) {
        requestEquipmentStart(runtime, upstream, 'BACKUP_SENSOR_CLEAR', {
          delaySeconds: zone.upstreamRestartDelaySeconds,
          rampUpSeconds: zone.upstreamRestartRampUpSeconds
        });
      }
    }
    runtime.events.push({
      type: 'BACKUP_SENSOR_CLEARED',
      atVirtualSecond: atSecond,
      zoneId: zone.id,
      upstreamEquipmentId: zone.upstreamControlEquipmentId,
      waitingUnits: round(zone.waitingUnits),
    queueLengthMm: round(zone.waitingUnits * zone.accumulatedPitchMm),
    queueTailPositionMm: round(Math.max(0, zone.usableLengthMm - zone.waitingUnits * zone.accumulatedPitchMm)),
      restartThresholdUnits: round(zone.backupRestartWaitingUnits)
    });
    return;
  }

  zone.backupClearCandidateSeconds = 0;
}

function recordBackupSignalDuration(zone, signalState, tickSeconds) {
  if (signalState === 'BLOCKED') zone.backupSignalBlockedSeconds += tickSeconds;
  else if (signalState === 'PULSING') zone.backupSignalPulsingSeconds += tickSeconds;
  else zone.backupSignalClearSeconds += tickSeconds;
}

function advanceEquipmentControlTimers(runtime) {
  runtime.equipment.forEach((equipment) => {
    const control = equipment.backupControl;
    if (control?.active && control.responseRemainingSeconds > 0) {
      control.responseRemainingSeconds = Math.max(0, control.responseRemainingSeconds - runtime.run.tickSeconds);
      if (control.responseRemainingSeconds === 0) {
        runtime.events.push({
          type: 'BACKUP_STOP_RESPONSE_COMPLETED',
          atVirtualSecond: runtime.virtualSecond,
          equipmentId: equipment.id,
          zoneId: control.zoneId
        });
      }
    }

    advanceEquipmentStart(runtime, equipment);
  });
}

// Charge only actual physical loss; unfulfilled quota is a restart purge.
function recordMacroScrap(equipment,units){
  const s=equipment.macroScrap,bottles=Math.round(units*(equipment.outputBottleFactor||1));
  s.actualBottles+=bottles;s.pendingBottles-=bottles;s.nativeEquivalent+=units;
}
function chargeMacroStopScrap(equipment,stopClass){
  const s=equipment.macroScrap,r=equipment.residence;
  if(!s||!r||!['MAJOR','GENERAL'].includes(stopClass))return;
  const count=equipment.processData.equipment.macroStopScrapBottles;
  if(!(count>0))return;
  s.requestedBottles+=count;s.pendingBottles+=count;s.stopCount++;
  const ratio=equipment.inputPerOutput||1,inputFactor=(equipment.outputBottleFactor||1)/ratio;
  const remove=Math.min(Math.round(r.inventory*ratio),Math.floor(s.pendingBottles/inputFactor))/ratio;
  if(!(remove>0))return;
  let remaining=remove;
  const ready=Math.min(r.ready,remaining);
  r.ready=Math.round(Math.max(0,r.ready-ready)*ratio)/ratio;
  remaining-=ready;
  while(remaining>1e-8&&r.head<r.queue.length){
    const entry=r.queue[r.head],taken=Math.min(entry.amount,remaining);
    entry.amount-=taken;remaining-=taken;
    if(entry.amount<1e-8)r.head++;
  }
  r.inventory=Math.round(Math.max(0,r.inventory-remove)*ratio)/ratio;
  equipment.packageRemainder=0;
  const control=activeBackupControl(equipment);
  if(control)control.residualRemainingUnits=Math.min(control.residualRemainingUnits,Math.floor(r.inventory+1e-8));
  recordMacroScrap(equipment,remove);
}
function rejectMacroScrapAdmission(equipment,admission){
  const s=equipment.macroScrap;
  if(!s||s.pendingBottles<=0)return admission;
  const ratio=equipment.inputPerOutput||1,inputFactor=(equipment.outputBottleFactor||1)/ratio;
  const rejected=Math.min(Math.round(admission*ratio),Math.floor(s.pendingBottles/inputFactor))/ratio;
  if(rejected>0)recordMacroScrap(equipment,rejected);
  return Math.round((admission-rejected)*ratio)/ratio;
}
function macroScrapMetrics(equipment){
  const s=equipment.macroScrap;
  return s?{macroStopScrapBottles:s.actualBottles,macroStopScrapRequestedBottles:s.requestedBottles,
    macroStopScrapPendingBottles:s.pendingBottles,macroStopScrapEvents:s.stopCount,
    macroStopScrapNativeEquivalent:round(s.nativeEquivalent)}:{};
}
function totalMacroScrap(runtime,key='actualBottles'){
  return sum(runtime.equipment.map(item=>item.macroScrap?.[key]||0));
}

function updateReliabilityFailures(runtime) {
  if (runtime.run.reliabilityEnabled === false) return;
  runtime.equipment.forEach((equipment) => {
    if (equipment.emergencyStopLatched) return;
    const profile = equipment.stopReliability;
    if (!profile) return;

    if (equipment.failureRemainingSeconds > 0) {
      equipment.failureRemainingSeconds = Math.max(0, equipment.failureRemainingSeconds - runtime.run.tickSeconds);
      if(equipment.failureRemainingSeconds<=1e-8)equipment.failureRemainingSeconds=0;
      if (equipment.failureRemainingSeconds === 0) {
        // Confirmed plant convention: MTTR ends when repair is finished.
        // Recovery has no extra startup delay; repair ramps are explicitly opt-in.
        cancelEquipmentStart(equipment);
        equipment.repairRestartPending = true;
        equipment.repairStopClass=equipment.activeStopClass;
        closeFailureEpisode(equipment.failureHistory,runtime.virtualSecond);
        runtime.events.push({ type: 'REPAIR_COMPLETED', atVirtualSecond: runtime.virtualSecond, equipmentId: equipment.id, stopClass:equipment.activeStopClass });
        equipment.activeStopClass=null;
        equipment.failureTargetSeconds=equipment.timeToFailureRemainingSeconds=randomExponentialSeconds(equipment.failureRandom,profile.mtbfMinutes*60);
      }
      return;
    }

    if (!isOperationalMode(equipment) || equipment.microStopRemainingSeconds > 0) return;
    if (equipment.timeToFailureRemainingSeconds === null) {
      equipment.failureTargetSeconds=equipment.timeToFailureRemainingSeconds=randomExponentialSeconds(equipment.failureRandom,profile.mtbfMinutes*60);
    }
    // Exposure is consumed during productive service ticks, not AUTO/idle time.
    // A threshold crossed in the previous productive tick fails at this tick boundary.
    if (equipment.timeToFailureRemainingSeconds > 1e-8) return;

    const category=selectReliabilityStop(profile,equipment.stopClassRandom);
    equipment.activeStopClass=category.stopClass;
    equipment.failureRemainingSeconds = category.mttrMinutes * 60;
    equipment[category.stopClass.toLowerCase()+'FailureCount']+=1;
    equipment.failureCount += 1;
    chargeMacroStopScrap(equipment,category.stopClass);
    startFailureEpisode(equipment.failureHistory,runtime.virtualSecond,category.stopClass,equipment.failureRemainingSeconds,equipment.failureTargetSeconds,equipment.reliabilityChargedSeconds);
    runtime.events.push({
      type: 'FAILURE_STARTED',
      atVirtualSecond: runtime.virtualSecond,
      equipmentId: equipment.id,
      durationSeconds: equipment.failureRemainingSeconds,
      mtbfMinutes: category.mtbfMinutes??profile.mtbfMinutes,
      mttrMinutes: category.mttrMinutes,
      stopClass:category.stopClass
    });
  });
}

function applyDueCommands(runtime) {
  while (runtime.commandIndex < runtime.commands.length) {
    const command = runtime.commands[runtime.commandIndex];
    if (command.atVirtualSecond > runtime.virtualSecond) return;
    const equipment = getEquipment(runtime, command.equipmentId);
    if (equipment && isSupportedAction(command.action)) {
      applyCommand(runtime, equipment, command.action);
    }
    runtime.commandIndex += 1;
  }
}

function updatePlantCalendar(runtime, countTick=true) {
  const now=runtime.virtualSecond;
  if(runtime.calendarActive && now>=runtime.calendarActive.endSeconds){
    runtime.events.push({type:'PLANT_STOP_ENDED',atVirtualSecond:now,category:runtime.calendarActive.category});
    const target=runtime.calendarActive.targetProductId;
    if(target&&runtime.product&&target!==runtime.product.id)switchRuntimeProduct(runtime,target);
    runtime.calendarActive=null;
    runtime.equipment.forEach(e=>{e.calendarStopped=false;});
    runtime.equipment.forEach(e=>{
      if(runtime.calendarActivePolicy==='RESTART')requestEquipmentStart(runtime,e,'PLANT_CALENDAR_RESTART');
      else resumeAfterPrime(runtime,e);
    });
  }
  const next=runtime.calendar.events[runtime.calendarIndex];
  if(!runtime.calendarActive&&next&&now>=next.startSeconds){
    runtime.calendarIndex++;runtime.calendarActive=next;runtime.calendarActivePolicy=next.restartPolicy||runtime.calendar.restartPolicy;
    runtime.equipment.forEach(e=>{e.calendarStopped=true;if(runtime.calendarActivePolicy==='RESTART')cancelEquipmentStart(e);});
    runtime.events.push({type:'PLANT_STOP_STARTED',atVirtualSecond:now,category:next.category,untilVirtualSecond:next.endSeconds});
  }
  if(runtime.calendarActive&&countTick)runtime.calendarStopSeconds+=runtime.run.tickSeconds;
}

function applyCommand(runtime, equipment, action) {
  if (action === 'EMERGENCY_STOP') {
    equipment.emergencyStopLatched = true;
    equipment.mode = 'STOP';
    cancelEquipmentStart(equipment);
    runtime.events.push({ type: 'EMERGENCY_STOP_APPLIED', atVirtualSecond: runtime.virtualSecond, equipmentId: equipment.id });
    return;
  }

  if (action === 'RESET') {
    if (!equipment.emergencyStopLatched) {
      runtime.events.push({ type: 'COMMAND_REJECTED', atVirtualSecond: runtime.virtualSecond, equipmentId: equipment.id, action, reason: 'NO_EMERGENCY_STOP_TO_RESET' });
      return;
    }
    equipment.emergencyStopLatched = false;
    equipment.mode = 'STOP';
    cancelEquipmentStart(equipment);
    runtime.events.push({ type: 'EMERGENCY_STOP_RESET', atVirtualSecond: runtime.virtualSecond, equipmentId: equipment.id });
    return;
  }

  if (equipment.emergencyStopLatched) {
    runtime.events.push({ type: 'COMMAND_REJECTED', atVirtualSecond: runtime.virtualSecond, equipmentId: equipment.id, action, reason: 'EMERGENCY_STOP_LATCHED' });
    return;
  }

  const wasOperational = isOperationalMode(equipment);
  equipment.mode = action === 'RUN' ? 'AUTO' : action;
  if (!isOperationalMode(equipment)) cancelEquipmentStart(equipment);
  runtime.events.push({ type: 'COMMAND_APPLIED', atVirtualSecond: runtime.virtualSecond, equipmentId: equipment.id, action });

  if (isOperationalMode(equipment) && !wasOperational) {
    requestEquipmentStart(runtime, equipment, 'COMMAND_' + action);
  }
}

function updateMicroStops(runtime) {
  runtime.equipment.forEach((equipment) => {
    if (equipment.emergencyStopLatched) return;
    if (equipment.failureRemainingSeconds > 0) return;
    if (equipment.microStopRemainingSeconds > 0) {
      equipment.microStopRemainingSeconds = Math.max(0, equipment.microStopRemainingSeconds - runtime.run.tickSeconds);
      if (equipment.microStopRemainingSeconds === 0) resumeAfterPrime(runtime, equipment);
      return;
    }
    if (equipment.mode !== 'AUTO') return;
    const profile = equipment.noiseProfile?.microStop;
    if (!profile) return;
    const probability = (profile.probabilityPerMinute || 0) * runtime.run.tickSeconds / 60;
    if (equipment.microStopRandom.next() < probability) {
      equipment.microStopRemainingSeconds = randomDuration(equipment.microStopDurationRandom, profile);
      runtime.events.push({ type: 'MICRO_STOP_STARTED', atVirtualSecond: runtime.virtualSecond, equipmentId: equipment.id, durationSeconds: equipment.microStopRemainingSeconds });
    }
  });
}

function processLineFromDownstream(runtime) {
  for (let index = runtime.equipment.length - 1; index >= 0; index -= 1) {
    processEquipment(runtime, index);
  }
}

// Apply pending repair recovery, then observe the existing phase flow counters.
function processEquipment(runtime, index) {
  const equipment=runtime.equipment[index];
  if(equipment.repairRestartPending&&!equipment.primeStartRequest)requestEquipmentStart(runtime,equipment,'REPAIR_COMPLETED');
  const control=activeBackupControl(equipment);
  const eligible=isAvailable(equipment)&&!equipment.calendarStopped&&!requiresPrime(equipment)&&!isStartDelayed(equipment);
  const phase=eligible&&control&&(control.responseRemainingSeconds>0||control.residualRemainingUnits>0)?'stopTransition':eligible&&!control&&isRampingUp(equipment)?'startRamp':null;
  const before=equipment.outputCount;
  processEquipmentFlow(runtime,index);
  const flow=equipment.outputCount-before;
  if(equipment.availabilityState==='STARVED'&&equipment.primeZoneId&&
    !(equipment.residence?.inventory>1e-8)&&runtime.zones[index-1]?.waitingUnits<=1e-8){
    rearmPrime(runtime,equipment);
  }
  if(['RUNNING','RAMPING_UP','BACKUP_STOPPING'].includes(equipment.availabilityState)){
    // Full productive ticks, not output/nominal equivalent time: partial flow and
    // productive ramps still consume operating time. No-flow states consume none.
    equipment.reliabilityExposureSeconds+=runtime.run.tickSeconds;
    if(runtime.run.reliabilityEnabled!==false&&equipment.stopReliability&&equipment.timeToFailureRemainingSeconds!==null){
      equipment.timeToFailureRemainingSeconds-=runtime.run.tickSeconds;
      equipment.reliabilityChargedSeconds+=runtime.run.tickSeconds;
    }
  }
  if(!phase)return;
  equipment[phase+'Seconds']+=runtime.run.tickSeconds;
  equipment[phase+'OutputUnits']+=flow;
  const unit=String(equipment.nativeOutputUnit||equipment.unitOfFlow||runtime.unitOfFlow||'').toUpperCase();
  const factor=runtime.product?equipment.outputBottleFactor:['BOTTLE','BOTTLES'].includes(unit)?1:null;
  if(factor>0&&equipment[phase+'BottleEquivalents']!==null)equipment[phase+'BottleEquivalents']+=flow*factor;
  else equipment[phase+'BottleEquivalents']=null;
  if(phase==='startRamp'&&equipment.lastAccountedStartSequenceId!==equipment.startSequenceId){equipment.startRampCount++;equipment.lastAccountedStartSequenceId=equipment.startSequenceId;}
  if(phase==='stopTransition'&&equipment.lastAccountedStopControl!==control){equipment.stopTransitionCount++;equipment.lastAccountedStopControl=control;}
}

function processEquipmentFlow(runtime, index) {
  const equipment = runtime.equipment[index];
  const tickSeconds = runtime.run.tickSeconds;
  equipment.discreteResidentStep=Boolean(runtime.run.discretePackages&&equipment.residence);
  if (!isAvailable(equipment)) {
    recordUnavailable(equipment, tickSeconds);
    return;
  }

  if(runtime.run.discretePackages&&isConveyorEquipment(equipment)&&runtime.zones[index]?.physicalModelEnabled){
    const occupied=getZoneInventory(runtime.zones[index])>0;
    equipment.actualRatePerSecond=0;
    equipment.availabilityState=occupied?'RUNNING':'STARVED';
    if(occupied){equipment.runningSeconds+=tickSeconds;equipment.runningDesignOutput+=(equipment.nominalRatePerSecond*tickSeconds);}
    else equipment.starvedSeconds+=tickSeconds;
    return;
  }
  if (requiresPrime(equipment)) {
    equipment.actualRatePerSecond = 0;
    equipment.waitingForPrimeSeconds += tickSeconds;
    equipment.availabilityState = 'WAITING_FOR_PRIME';
    return;
  }

  const control = activeBackupControl(equipment);
  if (control && (equipment.residence||control.responseRemainingSeconds <= 0) && control.residualRemainingUnits <= 0) {
    equipment.actualRatePerSecond = 0;
    equipment.backupStopSeconds += tickSeconds;
    equipment.availabilityState = 'BACKUP_STOP';
    return;
  }

  if (isStartDelayed(equipment)) {
    equipment.actualRatePerSecond = 0;
    equipment.availabilityState = 'STARTING';
    return;
  }

  const residualDischarge = Boolean(control && control.responseRemainingSeconds <= 0 && control.residualRemainingUnits > 0);
  const residence=equipment.residence;
  const bottleFactor=equipment.outputBottleFactor||1;
  const ratio=equipment.inputPerOutput||1;
  const capacity=residence?equipmentCapacityBottles(equipment)/bottleFactor:0;
  const residenceSeconds=residence?estimateResidence(equipment):0;
  const normalRequest=getRequestedFlow(equipment,tickSeconds);
  const requestedFlow = residualDischarge
    ? Math.min(equipment.nominalRatePerSecond*tickSeconds,control.residualRemainingUnits)
    : residence&&control ? Math.min(normalRequest,control.residualRemainingUnits) : normalRequest;

  if (requestedFlow <= 0) {
    equipment.actualRatePerSecond = 0;
    equipment.availabilityState = 'RAMPING_UP';
    return;
  }

  const incomingZone = runtime.zones[index - 1];
  let inputAvailable = index === 0 ? requestedFlow : Math.min(incomingZone.waitingUnits,
    incomingZone.physicalModelEnabled ? (isTransportAvailable(getEquipment(runtime, incomingZone.ownerEquipmentId))
      ? incomingZone.conveyorSpeedMmPerSecond / incomingZone.accumulatedPitchMm * tickSeconds : 0) : Infinity) / ratio;
  const downstreamSpace = getDownstreamSpace(runtime, index);
  let flow = Math.max(0, Math.min(requestedFlow, inputAvailable, residualDischarge ? requestedFlow : downstreamSpace));
  let entries;
  let outletWork=false,blockedOutlet=false,admissionWork=false;
  if(residence){
    residence.clock+=tickSeconds;
    // Position mode: move finite physical pockets with the machine's actual
    // attainable rate; a pocket cannot discharge before a full revolution.
    if(equipment.processData?.equipment?.occupancyMode==='POSITIONS')
      residence.positionClock+=Math.max(0,Math.min(requestedFlow,downstreamSpace));
    while(residence.head<residence.queue.length
      &&residence.queue[residence.head].due<=residence.clock+1e-8
      &&(residence.queue[residence.head].positionDue===undefined
        ||residence.queue[residence.head].positionDue<=residence.positionClock+1e-8)){
      residence.ready+=residence.queue[residence.head++].amount;
      if(runtime.run.discretePackages)residence.ready=Math.round(residence.ready*ratio)/ratio;
    }
    if(residence.head>=1024){residence.queue.splice(0,residence.head);residence.head=0;}
    inputAvailable=residence.ready;
    flow=Math.max(0,Math.min(requestedFlow,inputAvailable,residualDischarge?requestedFlow:downstreamSpace));
  }
  const completePackages=runtime.run.discretePackages||residence&&equipment.nativeOutputUnit==='cases';
  if(completePackages){
    const transportRate=incomingZone?.physicalModelEnabled
      ? (isTransportAvailable(getEquipment(runtime,incomingZone.ownerEquipmentId))
        ? incomingZone.conveyorSpeedMmPerSecond/incomingZone.accumulatedPitchMm : 0)
      : Infinity;
    if(!residence)inputAvailable=index===0?Infinity:(transportRate>0?incomingZone.waitingUnits/ratio:0);
    const requestedPackages=residence?requestedFlow:Math.min(requestedFlow,transportRate*tickSeconds/ratio);
    const previousCredit=equipment.packageRemainder||0;
    const hasComplete=Boolean(residence&&residence.inventory>=1-1e-8);
    const service=hasComplete?previousCredit+requestedPackages:0;
    const planned=planDiscretePackages(equipment,runtime.zones[index],runtime.virtualSecond,tickSeconds,
      requestedPackages,inputAvailable,downstreamSpace,residualDischarge?control.residualRemainingUnits:undefined);
    flow=planned.count;
    entries=planned.entries;
    if(residence&&runtime.run.discretePackages){
      // A tick that finishes a package earns service even if the transfer
      // cannot yet occur. Only a ready, already completed package whose
      // attempted discharge fails is Blocked for the entire tick.
      outletWork=hasComplete&&requestedPackages>0&&previousCredit<1-1e-8;
      blockedOutlet=hasComplete&&inputAvailable>=1-1e-8&&service>=1-1e-8&&flow===0&&!outletWork;
    }
  }
  const phase=control?'STOP':isRampingUp(equipment)?'RAMP':null;
  if(flow>0&&phase){
    const phaseLoss=Math.max(0,tickSeconds-requestedFlow/equipment.nominalRatePerSecond);
    if(phase==='STOP')equipment.stopTransitionRateLossSeconds+=phaseLoss;
    else equipment.rampRateLossSeconds+=phaseLoss;
  }
  let admitted=0;
  if(residence){
    residence.ready=Math.max(0,residence.ready-flow);
    residence.inventory=Math.max(0,residence.inventory-flow);
    if(runtime.run.discretePackages){
      residence.ready=Math.round(residence.ready*ratio)/ratio;
      residence.inventory=Math.round(residence.inventory*ratio)/ratio;
    }
    if(!control){
      const free=Math.max(0,capacity-residence.inventory);
      const transport=index===0||!incomingZone.physicalModelEnabled?Infinity:
        isTransportAvailable(getEquipment(runtime,incomingZone.ownerEquipmentId))
          ? incomingZone.conveyorSpeedMmPerSecond/incomingZone.accumulatedPitchMm*tickSeconds : 0;
      const available=index===0?Infinity:(transport>0?incomingZone.waitingUnits/ratio:0);
      // Round discrete intake to a complete input package. A packer may accumulate its bottles over multiple ticks.
      let admission=Math.min(free,requestedFlow,available,transport/ratio);
      if(runtime.run.discretePackages){
        const supply=Math.min(requestedFlow*ratio,transport);
        admissionWork=supply>0&&free*ratio>=1-1e-8&&available*ratio>=1-1e-8;
        // Spend credit before limiting the retained remainder. Capping first
        // discards fractional work at every package and biases throughput by tick.
        residence.intakeCredit=(residence.intakeCredit||0)+supply;
        admission=Math.floor(Math.min(free*ratio,available*ratio,residence.intakeCredit)+1e-8)/ratio;
        residence.intakeCredit=Math.max(0,Math.min(1,residence.intakeCredit-admission*ratio));
      }
      if(admission>0){
        admitted=admission;
        const retained=rejectMacroScrapAdmission(equipment,admission);
        residence.inventory+=retained;
        if(runtime.run.discretePackages)residence.inventory=Math.round(residence.inventory*ratio)/ratio;
        if(retained>0)residence.queue.push({amount:retained,due:residence.clock+residenceSeconds,
          positionDue:equipment.processData?.equipment?.occupancyMode==='POSITIONS'
            ?residence.positionClock+capacity:undefined});
        consumeFlow(runtime,index,admission);
      }
    }
  }
  const pending=equipment.packageRemainder||0;
  const processingPackage=completePackages&&pending>1e-8&&pending<1-1e-8&&(residence?.inventory??inputAvailable)>=1;
  const workingInside=residence&&(admitted>0||residence.inventory-residence.ready>1e-8);
  const blockedPackage=completePackages&&pending>=1-1e-8&&inputAvailable>=1&&downstreamSpace<1&&flow===0;
  const working=!blockedPackage&&(processingPackage||workingInside);
  const stateInput=completePackages&&inputAvailable<1?0:inputAvailable;
  if(residence&&runtime.run.discretePackages){
    // Partial cases cannot be blocked at their output until a complete
    // package is ready. Count fractional intake and outlet service as work.
    const productive=flow>0||!blockedOutlet&&(outletWork||admissionWork||workingInside||isRampingUp(equipment));
    recordMaterialState(equipment,requestedFlow,productive?Math.max(inputAvailable,requestedFlow):0,
      blockedOutlet?0:productive?downstreamSpace:Infinity,productive?Math.max(flow,requestedFlow):0,tickSeconds,control,residualDischarge);
  }else recordMaterialState(equipment,requestedFlow,working?Math.max(inputAvailable,requestedFlow):stateInput,downstreamSpace,
    working?Math.max(flow,requestedFlow):flow,tickSeconds,control,residualDischarge);
  moveFlow(runtime, index, flow, residualDischarge, requestedFlow, inputAvailable, phase, entries);
  equipment.outputCount += flow;
  if(runtime.product)equipment.productiveNativeSeconds=(equipment.productiveNativeSeconds||0)+flow/equipment.nominalRatePerSecond;
  equipment.actualRatePerSecond = flow / tickSeconds;

  if (residualDischarge||residence&&control) {
    control.residualRemainingUnits = Math.max(0, control.residualRemainingUnits - flow);
    if(runtime.run.discretePackages&&control.residualRemainingUnits<1)control.residualRemainingUnits=0;
  }
}

function getRequestedFlow(equipment, tickSeconds) {
  if (isStartDelayed(equipment)) return 0;
  if (isRampingUp(equipment)) {
    const rampFactor = equipment.startRampDurationSeconds <= 0
      ? 1
      : Math.min(1,(equipment.startRampElapsedSeconds+(equipment.residence&&equipment.discreteResidentStep?tickSeconds/2:0)) / equipment.startRampDurationSeconds);
    return equipment.nominalRatePerSecond * tickSeconds * rampFactor;
  }
  return equipment.nominalRatePerSecond * tickSeconds;
}

function hasStartProfile(equipment) {
  return equipment.startupDelaySeconds > 0 || equipment.restartRampUpSeconds > 0;
}

function rearmPrime(runtime, equipment) {
  if (!equipment.primeZoneId) return null;
  const zone = runtime.zones.find(zone => zone.id === equipment.primeZoneId);
  if (!zone) return null;
  equipment.primeStartAuthorized = false;
  zone.primeDetected = false;
  return zone;
}

function resumeAfterPrime(runtime, equipment) {
  if (rearmPrime(runtime, equipment) && !equipment.primeStartRequest) {
    equipment.primeStartRequest = {resume: true};
  }
}

function requestEquipmentStart(runtime, equipment, reason, options = {}) {
  if (!equipment || equipment.emergencyStopLatched || !isOperationalMode(equipment)) return false;
  // Keep exactly one pending repair recovery until other stop controls permit it.
  // Prime, RUN or calendar requests may resolve the same pending restart.
  const repairRestart=equipment.repairRestartPending&&equipment.failureRemainingSeconds<=0;
  if(equipment.repairRestartPending&&!repairRestart)return false;
  if(repairRestart&&(!isAvailable(equipment)||activeBackupControl(equipment)))return false;
  if (equipment.primeZoneId && !options.primeAuthorized) {
    const zone = rearmPrime(runtime, equipment);
    if (zone) {
      equipment.primeStartRequest = {reason,options};
      updatePrimeSensorSignal(runtime, zone);
      return equipment.primeStartAuthorized;
    }
  }
  const delaySeconds = repairRestart?0:firstNonNegative(options.delaySeconds, equipment.startupDelaySeconds);
  if(repairRestart){equipment.repairRestartPending=false;equipment.repairRestartCount++;reason='REPAIR_COMPLETED';}
  const rampUpSeconds = repairRestart
    ? (equipment.processData?.downstream?.rampAfterRepair===true?firstNonNegative(equipment.restartRampUpSeconds):0)
    : firstNonNegative(options.rampUpSeconds, equipment.restartRampUpSeconds);
  equipment.startDelayRemainingSeconds = delaySeconds;
  equipment.startRampDurationSeconds = rampUpSeconds;
  equipment.startRampElapsedSeconds = 0;
  equipment.startReason = reason;
  equipment.startSequenceId+=1;
  runtime.events.push({
    type: 'EQUIPMENT_START_SEQUENCE_REQUESTED',
    atVirtualSecond: runtime.virtualSecond,
    equipmentId: equipment.id,
    reason,
    delaySeconds,
    rampUpSeconds,
    ...(repairRestart?{stopClass:equipment.repairStopClass}: {})
  });
  return true;
}

function cancelEquipmentStart(equipment) {
  equipment.startDelayRemainingSeconds = 0;
  equipment.startRampDurationSeconds = 0;
  equipment.startRampElapsedSeconds = 0;
  equipment.startReason = null;
  equipment.primeStartRequest = null;
}

function advanceEquipmentStart(runtime, equipment) {
  if (!isAvailable(equipment) || requiresPrime(equipment) || activeBackupControl(equipment) || equipment.repairRestartPending) return;
  if (isStartDelayed(equipment)) {
    equipment.startDelayRemainingSeconds = Math.max(0, equipment.startDelayRemainingSeconds - runtime.run.tickSeconds);
    return;
  }
  if (isRampingUp(equipment)&&!(equipment.discreteResidentStep&&equipment.availabilityState==='BLOCKED')) {
    equipment.startRampElapsedSeconds = Math.min(
      equipment.startRampDurationSeconds,
      equipment.startRampElapsedSeconds + runtime.run.tickSeconds
    );
  }
}

function isStartDelayed(equipment) {
  return equipment.startDelayRemainingSeconds > 0;
}

function isRampingUp(equipment) {
  return equipment.startRampElapsedSeconds+1e-8 < equipment.startRampDurationSeconds;
}

function resolveStartupDelaySeconds(equipment) {
  return firstNonNegative(
    equipment.startupDelaySeconds,
    equipment.processData?.upstream?.startupTimeSeconds
  );
}

function resolveRestartRampUpSeconds(equipment) {
  return firstNonNegative(
    equipment.restartRampUpSeconds,
    equipment.processData?.downstream?.rampUpTimeSeconds
  );
}

function firstNonNegative(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function firstFinite(...values) {
  return values.find(isFiniteNumber) ?? null;
}

function safePositiveDivide(numerator, denominator) {
  return isFiniteNumber(numerator) && numerator > 0 && isFiniteNumber(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

function safeNonNegativeDivide(numerator, denominator) {
  return isFiniteNumber(numerator) && numerator >= 0 && isFiniteNumber(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

function getDownstreamSpace(runtime, index) {
  if (index === runtime.equipment.length - 1) return Number.POSITIVE_INFINITY;
  const zone = runtime.zones[index];
  const next=runtime.equipment[index+1],physical=runtime.zones[index+1];
  // The hidden machine-to-conveyor handoff is a connection, not extra storage.
  // A machine may discharge only when the real conveyor entry can accept it.
  if(runtime.run.discretePackages&&!zone.physicalModelEnabled&&isConveyorEquipment(next)&&physical?.physicalModelEnabled){
    return isTransportAvailable(next)?getZoneEntrySpace(physical):0;
  }
  return getZoneEntrySpace(zone);
}

function consumeFlow(runtime,index,flow) {
  if(index===0)runtime.sourceInputUnits+=flow*(runtime.equipment[0].outputBottleFactor||1);
  if (index > 0) {
    const incoming=runtime.zones[index-1];
    const consumed=flow*(runtime.equipment[index].inputPerOutput||1);
    if(incoming.discreteItems){
      incoming.discreteItems.splice(0,Math.round(consumed));
      incoming.accountingPackedPairIndex=Math.max(-1,(incoming.accountingPackedPairIndex??-1)-Math.round(consumed));
      const owner=runtime.equipmentById.get(incoming.ownerEquipmentId);
      if(owner){owner.outputCount+=consumed;owner.actualRatePerSecond+=consumed/runtime.run.tickSeconds;}
    }
    incoming.waitingUnits=Math.max(0,incoming.waitingUnits-consumed);
    incoming.dischargedUnits=(incoming.dischargedUnits||0)+consumed;
  }
}
function moveFlow(runtime, index, flow, allowOverflow, requestedFlow, inputAvailable, phase, entries) {
  if(!runtime.equipment[index].residence)consumeFlow(runtime,index,flow);
  if (index === runtime.equipment.length - 1) {
    const output=flow*(runtime.equipment[index].outputBottleFactor||1);
    runtime.outputCount += output;
    if(runtime.run.discretePackages){
      const reference=runtime.product?runtime.productReferenceRate:runtime.lineReferenceRate;
      if(['RUNNING','RAMPING_UP','BACKUP_STOPPING'].includes(runtime.equipment[index].availabilityState))runtime.lineRunSeconds+=runtime.run.tickSeconds;
      if(reference>0){
        runtime.lineEffectiveRuntimeSeconds+=output/reference;
        runtime.lineRateShortfallSeconds=Math.max(0,runtime.lineRunSeconds-runtime.lineEffectiveRuntimeSeconds);
        runtime.lineRateRecoverySeconds=Math.max(0,runtime.lineEffectiveRuntimeSeconds-runtime.lineRunSeconds);
        runtime.lineRateShortfallOutputEquivalents=runtime.lineRateShortfallSeconds*reference;
        runtime.lineRateRecoveryOutputEquivalents=runtime.lineRateRecoverySeconds*reference;
      }else runtime.lineRateReferenceValid=false;
    }else if(flow>0){
      const reference=runtime.product?runtime.productReferenceRate:runtime.lineReferenceRate;
      runtime.lineRunSeconds+=runtime.run.tickSeconds;
      if(reference>0){
        const equivalent=output/reference,gap=runtime.run.tickSeconds-equivalent;
        runtime.lineEffectiveRuntimeSeconds+=equivalent;
        // Separate shortfall from above-reference discharge; do not erase either.
        runtime.lineRateShortfallSeconds+=Math.max(0,gap);
        if(gap>0){
          const factor=runtime.equipment[index].outputBottleFactor||1;
          const requestedEquivalent=Math.min(runtime.run.tickSeconds,requestedFlow*factor/reference);
          const nominalEquivalent=Math.min(runtime.run.tickSeconds,runtime.equipment[index].nominalRatePerSecond*runtime.run.tickSeconds*factor/reference);
          const phaseLoss=Math.max(0,nominalEquivalent-requestedEquivalent);
          if(phase==='RAMP')runtime.lineRateLossRampSeconds+=phaseLoss;
          if(phase==='STOP')runtime.lineRateLossStopTransitionSeconds+=phaseLoss;
          if(inputAvailable<requestedFlow)runtime.lineRateLossStarvationSeconds+=Math.max(0,requestedEquivalent-equivalent);
        }
        runtime.lineRateRecoverySeconds+=Math.max(0,-gap);
        // Convert at the active format's reference, never a whole-period average.
        runtime.lineRateShortfallOutputEquivalents+=Math.max(0,gap)*reference;
        runtime.lineRateRecoveryOutputEquivalents+=Math.max(0,-gap)*reference;
      }
      else runtime.lineRateReferenceValid=false;
    }
    if(runtime.product){const row=currentProductRow(runtime);row.outputNative+=flow;row.outputBottleEquivalents+=flow*runtime.equipment[index].outputBottleFactor;}
    return;
  }
  const next=runtime.equipment[index+1],physical=runtime.zones[index+1];
  if(runtime.run.discretePackages&&!isConveyorEquipment(runtime.equipment[index])&&isConveyorEquipment(next)&&physical?.physicalModelEnabled){
    if(flow>0)addFlowToZone(runtime,physical,flow,allowOverflow,requestedFlow>0?Array.from({length:Math.floor(flow)},()=>runtime.virtualSecond+runtime.run.tickSeconds):[]);
    return;
  }
  addFlowToZone(runtime, runtime.zones[index], flow, allowOverflow, entries);
}

function addFlowToZone(runtime, zone, flow, allowOverflow, entries) {
  const availableSpace = getZoneEntrySpace(zone);
  const accepted = Math.min(flow, runtime.run.discretePackages?Math.floor(availableSpace+1e-8):availableSpace);
  const overflow = allowOverflow ? Math.max(0, flow - accepted) : 0;

  if (accepted > 0) {
    if (zone.travelSeconds <= 0) {
      zone.waitingUnits += accepted;
      if (zone.hasBackupSensor && zone.backupSensorPositionMm <= 0) {
        recordNormalPhotoeyePass(runtime, zone, 'backup', accepted);
      }
      if (zone.hasPrimeSensor && zone.primeTravelSeconds <= 0) {
        recordNormalPhotoeyePass(runtime, zone, 'prime', accepted);
      }
    } else if(entries){
      addDiscretePackets(zone,entries.slice(0,accepted));
    } else {
      zone.transit.push({
        units: accepted,
        initialUnits: accepted,
        entryDurationSeconds: runtime.run.tickSeconds,
        arrivedFraction: 0,
        backupDetected: false,
        backupAtVirtualSecond: zone.hasBackupSensor
          ? runtime.virtualSecond + zone.backupSensorPositionMm / zone.conveyorSpeedMmPerSecond
          : null,
        primeDetected: false,
        primeAtVirtualSecond: zone.hasPrimeSensor
          ? runtime.virtualSecond + zone.primeTravelSeconds
          : null,
        arrivesAtVirtualSecond: runtime.virtualSecond + zone.travelSeconds
      });
    }
  }

  if (overflow > 0) {
    zone.overflowUnits += overflow;
    if(runtime.product)runtime.overflowBottleEquivalents+=overflow*(zone.bottleFactor||1);
    zone.overflowEvents += 1;
    runtime.events.push({
      type: 'OVERFLOW',
      atVirtualSecond: runtime.virtualSecond,
      zoneId: zone.id,
      upstreamEquipmentId: zone.upstreamControlEquipmentId,
      lostUnits: round(overflow),
      totalOverflowUnits: round(zone.overflowUnits)
    });
  }
}

export function machineDesignRatePerSecond(equipment){
  const max=equipment.processData?.equipment?.maximumSpeedBpm;
  return max>0?max/60:equipment.nominalRatePerSecond;
}

export function machineOperatingRatePerSecond(equipment){
  return isConveyorEquipment(equipment)?equipment.nominalRatePerSecond:
    Math.min(equipment.nominalRatePerSecond,machineDesignRatePerSecond(equipment));
}

function recordMaterialState(equipment, requestedFlow, inputAvailable, downstreamSpace, flow, tickSeconds, control, residualDischarge) {
  if (control && flow <= 0) equipment.backupStopSeconds += tickSeconds;

  if (flow > 0) {
    equipment.runningSeconds += tickSeconds;
    equipment.runningDesignOutput = (equipment.runningDesignOutput||0) + machineDesignRatePerSecond(equipment)*tickSeconds;
    if(runtimeProductEquipment(equipment))equipment.idealRunningNativeOutput=(equipment.idealRunningNativeOutput||0)+equipment.nominalRatePerSecond*tickSeconds;
    if (control) {
      equipment.availabilityState = control.responseRemainingSeconds > 0 || residualDischarge
        ? 'BACKUP_STOPPING'
        : 'BACKUP_STOP';
    } else if (isRampingUp(equipment)) {
      equipment.availabilityState = 'RAMPING_UP';
    } else {
      equipment.availabilityState = 'RUNNING';
    }
    if (!control) recordPartialConstraintLoss(equipment, requestedFlow, inputAvailable, downstreamSpace, tickSeconds);
    return;
  }

  equipment.actualRatePerSecond = 0;
  if (control) {
    equipment.availabilityState = control.responseRemainingSeconds > 0 || residualDischarge
      ? 'BACKUP_STOPPING'
      : 'BACKUP_STOP';
    return;
  }
  if (downstreamSpace <= 0) {
    equipment.blockedSeconds += tickSeconds;
    equipment.availabilityState = 'BLOCKED';
    return;
  }
  if (inputAvailable <= 0) {
    equipment.starvedSeconds += tickSeconds;
    equipment.availabilityState = 'STARVED';
    return;
  }
  equipment.availabilityState = 'IDLE';
}

function recordPartialConstraintLoss(equipment, requestedFlow, inputAvailable, downstreamSpace, tickSeconds) {
  if (requestedFlow <= 0) return;
  if (inputAvailable < requestedFlow && inputAvailable <= downstreamSpace) {
    equipment.partialStarvationLossSeconds += (1 - inputAvailable / requestedFlow) * tickSeconds;
  } else if (downstreamSpace < requestedFlow) {
    equipment.partialBlockingLossSeconds += (1 - downstreamSpace / requestedFlow) * tickSeconds;
  }
}

function recordUnavailable(equipment, tickSeconds) {
  equipment.actualRatePerSecond = 0;
  if (equipment.emergencyStopLatched) {
    equipment.stoppedSeconds += tickSeconds;
    equipment.emergencyStopSeconds += tickSeconds;
    equipment.availabilityState = 'EMERGENCY_STOP';
  } else if (equipment.calendarStopped) {
    equipment.stoppedSeconds += tickSeconds;
    equipment.plannedStopSeconds = (equipment.plannedStopSeconds || 0) + tickSeconds;
    equipment.availabilityState = 'PLANNED_STOP';
  } else if (equipment.failureRemainingSeconds > 0) {
    equipment.stoppedSeconds += tickSeconds;
    equipment.failureSeconds += tickSeconds;
    chargeFailureEpisode(equipment.failureHistory,tickSeconds);
    equipment[(equipment.activeStopClass||'GENERAL').toLowerCase()+'FailureSeconds']+=tickSeconds;
    equipment.availabilityState = 'FAILURE';
  } else if (equipment.microStopRemainingSeconds > 0) {
    equipment.stoppedSeconds += tickSeconds;
    equipment.microStopSeconds += tickSeconds;
    equipment.availabilityState = 'MICRO_STOP';
  } else if (equipment.mode === 'PAUSE') {
    equipment.pausedSeconds += tickSeconds;
    equipment.availabilityState = 'PAUSED';
  } else {
    equipment.stoppedSeconds += tickSeconds;
    equipment.availabilityState = 'STOPPED';
  }
}

function isTransportAvailable(equipment) {
  return equipment && isAvailable(equipment) && !isStartDelayed(equipment);
}

function isAvailable(equipment) {
  return !equipment.emergencyStopLatched && isOperationalMode(equipment) &&
    equipment.microStopRemainingSeconds <= 0 && equipment.failureRemainingSeconds <= 0;
}

function requiresPrime(equipment) {
  return equipment.primeStartAuthorized === false;
}

function activeBackupControl(equipment) {
  return equipment.backupControl?.active ? equipment.backupControl : null;
}

function getEquipment(runtime, equipmentId) {
  return runtime.equipmentById.get(equipmentId);
}

function getZoneEntrySpace(zone) {
  if(zone.discreteItems){
    const last=zone.discreteItems.at(-1);
    return !last||last.x-zone.productLengthMm/2+1e-6>=zone.productPitchMm?1:0;
  }
  const transitUnits = getTransitUnits(zone);
  const inventory = zone.waitingUnits + transitUnits;
  if (!zone.physicalModelEnabled) return Math.max(0, zone.capacityUnits - inventory);
  const occupiedLength = zone.waitingUnits * zone.accumulatedPitchMm + transitUnits * zone.productPitchMm;
  return Math.max(0, Math.min(zone.capacityUnits - inventory, (zone.usableLengthMm - occupiedLength) / zone.productPitchMm));
}

function getZoneInventory(zone) {
  return zone.waitingUnits + getTransitUnits(zone);
}

function getTransitUnits(zone) {
  // Discrete packets always contain one whole package, so the exact integer
  // count is available without summing every package again on every tick.
  if(zone.discreteItems)return zone.transit.length;
  // Keep the original addition order; incremental inventory counters would
  // accumulate different floating-point errors over long replications.
  let total = 0;
  for (let i = 0; i < zone.transit.length; i++) total += zone.transit[i].units;
  return total;
}

// Lightweight exact state timeline; full measurement samples remain bounded.
// A change is recorded only when the calculated availability state changes.
const MAX_STATE_TRANSITIONS=4000;
function recordStateTransitions(runtime){
  if(!runtime.captureStateTransitions||runtime.summaryOnly)return;
  runtime.equipment.forEach((unit,index)=>{
    const state=unit.availabilityState||unit.mode||'UNKNOWN';
    if(runtime.lastRecordedStates[index]===state)return;
    runtime.lastRecordedStates[index]=state;
    if(runtime.stateTransitions.length<MAX_STATE_TRANSITIONS)
      runtime.stateTransitions.push([round(runtime.virtualSecond),index,state]);
    else runtime.omittedStateTransitions++;
  });
}

// Live-only diagnostic snapshots. A separate, bounded 5,000-frame display
// timeline permits smooth card updates while the normal recorded history stays
// at ~1,000 frames and reports retain their original numerical definitions.
function recordLiveTelemetry(runtime) {
  if(!runtime.liveTelemetry||runtime.liveTelemetry.length>=5001)return;
  const frame={
    virtualSecond:round(runtime.virtualSecond),
    outputCount:round(runtime.outputCount),
    effectiveRuntimeSeconds:runtime.lineRateReferenceValid?round(runtime.lineRunSeconds-runtime.lineRateShortfallSeconds):null,
    runtimeLossSeconds:runtime.lineRateReferenceValid?round(runtime.lineRateShortfallSeconds):null,
    accumulationZones:runtime.zones.filter(zone=>zone.visible).map(zone=>({
      id:zone.id,ownerEquipmentId:zone.ownerEquipmentId,
      inventoryUnits:round(getZoneInventory(zone)),
      overflowUnits:round(zone.overflowUnits),
      backup:{controlActive:zone.backupActive}
    })),
    equipment:runtime.equipment.map(item=>({
      ...macroScrapMetrics(item),
      id:item.id,unitOfFlow:item.unitOfFlow,mode:item.mode,
      availabilityState:item.availabilityState,
      stateAccounting:numericalAccountingSnapshot(item,runtime.virtualSecond,false),
      processedUnits:round(item.outputCount),outputCount:round(item.outputCount),
      actualRatePerSecond:round(item.actualRatePerSecond),
      internalInventoryBottles:equipmentInventoryBottles(item),
      internalCapacityBottles:item.residence?equipmentCapacityBottles(item):undefined,
      internalInputBottleFactor:item.residence?(item.outputBottleFactor||1)/(item.inputPerOutput||1):undefined,
      internalInputUnit:item.processData?.flowUnits?.input==='CASES'?'cases':'bottles',
      designSpeedPerSecond:machineDesignRatePerSecond(item),
      estimatedResidenceSeconds:item.residence?round(estimateResidence(item)):undefined,
      failureCount:item.failureCount,backupStopSeconds:round(item.backupStopSeconds),
      oeePercent:round(createEquipmentEffectiveness(item,runtime.virtualSecond).oee*100)
    }))
  };
  frame.buffers=frame.accumulationZones.map(zone=>zone.inventoryUnits);
  const previous=runtime.liveTelemetry.at(-1);
  frame.instantaneousOutputRatePerSecond=previous&&frame.virtualSecond>previous.virtualSecond
    ?(frame.outputCount-previous.outputCount)/(frame.virtualSecond-previous.virtualSecond):0;
  runtime.liveTelemetry.push(frame);
  runtime.nextLiveTelemetryAt=runtime.virtualSecond+runtime.liveTelemetryInterval;
}

function addSampleIfDue(runtime) {
  if(runtime.summaryOnly||runtime.playbackOnly)return;
  const live=runtime.run.calculationMode==='LIVE';
  const firstProduction=live&&!runtime.recordedFirstProduction&&runtime.equipment[0]?.outputCount>0;
  if(firstProduction)runtime.recordedFirstProduction=true;
  const startup=live&&runtime.virtualSecond<=2;
  if(!firstProduction&&!startup&&runtime.virtualSecond+1e-8<runtime.nextSampleAt&&runtime.virtualSecond<runtime.run.durationSeconds)return;
  addSample(runtime);
}

function addSample(runtime) {
  if(runtime.summaryOnly)return;
  runtime.nextSampleAt=(Math.floor((runtime.virtualSecond+1e-8)/runtime.sampleInterval)+1)*runtime.sampleInterval;
  runtime.samples.push(createSample(runtime));
  resetSampleRateWindow(runtime);
}

function resetSampleRateWindow(runtime){
  runtime.historyTicks=0;runtime.equipment.forEach(item=>{item.historySum=0;item.historyMin=undefined;item.historyMax=undefined;});
}

function createSample(runtime,complete=false) {
  const visibleZones = runtime.zones.filter((zone) => zone.visible);
  return {
    virtualSecond: runtime.virtualSecond,
    productId:runtime.product?.id,
    effectiveRuntimeSeconds:runtime.lineRateReferenceValid?round(runtime.lineRunSeconds-runtime.lineRateShortfallSeconds):null,
    runtimeLossSeconds:runtime.lineRateReferenceValid?round(runtime.lineRateShortfallSeconds):null,
    outputCount: round(runtime.outputCount),
    buffers: visibleZones.map((zone) => round(getZoneInventory(zone))),
    accumulationZones: visibleZones.map(zone=>createRecordedZoneSample(runtime,zone,!complete)),
    equipment: runtime.equipment.map((item) => {
      const effectiveness = createEquipmentEffectiveness(item, runtime.virtualSecond);
      return {
        ...(complete?createEquipmentMetrics(item,runtime.virtualSecond):{stateAccounting:numericalAccountingSnapshot(item,runtime.virtualSecond,false)}),
        ...macroScrapMetrics(item),
        id: item.id,
        mode: item.mode,
        availabilityState: item.availabilityState,
        outputCount: round(item.outputCount),
        processedUnits: round(item.outputCount),
        internalInventoryBottles:equipmentInventoryBottles(item),
        internalCapacityBottles:item.residence?equipmentCapacityBottles(item):undefined,
        internalInputBottleFactor:item.residence?(item.outputBottleFactor||1)/(item.inputPerOutput||1):undefined,
        internalInputUnit:item.processData?.flowUnits?.input==='CASES'?'cases':'bottles',
        estimatedResidenceSeconds:item.residence?round(estimateResidence(item)):undefined,
        meanRatePerSecond:round(runtime.historyTicks?(item.historySum||0)/runtime.historyTicks:item.actualRatePerSecond),
        minRatePerSecond:round(item.historyMin??item.actualRatePerSecond),maxRatePerSecond:round(item.historyMax??item.actualRatePerSecond),
        actualRatePerSecond: round(item.actualRatePerSecond),
        starvedSeconds: round(item.starvedSeconds),
        blockedSeconds: round(item.blockedSeconds),
        partialStarvationLossSeconds: round(item.partialStarvationLossSeconds),
        partialBlockingLossSeconds: round(item.partialBlockingLossSeconds),
        runningSeconds: round(item.runningSeconds),
        runningDesignOutput: round(item.runningDesignOutput||0),
        designSpeedPerSecond: machineDesignRatePerSecond(item),
        microStopSeconds: round(item.microStopSeconds),
        startRampSeconds: round(item.startRampSeconds),
        stopTransitionSeconds: round(item.stopTransitionSeconds),
        failureCount: item.failureCount,
        failureSeconds: round(item.failureSeconds),
        minorFailureSeconds:round(item.minorFailureSeconds),majorFailureSeconds:round(item.majorFailureSeconds),generalFailureSeconds:round(item.generalFailureSeconds),
        emergencyStopSeconds: round(item.emergencyStopSeconds),
        waitingForPrimeSeconds: round(item.waitingForPrimeSeconds),
        backupStopSeconds: round(item.backupStopSeconds),
        oeePercent: round(effectiveness.oee * 100)
      };
    })
  };
}

function recordingCoverage(runtime){return {omittedEvents:runtime.omittedEvents,requestedSampleSeconds:runtime.run.sampleEverySeconds||runtime.run.tickSeconds,effectiveSampleSeconds:runtime.sampleInterval,maximumSamples:1001,aggregated:runtime.sampleInterval>(runtime.run.sampleEverySeconds||runtime.run.tickSeconds),recordingMode:runtime.run.calculationMode==='SUMMARY'?'SUMMARY':'BOUNDED',exactReplay:false,stateTransitionsRecorded:runtime.stateTransitions.length,stateTransitionsOmitted:runtime.omittedStateTransitions};}

function createRecordedZoneSample(runtime,zone,compact=true){
  const frame=createZoneSample(zone);
  if(zone.physicalModelEnabled){
    frame.beltRunning=isTransportAvailable(getEquipment(runtime,zone.ownerEquipmentId));
    if(runtime.run.spatialPlayback===true&&!runtime.run.discretePackages)frame.transitBands=recordTransitBands(zone,runtime.virtualSecond);
    if(runtime.run.discretePackages){
      const stride=Math.max(1,Math.ceil(zone.transit.length/256));
      frame.transitPositionsMm=[];
      for(let index=0;index<zone.transit.length;index+=stride){
        const packet=zone.transit[index];
        frame.transitPositionsMm.push(Math.round(Math.max(0,Math.min(zone.usableLengthMm,zone.dynamic?packet.x:zone.usableLengthMm+(runtime.virtualSecond-packet.arrivesAtVirtualSecond)*zone.conveyorSpeedMmPerSecond))));
      }
      frame.transitPositionsMm.reverse();
    }
    if(runtime.product)frame.packageUnit=productFlowUnit(getEquipment(runtime,zone.ownerEquipmentId));
  }
  if(compact&&runtime.run.historyFormat==='COMPACT'&&!runtime.product){
    const definition=runtime.zoneDefinitions[zone.id]||(runtime.zoneDefinitions[zone.id]={});
    for(const key of ['name','ownerEquipmentId','upstreamControlEquipmentId','downstreamControlEquipmentId','physicalModelEnabled','modelOrigin','geometrySources','formatAssumptions','geometry']){if(!definition[key])definition[key]=frame[key];delete frame[key];}
  }
  return frame;
}
// Record a bounded spatial distribution from the engine's moving packets.
function recordTransitBands(zone, time){
  if(!zone.transit.length||!(zone.usableLengthMm>0))return [];
  const bands=Array.from({length:24},()=>[0,0]);
  for(const packet of zone.transit){
    const remainingEntryOffset=packet.entryDurationSeconds*(1+packet.arrivedFraction)/2;
    const distance=Math.max(0,Math.min(zone.usableLengthMm,zone.usableLengthMm+(time-packet.arrivesAtVirtualSecond-remainingEntryOffset)*zone.conveyorSpeedMmPerSecond));
    const index=Math.max(0,Math.min(bands.length-1,Math.floor(distance/zone.usableLengthMm*bands.length)));
    bands[index][0]+=packet.units;
    bands[index][1]+=packet.units*distance;
  }
  return bands.filter(([units])=>units>0).flatMap(([units,weightedDistance])=>[round(units),Math.round(weightedDistance/units)]);
}

function createZoneSample(zone) {
  const inventoryUnits = getZoneInventory(zone);
  const nominal=zone.dynamic?.nominalSpeedMmPerSecond??zone.conveyorSpeedMmPerSecond;
  return {
    ...(zone.dynamic?{dynamicLineBalancing:dynamicBeltSnapshot(zone.dynamic)}:{}),
    id: zone.id,
    name: zone.name,
    ownerEquipmentId: zone.ownerEquipmentId,
    upstreamControlEquipmentId: zone.upstreamControlEquipmentId,
    downstreamControlEquipmentId: zone.downstreamControlEquipmentId,
    physicalModelEnabled: zone.physicalModelEnabled,
    modelOrigin: zone.modelOrigin,
    geometrySources: zone.geometrySources,
    formatAssumptions: zone.formatAssumptions,
    geometry: {
      usableLengthMm: zone.usableLengthMm,
      productPitchMm: zone.productPitchMm,
      accumulatedPitchMm: zone.accumulatedPitchMm,
      transferCapacityPerSecond: nominal / zone.productPitchMm,
      productLengthMm: zone.productLengthMm,
      gapMm: zone.gapMm,
      conveyorSpeedMmPerSecond: nominal,
      travelSeconds: round(zone.travelSeconds),
      packagePassSensorSeconds: zone.packagePassSensorSeconds,
      sensorClearGapSeconds: zone.sensorClearGapSeconds,
      sensorCycleSeconds: zone.sensorCycleSeconds,
      capacityFormula: zone.physicalModelEnabled ? 'floor(usableLengthMm / accumulatedPitchMm)' : null
    },
    inventoryUnits: round(inventoryUnits),
    waitingUnits: round(zone.waitingUnits),
    dischargedUnits: round(zone.dischargedUnits||0),
    queueLengthMm: round(zone.waitingUnits * zone.accumulatedPitchMm),
    queueTailPositionMm: round(Math.max(0, zone.usableLengthMm - zone.waitingUnits * zone.accumulatedPitchMm)),
    inTransitUnits: round(getTransitUnits(zone)),
    capacityUnits: round(zone.capacityUnits),
    fillPercent: zone.capacityUnits > 0 ? round(inventoryUnits / zone.capacityUnits * 100) : 0,
    prime: {
      configured: zone.hasPrimeSensor,
      state: zone.primeSignalState,
      latched: zone.primeDetected,
      positionMm: zone.primeSensorPositionMm,
      thresholdUnits: zone.primeTriggerWaitingUnits,
      detectedAtVirtualSecond: zone.primeDetectedAtVirtualSecond,
      triggerCount: zone.primeTriggerCount,
      passedUnits: round(zone.primePassedUnits),
      lastPassAtVirtualSecond: zone.primeLastPassAtVirtualSecond
    },
    backup: {
      configured: zone.hasBackupSensor,
      state: zone.backupSignalState,
      controlActive: zone.backupActive,
      positionMm: zone.backupSensorPositionMm,
      restartPositionMm: zone.backupRestartPositionMm,
      thresholdUnits: zone.backupTriggerWaitingUnits,
      restartThresholdUnits: zone.backupRestartWaitingUnits,
      triggerCount: zone.backupTriggerCount,
      passedUnits: round(zone.backupPassedUnits),
      blockedTimeDelaySeconds: zone.blockedTimeDelaySeconds,
      clearTimeDelaySeconds: zone.clearTimeDelaySeconds,
      blockedCandidateSeconds: round(zone.backupBlockedCandidateSeconds),
      clearCandidateSeconds: round(zone.backupClearCandidateSeconds)
    },
    overflowUnits: round(zone.overflowUnits),
    overflowEvents: zone.overflowEvents,
    state: zone.overflowUnits > 0
      ? 'OVERFLOW'
      : zone.backupActive
        ? 'BACKUP_ACTIVE'
        : inventoryUnits > 0
          ? 'FLOWING'
          : 'EMPTY'
  };
}

function createResult(runtime,partial=false) {
  const target=runtime.run.effectiveRuntimeTargetSeconds;
  const duration=target===undefined||partial?runtime.run.durationSeconds:runtime.virtualSecond;
  return {
    effectiveRuntimeStop:target===undefined?undefined:{
      targetSeconds:target,limitSeconds:runtime.run.durationSeconds,
      accumulatedSeconds:runtime.lineRateReferenceValid?round(runtime.lineRunSeconds-runtime.lineRateShortfallSeconds):null,
      status:partial?'RUNNING':effectiveRuntimeTargetReached(runtime)?'REACHED':'LIMIT_REACHED'
    },
    caseId: runtime.caseId,
    unitOfFlow: runtime.unitOfFlow,
    engineVersion: (runtime.equipment.some(item=>item.processData?.accumulation?.speedMode==='DYNAMIC')?'0.20.6-dlb2':runtime.run.dynamicLineBalancingEnabled===true?'0.20.5-dlb1':'0.20.4')+(runtime.equipment.some(item=>item.macroScrap)?'-scrap1':''),
    numerics:runtime.numerics,
    discretePackages:runtime.run.discretePackages===true||undefined,
    products: runtime.product ? {activeProductId:runtime.product.id,timeline:runtime.productTimeline,rows:Object.values(runtime.productRows).map(row=>({...row,completeCases:row.outputUnit==='CASES'?Math.floor((row.outputNative+1e-8)):null,partialCaseEquivalent:row.outputUnit==='CASES'?Math.max(0,row.outputNative-Math.floor(row.outputNative+1e-8)):null,oeePercent:row.idealBottleOutput>0?100*row.outputBottleEquivalents/row.idealBottleOutput:0})),model:runtime.run.discretePackages?'DISCRETE_PACKAGES':'CONTINUOUS_EQUIVALENT_FLOW',changeoverPolicy:'CLEAR_OUT_REMAINING_INVENTORY',clearoutBottleEquivalents:runtime.clearoutBottleEquivalents} : undefined,
    detailCoverage:recordingCoverage(runtime),
    zoneDefinitions:runtime.zoneDefinitions,
    plantCalendar: runtime.calendar.horizonSeconds ? {mode:'SCHEDULED',horizonSeconds:runtime.calendar.horizonSeconds,plannedStopSeconds:runtime.calendar.plannedStopSeconds,observedStopSeconds:runtime.calendarStopSeconds,events:runtime.calendar.events,restartPolicy:runtime.calendar.restartPolicy,completePeriod:Math.abs(duration-runtime.calendar.horizonSeconds)<runtime.run.tickSeconds+1e-8} : undefined,
    seed: runtime.run.seed,
    durationSeconds: duration,
    summary: {...createSummary(runtime),failureOverlap:summarizeFailureOverlap(runtime.equipment.map(e=>e.failureHistory),runtime.virtualSecond)},
    equipmentMetrics: Object.fromEntries(runtime.equipment.map((item) => [item.id, createEquipmentMetrics(item, duration, runtime.virtualSecond)])),
    accumulationZoneMetrics: Object.fromEntries(runtime.zones.filter((zone) => zone.visible).map((zone) => [
      zone.id,
      createZoneMetrics(zone, duration)
    ])),
    events: partial?[]:runtime.events.slice(),
    stateTransitions:runtime.stateTransitions,
    samples: runtime.samples
  };
}

function createSummary(runtime) {
  const duration=runtime.run.effectiveRuntimeTargetSeconds===undefined?runtime.run.durationSeconds:runtime.virtualSecond;
  const lineEffectiveness = createLineEffectiveness(runtime);
  const rateLoss=runtime.lineRunSeconds-runtime.lineEffectiveRuntimeSeconds;
  const validRate=runtime.lineRateReferenceValid;
  const idealOutput=runtime.product?runtime.idealBottleOutput:(lineEffectiveness.reference?.nominalRatePerSecond||0)*duration;
  const lossOutput=runtime.lineRateShortfallOutputEquivalents,recoveryOutput=runtime.lineRateRecoveryOutputEquivalents;
  const impactAvailable=validRate&&idealOutput>0;
  const scrapConfigured=runtime.equipment.some(item=>item.macroScrap),scrap=totalMacroScrap(runtime);
  return {
    ...(scrapConfigured?{totalMacroStopScrapBottles:scrap,totalMacroStopScrapRequestedBottles:totalMacroScrap(runtime,'requestedBottles'),totalMacroStopScrapPendingBottles:totalMacroScrap(runtime,'pendingBottles')}:{}),
    lineRunSeconds: round(runtime.lineRunSeconds),
    lineEffectiveRuntimeSeconds: runtime.lineRateReferenceValid?round(runtime.lineEffectiveRuntimeSeconds):null,
    lineRateLossSeconds: validRate?round(runtime.lineRateShortfallSeconds):null,
    lineRateLossStarvationSeconds:validRate?round(runtime.lineRateLossStarvationSeconds):null,
    lineRateLossRampSeconds:validRate?round(runtime.lineRateLossRampSeconds):null,
    lineRateLossStopTransitionSeconds:validRate?round(runtime.lineRateLossStopTransitionSeconds):null,
    lineRateRecoverySeconds: validRate?round(runtime.lineRateRecoverySeconds):null,
    lineNetRateBalanceSeconds: validRate?round(rateLoss):null,
    lineRateLossOutputEquivalents: validRate?round(lossOutput):null,
    lineRateRecoveryOutputEquivalents: validRate?round(recoveryOutput):null,
    lineNetRateBalanceOutputEquivalents: validRate?round(lossOutput-recoveryOutput):null,
    lineRateLossEfficiencyPp: impactAvailable?round(100*lossOutput/idealOutput):null,
    lineRateRecoveryEfficiencyPp: impactAvailable?round(100*recoveryOutput/idealOutput):null,
    lineNetRateBalanceEfficiencyPp: impactAvailable?round(100*(lossOutput-recoveryOutput)/idealOutput):null,
    lineRateImpactDenominatorOutput: impactAvailable?round(idealOutput):null,
    lineRateImpactOutputUnit: runtime.unitOfFlow||'units',
    lineRateImpactBasis: 'ACTIVE_FORMAT_REFERENCE_OVER_FULL_SIMULATED_IDEAL_OUTPUT',
    lineRateLossBasis: 'FINAL_OUTPUT_GROSS_SHORTFALL_AND_RECOVERY_PER_FORMAT_REFERENCE',
    lineRateRecoveryInterpretation: 'Above-reference output may reflect buffer discharge. Runtime - effective runtime = gross loss - recovery; negative net balance alone does not invalidate the reference.',
    equipmentFailureTimeBasis: 'SUM_OF_OVERLAPPING_EQUIPMENT_DURATIONS_NOT_EXCLUSIVE_LINE_DOWNTIME',
    lineRateLossStatus: !validRate?'INCONSISTENT_REFERENCE':runtime.lineRateRecoverySeconds>1e-7?'ABOVE_REFERENCE_OUTPUT':'AVAILABLE',
    outputCount: round(runtime.outputCount),
    materialBalance: {
      inputUnits: round(runtime.sourceInputUnits),
      outputUnits: round(runtime.outputCount),
      inventoryUnits: round(materialInventory(runtime)),
      overflowUnits: round(runtime.product?runtime.overflowBottleEquivalents:sum(runtime.zones.map(zone => zone.overflowUnits))),
      clearoutUnits: runtime.product?round(runtime.clearoutBottleEquivalents):undefined,
      ...(scrapConfigured?{scrapUnits:scrap}:{}),
      residualUnits: round(runtime.sourceInputUnits-runtime.outputCount-materialInventory(runtime)-scrap-
        (runtime.product?runtime.clearoutBottleEquivalents+runtime.overflowBottleEquivalents:sum(runtime.zones.map(zone=>zone.overflowUnits))))
    },
    averageOutputRatePerSecond: round(duration>0?runtime.outputCount / duration:0),
    totalBlockedSeconds: round(sum(runtime.equipment.map((item) => item.blockedSeconds))),
    totalStarvedSeconds: round(sum(runtime.equipment.map((item) => item.starvedSeconds))),
    totalPartialStarvationLossSeconds: round(sum(runtime.equipment.map((item) => item.partialStarvationLossSeconds))),
    totalPartialBlockingLossSeconds: round(sum(runtime.equipment.map((item) => item.partialBlockingLossSeconds))),
    totalFailureSeconds: round(sum(runtime.equipment.map((item) => item.failureSeconds))),
    totalMinorFailureSeconds:round(sum(runtime.equipment.map(item=>item.minorFailureSeconds))),
    totalMajorFailureSeconds:round(sum(runtime.equipment.map(item=>item.majorFailureSeconds))),
    totalGeneralFailureSeconds:round(sum(runtime.equipment.map(item=>item.generalFailureSeconds))),
    totalEmergencyStopSeconds: round(sum(runtime.equipment.map((item) => item.emergencyStopSeconds))),
    totalBackupStopSeconds: round(sum(runtime.equipment.map((item) => item.backupStopSeconds))),
    totalWaitingForPrimeSeconds: round(sum(runtime.equipment.map((item) => item.waitingForPrimeSeconds))),
    totalOverflowUnits: round(runtime.product?runtime.overflowBottleEquivalents:sum(runtime.zones.map((zone) => zone.overflowUnits))),
    lineOeePercent: round(lineEffectiveness.oee * 100),
    lineOeePacemakerEquipmentId: lineEffectiveness.reference?.id || null,
    lineOeePacemakerName: lineEffectiveness.reference?.name || null,
    lineOeePacemakerRatePerSecond: runtime.product ? duration>0?runtime.idealBottleOutput/duration:null : lineEffectiveness.reference?.nominalRatePerSecond || null,
    lineOeeReference: runtime.product?'PRODUCT_WEIGHTED_IDEAL_OUTPUT':lineEffectiveness.referenceMethod,
    idealBottleOutput:runtime.product?runtime.idealBottleOutput:undefined,
    repairRestartPolicy: 'MTTR_STOP_TO_REPAIR_END_REPAIR_RAMP_OPT_IN',
    reliabilityClockBasis: 'PRODUCTIVE_STATE_TICKS',
    qualityAssumption: scrapConfigured?'MACROSTOP_SCRAP_ONLY_OTHER_REJECTS_NOT_MODELED':'NO_REJECT_MODEL_ASSUMES_100_PERCENT'
  };
}

function equipmentCapacityBottles(equipment) {
  // The persisted legacy field stores incoming units; the engine balances bottle equivalents.
  const factor=(equipment.outputBottleFactor||1)/(equipment.inputPerOutput||1);
  return (equipment.processData?.equipment?.internalCapacityBottles??Math.max(30,equipment.inputPerOutput||1))*factor;
}
function estimateResidence(equipment) {
  return equipment.processData?.equipment?.residenceTimeSeconds??0;
}
function equipmentInventoryBottles(equipment) {
  return equipment.residence?round(equipment.residence.inventory*(equipment.outputBottleFactor||1)):undefined;
}
function materialInventory(runtime) {
  return sum(runtime.zones.map(zone=>getZoneInventory(zone)*(zone.bottleFactor||1)))+
    sum(runtime.equipment.map(item=>(item.residence?.inventory||0)*(item.outputBottleFactor||1)));
}
function createEquipmentMetrics(equipment, durationSeconds, accountingElapsedSeconds=durationSeconds) {
  const effectiveness = createEquipmentEffectiveness(equipment, durationSeconds);
  return {
    ...macroScrapMetrics(equipment),
    internalInventoryBottles:equipmentInventoryBottles(equipment),
    internalCapacityBottles:equipment.residence?equipmentCapacityBottles(equipment):undefined,
    internalInputBottleFactor:equipment.residence?(equipment.outputBottleFactor||1)/(equipment.inputPerOutput||1):undefined,
    internalInputUnit:equipment.processData?.flowUnits?.input==='CASES'?'cases':'bottles',
    estimatedResidenceSeconds:equipment.residence?round(estimateResidence(equipment)):undefined,
    stateAccounting:numericalAccountingSnapshot(equipment,accountingElapsedSeconds),
    reliabilityClockBasis: 'PRODUCTIVE_STATE_TICKS',
    reliabilityChargedSeconds: round(equipment.reliabilityChargedSeconds),
    reliabilityExposureSeconds: round(equipment.reliabilityExposureSeconds),
    startRampSeconds: round(equipment.startRampSeconds),
    startRampOutputUnits: round(equipment.startRampOutputUnits),
    startRampBottleEquivalents: equipment.startRampBottleEquivalents===null?null:round(equipment.startRampBottleEquivalents),
    startRampCount: equipment.startRampCount,
    repairRestartCount: equipment.repairRestartCount,
    repairRampEnabled: equipment.processData?.downstream?.rampAfterRepair===true,
    stopTransitionSeconds: round(equipment.stopTransitionSeconds),
    stopTransitionOutputUnits: round(equipment.stopTransitionOutputUnits),
    stopTransitionBottleEquivalents: equipment.stopTransitionBottleEquivalents===null?null:round(equipment.stopTransitionBottleEquivalents),
    stopTransitionCount: equipment.stopTransitionCount,
    outputCount: round(equipment.outputCount),
    unitOfFlow:equipment.nativeOutputUnit||equipment.unitOfFlow,
    stateSeconds: Object.fromEntries(Object.entries(equipment.stateSeconds).map(([state, seconds]) => [state, round(seconds)])),
    runningSeconds: round(equipment.runningSeconds),
    runningDesignOutput: round(equipment.runningDesignOutput||0),
    designSpeedPerSecond: machineDesignRatePerSecond(equipment),
    productiveEquivalentSeconds: round(equipment.productiveNativeSeconds ?? (equipment.outputCount / equipment.nominalRatePerSecond)),
    processingCapacityPercent: round(100 * equipment.outputCount / (equipment.idealNativeOutput ?? (equipment.nominalRatePerSecond * durationSeconds))),
    pausedSeconds: round(equipment.pausedSeconds),
    stoppedSeconds: round(equipment.stoppedSeconds),
    failureSeconds: round(equipment.failureSeconds),
    failureCount: equipment.failureCount,
    failureHistory:snapshotFailureHistory(equipment.failureHistory),
    minorFailureCount:equipment.minorFailureCount,majorFailureCount:equipment.majorFailureCount,generalFailureCount:equipment.generalFailureCount,
    minorFailureSeconds:round(equipment.minorFailureSeconds),majorFailureSeconds:round(equipment.majorFailureSeconds),generalFailureSeconds:round(equipment.generalFailureSeconds),
    plannedStopSeconds: round(equipment.plannedStopSeconds||0),
    microStopSeconds: round(equipment.microStopSeconds),
    emergencyStopSeconds: round(equipment.emergencyStopSeconds),
    starvedSeconds: round(equipment.starvedSeconds),
    blockedSeconds: round(equipment.blockedSeconds),
    rampRateLossSeconds:round(equipment.rampRateLossSeconds),
    stopTransitionRateLossSeconds:round(equipment.stopTransitionRateLossSeconds),
    partialStarvationLossSeconds: round(equipment.partialStarvationLossSeconds),
    partialBlockingLossSeconds: round(equipment.partialBlockingLossSeconds),
    waitingForPrimeSeconds: round(equipment.waitingForPrimeSeconds),
    backupStopSeconds: round(equipment.backupStopSeconds),
    availability: round(effectiveness.availability),
    availabilityPercent: round(effectiveness.availability * 100),
    performance: round(effectiveness.performance),
    performancePercent: round(effectiveness.performance * 100),
    quality: round(effectiveness.quality),
    qualityPercent: round(effectiveness.quality * 100),
    oee: round(effectiveness.oee),
    oeePercent: round(effectiveness.oee * 100),
    qualityAssumption: equipment.macroScrap?'MACROSTOP_SCRAP_ONLY_OTHER_REJECTS_NOT_MODELED':'NO_REJECT_MODEL_ASSUMES_100_PERCENT'
  };
}

function createEquipmentEffectiveness(equipment, elapsedSeconds) {
  const durationSeconds = Math.max(0, elapsedSeconds || 0);
  // Intrinsic availability deliberately excludes STARVED, BLOCKED, Waiting for
  // Prime, and Back-up control. Those are line-interaction losses, not an
  // equipment reliability loss. The stopped counter contains failures,
  // micro-stops, emergency stops, and explicit STOP commands.
  const availability = durationSeconds > 0
    ? clampUnit(1 - equipment.stoppedSeconds / durationSeconds)
    : 1;
  const idealOutput = equipment.idealRunningNativeOutput ?? (Math.max(0, equipment.nominalRatePerSecond || 0) * Math.max(0, equipment.runningSeconds || 0));
  const gross=equipment.outputCount+(equipment.macroScrap?.nativeEquivalent||0);
  // Gross service can exceed the ideal in a finite-inventory period. Do not
  // cap gross before multiplying by quality: that would charge rejects twice.
  const performance = idealOutput > 0 ? (equipment.macroScrap?.actualBottles>0?gross/idealOutput:clampUnit(gross/idealOutput)) : 0;
  const quality = gross>0?equipment.outputCount/gross:1;
  return { availability, performance, quality, oee: availability * clampUnit(performance * quality) };
}

function createLineEffectiveness(runtime) {
  const reference = resolveLineOeeReference(runtime.equipment);
  const idealOutput = runtime.product ? runtime.idealBottleOutput : reference
    ? reference.nominalRatePerSecond * (runtime.run.effectiveRuntimeTargetSeconds===undefined?runtime.run.durationSeconds:runtime.virtualSecond)
    : 0;
  return {
    reference,
    referenceMethod: reference?.lineOeeReference || 'NOT_AVAILABLE',
    oee: idealOutput > 0 ? clampUnit(runtime.outputCount / idealOutput) : 0
  };
}

function resolveLineOeeReference(equipment) {
  const explicitPacemaker = equipment.find((item) => item.type === 'PACEMAKER' ||
    item.processData?.role === 'PACEMAKER' || item.characteristics?.isPacemaker === true);
  if (explicitPacemaker) return { ...explicitPacemaker, lineOeeReference: 'EXPLICIT_PACEMAKER' };

  const fillerFallback = equipment.find((item) => item.type === 'FILLER');
  if (fillerFallback) return { ...fillerFallback, lineOeeReference: 'FILLER_FALLBACK' };

  const firstMachine = equipment.find((item) => item.type !== 'CONVEYOR' && item.processData?.role !== 'CONVEYOR');
  if (firstMachine) return { ...firstMachine, lineOeeReference: 'FIRST_MACHINE_FALLBACK' };

  return equipment[0] ? { ...equipment[0], lineOeeReference: 'FIRST_EQUIPMENT_FALLBACK' } : null;
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function createZoneMetrics(zone, durationSeconds) {
  const nominal=zone.dynamic?.nominalSpeedMmPerSecond??zone.conveyorSpeedMmPerSecond;
  return {
    ...(zone.dynamic?{dynamicLineBalancing:dynamicBeltSnapshot(zone.dynamic)}:{}),
    id: zone.id,
    name: zone.name,
    ownerEquipmentId: zone.ownerEquipmentId,
    upstreamControlEquipmentId: zone.upstreamControlEquipmentId,
    downstreamControlEquipmentId: zone.downstreamControlEquipmentId,
    capacityUnits: round(zone.capacityUnits),
    movingPitchMm: zone.productPitchMm,
    accumulatedPitchMm: zone.accumulatedPitchMm,
    conveyorSpeedMmPerSecond: nominal,
    transferCapacityPerSecond: nominal / zone.productPitchMm,
    modelOrigin: zone.modelOrigin,
    geometrySources: zone.geometrySources,
    blockingEquivalentSeconds: round(zone.blockingEquivalentSeconds),
    starvingEquivalentSeconds: round(zone.starvingEquivalentSeconds),
    constraintLossEquivalentSeconds: round(zone.constraintLossEquivalentSeconds),
    conveyorConstraintLossPercent: round(100*zone.constraintLossEquivalentSeconds/Math.max(durationSeconds,1e-9)),
    finalInventoryUnits: round(getZoneInventory(zone)),
    finalWaitingUnits: round(zone.waitingUnits),
    finalInTransitUnits: round(getTransitUnits(zone)),
    minimumInventoryUnits: round(zone.minimumInventoryUnits),
    averageInventoryUnits: round(zone.inventoryIntegralUnitSeconds / Math.max(1, durationSeconds)),
    maximumInventoryUnits: round(zone.maximumInventoryUnits),
    emptyInventorySeconds: round(zone.emptyInventorySeconds),
    overflowUnits: round(zone.overflowUnits),
    overflowEvents: zone.overflowEvents,
    primeSignalState: zone.primeSignalState,
    backupTriggerCount: zone.backupTriggerCount,
    backupSignalState: zone.backupSignalState,
    backupSignalBlockedSeconds: round(zone.backupSignalBlockedSeconds),
    backupSignalPulsingSeconds: round(zone.backupSignalPulsingSeconds),
    backupSignalClearSeconds: round(zone.backupSignalClearSeconds),
    primeTriggerCount: zone.primeTriggerCount,
    primePassedUnits: round(zone.primePassedUnits),
    backupPassedUnits: round(zone.backupPassedUnits),
    primeDetected: zone.primeDetected,
    engineering: zone.engineering
  };
}

function sortCommands(commands) {
  return [...commands].sort((a, b) => a.atVirtualSecond - b.atVirtualSecond);
}
function isSupportedAction(action) {
  return ['RUN', 'PAUSE', 'STOP', 'MANUAL', 'AUTO', 'EMERGENCY_STOP', 'RESET'].includes(action);
}
function isOperationalMode(equipment) {
  return !equipment.calendarStopped && (equipment.mode === 'AUTO' || equipment.mode === 'MANUAL');
}
function randomDuration(random, profile) {
  const min = profile.minDurationSeconds || 0;
  const max = profile.maxDurationSeconds ?? min;
  return min + (max - min) * random.next();
}
function randomExponentialSeconds(random, meanSeconds) {
  return -Math.log(1 - Math.max(random.next(), 1e-12)) * meanSeconds;
}
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
function round(value) {
  return Number(value.toFixed(6));
}



function currentProductRow(runtime){
  const p=runtime.product;
  return runtime.productRows[p.id]||(runtime.productRows[p.id]={productId:p.id,formatId:p.formatId||p.id,catalogProductId:p.productId||null,productName:p.productName||p.name,boxId:p.boxId||null,boxName:p.boxName||null,name:p.name,bottlesPerCase:productPackSize(p),outputUnit:productFlowUnit(runtime.equipment.at(-1)),outputNative:0,outputBottleEquivalents:0,durationSeconds:0,idealBottleOutput:0,clearoutBottleEquivalents:0});
}
function configureProductFactors(runtime){
  for(const e of runtime.equipment){
    e.outputBottleFactor=productUnitFactor(e,runtime.product);
    e.inputPerOutput=e.outputBottleFactor/productUnitFactor(e,runtime.product,'input');
    e.nativeOutputUnit=productFlowUnit(e).toLowerCase();
  }
  for(const zone of runtime.zones)zone.bottleFactor=runtime.equipmentById.get(zone.ownerEquipmentId).outputBottleFactor;
  const reference=resolveLineOeeReference(runtime.equipment);runtime.productReferenceRate=(reference?.nominalRatePerSecond||0)*(reference?.outputBottleFactor||1);
}
function switchRuntimeProduct(runtime,id){
  const product=runtime.run.productCatalog.find(p=>p.id===id);
  const removed=materialInventory(runtime);
  for(const e of runtime.equipment)if(e.residence){e.residence={clock:0,positionClock:0,inventory:0,ready:0,queue:[],head:0,intakeCredit:1};e.packageRemainder=0;}
  runtime.clearoutBottleEquivalents+=removed;currentProductRow(runtime).clearoutBottleEquivalents+=removed;
  runtime.productTimeline.at(-1).endSeconds=runtime.virtualSecond;
  const models=applyProductProfile(runtime.baseEquipment,product);
  models.forEach((model,i)=>{
    const e=runtime.equipment[i];e.processData=model.processData;e.nominalRatePerSecond=machineOperatingRatePerSecond(model);
    e.startupDelaySeconds=model.startupDelaySeconds;e.restartRampUpSeconds=model.restartRampUpSeconds;e.backupControl=null;e.startupDelaySeconds=resolveStartupDelaySeconds(e);e.restartRampUpSeconds=resolveRestartRampUpSeconds(e);
  });
  runtime.zones=runtime.equipment.slice(0,-1).map((owner,i)=>{
    const next=createAccumulationZoneRuntime(owner,models[i+1],models,i,runtime.run.tickSeconds,runtime.run),old=runtime.zones[i];
    if(next.dynamic&&old.dynamic)for(const key of ['boostRequests','boostSeconds','nominalSeconds','stoppedSeconds','rampSeconds','speedIntegral','observedSeconds','peakSpeedMmPerSecond'])next.dynamic[key]=old.dynamic[key];
    for(const key of ['overflowUnits','overflowEvents','blockingEquivalentSeconds','starvingEquivalentSeconds','constraintLossEquivalentSeconds','inventoryIntegralUnitSeconds','maximumInventoryUnits','emptyInventorySeconds','backupSignalBlockedSeconds','backupSignalPulsingSeconds','backupSignalClearSeconds','primeTriggerCount','backupTriggerCount'])next[key]=old[key];
    next.lastPartialBlockingSeconds=runtime.equipmentById.get(next.upstreamControlEquipmentId)?.partialBlockingLossSeconds||0;
    next.lastPartialStarvingSeconds=runtime.equipmentById.get(next.downstreamControlEquipmentId)?.partialStarvationLossSeconds||0;
    return next;
  });
  runtime.product=product;configureProductFactors(runtime);
  runtime.equipment.forEach((e,i)=>{const outgoing=runtime.zones[i];if((e.type==='CONVEYOR'||e.processData?.role==='CONVEYOR')&&outgoing?.physicalModelEnabled)e.nominalRatePerSecond=outgoing.conveyorSpeedMmPerSecond/outgoing.productPitchMm;e.primeZoneId=i===0?undefined:runtime.zones.find(z=>z.downstreamControlEquipmentId===e.id&&z.hasPrimeSensor)?.id;e.primeStartAuthorized=!e.primeZoneId;e.primeStartRequest=null;});
  runtime.events.push({type:'PRODUCT_CHANGED',atVirtualSecond:runtime.virtualSecond,productId:id,clearoutBottleEquivalents:removed});
  runtime.productTimeline.push({productId:id,name:product.name,startSeconds:runtime.virtualSecond});
}

function runtimeProductEquipment(equipment){return equipment.outputBottleFactor!==undefined;}
