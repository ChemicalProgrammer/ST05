import {canonicalSimulationInputSignature} from '../../src/simulation/SimulationProvenance.js';

// Structural fixture for UI/service tests that stub the simulator. Real-engine
// readiness and integration tests verify completion against simulated outputs.
export function completeSyntheticScenarioSource(simulation) {
  const run={durationSeconds:300,seed:1,rounds:1,...simulation.dynamicConfig};
  if(run.durationMode==='SHIFTS')run.durationSeconds=(run.shiftHours||8)*(run.shiftCount||1)*3600;
  const summary={lineOeePercent:50,outputCount:run.durationSeconds*2};
  simulation.results={...simulation.results,seed:run.seed,durationSeconds:run.durationSeconds,
    summary:{...simulation.results?.summary,...summary},
    inputSignature:canonicalSimulationInputSignature({case:simulation,run:simulation.dynamicConfig||{}}),
    replicationStatus:{state:'COMPLETE',rounds:run.rounds,baseSeed:run.seed},
    batch:{rounds:run.rounds,rows:Array.from({length:run.rounds},(_,i)=>({seed:(run.seed+i)>>>0,summary:{...summary}}))}};
  return simulation;
}
