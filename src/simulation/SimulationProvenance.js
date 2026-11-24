// One namespace for cached simulation outputs and consumers of their evidence.
// Bump it when simulation mathematics or the serialized result contract changes.
export const SIMULATION_PROVENANCE_VERSION = 'ST_CURRENT:0.20.1/DES:0.5.0/cache:30';

export function canonicalSimulationInputSignature(input) {
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
  // PRECISE preserves the historical step. Explicitly choosing it must not
  // invalidate an otherwise identical completed simulation.
  if (run.numericalResolution === 'PRECISE') delete run.numericalResolution;
  return JSON.stringify(canonical({
    version: SIMULATION_PROVENANCE_VERSION,
    unitOfFlow: input.case.unitOfFlow || 'units',
    equipment: input.case.equipment,
    run: {
      durationSeconds: 300, tickSeconds: .25, sampleEverySeconds: 5,
      seed: 1, commands: [], rounds: 1, engineId: 'ST_CURRENT', ...run
    }
  }));
}
