// Stable, serializable Mulberry32 streams. The numerical engine retains its
// existing sequence; 2D stores the same per-equipment state in its checkpoint.
function normalizeSeed(seed) {
  return Number.isInteger(seed) ? seed >>> 0 : 0;
}
export function equipmentRandomSeed(seed,equipmentId,eventType) {
  const key=JSON.stringify([normalizeSeed(seed),String(equipmentId),String(eventType)]);
  let hash=2166136261;
  for(let i=0;i<key.length;i++){hash^=key.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return hash>>>0;
}
export function seededRandomStep(state) {
  state=(state+0x6d2b79f5)>>>0;
  let value=state;
  value=Math.imul(value^(value>>>15),value|1);
  value^=value+Math.imul(value^(value>>>7),value|61);
  return {state,value:((value^(value>>>14))>>>0)/4294967296};
}
export function createSeededRandom(seed) {
  let state=normalizeSeed(seed);
  return {next(){const next=seededRandomStep(state);state=next.state;return next.value;}};
}
export function createEquipmentRandom(seed,equipmentId,eventType) {
  return createSeededRandom(equipmentRandomSeed(seed,equipmentId,eventType));
}
