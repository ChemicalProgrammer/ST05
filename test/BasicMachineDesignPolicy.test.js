import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateLine} from '../src/simulation/LineSimulationEngine.js';
import {validateSimulationInput} from '../src/simulation/SimulationValidation.js';
import {canonicalSimulationInputSignature} from '../src/simulation/SimulationProvenance.js';
import {scenarioSignature,planScenarios} from '../src/analysis/ScenarioPlanner.js';

function inputs(){
 const source=JSON.parse(fs.readFileSync('test/fixtures/demo-b-case.json','utf8')).simulations[0];
 const a={case:{id:'basic-policy',unitOfFlow:'bottles',equipment:source.equipment},run:{...source.dynamicConfig,durationSeconds:300,rounds:1,sampleEverySeconds:60,machineResidenceEnabled:true,machineDesignEnabled:false,numericalResolution:'FAST'}};
 const b=JSON.parse(JSON.stringify(a));
 Object.assign(b.case.equipment[0].processData.equipment,{internalCapacityBottles:9999,occupancyMode:'POSITIONS',residenceTimeSeconds:200,recoveryTimeSeconds:2,macroStopScrapBottles:8});
 return [a,b];
}
test('Basic ignores all five advanced machine design inputs in execution, validation and evidence without mutating the saved model',()=>{
 const [a,b]=inputs(),saved=JSON.stringify(b);
 assert(validateSimulationInput(b).ok);
 const first=simulateLine(a),second=simulateLine(b);
 assert(first.ok&&second.ok);
 assert(first.result.summary.outputCount>0);
 assert.deepEqual(second.result.summary,first.result.summary);
 assert.deepEqual(second.result.equipmentMetrics,first.result.equipmentMetrics);
 assert(Object.values(first.result.equipmentMetrics).every(m=>m.internalCapacityBottles===undefined));
 assert.equal(canonicalSimulationInputSignature(a),canonicalSimulationInputSignature(b));
 const sim=input=>({id:'same',unitOfFlow:'bottles',equipment:input.case.equipment,dynamicConfig:input.run});
 assert.equal(scenarioSignature(sim(a)),scenarioSignature(sim(b)));
 assert.deepEqual(planScenarios(sim(a)),planScenarios(sim(b)));
 assert.equal(JSON.stringify(b),saved);
 const full={...b,run:{...b.run,machineDesignEnabled:true}},original={...a,run:{...a.run,machineDesignEnabled:true}};
 assert.notEqual(canonicalSimulationInputSignature(full),canonicalSimulationInputSignature(original));
 assert.notEqual(canonicalSimulationInputSignature(full),canonicalSimulationInputSignature(b));
 const invalid=JSON.parse(JSON.stringify(b));invalid.case.equipment[0].processData.equipment.internalCapacityBottles=-5;
 assert(validateSimulationInput(invalid).ok);assert(!validateSimulationInput({...invalid,run:{...invalid.run,machineDesignEnabled:true}}).ok);
});

test('Nominal-only speed policy ignores retained maxima, preserving other machine design and evidence',()=>{
 const [a]=inputs(),b=JSON.parse(JSON.stringify(a));
 a.run.machineDesignEnabled=true;b.run.machineDesignEnabled=true;
 a.run.machineMaximumSpeedEnabled=false;b.run.machineMaximumSpeedEnabled=false;
 const aMachine=a.case.equipment.find(e=>e.type!=='CONVEYOR'),bMachine=b.case.equipment.find(e=>e.id===aMachine.id);
 aMachine.processData.equipment={...aMachine.processData.equipment,maximumSpeedBpm:aMachine.nominalRatePerSecond*60};
 bMachine.processData.equipment={...bMachine.processData.equipment,maximumSpeedBpm:bMachine.nominalRatePerSecond*15};
 const saved=JSON.stringify(b);
 assert(validateSimulationInput(a).ok&&validateSimulationInput(b).ok);
 const first=simulateLine(a),second=simulateLine(b);
 assert(first.ok&&second.ok);
 assert.deepEqual(first.result.summary,second.result.summary);
 assert.deepEqual(first.result.equipmentMetrics,second.result.equipmentMetrics);
 assert.equal(second.result.equipmentMetrics[bMachine.id].designSpeedPerSecond,bMachine.nominalRatePerSecond);
 assert.equal(canonicalSimulationInputSignature(a),canonicalSimulationInputSignature(b));
 const sim=input=>({id:'nominal-only',equipment:input.case.equipment,unitOfFlow:'bottles',dynamicConfig:input.run});
 assert.equal(scenarioSignature(sim(a)),scenarioSignature(sim(b)));
 assert.deepEqual(planScenarios(sim(a)),planScenarios(sim(b)));
 assert.equal(JSON.stringify(b),saved);
 const advanced={...b,run:{...b.run,machineMaximumSpeedEnabled:true}};
 assert.notEqual(canonicalSimulationInputSignature(advanced),canonicalSimulationInputSignature(b));
});
