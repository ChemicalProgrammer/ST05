import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = [
  'src/simulation/SeededRandom.js',
  'src/simulation/StopReliability.js',
  'src/simulation/ProductProfiles.js',
  'src/simulation/FormatCatalog.js',
  'src/simulation/ConveyorEngineering.js',
  'src/simulation/FormatGeometryAdapter.js',
  'src/simulation/PlantCalendarSchedule.js',
  'src/simulation/SimulationValidation.js',
  'src/simulation/DiscretePackageEngine.js',
  'src/simulation/LineSimulationEngine.js',
  'src/simulation/SimulationBatch.js',
  'src/simulation/SimulationWorkers.js',
  'src/simulation/NumericalPlayback.js',
  'src/simulation/SimPyBrowserEngine.js',
  'src/simulation/SimulationProvenance.js',
  'src/analysis/LinePerformanceAnalysis.js',
  'src/analysis/ScenarioReadiness.js',
  'src/analysis/ScenarioPlanner.js',
  'src/analysis/ScenarioStatistics.js',
  'src/analysis/ScenarioDOE.js',
  'src/analysis/ScenarioSearch.js',
  'src/analysis/ReliabilityTargetSearch.js',
  'src/analysis/FlowFactorScreening.js',
  'src/analysis/ScenarioMethodology.js'
];
const targetFile = path.join(repositoryRoot, 'apps-script', 'SimulationEngine.html');
const pythonRoot=path.join(repositoryRoot,'src/simulation/python');
// Include the audited pure Python wheel, including its MIT license. Users only
// download the pinned Pyodide runtime; no package lookup or PyPI request occurs.
const pythonFiles=JSON.parse(execFileSync('python3',['-c',
  'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))',
  path.join(pythonRoot,'vendor/simpy-4.1.2-py3-none-any.whl')],{encoding:'utf8'}));
for(const name of ['st_des_engine.py','st_simpy_engine.py','st_spatial_engine.py'])pythonFiles[name]=fs.readFileSync(path.join(pythonRoot,name),'utf8');
// Remove informational URLs from bundled documentation and package metadata.
// Keep license files and copyright/attribution notices intact.
for (const name of Object.keys(pythonFiles)) {
  if (/license|copying/i.test(name)) continue;
  pythonFiles[name] = pythonFiles[name].replace(/https?:\/\/[^\s)<>]+/g, '');
}

const source = sourceFiles.map(relativePath=>{
  const code=removeModuleSyntax(fs.readFileSync(path.join(repositoryRoot,relativePath),'utf8'));
  return code+(relativePath==='src/simulation/LineSimulationEngine.js'?'\n/* WORKER_MODEL_END */':'');
}).join('\n\n');

const output = `<script>
(function engineRuntime(window) {
'use strict';

/* WORKER_MODEL_START */
${source}

function simulationWorkerMain(){
self.onmessage=async function(event){
    const task=event.data;
    try {
      let lastProgressAt=0;
      const response=await simulateLineAsync(task.input,{detail:task.detail,summaryOnly:task.summaryOnly,yieldBetweenChunks:false,onPartial:task.stream?result=>self.postMessage({type:'partial',id:task.id,result}):undefined,progress:(value,detail)=>{const now=Date.now();if(value===0||value===1||now-lastProgressAt>=50){lastProgressAt=now;self.postMessage({type:'progress',id:task.id,value,detail});}}});
      self.postMessage({type:'result',id:task.id,response});
    }catch(error){self.postMessage({type:'error',id:task.id,message:error.message});}
  };
self.postMessage({type:'ready'});
}

let workerPool,workerSource,playbackWorkerSource,workersUnavailable=false;
const playbackControllers=new Set();
const simPyRuntime=createSimPyBrowserEngine(window,${JSON.stringify(pythonFiles).replace(/</g,'\\u003c')});
function selectedEngine(input){
  const id=input.run.engineId||CURRENT_ENGINE_ID;
  if(![CURRENT_ENGINE_ID,SIMPY_ENGINE_ID].includes(id))throw new Error('Unknown simulation engine: '+id);
  return id;
}
async function simulateSelectedLine(input,options={}){
  return selectedEngine(input)===SIMPY_ENGINE_ID?input.run.effectiveRuntimeTargetSeconds!==undefined?effectiveRuntimeUnsupported():simPyRuntime.run(input,options):simulateLineAsync(input,options);
}
function effectiveRuntimeUnsupported(){
  return {ok:false,error:{code:'EFFECTIVE_RUNTIME_ENGINE',message:'Effective Runtime targets require the continuous simulation engine.'}};
}
function canUseSimulationWorkers(){
  return !workersUnavailable&&typeof window.Worker==='function'&&!!window.Blob&&!!window.URL?.createObjectURL;
}
function browserSimulationWorkerCapacity(){
  // Leave room for both the interface and its demand-driven playback cursor.
  return Math.max(1,simulationWorkerCapacity(window.navigator)-1);
}
function createBrowserPlayback(input){
  if(selectedEngine(input)!==CURRENT_ENGINE_ID)
    throw Object.assign(new Error('Live numerical playback requires the current engine.'),{code:'PLAYBACK_ENGINE_UNSUPPORTED'});
  const controller=createNumericalPlayback(input,{
    createWorker:()=>{
      if(!canUseSimulationWorkers())return null;
      playbackWorkerSource=playbackWorkerSource||["'use strict';\\n",engineRuntime.toString().split('/* WORKER_MODEL_START */')[1].split('/* WORKER_MODEL_END */')[0],'('+numericalPlaybackWorkerMain.toString()+')();'].join('');
      const url=window.URL.createObjectURL(new window.Blob([playbackWorkerSource],{type:'text/javascript'}));
      try{return new window.Worker(url);}finally{window.URL.revokeObjectURL(url);}
    },
    onClose:()=>playbackControllers.delete(controller)
  });
  playbackControllers.add(controller);
  return controller;
}
async function calculateBrowserBatch(input,options={}){
  if(input.run.effectiveRuntimeTargetSeconds!==undefined&&selectedEngine(input)===SIMPY_ENGINE_ID)return effectiveRuntimeUnsupported();
  if(selectedEngine(input)===SIMPY_ENGINE_ID)return simulateBatch(input,{...options,runRound:simPyRuntime.run,workerFirstRound:true,concurrency:options.parallel===false?1:simPyRuntime.size,laterSummaryOnly:options.laterSummaryOnly!==false});
  let published=false;
  const onFirstRound=options.onFirstRound?result=>{if(!published){published=true;options.onFirstRound(result);}}:undefined;
  const settings={...options,onFirstRound,laterSummaryOnly:options.laterSummaryOnly!==false};
  if(options.parallel===false||!canUseSimulationWorkers())return simulateBatch(input,settings);
  if(!workerPool){
    const size=browserSimulationWorkerCapacity();
    workerSource=workerSource||["'use strict';\\n",engineRuntime.toString().split('/* WORKER_MODEL_START */')[1].split('/* WORKER_MODEL_END */')[0],'('+simulationWorkerMain.toString()+')();'].join('');
    workerPool=createSimulationWorkerPool(()=>{
      const url=window.URL.createObjectURL(new window.Blob([workerSource],{type:'text/javascript'}));
      try{return new window.Worker(url);}finally{window.URL.revokeObjectURL(url);}
    },size);
  }
  try{return await simulateBatch(input,{...settings,runRound:workerPool.run,workerFirstRound:true,concurrency:workerPool.size});}
  catch(error){
    if(error.message!=='SIMULATION_WORKER_UNAVAILABLE')throw error;
    workersUnavailable=true;workerPool?.close(new Error('SIMULATION_WORKER_UNAVAILABLE'));workerPool=null;
    if(options.cancelled?.())throw new Error('BATCH_CANCELLED');
    return simulateBatch(input,settings);
  }
}
// Exact canonical provenance; include all run inputs and model fields, never
// reuse metrics on a hash collision. Bump the namespace after engine changes.
function simulationInputSignature(input){
  return canonicalSimulationInputSignature(input);
}
async function simulateBrowserBatch(input,options={}){
  const signature=simulationInputSignature(input);
  const response=await calculateBrowserBatch(input,options);
  if(response.ok)response.result.inputSignature=signature;
  return response;
}
window.addEventListener?.('pagehide',()=>{workerPool?.close();workerPool=null;for(const controller of playbackControllers)controller.close();});
window.SimulatorEngine = {
  advancePackagePositions,
  reliabilitySupport:{equipmentRandomSeed,seededRandomStep,stopReliabilityProfile,createFailureHistory,startFailureEpisode,closeFailureEpisode,chargeFailureEpisode,snapshotFailureHistory,summarizeFailureOverlap},
  simulateLine: function(input){if(selectedEngine(input)===SIMPY_ENGINE_ID)return {ok:false,error:{code:'ASYNC_ENGINE_REQUIRED',message:'SimPy requires simulateLineAsync.'}};return simulateLine(input);},
  simulateBatch: simulateBrowserBatch,
  replicationView:replicationView,
  inputSignature: simulationInputSignature,
  concurrency: function(engineId){return engineId===SIMPY_ENGINE_ID?simPyRuntime.size:canUseSimulationWorkers()?browserSimulationWorkerCapacity():1;},
  simulateLineAsync: simulateSelectedLine,
  createPlayback: createBrowserPlayback,
  validateSimulationInput: validateSimulationInput,
  projectMachineDesign:projectMachineDesign,
  plantCalendarSchedule: plantCalendarSchedule,
  resolvePlannedStops:resolvePlannedStops,
  resolveProductConveyor:function(equipment,index){return resolveAccumulationZoneDefinition(equipment,index).definition;},
  productVolumeUnits,
  normalizeFormatCatalog:normalizeFormatCatalog,
  resolvePackingFormats:resolvePackingFormats,
  validateFormatCatalog:validateFormatCatalog,
  mergeFormatCatalogs:mergeFormatCatalogs,
  materialConfiguration:materialConfiguration,
  readMaterialConfiguration:readMaterialConfiguration,
  applyProductProfile:applyProductProfile,
  resolveLineFlowUnits:resolveLineFlowUnits,
  validateProductSetup:validateProductSetup,
  validateProductDefinitions:validateProductDefinitions,
  productPresentation:productPresentation,
  productPackSize:productPackSize,
  calculateConveyorEngineering: calculateConveyorEngineering,
  resolveDynamicBeltSettings,resolveDynamicSpeedPair,
  analyzeLinePerformance: analyzeLinePerformance,diagnoseLineEfficiency:diagnoseLineEfficiency
};
window.STScenarioDOE = {design:createScenarioDOE,analyze:analyzeScenarioDOE,anova:analyzeScenarioANOVA};
window.STScenarioSearch = {basicPlan:planBasicScenarioSearch,progressiveFinalists:selectProgressiveBasicFinalists,packageDesign:designScenarioPackages,screenFlow:screenFlowFactors,reliabilityTargets:searchReliabilityTargets,settings:scenarioSearchSettings,settingsSignature:scenarioSearchSettingsSignature,profiles:SCENARIO_SEARCH_PROFILES,profile:scenarioSearchProfile,run:scenarioSearchRun,rankingPlan:planScenarioFinalistRanking,selectFinalists:selectScenarioFinalists,needsMore:scenarioConfirmationNeedsMore,pairedEvidence:scenarioPairedEvidence,planConfirmation:planScenarioConfirmation,confirm:assessScenarioConfirmation,pairedSummary:scenarioPairedSummary,practicalGain:scenarioPracticalGain};
window.STScenarios = {expandPackages:expandScenarioPackages,equipmentReliability:equipmentReliabilityAssessment,equipmentAnalysis:analyzeEquipmentReliability,plan:planScenarios,readiness:scenarioSourceReadiness,methodologyInputs:scenarioTechnicalMethodology,efficiency:diagnoseLineEfficiency,diagnose:diagnoseScenarioLosses,apply:applyScenarioChanges,signature:scenarioSignature,audit:scenarioAudit,fields:SCENARIO_FIELDS,catalog:scenarioVariableCatalog,definitions:SCENARIO_DEFINITIONS,interventions:SCENARIO_INTERVENTIONS,categoryAllows:scenarioCategoryAllows,reliabilitySensitivity:reliabilitySensitivityCandidates,study:buildScenarioStudy,economics:evaluateScenarioEconomics};
})(window);
</script>
`;

fs.writeFileSync(targetFile, output);

const scenarioSources = ['src/simulation/SimulationProvenance.js','src/simulation/FormatCatalog.js','src/simulation/ProductProfiles.js','src/simulation/PlantCalendarSchedule.js','src/simulation/ConveyorEngineering.js','src/simulation/FormatGeometryAdapter.js','src/simulation/SimulationValidation.js','src/analysis/LinePerformanceAnalysis.js','src/analysis/ScenarioReadiness.js','src/analysis/ScenarioPlanner.js','src/analysis/ScenarioStatistics.js','src/analysis/ScenarioSearch.js','src/analysis/ScenarioMethodology.js'];
fs.writeFileSync(path.join(repositoryRoot,'apps-script','ScenarioEngine.gs'),
  'var STScenarioEngine_ = (function(){\n'+
  scenarioSources.map(file=>removeModuleSyntax(fs.readFileSync(path.join(repositoryRoot,file),'utf8'))).join('\n')+
  '\nreturn {equipmentReliability:equipmentReliabilityAssessment,equipmentAnalysis:analyzeEquipmentReliability,productVolumeUnits,normalizeFormatCatalog:normalizeFormatCatalog,validateFormatCatalog:validateFormatCatalog,resolvePackingFormats:resolvePackingFormats,applyProductProfile:applyProductProfile,plan:planScenarios,readiness:scenarioSourceReadiness,methodologyInputs:scenarioTechnicalMethodology,searchSettingsSignature:scenarioSearchSettingsSignature,efficiency:diagnoseLineEfficiency,diagnose:diagnoseScenarioLosses,apply:applyScenarioChanges,signature:scenarioSignature,audit:scenarioAudit,fields:SCENARIO_FIELDS,catalog:scenarioVariableCatalog,definitions:SCENARIO_DEFINITIONS,interventions:SCENARIO_INTERVENTIONS,categoryAllows:scenarioCategoryAllows,reliabilitySensitivity:reliabilitySensitivityCandidates,study:buildScenarioStudy,economics:evaluateScenarioEconomics,confirm:assessScenarioConfirmation,pairedSummary:scenarioPairedSummary};\n})();\n');

function removeModuleSyntax(moduleSource) {
  return moduleSource
    .replace(/^import .*;\n/gm, '')
    .replace(/^export /gm, '');
}
