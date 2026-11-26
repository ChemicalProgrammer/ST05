import {projectMachineDesignInput} from './SimulationValidation.js';

// One namespace for cached simulation outputs and consumers of their evidence.
// Bump it when simulation mathematics or the serialized result contract changes.
export const SIMULATION_PROVENANCE_VERSION = 'ST_CURRENT:0.20.7/DES:0.5.0/cache:34';

export function canonicalSimulationInputSignature(input) {
  input=projectMachineDesignInput(input);
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.keys(value).sort().filter(key => value[key] !== undefined)
        .map(key => [key, canonical(value[key])])
    );
    return value;
  }
  const run = {...input.run};
  // Enabled/default reliability are equivalent; disabled reliability is not.
  if (run.reliabilityEnabled !== false) delete run.reliabilityEnabled;
  if(run.machineDesignEnabled!==false)delete run.machineDesignEnabled;
  // PRECISE preserves the historical step. Explicitly choosing it must not
  // invalidate an otherwise identical completed simulation.
  if (run.numericalResolution === 'PRECISE') delete run.numericalResolution;
  if(run.dynamicLineBalancingEnabled!==true)delete run.dynamicLineBalancingEnabled;
  const dynamicMode=input.case.equipment.some(item=>item.processData?.accumulation?.speedMode==='DYNAMIC');
  const macroScrap=input.case.equipment.some(item=>item.processData?.equipment?.macroStopScrapBottles>0);
  return JSON.stringify(canonical({
    version: SIMULATION_PROVENANCE_VERSION+(dynamicMode?'/DLB:2':run.dynamicLineBalancingEnabled===true?'/DLB:1':'')+(macroScrap?'/SCRAP:3':''),
    unitOfFlow: input.case.unitOfFlow || 'units',
    equipment: input.case.equipment.map(item=>{
      const inactiveDynamic=item.processData?.dynamicLineBalancing&&item.processData?.accumulation?.speedMode!=='DYNAMIC'&&!(run.dynamicLineBalancingEnabled===true&&item.processData.dynamicLineBalancing.enabled===true);
      const zeroScrap=item.processData?.equipment?.macroStopScrapBottles===0;
      if(!inactiveDynamic&&!zeroScrap)return item;
      const processData={...item.processData};
      if(inactiveDynamic)delete processData.dynamicLineBalancing;
      if(zeroScrap){processData.equipment={...processData.equipment};delete processData.equipment.macroStopScrapBottles;}
      return {...item,processData};
    }),
    run: {
      durationSeconds: 300, tickSeconds: .25, sampleEverySeconds: 5,
      seed: 1, commands: [], rounds: 1, engineId: 'ST_CURRENT', ...run
    }
  }));
}
