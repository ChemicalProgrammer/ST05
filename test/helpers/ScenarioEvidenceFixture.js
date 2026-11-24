import { simulateBatch } from '../../src/simulation/SimulationBatch.js';
import { canonicalSimulationInputSignature } from '../../src/simulation/SimulationProvenance.js';

export function scenarioEvidenceInput() {
  const machine=(id,type,rate,reliability)=>({id,type,name:id,nominalRatePerSecond:rate,initialMode:'AUTO',
    noiseProfile:{reliability},processData:{equipment:{maximumSpeedBpm:rate*90},upstream:{startupTimeSeconds:0,bottlesDischargedAtStop:0},downstream:{rampUpTimeSeconds:0}}});
  return {id:'evidence-line',unitOfFlow:'bottles',equipment:[
    machine('upstream','BLOWMOLDER',2,{mtbfMinutes:.2,mttrMinutes:.05}),
    {id:'belt',type:'CONVEYOR',name:'Belt',nominalRatePerSecond:3,initialMode:'AUTO',noiseProfile:{},processData:{role:'CONVEYOR',accumulation:{usableLengthMm:600,productLengthMm:80,gapMm:20,conveyorSpeedMmPerSecond:300,primeSensorPositionMm:500,backupSensorPositionMm:300,backupRestartPositionMm:400,blockedTimeDelaySeconds:.25,clearTimeDelaySeconds:.25,upstreamStopResponseSeconds:0,bottlesDischargedAtStop:0,downstreamRampUpSeconds:0}}},
    machine('reference','FILLER',1.8,{mtbfMinutes:.3,mttrMinutes:.05})
  ],dynamicConfig:{durationSeconds:120,tickSeconds:.25,sampleEverySeconds:5,seed:51,commands:[],rounds:3,engineId:'ST_CURRENT'}};
}

export async function simulatedEvidence() {
  const simulation=scenarioEvidenceInput();
  const input={case:simulation,run:simulation.dynamicConfig};
  const response=await simulateBatch(input,{summaryOnly:true});
  if(!response.ok)throw Error(JSON.stringify(response.error));
  simulation.results={...response.result,inputSignature:canonicalSimulationInputSignature(input),
    replicationStatus:{state:'COMPLETE',rounds:input.run.rounds,baseSeed:input.run.seed}};
  return simulation;
}
