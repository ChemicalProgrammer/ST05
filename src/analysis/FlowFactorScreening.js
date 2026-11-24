import {scenarioPairedSummary} from './ScenarioStatistics.js';

// Candidate selection uses matched batches, not a claim of plant significance.
// Independent full-horizon confirmation remains outside this screening phase.
export async function screenFlowFactors(simulation,{targets=[],fixedChanges=[],run,measure,cancelled=()=>false,progress=()=>{},maximumTargets=16,maximumPairs=12,maxFactors=3,concurrency=1,confidenceLevel=.95}={}){
  if(!Number.isFinite(confidenceLevel)||confidenceLevel<=0||confidenceLevel>=1)throw Error('SCENARIO_INVALID_FLOW_SCREEN_CONFIDENCE');
  if(!Number.isInteger(maxFactors)||maxFactors<1||maxFactors>4||!Number.isInteger(maximumTargets)||maximumTargets<0||!Number.isInteger(maximumPairs)||maximumPairs<0)throw Error('SCENARIO_INVALID_FLOW_SCREEN_LIMITS');
  const key=c=>c.equipmentId+':'+c.path;
  const ordered=targets.filter(t=>Number.isFinite(t.change?.before)&&Number.isFinite(t.change?.after)&&t.change.after!==t.change.before&&!t.change.path.startsWith('noiseProfile.reliability.')).slice().sort((a,b)=>(b.priority||0)-(a.priority||0)||key(a.change).localeCompare(key(b.change)));
  // Reserve room for operating-speed hypotheses so high-priority buffer
  // changes cannot crowd every capacity-related factor out of the screen.
  const speedTargets=ordered.filter(t=>t.change.path==='nominalRatePerSecond'||/conveyorSpeed/.test(t.change.path)).slice(0,Math.min(3,maximumTargets));
  const chosenTargets=new Map(speedTargets.map(t=>[key(t.change),t]));
  // Cover distinct mechanisms before filling remaining slots by priority.
  const groups=[ordered.filter(t=>/Sensor|sensor|TimeDelay/.test(t.change.path)),ordered.filter(t=>/geometry.lactMm/.test(t.change.path)),ordered.filter(t=>/geometry.lpPrimeMm/.test(t.change.path))];
  for(const group of groups){const target=group.find(t=>!chosenTargets.has(key(t.change)));if(target&&chosenTargets.size<maximumTargets)chosenTargets.set(key(target.change),target);}
  for(const target of ordered)if(chosenTargets.size<maximumTargets&&!chosenTargets.has(key(target.change)))chosenTargets.set(key(target.change),target);
  const shortlist=[...chosenTargets.values()],observations=[],pairs=[],groupsOfGain=[];
  const initialRun={...run,rounds:3};let calculations=0;
  async function evaluate(changes,r,label){if(cancelled())throw Error('BATCH_CANCELLED');progress({label,calculations});const value=await measure(simulation,fixedChanges.concat(changes),r);if(cancelled())throw Error('BATCH_CANCELLED');calculations++;if(!Number.isFinite(value?.throughput)||!Number.isFinite(value?.oee))throw Error('INVALID_FLOW_METRICS');return value;}
  const baseline=await evaluate([],initialRun,'Flow screening baseline · 3 seeds');let extraBase,extraBasePromise;
  const threshold=Math.max(.001,Math.abs(baseline.throughput)*.001);
  function pairedScreen(base,next){
    const summary=scenarioPairedSummary(base,next,{confidenceLevel}),metric=summary.metrics.throughput,oee=summary.metrics.oee;
    if(!summary.available||!metric||!oee||![3,6].includes(summary.n))return {stable:false,uncertain:false,selectionScore:null,kind:'INFERENCE_UNAVAILABLE',reason:summary.reason||summary.metricReasons.throughput||summary.metricReasons.oee||'MATCHED_ROUNDS_REQUIRED',confidenceLevel};
    const candidates=new Map(next.roundMetrics.map(row=>[row.seed,row])),deltas=base.roundMetrics.map(row=>candidates.get(row.seed).throughput-row.throughput);
    const blocks=summary.n===6?[deltas.slice(0,3),deltas.slice(3)]:[deltas],blockMeans=blocks.map(values=>values.reduce((sum,value)=>sum+value,0)/values.length);
    const descriptive=metric.reason==='ZERO_OBSERVED_VARIANCE',score=descriptive?metric.mean:metric.lower;
    const stable=Number.isFinite(score)&&score>threshold&&blockMeans.every(value=>value>threshold)&&oee.mean>=-1e-9;
    return {mean:metric.mean,lower:metric.lower,upper:metric.upper,standardError:metric.standardError,df:metric.df,rounds:summary.n,confidenceLevel,threshold,blockMeans,stable,
      uncertain:metric.inferenceAvailable&&metric.upper>threshold&&!stable,selectionScore:stable?score:null,
      kind:descriptive?'DESCRIPTIVE_REPRODUCTION':'EXPLORATORY_PAIRED_INTERVAL',inferenceAvailable:metric.inferenceAvailable,reason:metric.reason,
      interpretation:'Exploratory screening can select repeated descriptive gains. Intervals use matched seeds and the configured Student confidence level; adaptive screening is not a significance claim, has no multiplicity adjustment and requires independent confirmation.'};
  }
  function merge(a,b){return {...a,oee:(a.oee+b.oee)/2,throughput:(a.throughput+b.throughput)/2,overflowUnits:Number.isFinite(a.overflowUnits)&&Number.isFinite(b.overflowUnits)?(a.overflowUnits+b.overflowUnits)/2:null,roundMetrics:[...(a.roundMetrics||[]),...(b.roundMetrics||[])],warnings:[...(a.warnings||[]),...(b.warnings||[])]};}
  function safe(base,next){const spill=next.overflowUnits===null||next.overflowUnits===undefined||base.overflowUnits===null||base.overflowUnits===undefined?true:next.overflowUnits<=base.overflowUnits+1e-6;const prior=new Set((base.warnings||[]).map(w=>w.equipmentId+':'+w.rule));return spill&&!(next.warnings||[]).some(w=>w.rule!=='SIMULATED_OVERFLOW'&&!prior.has(w.equipmentId+':'+w.rule));}
  async function test(changes,label){let candidate=await evaluate(changes,initialRun,label+' · 3 seeds'),base=baseline,paired=pairedScreen(base,candidate),extended=false;
    if(paired.uncertain&&safe(base,candidate)){const extraRun={...initialRun,seed:((Number(initialRun.seed)||1)+3)%2147483647};extraBasePromise=extraBasePromise||evaluate([],extraRun,'Additional baseline seeds');extraBase=await extraBasePromise;candidate=merge(candidate,await evaluate(changes,extraRun,label+' · 3 additional seeds'));base=merge(baseline,extraBase);paired=pairedScreen(base,candidate);extended=true;}
    const admissible=safe(base,candidate),reason=!admissible?'ENGINEERING_REVIEW_REQUIRED':paired.kind==='INFERENCE_UNAVAILABLE'?'INVALID_REPLICATION_EVIDENCE':paired.stable?'STABLE_GAIN':paired.uncertain||paired.mean>threshold?'INCONCLUSIVE':'NO_GAIN_IN_SCREEN';
    return {candidate,paired,extended,deltaThroughput:candidate.throughput-base.throughput,deltaOee:candidate.oee-base.oee,spillNotWorse:admissible,reason};
  }
  // Consume results in input order; completion timing must not choose factors.
  async function inOrder(items,task,counter){
    const results=new Array(items.length);let next=0,finished=0,failure;
    const report=()=>progress({label:counter+' '+finished+' / '+items.length,calculations,counter,completed:finished,total:items.length});report();
    await Promise.all(Array.from({length:Math.min(items.length,Math.max(1,Math.min(4,Math.floor(concurrency)||1)))},async()=>{
      while(next<items.length&&!failure){const index=next++;try{results[index]=await task(items[index]);finished++;report();}catch(error){failure=error;}}
    }));
    if(failure)throw failure;return results;
  }
  const singleResults=await inOrder(shortlist,async target=>{try{return await test([target.change],key(target.change));}catch(error){if(!String(error.message).startsWith('SCENARIO_'))throw error;return {reason:'INFEASIBLE',error:error.message};}},'Factors screened');
  for(const [index,target] of shortlist.entries()){try{const result=singleResults[index];const note={...target.change,...result};observations.push(note);if(result.paired?.stable&&result.spillNotWorse)groupsOfGain.push({items:[target],score:result.paired.selectionScore});}catch(error){if(!String(error.message).startsWith('SCENARIO_'))throw error;observations.push({...target.change,reason:'INFEASIBLE',error:error.message});}}
  const pool=[];for(let i=0;i<shortlist.length;i++)for(let j=i+1;j<shortlist.length;j++){const a=shortlist[i],b=shortlist[j],distance=Math.abs(simulation.equipment.findIndex(e=>e.id===a.change.equipmentId)-simulation.equipment.findIndex(e=>e.id===b.change.equipmentId));pool.push({items:[a,b],priority:(a.priority||0)+(b.priority||0)+(distance===0?30:distance<=2?15:0),key:[key(a.change),key(b.change)].sort().join('|')});}
  pool.sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key));
  // Cover different inputs before spending the pair budget on the same few
  // high-priority buffers. Isolated non-gains can still have interactions.
  const pairSelection=[],covered=new Set();
  while(pairSelection.length<maximumPairs){
    const pair=pool.find(p=>p.items.every(t=>!covered.has(key(t.change))))||pool.find(p=>p.items.some(t=>!covered.has(key(t.change))));
    if(!pair)break;pairSelection.push(pair);pair.items.forEach(t=>covered.add(key(t.change)));
  }
  for(const pair of pool)if(pairSelection.length<maximumPairs&&!pairSelection.includes(pair))pairSelection.push(pair);
  const pairResults=await inOrder(pairSelection,async pair=>{try{return await test(pair.items.map(t=>t.change),pair.key);}catch(error){if(!String(error.message).startsWith('SCENARIO_'))throw error;return {reason:'INFEASIBLE',error:error.message};}},'Pairs screened');
  for(const [index,pair] of pairSelection.entries()){try{const result=pairResults[index];pairs.push({keys:pair.items.map(t=>key(t.change)),...result});if(result.paired?.stable&&result.spillNotWorse)groupsOfGain.push({items:pair.items,score:result.paired.selectionScore});}catch(error){if(!String(error.message).startsWith('SCENARIO_'))throw error;pairs.push({keys:pair.items.map(t=>key(t.change)),reason:'INFEASIBLE',error:error.message});}}
  const chosen=new Map();for(const group of groupsOfGain.sort((a,b)=>b.score-a.score)){const union=new Map(chosen);group.items.forEach(t=>union.set(key(t.change),t));if(union.size<=maxFactors)group.items.forEach(t=>chosen.set(key(t.change),t));}
  for(const observation of observations)if(chosen.has(key(observation)))observation.selectionReason=observation.paired?.stable?'Selected through isolated gain':'Suggested through a stable pair';
  const selectedFactors=[...chosen.values()].map(t=>({...t.change,low:Math.min(t.change.before,t.change.after),high:Math.max(t.change.before,t.change.after)}));
  return {method:'ADAPTIVE_CONDITIONAL_FLOW_V4',run:initialRun,confidenceLevel,maximumFactors:maxFactors,maximumRounds:6,initialRun,additionalRun:extraBase?{...initialRun,seed:((Number(initialRun.seed)||1)+3)%2147483647}:null,additionalBaseline:extraBase||null,baseline,fixedReliabilityChanges:fixedChanges,observations,pairs,selectedFactors,eligible:ordered.length,screened:shortlist.length,screenedTargets:shortlist.length,omitted:ordered.length-shortlist.length,pairsOmitted:Math.max(0,pool.length-pairs.length),calculations,outcome:selectedFactors.length?'STABLE_FACTORS_FOUND':observations.concat(pairs).some(o=>o.reason==='INVALID_REPLICATION_EVIDENCE')?'INCOMPLETE_SCREENING_EVIDENCE':observations.concat(pairs).some(o=>o.reason==='INCONCLUSIVE')?'POSITIVE_BUT_UNSTABLE':'NO_STABLE_FACTORS',interpretation:'Bounded conditional screening: three matched seeds; uncertain candidates receive three new seeds without repeating the first block. Confidence level is shared with the experiment. Repeated gains with no observed variance are descriptive, without an interval. Context reliability remains fixed. Adaptive screening does not establish significance; untested higher-order interactions and long-horizon gains can be missed, and final independent confirmation is required.'};
}
