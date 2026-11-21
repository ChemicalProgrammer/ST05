function createDemoCaseRequest_() {
  var suffix = new Date().getTime().toString();
  var equipment = createCompleteDemoLine_();
  var catalog = createDemoFormatCatalog_(equipment);
  var format = createDemoResolvedFormat_(catalog);
  var run = { durationMode: 'FIXED', shiftHours: 8, shiftCount: 1, shiftSeconds: 28800, durationSeconds: 600, tickSeconds: 0.25, sampleEverySeconds: 15, seed: 20261008, rounds: 3, commands: [], machineResidenceEnabled: true, initialFormatId: format.id, initialProductId: format.id, productCatalog: [format] };
  var options = createDemoTargets_(equipment);
  var baseline = { id: 'simulation-a', name: 'Baseline — complete physical line', equipment: equipment, dynamicConfig: run, results: null, whatIf: { externalOptions: options } };
  var simulations = [baseline];
  options.forEach(function(option) {
    var copy = JSON.parse(JSON.stringify(equipment));
    option.changes.forEach(function(change) {
      var unit = copy.filter(function(item) { return item.id === change.equipmentId; })[0];
      var keys = change.path.split('.'), field = keys.pop();
      keys.reduce(function(value, key) { return value[key]; }, unit)[field] = change.after;
    });
    simulations.push({ id: 'demo-' + option.tier.toLowerCase(), name: option.tier === 'ZERO' ? 'Zero CAPEX — operating adjustments' : option.tier === 'MEDIUM' ? 'Medium CAPEX — buffer extensions' : 'High CAPEX — accumulation upgrade',
      equipment: copy, dynamicConfig: JSON.parse(JSON.stringify(run)), results: null,
      scenario: { origin: 'DEMO', tier: option.tier, sourceSimulationId: baseline.id, changes: option.changes } });
  });
  var request = {
    id: 'demo-packaging-line-' + suffix,
    name: 'Demo — complete bottling and packaging line',
    unitOfFlow: 'units',
    metadata: Object.assign(createDemoMetadata_(), {formatCatalog: catalog}),
    engineConfig: {
      modelMode: 'DEMO_PHYSICAL_BOTTLES_AND_CASES',
      designThroughputBottlesPerHour: 24000,
      packConfiguration: { bottlesPerCase: 12, casesPerLayer: 9, layersPerPallet: 4 },
      reliabilityModel: 'Seeded exponential time-to-failure with fixed MTTR repair duration',
      accumulationControlModel: 'FlowPilot physical conveyor engineering with package-pulse photoeyes, sustained Back-up debounce, overflow margin, and recovery audit'
    },
    equipment: equipment,
    simulations: simulations
  };
  simulations.forEach(function(sim) {sim.simulation2d={viewports:1,speed:1,layout:{equipmentView:'animated'},appearance:{bottle:'ribbed',labelShape:'wrap'}};});
  applyPreparedDemoResults_(request);
  return request;
}

// Derived demo results may also be supplied on open for an unchanged saved demo.
// Never replace a user's result or reuse a fixture for modified physical inputs.
function normalizeDemoLabels_(record) {
  if (!record.metadata?.demoRevision) return;
  function label(value) { return typeof value === 'string' ? value.replace(/public[ -]+(?=demo)/ig, '') : value; }
  function marker(value) { return typeof value === 'string' ? value.replace(/^PUBLIC_/, '').replace(/^DEMONSTRATION/, 'DEMO') : value; }
  record.name = label(record.name);
  record.metadata.dataClassification = marker(record.metadata.dataClassification);
  record.metadata.modelLimitations = (record.metadata.modelLimitations || []).map(label);
  if (record.engineConfig) record.engineConfig.modelMode = marker(record.engineConfig.modelMode);
  (record.simulations || []).forEach(function(sim) {
    if (sim.scenario) sim.scenario.origin = marker(sim.scenario.origin);
    if (sim.results?.preparedDemo) {
      function signature(value) { return typeof value === 'string' ? value.replace(/PUBLIC_(?:DEMONSTRATION|DEMO)/g, 'DEMO') : value; }
      sim.results.inputSignature = signature(sim.results.inputSignature);
      if (sim.results.replay) sim.results.replay.inputSignature = signature(sim.results.replay.inputSignature);
    }
    (sim.whatIf?.evaluations || []).forEach(function(entry) { entry.origin = marker(entry.origin); });
    (sim.equipment || []).forEach(function(unit) {
      if (unit.characteristics) unit.characteristics.dataClassification = marker(unit.characteristics.dataClassification);
    });
  });
}

function applyPreparedDemoResults_(record){
  normalizeDemoLabels_(record);
  if(typeof preparedDemoResults_!=='function'||record.metadata?.demoRevision!==createDemoMetadata_().demoRevision||record.unitOfFlow!=='units')return;
  var prepared=preparedDemoResults_(),ids=['simulation-a','demo-zero','demo-medium','demo-high'];
  if(prepared.revision!==record.metadata.demoRevision)return;
  function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object'){var result={};Object.keys(value).sort().forEach(function(key){if(value[key]!==undefined)result[key]=canonical(value[key]);});return result;}return value;}
  function input(equipment,run){return canonical({equipment:equipment,run:Object.assign({durationSeconds:300,tickSeconds:.25,sampleEverySeconds:5,seed:1,commands:[],rounds:1,engineId:'ST_CURRENT'},run||{})});}
  (record.simulations||[]).forEach(function(sim){var index=ids.indexOf(sim.id);if(index<0||sim.results&&Object.keys(sim.results).length)return;
    if(JSON.stringify(input(prepared.input[index].equipment,prepared.input[index].run))===JSON.stringify(input(sim.equipment,sim.dynamicConfig)))sim.results=prepared.results[index];
  });
  if(typeof STScenarioEngine_==='undefined')return;
  var base=(record.simulations||[]).find(function(sim){return sim.id===ids[0];});
  if(!base)return;
  function measured(sim,index){return sim.results?.preparedDemo&&sim.results.inputSignature===prepared.results[index].inputSignature&&JSON.stringify(input(sim.equipment,sim.dynamicConfig))===JSON.stringify(input(prepared.input[index].equipment,prepared.input[index].run));}
  function metrics(sim){return {oee:sim.results.batch.statistics.lineOeePercent.mean,throughput:sim.results.batch.statistics.throughputPerMinute.mean};}
  base.whatIf=base.whatIf||{};
  var entries=base.whatIf.evaluations||[];
  if(measured(base,0)){
    (record.simulations||[]).forEach(function(sim){var index=ids.indexOf(sim.id);if(index<1||!measured(sim,index)||sim.scenario?.sourceSimulationId!==base.id)return;
      if(entries.some(function(entry){return entry.sourceSimulationId===base.id&&(entry.searchScope||entry.tier)===sim.scenario.tier&&entry.origin!=='DEMO_PREPARED';}))return;
      entries=entries.filter(function(entry){return entry.recordKey!=='prepared-demo:'+sim.id;});
      entries.push({cardId:JSON.stringify([base.id,'CAPEX',sim.scenario.tier]),recordKey:'prepared-demo:'+sim.id,origin:'DEMO_PREPARED',sourceSimulationId:base.id,sourceSignature:STScenarioEngine_.signature(base),linkedSimulationId:sim.id,linkedSignature:STScenarioEngine_.signature(sim),tier:sim.scenario.tier,searchScope:sim.scenario.tier,status:'PREPARED_DEMO',baseline:metrics(base),candidate:metrics(sim),run:base.dynamicConfig,evaluatedChanges:sim.scenario.changes,plantValidated:false,updatedAt:sim.results.completedAt,message:'Saved demo scenario: '+sim.name+' · '+sim.results.batch.rounds+' rounds. These values match the existing simulation; a new search can find different targets.'});
    });
  }
  base.whatIf.evaluations=entries;
}

// One representative of every distinct machine design; BLOWER is an alias of BLOWMOLDER.
function createCompleteDemoLine_() {
  var machines = [
    ['blowmolder-1','BLOWMOLDER','Blowmolder',480,600,36,3],
    ['feeder-1','FEEDER','Bottle orienter / feeder',460,580,40,2],
    ['pucker-1','PUCKER','Pucker',440,560,24,2],
    ['filler-1','FILLER','Filler',400,420,60,5],
    ['capper-1','CAPPER','Capper',420,540,24,2],
    ['depucker-1','DEPUCKER','Depucker',440,560,24,2],
    ['sleever-1','SLEEVER','Sleeve labeller',460,580,30,3],
    ['inspection-1','CUSTOM','Bottle inspection',480,600,12,1],
    ['case-packer-1','CASE_PACKER','Case packer',500,620,48,3],
    ['palletizer-1','PALLETIZER','Robotic palletizer',520,640,8,2]
  ];
  var equipment=[];
  machines.forEach(function(spec,index){
    var cases=spec[1]==='PALLETIZER',packing=spec[1]==='CASE_PACKER';
    var factor=cases||packing?12:1;
    var unit=createDemoLineUnit_({id:spec[0],type:spec[1],name:spec[2],role:spec[1]==='FILLER'?'PACEMAKER':'MACHINE',nominalRateBpm:spec[3]/factor,maximumSpeedBpm:spec[4]/factor,mtbfMinutes:30+index*3,mttrMinutes:1+index%3*.25,packageLengthMm:cases?340:66,dischargePitchMm:cases?400:85,infeedPitchMm:cases?400:85,startupTimeSeconds:2,bottlesDischargedAtStop:cases?1:3,rampUpTimeSeconds:3,actualDischargeMm:0,actualCodingMm:0,dischargeFactorPercent:5,codingFactorPercent:2,microStopProbabilityPerMinute:.04,microStopMinSeconds:2,microStopMaxSeconds:5});
    unit.processData.flowUnits={input:cases?'CASES':'BOTTLES',output:cases||packing?'CASES':'BOTTLES'};
    unit.processData.equipment.internalCapacityBottles=spec[5]; // Native input units: bottles, or cases at the palletizer.
    unit.processData.equipment.residenceTimeSeconds=spec[6];
    unit.processData.downstream.rampAfterRepair=true;
    unit.characteristics.isPacemaker=spec[1]==='FILLER';
    unit.characteristics.rateBasis=cases||packing?'cases per minute':'bottles per minute';
    equipment.push(unit);
    if(index===machines.length-1)return;
    var boxed=packing,length=boxed?340:66,pitch=boxed?400:85;
    var belt=createDemoLineUnit_({id:'conveyor-'+(index+1),type:'CONVEYOR',name:spec[2]+' discharge conveyor',role:'CONVEYOR',nominalRateBpm:spec[3]/factor,maximumSpeedBpm:spec[4]/factor,mtbfMinutes:1440,mttrMinutes:5,packageLengthMm:length,dischargePitchMm:pitch,infeedPitchMm:pitch,startupTimeSeconds:0,bottlesDischargedAtStop:boxed?1:3,rampUpTimeSeconds:3,actualDischargeMm:300,actualCodingMm:index===6?500:0,dischargeFactorPercent:5,codingFactorPercent:2,microStopProbabilityPerMinute:0,microStopMinSeconds:0,microStopMaxSeconds:0});
    belt.processData.flowUnits={input:boxed?'CASES':'BOTTLES',output:boxed?'CASES':'BOTTLES'};
    belt.processData.geometry.lactMm=boxed?6000:8000;
    belt.processData.geometry.lpPrimeMm=boxed?1200:800;
    belt.processData.upstream.packageWidthMm=boxed?260:66;
    belt.processData.upstream.dischargeVelocityMPerMinute=spec[3]/factor*pitch/1000;
    belt.processData.accumulation={id:'demo-zone-'+(index+1),name:spec[2]+' accumulation',restartToFirstPackageSeconds:spec[6],speedMode:'MANUAL',conveyorSpeedMmPerSecond:spec[3]/factor*pitch/60*1.2,conveyorWidthMm:boxed?400:150,movingGapMm:pitch-length,accumulatedGapMm:0,backupSensorPositionMm:1000,blockedTimeDelaySeconds:.5,clearTimeDelaySeconds:.5,insuranceFactorUnits:2,upstreamStopResponseSeconds:.4,bottlesDischargedAtStop:boxed?1:3,downstreamRampUpSeconds:3};
    equipment.push(belt);
  });
  return equipment;
}
function createDemoFormatCatalog_(equipment){
  var profiles={};
  equipment.forEach(function(unit){profiles[unit.id]={inputUnit:unit.processData.flowUnits.input,outputUnit:unit.processData.flowUnits.output};});
  return {version:3,products:[{id:'demo-product',name:'Multipurpose cleaner',volumeMl:500,bottle:{lengthMm:66,widthMm:66,heightMm:220},equipment:{}}],formats:[{id:'demo-format-12',name:'500 mL · 12 bottles per case',productId:'demo-product',bottlesPerCase:12,case:{lengthMm:340,widthMm:260,heightMm:240},packPattern:'4 × 3',equipment:profiles}]};
}
function createDemoResolvedFormat_(catalog){
  var product=catalog.products[0],format=catalog.formats[0];
  return {id:format.id,formatId:format.id,name:format.name,productId:product.id,productName:product.name,boxId:format.id,boxName:format.name,volumeMl:product.volumeMl,bottleLengthMm:product.bottle.lengthMm,caseLengthMm:format.case.lengthMm,bottlesPerCase:format.bottlesPerCase,packPattern:format.packPattern,presentations:{bottle:product.bottle,case:Object.assign({},format.case,{bottlesPerCase:format.bottlesPerCase})},equipment:format.equipment};
}
// Scenario changes retain the same physical units, capacities and reliability.
function createDemoTargets_(equipment) {
  return ['ZERO','MEDIUM','HIGH'].map(function(tier){
    var changes=[];
    function change(unit,path,after,measure){var before=path.split('.').reduce(function(value,key){return value[key];},unit);if(before!==after)changes.push({equipmentId:unit.id,path:path,before:before,after:after,unit:measure});}
    equipment.forEach(function(unit){
      if(unit.type==='CONVEYOR'){
        change(unit,'processData.accumulation.conveyorSpeedMmPerSecond',unit.processData.accumulation.conveyorSpeedMmPerSecond*(tier==='HIGH'?1.35:1.15),'mm/s');
        change(unit,'processData.geometry.lpPrimeMm',unit.processData.flowUnits.output==='CASES'?800:400,'mm');
        if(tier!=='ZERO')change(unit,'processData.geometry.lactMm',tier==='HIGH'?16000:12000,'mm');
      }else if(unit.type!=='FILLER'){
        change(unit,'nominalRatePerSecond',Math.min(unit.processData.equipment.maximumSpeedBpm/60,unit.nominalRatePerSecond*(tier==='HIGH'?1.15:1.05)),unit.processData.flowUnits.output==='CASES'?'cases/s':'bottles/s');
      }
    });
    return {tier:tier,changes:changes};
  });
}

function createDemoMetadata_() {
  return {
    demoRevision: 'complete-physical-line-5',
    consoleOptions: { autosaveEnabled: false, autosaveSeconds: 10, seedPolicy: 'FIXED' },
    learningObjectives: ['Follow all ten machine types and nine conveyors, including pucks, filling, capping, labelling, inspection, case packing and robotic palletizing.', 'Compare internal capacity in bottles and cases, explicit residence times, and bottle-equivalent production.', 'Compare theoretical series availability with simulated OEE; buffering can decouple equipment downtime.', 'Read speeds in their native units: the Filler runs at 400 bpm; the Case packer and Palletizer use cases/min with 12 bottle equivalents per case.', 'Zero CAPEX: increase installed recovery headroom and retune existing sensors.', 'Medium CAPEX: evaluate moderate buffer extensions with unchanged reliability and internal capacities.', 'High CAPEX: evaluate additional accumulation length and safe sensor relocation.'],
    dataClassification: 'DEMO_ONLY',
    dataNote: 'This is a non-confidential demonstration Case. MTBF, MTTR, physical conveyor geometry, speeds, sensor positions, and line configuration are transparent synthetic assumptions for software testing; they are not plant measurements, equipment guarantees, or operating recommendations.',
    modelLimitations: [
      'Rates use each machine’s native output unit. The case packer consumes 12 bottles per case; the palletizer stores cases. Pallets and robot batch pickups are symbolic 36-space graphics.',
      'MTBF produces seeded exponential time-to-failure intervals. MTTR is represented as a fixed repair duration.',
      'The demo uses transparent synthetic L_act, L_p, runout lengths, sensor delays, insurance, and sensor positions. They are not plant measurements or recommendations.',
      'Every conveyor derives pitch, conveyor velocity, Population %, normal photoeye pulse/gap timing, Prime location, Back-up margin, usable accumulation, recovery length, and anti-starve / anti-block time from the named FlowPilot inputs.',
      'Prime is modeled as leading-product travel to the downstream photocell. Back-up receives normal product pulses, but it requests an upstream stop only after a queue holds the photocell continuously blocked for its configured delay; its clear delay is also continuous.'
    ]
  };
}

function createDemoLineUnit_(definition) {
  return {
    id: definition.id,
    type: definition.type,
    name: definition.name,
    nominalRatePerSecond: definition.nominalRateBpm / 60,
    initialMode: 'AUTO',
    characteristics: {
      dataClassification: 'DEMO_ONLY',
      rateBasis: 'units per minute',
      nominalRateBpm: definition.nominalRateBpm
    },
    noiseProfile: {
      reliability: { mtbfMinutes: definition.mtbfMinutes, mttrMinutes: definition.mttrMinutes },
      microStop: {
        probabilityPerMinute: definition.microStopProbabilityPerMinute,
        minDurationSeconds: definition.microStopMinSeconds,
        maxDurationSeconds: definition.microStopMaxSeconds
      }
    },
    processData: {
      role: definition.role,
      machineType: definition.type,
      equipment: {
        mtbfMinutes: definition.mtbfMinutes,
        mttrMinutes: definition.mttrMinutes,
        maximumSpeedBpm: definition.maximumSpeedBpm,
        bufferMinutes: definition.bufferMinutes
      },
      geometry: {
        lactMm: null,
        lpPrimeMm: null,
        actualDischargeMm: definition.actualDischargeMm,
        actualCodingMm: definition.actualCodingMm
      },
      upstream: {
        packageLengthMm: definition.packageLengthMm,
        dischargePitchMm: definition.dischargePitchMm,
        startupTimeSeconds: definition.startupTimeSeconds,
        bottlesDischargedAtStop: definition.bottlesDischargedAtStop
      },
      downstream: {
        infeedPitchMm: definition.infeedPitchMm,
        rampUpTimeSeconds: definition.rampUpTimeSeconds
      },
      speedAndSensors: {
        conveyorSpeedFactorVsDischargeVelocityPercent: definition.dischargeFactorPercent,
        codingConveyorSpeedFactorVsPreviousConveyorPercent: definition.codingFactorPercent,
        additionalParameters: []
      }
    }
  };
}


