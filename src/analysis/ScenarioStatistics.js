// Dependency-free statistics for independent seed replications, not simulation ticks.
// Student intervals invert the incomplete-beta t distribution (no normal approximation).
// A repeated deterministic result is descriptive evidence; zero sample variance does
// not identify the stochastic variance and therefore does not yield a p-value or CI.

function scenarioLogGamma(value) {
  const coefficients=[676.5203681218851,-1259.1392167224028,771.3234287776531,-176.6150291621406,12.507343278686905,-.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];
  if(value<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*value))-scenarioLogGamma(1-value);
  const z=value-1;
  let sum=.9999999999998099;
  for(let i=0;i<coefficients.length;i++)sum+=coefficients[i]/(z+i+1);
  const t=z+7.5;
  return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(sum);
}

function scenarioBetaFraction(a,b,x) {
  const tiny=1e-300;
  let c=1,d=1-(a+b)*x/(a+1);
  if(Math.abs(d)<tiny)d=tiny;
  d=1/d;
  let h=d;
  for(let m=1;m<=500;m++) {
    let term=m*(b-m)*x/((a+2*m-1)*(a+2*m));
    d=1+term*d;if(Math.abs(d)<tiny)d=tiny;
    c=1+term/c;if(Math.abs(c)<tiny)c=tiny;
    d=1/d;h*=d*c;
    term=-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1));
    d=1+term*d;if(Math.abs(d)<tiny)d=tiny;
    c=1+term/c;if(Math.abs(c)<tiny)c=tiny;
    d=1/d;
    const delta=d*c;h*=delta;
    if(Math.abs(delta-1)<2e-14)break;
  }
  return h;
}

function scenarioRegularizedBeta(x,a,b) {
  if(x<=0)return 0;
  if(x>=1)return 1;
  const front=Math.exp(scenarioLogGamma(a+b)-scenarioLogGamma(a)-scenarioLogGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
  const value=x<(a+1)/(a+b+2)?front*scenarioBetaFraction(a,b,x)/a:1-front*scenarioBetaFraction(b,a,1-x)/b;
  return Math.max(0,Math.min(1,value));
}

export function scenarioFDistributionSurvival(f,df1,df2) {
  if(!(typeof f==='number'&&f>=0&&Number.isFinite(df1)&&df1>0&&Number.isFinite(df2)&&df2>0))return null;
  if(f===0)return 1;
  if(f===Infinity)return 0;
  return scenarioRegularizedBeta(df2/(df2+df1*f),df2/2,df1/2);
}

export function scenarioStudentTPValue(t,df) {
  if(typeof t!=='number'||Number.isNaN(t)||!Number.isFinite(df)||df<=0)return null;
  if(t===0)return 1;
  return scenarioRegularizedBeta(df/(df+t*t),df/2,.5);
}

export function scenarioStudentTCritical(confidenceLevel=.95,df) {
  if(!Number.isFinite(confidenceLevel)||confidenceLevel<=0||confidenceLevel>=1||!Number.isFinite(df)||df<=0)return null;
  const tail=1-confidenceLevel;
  let low=0,high=1;
  while(scenarioStudentTPValue(high,df)>tail&&high<1e150)high*=2;
  if(scenarioStudentTPValue(high,df)>tail)return null;
  for(let iteration=0;iteration<100;iteration++) {
    const mid=(low+high)/2;
    if(scenarioStudentTPValue(mid,df)>tail)low=mid;else high=mid;
    if(high-low<=2e-14*Math.max(1,mid))break;
  }
  return (low+high)/2;
}

export function scenarioMeanSummary(values,options={}) {
  const confidenceLevel=options.confidenceLevel??options.confidence??.95;
  if(!Array.isArray(values)||values.length<2||values.some(value=>!Number.isFinite(value)))return null;
  const n=values.length,df=n-1,tCritical=scenarioStudentTCritical(confidenceLevel,df);
  if(tCritical===null)return null;
  // Center first to keep small differences accurate beside a large throughput offset.
  const origin=values[0],offset=values.reduce((sum,value)=>sum+(value-origin)/n,0),mean=origin+offset;
  const roundingFloor=32*Number.EPSILON*Math.max(1,...values.map(value=>Math.abs(value)));
  const zeroVariance=values.every(value=>Math.abs((value-origin)-offset)<=roundingFloor);
  const sumSquares=zeroVariance?0:values.reduce((sum,value)=>sum+((value-origin)-offset)**2,0);
  const standardDeviation=Math.sqrt(sumSquares/df),standardError=standardDeviation/Math.sqrt(n);
  if(!Number.isFinite(mean)||!Number.isFinite(standardDeviation))return null;
  const halfWidth=zeroVariance?null:tCritical*standardError;
  return {n,mean,standardDeviation,standardError,lower:halfWidth===null?null:mean-halfWidth,upper:halfWidth===null?null:mean+halfWidth,df,halfWidth,tCritical,confidenceLevel,zeroVariance,inferenceAvailable:!zeroVariance,reason:zeroVariance?'ZERO_OBSERVED_VARIANCE':null};
}

// Missing/untestable hypotheses retain their place in the planned family. Holm
// remains valid with correlated contrasts and does not claim simultaneous CIs.
export function scenarioHolmAdjust(pValues) {
  if(!Array.isArray(pValues))return [];
  const result=pValues.map(()=>null),familySize=pValues.length;
  const ordered=pValues.map((p,index)=>({p,index})).filter(row=>Number.isFinite(row.p)&&row.p>=0&&row.p<=1).sort((a,b)=>a.p-b.p);
  let previous=0;
  ordered.forEach((row,index)=>{previous=Math.max(previous,Math.min(1,(familySize-index)*row.p));result[row.index]=previous;});
  return result;
}

export function scenarioPairedSummary(base,candidate,options={}) {
  const confidenceLevel=options.confidenceLevel??options.confidence??.95;
  const a=base?.roundMetrics,b=candidate?.roundMetrics;
  const result={available:false,reason:null,n:Array.isArray(a)?a.length:0,metrics:{throughput:null,oee:null},metricReasons:{throughput:null,oee:null},confidenceLevel,seedIds:[],method:'PAIRED_SEED_DIFFERENCES',interpretation:'Intervals describe simulation replication uncertainty conditional on the model and inputs; independent seed streams and approximately normal mean differences are assumed.'};
  if(!Number.isFinite(confidenceLevel)||confidenceLevel<=0||confidenceLevel>=1)return {...result,reason:'INVALID_CONFIDENCE_LEVEL'};
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||a.length<2)return {...result,reason:'MATCHED_REPLICATIONS_REQUIRED'};
  if(a.some(row=>!Number.isFinite(row?.seed))||b.some(row=>!Number.isFinite(row?.seed)))return {...result,reason:'INVALID_SEED_IDS'};
  if(new Set(a.map(row=>row.seed)).size!==a.length||new Set(b.map(row=>row.seed)).size!==b.length)return {...result,reason:'DUPLICATE_SEED_IDS'};
  const bySeed=new Map(b.map(row=>[row.seed,row]));
  if(a.some(row=>!bySeed.has(row.seed)))return {...result,reason:'SEED_IDS_DO_NOT_MATCH'};
  result.seedIds=a.map(row=>row.seed);
  for(const metric of ['throughput','oee']) {
    if(a.some(row=>!Number.isFinite(row[metric])||!Number.isFinite(bySeed.get(row.seed)[metric]))) {
      result.metricReasons[metric]='MISSING_OR_NONFINITE_METRICS';
      continue;
    }
    const summary=scenarioMeanSummary(a.map(row=>bySeed.get(row.seed)[metric]-row[metric]),{confidenceLevel});
    result.metrics[metric]=summary;
    result.metricReasons[metric]=summary?.reason??(summary?null:'NONFINITE_DIFFERENCES');
  }
  result.available=Object.values(result.metrics).some(value=>value!==null);
  result.reason=result.available?null:'MISSING_OR_NONFINITE_METRICS';
  return result;
}

export function planScenarioReplications(base,candidate,options={}) {
  const confidenceLevel=options.confidenceLevel??options.confidence??.95;
  const minRounds=options.minRounds??3,maxRounds=options.maxRounds??30,relativePrecision=options.relativePrecision??.005;
  const result={rounds:null,requiredRounds:null,capped:false,status:null,targetHalfWidth:null,pilotSeeds:[],pilotRounds:0,confidenceLevel,minRounds,maxRounds,confirmationMustExcludePilotSeeds:true,method:'FIXED_SAMPLE_SIZE_FROM_SEPARATE_PILOT',interpretation:'Fix the confirmation size before examining its outcomes and use new seeds. Precision is planned from pilot variance; it is not guaranteed, and no optional significance stopping is allowed.'};
  if(!Number.isInteger(minRounds)||minRounds<3||!Number.isInteger(maxRounds)||maxRounds<minRounds||!Number.isFinite(confidenceLevel)||confidenceLevel<=0||confidenceLevel>=1)return {...result,status:'INVALID_OPTIONS'};
  const paired=scenarioPairedSummary(base,candidate,{confidenceLevel});
  result.pilotSeeds=paired.seedIds;result.pilotRounds=paired.n;
  if(Array.isArray(options.confirmationSeeds)&&options.confirmationSeeds.some(seed=>result.pilotSeeds.includes(seed)))return {...result,status:'PILOT_CONFIRMATION_SEEDS_OVERLAP'};
  const baselineValues=Array.isArray(base?.roundMetrics)?base.roundMetrics.map(row=>row?.throughput):null;
  const baselineMean=baselineValues?.length&&baselineValues.every(Number.isFinite)?baselineValues.reduce((sum,value)=>sum+value/baselineValues.length,0):null;
  result.baselineMeanThroughput=baselineMean;
  const target=options.absolutePrecision!==undefined?options.absolutePrecision:(Number.isFinite(relativePrecision)&&relativePrecision>0&&Number.isFinite(baselineMean)?Math.abs(baselineMean)*relativePrecision:null);
  if(!Number.isFinite(target)||target<=0)return {...result,status:'POSITIVE_PRECISION_REQUIRED'};
  result.targetHalfWidth=target;
  if(!paired.available||!paired.metrics.throughput||paired.n<3)return {...result,rounds:maxRounds,status:'INSUFFICIENT_PILOT_EVIDENCE',reason:paired.reason??paired.metricReasons.throughput??'THREE_PILOT_ROUNDS_REQUIRED'};
  const sd=paired.metrics.throughput.standardDeviation;
  result.pilotStandardDeviation=sd;
  if(sd===0)return {...result,rounds:Math.min(maxRounds,Math.max(minRounds,6)),status:'ZERO_PILOT_VARIANCE',reason:'Zero observed pilot variance does not establish absence of stochastic noise; confirm descriptively with new seeds.'};
  const halfWidth=rounds=>scenarioStudentTCritical(confidenceLevel,rounds-1)*sd/Math.sqrt(rounds);
  let low=minRounds-1,high=minRounds;
  // The cap is numerical, not a claim that a larger design has been calculated.
  const numericalLimit=Math.max(1000000,maxRounds);
  while(halfWidth(high)>target&&high<numericalLimit)high=Math.min(numericalLimit,high*2);
  if(halfWidth(high)>target)return {...result,rounds:maxRounds,capped:true,status:'PRECISION_TARGET_EXCEEDS_CAP',requiredRoundsLowerBound:numericalLimit+1,plannedHalfWidth:halfWidth(maxRounds)};
  while(high-low>1) {
    const mid=Math.floor((low+high)/2);
    if(halfWidth(mid)<=target)high=mid;else low=mid;
  }
  const rounds=Math.min(maxRounds,high);
  return {...result,rounds,requiredRounds:high,capped:high>maxRounds,status:high>maxRounds?'PRECISION_TARGET_EXCEEDS_CAP':'PLANNED',plannedHalfWidth:halfWidth(rounds)};
}
