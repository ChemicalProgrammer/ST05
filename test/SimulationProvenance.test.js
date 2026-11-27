import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {canonicalSimulationInputSignature,SIMULATION_PROVENANCE_VERSION} from '../src/simulation/SimulationProvenance.js';
import {projectMachineDesign} from '../src/simulation/SimulationValidation.js';
import {scenarioSignature} from '../src/analysis/ScenarioPlanner.js';
import {scenarioEvidenceInput} from './helpers/ScenarioEvidenceFixture.js';

test('browser and diagnostic consumers use the same provenance and keep enabled/default reliability equivalent',()=>{
  const host={addEventListener(){}},context=vm.createContext({window:host,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync('apps-script/SimulationEngine.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1],context);
  const simulation=scenarioEvidenceInput(),input={case:simulation,run:simulation.dynamicConfig};
  const signature=canonicalSimulationInputSignature(input);
  assert.equal(host.SimulatorEngine.inputSignature(input),signature);
  assert.equal(JSON.parse(signature).version,SIMULATION_PROVENANCE_VERSION);
  assert.equal(canonicalSimulationInputSignature({...input,run:{...input.run,reliabilityEnabled:true}}),signature);
  assert.notEqual(canonicalSimulationInputSignature({...input,run:{...input.run,reliabilityEnabled:false}}),signature);
  assert.equal(canonicalSimulationInputSignature({...input,run:{...input.run,numericalResolution:'PRECISE'}}),signature);
  for(const numericalResolution of ['BALANCED','FAST']){
    assert.notEqual(canonicalSimulationInputSignature({...input,run:{...input.run,numericalResolution}}),signature);
    assert.notEqual(scenarioSignature({...simulation,dynamicConfig:{...simulation.dynamicConfig,numericalResolution}}),scenarioSignature(simulation));
  }
  assert.equal(scenarioSignature({...simulation,dynamicConfig:{...simulation.dynamicConfig,numericalResolution:'PRECISE'}}),scenarioSignature(simulation));
  assert.equal(canonicalSimulationInputSignature({...input,run:Object.fromEntries(Object.entries(input.run).reverse())}),signature);
});

test('provenance distinguishes the whole run, model, units and engine instead of relying on a lossy hash',()=>{
  const simulation=scenarioEvidenceInput(),input={case:simulation,run:simulation.dynamicConfig},signature=canonicalSimulationInputSignature(input);
  for(const mutate of [data=>data.case.equipment[0].nominalRatePerSecond++,data=>data.case.unitOfFlow='cases',data=>data.run.seed++,data=>data.run.rounds++,data=>data.run.durationSeconds++,data=>data.run.sampleEverySeconds++,data=>data.run.engineId='DES_SIMPY_EXPERIMENTAL',data=>data.run.commands.push({atVirtualSecond:10,equipmentId:'upstream',action:'STOP'})]){
    const data=structuredClone(input);mutate(data);assert.notEqual(canonicalSimulationInputSignature(data),signature);
  }
});

test('scenario signature binds flow units with legacy fallbacks without depending on unrelated result values',()=>{
  const simulation=scenarioEvidenceInput(),signature=scenarioSignature(simulation);
  const cases=structuredClone(simulation);cases.unitOfFlow='cases';assert.notEqual(scenarioSignature(cases),signature);
  const resultOnly=structuredClone(simulation);delete resultOnly.unitOfFlow;
  resultOnly.results={unitOfFlow:'bottles',summary:{lineOeePercent:12},engineVersion:'old-output'};
  assert.equal(scenarioSignature(resultOnly),signature);
  resultOnly.results={replay:{unitOfFlow:'bottles'},summary:{lineOeePercent:99},engineVersion:'another-output'};
  assert.equal(scenarioSignature(resultOnly),signature);
  const noUnit=structuredClone(simulation);delete noUnit.unitOfFlow;
  assert.equal(scenarioSignature(noUnit),scenarioSignature({...noUnit,unitOfFlow:'units'}));
  const explicit=structuredClone(cases);explicit.results={unitOfFlow:'bottles',replay:{unitOfFlow:'units'}};
  assert.equal(scenarioSignature(explicit),scenarioSignature(cases),'explicit simulation units take precedence');
  const resultsChanged=structuredClone(simulation);resultsChanged.results={summary:{lineOeePercent:1},batch:{rounds:9},unitOfFlow:'cases',engineVersion:'historical'};
  assert.equal(scenarioSignature(resultsChanged),signature,'unrelated result contents do not invalidate unchanged model inputs');
});

test('scenario signature changes with the active model namespace and survives storage normalization',()=>{
  const simulation=scenarioEvidenceInput(),signature=scenarioSignature(simulation);
  // Exercise the real planner with an alternate active namespace, without
  // modifying its source or pretending historical results use a current engine.
  const planner=fs.readFileSync('src/analysis/ScenarioPlanner.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  const withNamespace=namespace=>vm.runInNewContext(planner+'\nscenarioSignature(simulation)',{SIMULATION_PROVENANCE_VERSION:namespace,simulation,projectMachineDesign});
  assert.equal(withNamespace(SIMULATION_PROVENANCE_VERSION),signature);
  assert.notEqual(withNamespace(SIMULATION_PROVENANCE_VERSION+'/changed-mathematics'),signature);
  const normalized=structuredClone(simulation);
  normalized.equipment=normalized.equipment.map(unit=>({uiExpanded:true,processData:Object.fromEntries(Object.entries(unit.processData||{}).reverse()),noiseProfile:unit.noiseProfile||{},characteristics:unit.characteristics||{},initialMode:unit.initialMode,nominalRatePerSecond:String(unit.nominalRatePerSecond),name:' '+unit.name+' ',type:unit.type,id:unit.id}));
  normalized.dynamicConfig=Object.fromEntries(Object.entries(normalized.dynamicConfig).reverse());
  assert.equal(scenarioSignature(normalized),signature);
});
