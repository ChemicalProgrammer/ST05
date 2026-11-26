import { productUnitFactor, validateProductSetup } from './ProductProfiles.js';
import { plantCalendarSchedule, resolvePlannedStops } from './PlantCalendarSchedule.js';
import { isConveyorEquipment, resolveAccumulationZoneDefinition } from './FormatGeometryAdapter.js';

// Dynamic balancing phase 1: one independently driven belt, two virtual
// contiguous-queue thresholds. All distances are mm; native flow is packages/s.
export function resolveDynamicBeltSettings(zone, config, downstream) {
  if(zone?.dynamicSpeedError)throw Error(zone.dynamicSpeedError);
  const range=zone?.dynamicSpeedRange;
  if(!range&&(!config || config.enabled!==true))return null;
  if(range&&!config)throw Error('Configure the dynamic conveyor reserve and ramp settings.');
  const nominal=zone?.conveyorSpeedMmPerSecond, length=zone?.usableLengthMm;
  const packed=zone?.accumulatedPitchMm??zone?.productLengthMm;
  const configured=downstream?.nominalRatePerSecond;
  const maximum=downstream?.processData?.equipment?.maximumSpeedBpm;
  const rate=(downstream?.processData?.productInputRatePerSecond??configured)*
    (maximum>0&&configured>0?Math.min(1,maximum/60/configured):1);
  const low=config.lowReserveSeconds, high=config.highReserveSeconds;
  const max=range?.maxSpeedMmPerSecond??config.maxSpeedMPerMinute/0.06, boost=range?(max/nominal-1)*100:config.boostPercent;
  const up=config.accelerationSeconds, down=config.decelerationSeconds;
  const debounce=config.confirmSeconds, dwell=config.minDwellSeconds;
  const positive=x=>Number.isFinite(x)&&x>0;
  const nonnegative=x=>Number.isFinite(x)&&x>=0;
  if(![nominal,length,packed,rate].every(positive))throw Error('Resolve belt geometry and downstream native input rate first.');
  if(!positive(max)||!(max>nominal))throw Error('Maximum belt speed must exceed nominal speed (m/min).');
  if(!range&&(!positive(boost)||boost>1000))throw Error('Boost must be greater than 0 and at most 1000%.');
  if(!positive(low)||!positive(high)||high<=low)throw Error('High reserve must exceed positive low reserve.');
  if(![up,down].every(positive)||![debounce,dwell].every(nonnegative))throw Error('Use positive ramp times and nonnegative confirmation and dwell times.');
  const lowUnits=Math.ceil(rate*low),highUnits=Math.ceil(rate*high);
  const lowPositionMm=length-lowUnits*packed,highPositionMm=length-highUnits*packed;
  if(!Number.isFinite(zone.backupSensorPositionMm)||!Number.isFinite(zone.primeSensorPositionMm)||
    highUnits<=lowUnits||!(zone.backupSensorPositionMm<highPositionMm&&highPositionMm<lowPositionMm&&lowPositionMm<zone.primeSensorPositionMm))
    throw Error('Both balancing sensors must fit strictly between Back-up and Prime; adjust reserve thresholds.');
  const highSpeed=range?max:Math.min(max,nominal*(1+boost/100));
  return {nominalSpeedMmPerSecond:nominal,highSpeedMmPerSecond:highSpeed,maxSpeedMmPerSecond:max,
    lowUnits,highUnits,lowPositionMm,highPositionMm,lowReserveSeconds:low,highReserveSeconds:high,
    accelerationSeconds:up,decelerationSeconds:down,confirmSeconds:debounce,minDwellSeconds:dwell};
}

export function dynamicBeltEnabled(item,run){
  const mode=item?.processData?.accumulation?.speedMode;
  return isConveyorEquipment(item)&&(mode==='DYNAMIC'||
    // Historical replay/API compatibility only; the editor no longer writes this flag.
    run?.dynamicLineBalancingEnabled===true&&item?.processData?.dynamicLineBalancing?.enabled===true);
}
function validateDynamicBalancing(equipment,run,details){
  if(!Array.isArray(equipment))return;
  let active=0;
  equipment.forEach((item,index)=>{
    if(!dynamicBeltEnabled(item,run))return;
    active++;
    try{
      const config=item.processData?.dynamicLineBalancing;
      if(item.processData?.accumulation?.speedMode==='DYNAMIC'&&(!config||!['NORMAL','MAXIMUM'].includes(config.speedReference)))throw Error('Select Normal or Maximum as the specified speed reference.');
      resolveDynamicBeltSettings(resolveAccumulationZoneDefinition(equipment,index).definition,config,equipment[index+1]);
    }
    catch(error){details.push(invalid('case.equipment['+index+'].processData.dynamicLineBalancing',(item.name||item.id)+': '+error.message));}
  });
  if(active&&(run?.engineId==='DES_SIMPY_EXPERIMENTAL'||run?.machineResidenceEnabled!==true))details.push(invalid('run.engineId','Dynamic conveyors require the ST discrete physical engine (machine residence enabled).'));
  if(!active&&run?.dynamicLineBalancingEnabled===true)details.push(invalid('run.dynamicLineBalancingEnabled','Enable and configure at least one conveyor in Dynamic balancing.'));
}

// Basic ignores advanced machine-design measurements without altering the
// persisted installation. Validators, runtimes and evidence use this same
// projection; unrelated reliability, flow and speed fields remain.
export function projectMachineDesign(equipment,run){
  const simpleDesign=run?.machineDesignEnabled===false;
  const nominalOnly=run?.machineMaximumSpeedEnabled===false;
  if((!simpleDesign&&!nominalOnly)||!Array.isArray(equipment))return equipment;
  return equipment.map(unit=>{
    const design=unit?.processData?.equipment;
    if(!design||typeof design!=='object'||Array.isArray(design))return unit;
    const processData={...unit.processData},next={...design};
    if(simpleDesign)for(const key of ['internalCapacityBottles','occupancyMode','residenceTimeSeconds','recoveryTimeSeconds','macroStopScrapBottles'])delete next[key];
    // A separate switch preserves all other machine design parameters in Basic.
    // This is an execution/evidence projection, never an edit of saved maxima.
    if(nominalOnly)delete next.maximumSpeedBpm;
    if(Object.keys(next).length)processData.equipment=next;else delete processData.equipment;
    return {...unit,processData};
  });
}
export function projectMachineDesignInput(input){
  return (input?.run?.machineDesignEnabled===false||input?.run?.machineMaximumSpeedEnabled===false)&&Array.isArray(input?.case?.equipment)
    ?{...input,case:{...input.case,equipment:projectMachineDesign(input.case.equipment,input.run)}}:input;
}

export function validateSimulationInput(input) {
  input=projectMachineDesignInput(input);
  const details = [];
  try { const resolvedProducts=validateProductSetup(input);if(resolvedProducts.length){for(const resolved of resolvedProducts){validateCase({...input.case,equipment:resolved.equipment},details,resolved.product);validateDynamicBalancing(resolved.equipment,input.run,details);}}else {validateCase(input?.case, details);validateDynamicBalancing(input?.case?.equipment,input?.run,details);} } catch(error) { details.push(invalid('run.productCatalog',error.message)); }
  validateRun(input?.run, details);
  if(input?.case?.equipment?.some(item=>item?.processData?.equipment?.macroStopScrapBottles>0)&&
    (input.run?.machineResidenceEnabled!==true||input.run?.engineId==='DES_SIMPY_EXPERIMENTAL'))details.push(invalid('run.engineId','Macrostop scrap requires the ST discrete physical engine (machine residence enabled).'));
  try { if(input?.run?.tickSeconds>0)resolvePlannedStops(input.run);if(input?.run?.eventsEnabled!==false&&(input?.run?.plannedStops?.length||input?.run?.plantCalendar?.enabled&&input.run.plantCalendar.mode==='SCHEDULED')&&input.run.engineId==='DES_SIMPY_EXPERIMENTAL')throw new Error('Scheduled plant stops currently require the ST engine.'); } catch(error){details.push(invalid('run.plantCalendar',error.message));}
  if(input?.run?.eventsEnabled!==false)validateCommands(input?.run?.commands, input?.case?.equipment, details);

  return details.length === 0
    ? { ok: true }
    : {
        ok: false,
        error: {
          code: 'INVALID_SIMULATION_INPUT',
          message: 'The simulation input does not satisfy the required physical-line contract.',
          details
        }
      };
}

function validateCase(caseModel, details,product) {
  if (!caseModel || typeof caseModel !== 'object') {
    details.push(required('case'));
    return;
  }
  if (!Array.isArray(caseModel.equipment) || caseModel.equipment.length < 3) {
    details.push(invalid('case.equipment', 'must contain at least a machine, a conveyor, and a machine'));
    return;
  }

  const ids = new Set();
  caseModel.equipment.forEach((equipment, index) => {
    const path = 'case.equipment[' + index + ']';
    if (!equipment || typeof equipment !== 'object') {
      details.push(invalid(path, 'must be an object'));
      return;
    }
    if (!nonEmptyString(equipment.id)) details.push(required(path + '.id'));
    if (ids.has(equipment.id)) details.push(invalid(path + '.id', 'must be unique'));
    ids.add(equipment.id);
    if (!nonEmptyString(equipment.type)) details.push(required(path + '.type'));
    if(equipment.unitOfFlow!==undefined&&(typeof equipment.unitOfFlow!=='string'||equipment.unitOfFlow.trim().length>40))details.push(invalid(path+'.unitOfFlow','must be text of at most 40 characters'));
    if (!positiveNumber(equipment.nominalRatePerSecond)) {
      details.push(invalid(path + '.nominalRatePerSecond', 'must be a number greater than zero'));
    }
    if (!['AUTO', 'MANUAL', 'PAUSE', 'STOP'].includes(equipment.initialMode)) {
      details.push(invalid(path + '.initialMode', 'must be AUTO, MANUAL, PAUSE, or STOP'));
    }
    if (equipment.bufferAfterCapacity !== undefined) {
      details.push(invalid(path + '.bufferAfterCapacity', 'is no longer supported; configure the physical conveyor geometry instead'));
    }
    if (equipment.accumulationZone !== undefined) {
      details.push(invalid(path + '.accumulationZone', 'is no longer supported; configure processData.accumulation on the conveyor instead'));
    }
    validateNoiseProfile(equipment.noiseProfile, path, details);
    validateStartProfile(equipment, path, details);
    const design=equipment.processData?.equipment;
    const scrap=design?.macroStopScrapBottles;
    if(scrap!==undefined&&(!Number.isSafeInteger(scrap)||scrap<0))details.push(invalid(path+'.processData.equipment.macroStopScrapBottles','must be a nonnegative whole number of bottles'));
    if(scrap>0){
      if(isConveyorEquipment(equipment))details.push(invalid(path+'.processData.equipment.macroStopScrapBottles','Macrostop scrap applies only to machines.'));
      else if(product&&scrap%productUnitFactor(equipment,product,'input')!==0)details.push(invalid(path+'.processData.equipment.macroStopScrapBottles','For case-fed machines, use whole incoming cases expressed in bottles for every selected format.'));
      else if(!product&&![equipment.processData?.flowUnits?.input,equipment.processData?.flowUnits?.output,equipment.unitOfFlow].filter(Boolean).every(unit=>['BOTTLE','BOTTLES'].includes(String(unit).toUpperCase())))details.push(invalid(path+'.processData.equipment.macroStopScrapBottles','Select a product format for non-bottle flow units.'));
    }
    if(product&&!isConveyorEquipment(equipment)&&design?.internalCapacityBottles!=null){
      const minimum=productUnitFactor(equipment,product)/productUnitFactor(equipment,product,'input');
      if(design.internalCapacityBottles<minimum)
        details.push(invalid(path+'.processData.equipment.internalCapacityBottles',equipment.name+': internal capacity must hold at least '+minimum+' '+(equipment.processData?.flowUnits?.input==='CASES'?'cases':'bottles')+' for one output package.'));
    }
  });

  validateAlternatingTopology(caseModel.equipment, details);
  caseModel.equipment.forEach((equipment, index) => {
    const path = 'case.equipment[' + index + ']';
    if (!equipment || typeof equipment !== 'object') return;
    if (isConveyorEquipment(equipment)) {
      validateConveyorGeometry(caseModel.equipment, index, path, details);
    } else if (equipment.processData?.accumulation !== undefined) {
      details.push(invalid(path + '.processData.accumulation', 'belongs only on a CONVEYOR'));
    }
  });
}

function validateAlternatingTopology(equipment, details) {
  const first = equipment[0];
  const last = equipment[equipment.length - 1];
  if (isConveyorEquipment(first)) details.push(invalid('case.equipment[0]', 'a line must start with a machine, not a conveyor'));
  if (isConveyorEquipment(last)) details.push(invalid('case.equipment[' + (equipment.length - 1) + ']', 'a line must end with a machine, not a conveyor'));

  equipment.forEach((item, index) => {
    if (!item) return;
    const path = 'case.equipment[' + index + ']';
    const previous = equipment[index - 1];
    const next = equipment[index + 1];
    if (isConveyorEquipment(item)) {
      if (!previous || isConveyorEquipment(previous) || !next || isConveyorEquipment(next)) {
        details.push(invalid(path, 'must sit between two non-conveyor machines'));
      }
    } else if (next && !isConveyorEquipment(next)) {
      details.push(invalid(path, 'must be followed by a CONVEYOR; direct machine-to-machine accumulation is not modeled'));
    }
  });
}

function validateConveyorGeometry(allEquipment, index, path, details) {
  const accumulation = allEquipment[index].processData?.accumulation;
  if (!accumulation || typeof accumulation !== 'object' || Array.isArray(accumulation)) {
    details.push(required(path + '.processData.accumulation'));
    return;
  }

  if (accumulation.speedMode !== undefined && !['AUTO', 'MANUAL','DYNAMIC'].includes(accumulation.speedMode)) details.push(invalid(path + '.processData.accumulation.speedMode', 'must be AUTO, MANUAL or DYNAMIC'));
  if(accumulation.speedMode==='DYNAMIC'&&(accumulation.targetPopulationPercent!==undefined||accumulation.targetOverspeedPercent!==undefined))details.push(invalid(path+'.processData.accumulation.speedMode','Dynamic speed cannot be combined with target Population or target Overspeed.'));
  if (accumulation.targetPopulationPercent !== undefined && !(positiveNumber(accumulation.targetPopulationPercent) && accumulation.targetPopulationPercent <= 100)) details.push(invalid(path + '.processData.accumulation.targetPopulationPercent', 'must be greater than 0 and at most 100%'));
  if(accumulation.targetOverspeedPercent!==undefined&&!(Number.isFinite(accumulation.targetOverspeedPercent)&&accumulation.targetOverspeedPercent>=0&&accumulation.targetOverspeedPercent<=1000))details.push(invalid(path+'.processData.accumulation.targetOverspeedPercent','must be between 0 and 1000%'));
  if(accumulation.targetOverspeedPercent!==undefined&&accumulation.targetPopulationPercent!==undefined)details.push(invalid(path+'.processData.accumulation','choose either target Population or target Overspeed, not both'));
  const resolved = resolveAccumulationZoneDefinition(allEquipment, index);
  if (accumulation.manualLbaMm !== undefined && !(positiveNumber(accumulation.manualLbaMm) && accumulation.manualLbaMm <= resolved.definition?.engineering?.calculated?.calculatedUsefulAccumulationLengthMm)) details.push(invalid(path + '.processData.accumulation.manualLbaMm', 'must be positive and fit after Prime and required overflow reserves'));
  validatePhysicalZone(resolved.definition, path + '.processData.accumulation', details, allEquipment[index].name||allEquipment[index].id);
}

function validatePhysicalZone(zone, path, details, conveyorName) {
  if (!zone || !['FORMAT_GEOMETRY', 'FLOWPILOT_ENGINEERING'].includes(zone.kind)) {
    details.push(invalid(path, 'could not resolve a physical conveyor zone'));
    return;
  }

  if (!positiveNumber(zone.usableLengthMm)) {
    details.push(invalid(path + '.usableLengthMm', 'must be a number greater than zero'));
  }
  if (zone.productPitchMm !== undefined && !positiveNumber(zone.productPitchMm)) {
    details.push(invalid(path + '.productPitchMm', 'must be a number greater than zero'));
  }
  if (zone.productLengthMm !== undefined && !positiveNumber(zone.productLengthMm)) {
    details.push(invalid(path + '.productLengthMm', 'must be a number greater than zero'));
  }
  if (zone.gapMm !== undefined && !nonNegativeNumber(zone.gapMm)) {
    details.push(invalid(path + '.gapMm', 'must be a number greater than or equal to zero'));
  }

  if(!['MANUAL','DYNAMIC'].includes(zone.engineering?.runtimeGeometry?.speedMode)&&zone.engineering?.calculated?.dischargePopulationPercent>100+1e-9){
    details.push(invalid(path+'.gapMm','discharge pitch and discharge factor must leave non-overlapping package spacing in the discharge zone'));
  }
  const hasExplicitPitch = positiveNumber(zone.productPitchMm);
  const hasLengthAndGap = positiveNumber(zone.productLengthMm) && nonNegativeNumber(zone.gapMm);
  if (!hasExplicitPitch && !hasLengthAndGap) {
    details.push(invalid(path, conveyorName+': moving pitch could not be derived. Provide package length and a valid belt speed with upstream machine rate, and upstream machine rate.'));
  }

  if (zone.accumulatedPitchMm !== undefined && (!positiveNumber(zone.accumulatedPitchMm) || zone.accumulatedPitchMm < (zone.productLengthMm || 0) || zone.accumulatedPitchMm > (zone.productPitchMm ?? zone.productLengthMm + zone.gapMm))) {
    details.push(invalid(path + '.accumulatedPitchMm', 'must be between product length and moving pitch'));
  }
  const pitch = hasExplicitPitch ? zone.productPitchMm : hasLengthAndGap ? zone.productLengthMm + zone.gapMm : null;
  if (positiveNumber(zone.usableLengthMm) && positiveNumber(pitch) && Math.floor(zone.usableLengthMm / pitch) < 1) {
    details.push(invalid(path, 'usableLengthMm must hold at least one product pitch'));
  }

  if (!positiveNumber(zone.conveyorSpeedMmPerSecond)) {
    details.push(invalid(path + '.conveyorSpeedMmPerSecond', 'must be a number greater than zero'));
  }
  validateRequiredSensor(zone.primeSensorPositionMm, path + '.primeSensorPositionMm', zone.usableLengthMm, details);
  if(zone.backupSensorPositionMm===undefined||zone.backupSensorPositionMm===null){
    // One missing derivative must not generate a second missing restart-field
    // error. The installed sensor is optional when engineering can resolve it.
    if(hasExplicitPitch||hasLengthAndGap)details.push(invalid(path,conveyorName+': Back-up position could not be derived from the overflow reserve. Check the available package spacing, belt speed, upstream rate and geometry; enter the installed Back-up position only if known.'));
  }else{
    validateRequiredSensor(zone.backupSensorPositionMm, path + '.backupSensorPositionMm', zone.usableLengthMm, details);
    validateRequiredSensor(zone.backupRestartPositionMm, path + '.backupRestartPositionMm', zone.usableLengthMm, details);
  }

  if (nonNegativeNumber(zone.backupRestartPositionMm) && nonNegativeNumber(zone.backupSensorPositionMm) &&
      zone.backupRestartPositionMm < zone.backupSensorPositionMm) {
    details.push(invalid(path + '.backupRestartPositionMm', 'must be at or downstream of backupSensorPositionMm'));
  }
  if (nonNegativeNumber(zone.backupSensorPositionMm) && nonNegativeNumber(zone.primeSensorPositionMm) &&
      zone.backupSensorPositionMm > zone.primeSensorPositionMm) {
    details.push(invalid(path + '.backupSensorPositionMm', 'must be upstream of the Prime sensor'));
  }

  validateRequiredNonNegative(zone.upstreamStopResponseSeconds, path + '.upstreamStopResponseSeconds', details);
  validateRequiredNonNegative(zone.bottlesDischargedAtStop, path + '.bottlesDischargedAtStop', details);
  validateRequiredNonNegative(zone.downstreamRampUpSeconds, path + '.downstreamRampUpSeconds', details);
  validateOptionalNonNegative(zone.blockedTimeDelaySeconds, path + '.blockedTimeDelaySeconds', details);
  validateOptionalNonNegative(zone.clearTimeDelaySeconds, path + '.clearTimeDelaySeconds', details);
  if (!nonEmptyString(zone.upstreamControlEquipmentId)) details.push(required(path + '.upstreamControlEquipmentId'));
  if (!nonEmptyString(zone.downstreamControlEquipmentId)) details.push(required(path + '.downstreamControlEquipmentId'));
}

function validateRequiredSensor(value, path, usableLengthMm, details) {
  if (!nonNegativeNumber(value)) {
    details.push(required(path));
  } else if (positiveNumber(usableLengthMm) && value > usableLengthMm) {
    details.push(invalid(path, 'must be within usableLengthMm'));
  }
}

function validateRequiredNonNegative(value, path, details) {
  if (!nonNegativeNumber(value)) details.push(required(path));
}

function validateStartProfile(equipment, path, details) {
  validateOptionalNonNegative(equipment.processData?.equipment?.residenceTimeSeconds,path+'.processData.equipment.residenceTimeSeconds',details);
  if(equipment.processData?.equipment?.occupancyMode!==undefined&&!['STORAGE','POSITIONS'].includes(equipment.processData.equipment.occupancyMode))
    details.push(invalid(path+'.processData.equipment.occupancyMode','must be STORAGE or POSITIONS'));
  const capacity=equipment.processData?.equipment?.internalCapacityBottles;
  if(capacity!=null&&(!Number.isSafeInteger(capacity)||capacity<1))details.push(invalid(path+'.processData.equipment.internalCapacityBottles','must be a positive whole number of incoming units (bottles or cases)'));
  validateOptionalNonNegative(equipment.startupDelaySeconds, path + '.startupDelaySeconds', details);
  validateOptionalNonNegative(equipment.restartRampUpSeconds, path + '.restartRampUpSeconds', details);
  ['conveyorSpeedFactorVsDischargeVelocityPercent','codingConveyorSpeedFactorVsPreviousConveyorPercent','conveyorSpeedFactorVsPreviousConveyorPercent','overspeedVsInfeedScrewPercent'].forEach(key=>validateOptionalNonNegative(equipment.processData?.speedAndSensors?.[key],path+'.processData.speedAndSensors.'+key,details));
  ['actualDischargeMm','actualCodingMm'].forEach(key=>validateOptionalNonNegative(equipment.processData?.geometry?.[key],path+'.processData.geometry.'+key,details));
  validateOptionalNonNegative(equipment.processData?.upstream?.startupTimeSeconds, path + '.processData.upstream.startupTimeSeconds', details);
  validateOptionalNonNegative(equipment.processData?.downstream?.rampUpTimeSeconds, path + '.processData.downstream.rampUpTimeSeconds', details);
  const split=equipment.processData?.equipment?.stopInputs;
  if(split!==undefined){
    const splitPath=path+'.processData.equipment.stopInputs';
    if(!split||typeof split!=='object'||Array.isArray(split))details.push(invalid(splitPath,'must be an object'));
    else for(const kind of ['minor','major']){
      const pair=split[kind],valid=pair&&((positiveNumber(pair.mtbfMinutes)&&positiveNumber(pair.mttrMinutes))||(pair.mtbfMinutes===0&&pair.mttrMinutes===0));
      if(!valid)details.push(invalid(splitPath+'.'+kind,'supply positive MTBF/MTTR minutes or 0 and 0 for an absent category'));
    }
  }
  const repairRamp=equipment.processData?.downstream?.rampAfterRepair;
  if(repairRamp!==undefined&&typeof repairRamp!=='boolean')details.push(invalid(path+'.processData.downstream.rampAfterRepair','must be a boolean'));
}

function validateOptionalNonNegative(value, path, details) {
  if (value !== undefined && value !== null && !nonNegativeNumber(value)) {
    details.push(invalid(path, 'must be a number greater than or equal to zero'));
  }
}

function validateRun(run, details) {
  if (!run || typeof run !== 'object') {
    details.push(required('run'));
    return;
  }
  if(run.machineDesignEnabled!==undefined&&typeof run.machineDesignEnabled!=='boolean')details.push(invalid('run.machineDesignEnabled','must be a boolean'));
  if(run.machineMaximumSpeedEnabled!==undefined&&typeof run.machineMaximumSpeedEnabled!=='boolean')details.push(invalid('run.machineMaximumSpeedEnabled','must be a boolean'));
  if(run.dynamicLineBalancingEnabled!==undefined&&typeof run.dynamicLineBalancingEnabled!=='boolean')details.push(invalid('run.dynamicLineBalancingEnabled','must be a boolean'));
  if(run.dynamicLineBalancingEnabled===true&&(run.engineId==='DES_SIMPY_EXPERIMENTAL'||run.machineResidenceEnabled!==true))details.push(invalid('run.dynamicLineBalancingEnabled','Dynamic balancing requires the ST discrete physical engine (machine residence enabled).'));
  if (run.eventsEnabled !== undefined && typeof run.eventsEnabled !== 'boolean') details.push(invalid('run.eventsEnabled','must be a boolean'));
  if(run.discretePackages!==undefined&&typeof run.discretePackages!=='boolean')details.push(invalid('run.discretePackages','must be a boolean'));
  if(run.discretePackages&&(run.engineId==='DES_SIMPY_EXPERIMENTAL'||(run.rounds??1)!==1))details.push(invalid('run.discretePackages','Bottle Live requires the ST engine and one round'));
  if(run.calculationMode!==undefined&&!['LIVE','FAST','SUMMARY'].includes(run.calculationMode))details.push(invalid('run.calculationMode','unsupported mode'));
  if(run.numericalResolution!==undefined&&!['PRECISE','BALANCED','FAST'].includes(run.numericalResolution))details.push(invalid('run.numericalResolution','must be PRECISE, BALANCED, or FAST'));
  if (run.reliabilityEnabled !== undefined && typeof run.reliabilityEnabled !== 'boolean') details.push(invalid('run.reliabilityEnabled', 'must be a boolean'));
  if (run.reliabilityCategories !== undefined) {
    const categories=run.reliabilityCategories;
    if (!categories || typeof categories !== 'object' || Array.isArray(categories) ||
        Object.entries(categories).some(([key,value])=>!['general','minor','major'].includes(key)||typeof value!=='boolean')) {
      details.push(invalid('run.reliabilityCategories','must contain boolean general, minor or major settings'));
    }
  }
  if (!positiveNumber(run.durationSeconds)) details.push(invalid('run.durationSeconds', 'must be a number greater than zero'));
  if(run.effectiveRuntimeTargetSeconds!==undefined&&(!positiveNumber(run.effectiveRuntimeTargetSeconds)||run.effectiveRuntimeTargetSeconds>run.durationSeconds||Math.abs(run.durationSeconds/run.tickSeconds-Math.round(run.durationSeconds/run.tickSeconds))>1e-8))details.push(invalid('run.effectiveRuntimeTargetSeconds','must be positive and at most the tick-aligned time limit'));
  if (!positiveNumber(run.tickSeconds)) details.push(invalid('run.tickSeconds', 'must be a number greater than zero'));
  if (!Number.isInteger(run.seed)) details.push(invalid('run.seed', 'must be an integer'));
  if (run.sampleEverySeconds !== undefined && !positiveNumber(run.sampleEverySeconds)) {
    details.push(invalid('run.sampleEverySeconds', 'must be a number greater than zero'));
  }
}

function validateCommands(commands, equipment, details) {
  if (commands === undefined) return;
  if (!Array.isArray(commands)) {
    details.push(invalid('run.commands', 'must be an array'));
    return;
  }
  const equipmentIds = new Set(Array.isArray(equipment) ? equipment.map((item) => item?.id) : []);
  commands.forEach((command, index) => {
    const path = 'run.commands[' + index + ']';
    if (!command || typeof command !== 'object') {
      details.push(invalid(path, 'must be an object'));
      return;
    }
    if (!nonNegativeNumber(command.atVirtualSecond)) {
      details.push(invalid(path + '.atVirtualSecond', 'must be a number greater than or equal to zero'));
    }
    if (!equipmentIds.has(command.equipmentId)) {
      details.push(invalid(path + '.equipmentId', 'must reference an equipment unit in case.equipment'));
    }
    if (!['RUN', 'PAUSE', 'STOP', 'MANUAL', 'AUTO', 'EMERGENCY_STOP', 'RESET'].includes(command.action)) {
      details.push(invalid(path + '.action', 'is not supported'));
    }
  });
}

function validateNoiseProfile(noiseProfile, equipmentPath, details) {
  if (noiseProfile === undefined) return;
  if (!noiseProfile || typeof noiseProfile !== 'object' || Array.isArray(noiseProfile)) {
    details.push(invalid(equipmentPath + '.noiseProfile', 'must be an object'));
    return;
  }
  if (noiseProfile.microStop !== undefined) validateMicroStop(noiseProfile.microStop, equipmentPath, details);
  if (noiseProfile.reliability !== undefined) validateReliability(noiseProfile.reliability, equipmentPath, details);
}

function validateMicroStop(microStop, equipmentPath, details) {
  const path = equipmentPath + '.noiseProfile.microStop';
  if (!microStop || typeof microStop !== 'object' || Array.isArray(microStop)) {
    details.push(invalid(path, 'must be an object'));
    return;
  }
  if (microStop.probabilityPerMinute !== undefined && !nonNegativeNumber(microStop.probabilityPerMinute)) {
    details.push(invalid(path + '.probabilityPerMinute', 'must be a number greater than or equal to zero'));
  }
  if (microStop.minDurationSeconds !== undefined && !nonNegativeNumber(microStop.minDurationSeconds)) {
    details.push(invalid(path + '.minDurationSeconds', 'must be a number greater than or equal to zero'));
  }
  if (microStop.maxDurationSeconds !== undefined && !nonNegativeNumber(microStop.maxDurationSeconds)) {
    details.push(invalid(path + '.maxDurationSeconds', 'must be a number greater than or equal to zero'));
  }
  if (nonNegativeNumber(microStop.minDurationSeconds) && nonNegativeNumber(microStop.maxDurationSeconds) &&
      microStop.minDurationSeconds > microStop.maxDurationSeconds) {
    details.push(invalid(path + '.maxDurationSeconds', 'must be greater than or equal to minDurationSeconds'));
  }
}

function validateReliability(reliability, equipmentPath, details) {
  const path = equipmentPath + '.noiseProfile.reliability';
  if (!reliability || typeof reliability !== 'object' || Array.isArray(reliability)) {
    details.push(invalid(path, 'must be an object'));
    return;
  }
  if (!positiveNumber(reliability.mtbfMinutes)) {
    details.push(invalid(path + '.mtbfMinutes', 'must be a number greater than zero'));
  }
  if (!positiveNumber(reliability.mttrMinutes)) {
    details.push(invalid(path + '.mttrMinutes', 'must be a number greater than zero'));
  }
}

function required(path) { return { path, reason: 'is required' }; }
function invalid(path, reason) { return { path, reason }; }
function positiveNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function nonNegativeNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
