// Category frequencies share the same operating exposure. Exponential clocks
// superpose to a total rate, with event categories sampled by their rate share.
export function stopReliabilityProfile(model, categories) {
  const general=model.noiseProfile?.reliability;
  // 2D also resolves draft inputs before the numerical validator runs.
  const valid=profile=>Number.isFinite(profile?.mtbfMinutes)&&profile.mtbfMinutes>0&&
    Number.isFinite(profile?.mttrMinutes)&&profile.mttrMinutes>0;
  const split=model.processData?.equipment?.stopInputs;
  if (!split) return categories?.general===false||!valid(general) ? null : {...general,stopClasses:null};
  const stopClasses=['minor','major'].filter(kind=>categories?.[kind]!==false && valid(split[kind]))
    .map(kind=>({stopClass:kind.toUpperCase(),...split[kind],rate:1/split[kind].mtbfMinutes}));
  const total=stopClasses.reduce((sum,profile)=>sum+profile.rate,0);
  if (!total) return null;
  return {mtbfMinutes:1/total,mttrMinutes:stopClasses.reduce((sum,profile)=>sum+profile.rate*profile.mttrMinutes,0)/total,stopClasses};
}

export function selectReliabilityStop(profile,random) {
  if (!profile.stopClasses) return {stopClass:'GENERAL',mttrMinutes:profile.mttrMinutes};
  if (profile.stopClasses.length===1) return profile.stopClasses[0];
  const total=profile.stopClasses.reduce((sum,item)=>sum+item.rate,0);
  const threshold=random.next()*total;
  let cumulative=0;
  for (const category of profile.stopClasses) {
    cumulative+=category.rate;
    if (threshold<cumulative) return category;
  }
  return profile.stopClasses.at(-1);
}

// Dedicated repair episodes are independent of the bounded generic event log.
// Times are virtual seconds. Observed failure time is exclusive state time;
// an open repair interval can overlap calendar/command/E-stop conditions.
export function createFailureHistory(){
  return {schema:'ST_FAILURE_HISTORY_V1',complete:true,episodes:[]};
}
export function startFailureEpisode(history,start,stopClass,repair,threshold,charged){
  if(!history)return;
  history.episodes.push([start,null,stopClass,repair,Number.isFinite(threshold)?threshold:null,charged,0,null]);
}
export function closeFailureEpisode(history,end,reason='REPAIRED'){
  const row=history?.episodes.at(-1);
  if(row&&row[1]===null){row[1]=end;row[7]=reason;}
}
export function chargeFailureEpisode(history,seconds){
  const row=history?.episodes.at(-1);
  if(row&&row[1]===null)row[6]+=seconds;
}
export function snapshotFailureHistory(history){
  if(!history)return null;
  return {schema:history.schema,complete:history.complete,fields:[
    'startSecond','endSecond','stopClass','configuredRepairSeconds','sampledExposureSeconds',
    'cumulativeChargedSecondsAtStart','observedFailureSeconds','endReason'
  ],episodes:history.episodes.map(row=>row.map((value,index)=>typeof value==='number'?Number(value.toFixed(index===6?9:6)):value))};
}
export function summarizeFailureOverlap(histories,elapsed){
  if(!Number.isFinite(elapsed)||histories.some(h=>!h||!h.complete))return null;
  const boundaries=[];let count=0,open=0;
  for(const history of histories)for(const row of history.episodes){
    count++;if(row[1]===null)open++;
    const start=Math.min(elapsed,Math.max(0,row[0])),end=Math.min(elapsed,row[1]??elapsed);
    if(end>start){boundaries.push([start,1],[end,-1]);}
  }
  boundaries.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let active=0,last=0,union=0,overlap=0,sum=0,peak=0;
  for(let i=0;i<boundaries.length;){
    const t=boundaries[i][0],span=t-last;
    if(active>0)union+=span;
    if(active>1)overlap+=span;
    sum+=active*span;
    while(i<boundaries.length&&boundaries[i][0]===t)active+=boundaries[i++][1];
    peak=Math.max(peak,active);last=t;
  }
  const tidy=v=>Number(v.toFixed(6));
  return {schema:'ST_FAILURE_OVERLAP_V1',basis:'OPEN_REPAIR_INTERVALS_NOT_LINE_LOSS',
    episodes:count,openEpisodes:open,unionSeconds:tidy(union),overlapSeconds:tidy(overlap),
    summedEquipmentSeconds:tidy(sum),peakConcurrent:peak};
}
