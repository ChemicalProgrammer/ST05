import {projectMachineDesignInput} from '../simulation/SimulationValidation.js';
import {resolveAccumulationZoneDefinition,isConveyorEquipment} from '../simulation/FormatGeometryAdapter.js';
import {applyProductProfile,productUnitFactor} from '../simulation/ProductProfiles.js';
import {machineOperatingRatePerSecond} from '../simulation/LineSimulationEngine.js';
import {createEquipmentRandom} from '../simulation/SeededRandom.js';
import {stopReliabilityProfile,selectReliabilityStop} from '../simulation/StopReliability.js';
import {scenarioScreeningEligibility} from './ScenarioSearch.js';

// Approximate event-driven fluid model for CAPEX screening only. It does not
// replace the physical simulation or establish sensor / overflow feasibility.
// A delayed fluid stream plus a finite ready queue replaces individual items.
const FLUID_EPS=1e-7;
const FLUID_EVENT_LIMIT=200000;
function fluidExp(random,mean){return Math.max(1e-5,-Math.log(1-Math.max(random.next(),1e-12))*mean);}
function fluidPositive(value,fallback=0){return Number.isFinite(value)&&value>0?value:fallback;}
function fluidFinite(value){return Number.isFinite(value);}
function fluidTime(value){return fluidPositive(value);}
function fluidReference(equipment){return equipment.find(e=>e.type==='PACEMAKER'||e.processData?.role==='PACEMAKER'||e.characteristics?.isPacemaker===true)||equipment.find(e=>e.type==='FILLER')||equipment[0];}
function fluidClamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
function fluidBuild(input){
  const original=input;input=projectMachineDesignInput(input);
  const run=input.run,product=run.productCatalog?.find(p=>p.id===(run.initialFormatId??run.initialProductId));
  const equipment=product?applyProductProfile(input.case.equipment,product):input.case.equipment;
  const eligible=scenarioScreeningEligibility(original.run,original.case.equipment);
  if(!eligible.supported)throw Error('SCENARIO_FLUID_UNSUPPORTED: '+eligible.reason);
  const factor=e=>product?productUnitFactor(e,product):1;
  const machines=[],links=[];
  for(let i=0;i<equipment.length;i++){
    const e=equipment[i];
    if(isConveyorEquipment(e))continue;
    const rate=machineOperatingRatePerSecond(e)*factor(e);
    if(!(rate>0&&Number.isFinite(rate)))throw Error('SCENARIO_FLUID_INVALID_RATE');
    const reliability=run.reliabilityEnabled===false?null:stopReliabilityProfile(e,run.reliabilityCategories);
    const random=createEquipmentRandom(run.seed,e.id,'failure'),categoryRandom=createEquipmentRandom(run.seed,e.id,'failure-class');
    const micro=e.noiseProfile?.microStop,microRandom=createEquipmentRandom(run.seed,e.id,'microstop-occurrence'),microDuration=createEquipmentRandom(run.seed,e.id,'microstop-duration');
    const microMean=micro?.probabilityPerMinute>0?60/micro.probabilityPerMinute:Infinity;
    const start=fluidTime(e.startupDelaySeconds??e.processData?.upstream?.startupTimeSeconds)+fluidTime(e.restartRampUpSeconds??e.processData?.downstream?.rampUpTimeSeconds)/2;
    machines.push({index:i,e,rate,reliability,random,categoryRandom,micro,microRandom,microDuration,microMean,exposure:reliability?fluidExp(random,reliability.mtbfMinutes*60):Infinity,microExposure:microMean<Infinity?fluidExp(microRandom,microMean):Infinity,repairUntil:0,microUntil:0,startUntil:0,start,prime:false,authorized:false,everStarted:false,failures:0,microStops:0,output:0});
  }
  for(let i=0;i<machines.length-1;i++){
    const up=machines[i],down=machines[i+1],between=down.index-up.index-1;
    if(between===0){links.push(null);continue;}
    const belt=equipment[up.index+1],d=resolveAccumulationZoneDefinition(equipment,up.index+1).definition;
    const pitch=d?.productPitchMm||((d?.productLengthMm||0)+(d?.gapMm||0)),packed=d?.accumulatedPitchMm??pitch;
    const length=d?.usableLengthMm,speed=d?.conveyorSpeedMmPerSecond,mult=factor(belt);
    if(![pitch,packed,length,speed,mult].every(v=>Number.isFinite(v)&&v>0))throw Error('SCENARIO_FLUID_INVALID_GEOMETRY');
    const cap=Math.floor(length/packed)*mult;
    if(!(cap>0))throw Error('SCENARIO_FLUID_INVALID_CAPACITY');
    const threshold=p=>fluidClamp(Math.ceil((length-p)/packed)*mult,mult,cap);
    const prime=fluidFinite(d.primeSensorPositionMm)?threshold(d.primeSensorPositionMm):0;
    const backup=fluidFinite(d.backupSensorPositionMm)?threshold(d.backupSensorPositionMm):Infinity;
    // Use a one-package hysteresis if positions round to the same queue count.
    const clear=Number.isFinite(backup)?Math.max(0,Math.min(backup-mult,Math.floor((length-(d.backupRestartPositionMm??d.backupSensorPositionMm))/packed)*mult)):0;
    const travel=length/speed;
    links.push({cap,prime,backup,clear,travel,inCap:speed/pitch*mult,outCap:speed/packed*mult,delay:fluidTime(d.blockedTimeDelaySeconds),clearDelay:fluidTime(d.clearTimeDelaySeconds),response:fluidTime(d.upstreamStopResponseSeconds)+fluidTime(d.bottlesDischargedAtStop)*mult/up.rate,total:0,ready:0,arrival:0,lastIn:0,arrivals:[],head:0,blocked:false,blockAt:Infinity,clearAt:Infinity,stopAt:Infinity});
    down.prime=prime>0;
  }
  const ref=fluidReference(machines.map(m=>m.e));
  const reference=machineOperatingRatePerSecond(ref)*factor(ref);
  return {machines,links,reference,unitOfFlow:product?'bottles':input.case.unitOfFlow||'units',run};
}
function fluidRearm(machine){machine.authorized=!machine.prime;}
function fluidStart(machine,t,delay){machine.authorized=true;machine.startUntil=Math.max(machine.startUntil,t+delay);machine.everStarted=true;}
function fluidUpdate(model,t){
  const {machines,links}=model;
  for(const link of links)if(link){
    while(link.head<link.arrivals.length&&link.arrivals[link.head].t<=t+FLUID_EPS){link.arrival=link.arrivals[link.head++].rate;}
    if(link.head>128&&link.head*2>link.arrivals.length){link.arrivals=link.arrivals.slice(link.head);link.head=0;}
  }
  for(let i=0;i<machines.length;i++){
    const m=machines[i],incoming=links[i-1],outgoing=links[i];
    if(m.repairUntil>0&&m.repairUntil<=t+FLUID_EPS){m.repairUntil=0;m.exposure=fluidExp(m.random,m.reliability.mtbfMinutes*60);fluidRearm(m);if(!m.prime&&m.e.processData?.downstream?.rampAfterRepair===true)m.startUntil=t+fluidTime(m.e.restartRampUpSeconds??m.e.processData?.downstream?.rampUpTimeSeconds)/2;}
    if(m.microUntil>0&&m.microUntil<=t+FLUID_EPS){m.microUntil=0;m.microExposure=fluidExp(m.microRandom,m.microMean);fluidRearm(m);}
    if(!m.repairUntil&&!m.microUntil&&m.exposure<=FLUID_EPS&&m.reliability){const category=selectReliabilityStop(m.reliability,m.categoryRandom);m.repairUntil=t+Math.max(1e-5,category.mttrMinutes*60);m.failures++;m.startUntil=t;fluidRearm(m);}
    if(!m.repairUntil&&!m.microUntil&&m.microExposure<=FLUID_EPS&&m.microMean<Infinity){const min=fluidTime(m.micro.minDurationSeconds),max=m.micro.maxDurationSeconds??min;m.microUntil=t+Math.max(1e-5,min+(max-min)*m.microDuration.next());m.microStops++;m.startUntil=t;fluidRearm(m);}
    if(outgoing){
      if(!outgoing.blocked){
        if(outgoing.ready>=outgoing.backup-FLUID_EPS){if(!Number.isFinite(outgoing.blockAt))outgoing.blockAt=t+outgoing.delay;if(outgoing.blockAt<=t+FLUID_EPS){outgoing.blocked=true;outgoing.stopAt=t+outgoing.response;outgoing.blockAt=Infinity;}}
        else outgoing.blockAt=Infinity;
      }else if(outgoing.ready<=outgoing.clear+FLUID_EPS){
        if(!Number.isFinite(outgoing.clearAt))outgoing.clearAt=t+outgoing.clearDelay;
        if(outgoing.clearAt<=t+FLUID_EPS){outgoing.blocked=false;outgoing.clearAt=Infinity;outgoing.stopAt=Infinity;fluidRearm(m);if(!m.prime)m.startUntil=Math.max(m.startUntil,t+m.start);}
      }else outgoing.clearAt=Infinity;
    }
    if(m.repairUntil||m.microUntil)continue;
    if(!m.everStarted&&!m.prime)fluidStart(m,t,m.start);
    if(m.prime){
      if(m.authorized&&incoming.ready<=FLUID_EPS&&incoming.arrival<=FLUID_EPS)m.authorized=false;
      if(!m.authorized&&incoming.ready>=incoming.prime-FLUID_EPS)fluidStart(m,t,m.start);
    }
  }
}
function fluidRates(model,t){
  const {machines,links}=model;
  const rates=machines.map((m,i)=>m.repairUntil||m.microUntil||m.startUntil>t+FLUID_EPS||m.prime&&!m.authorized||links[i]?.blocked&&links[i].stopAt<=t+FLUID_EPS?0:m.rate);
  for(let pass=0;pass<rates.length;pass++){
    let changed=false;
    for(let i=0;i<links.length;i++){
      const l=links[i],a=rates[i],b=rates[i+1];
      if(!l){rates[i]=rates[i+1]=Math.min(a,b);}
      else{rates[i]=Math.min(a,l.inCap);rates[i+1]=Math.min(b,l.outCap,l.ready<=FLUID_EPS?l.arrival:Infinity);if(l.total>=l.cap-FLUID_EPS)rates[i]=Math.min(rates[i],rates[i+1]);}
      if(a-rates[i]>FLUID_EPS||b-rates[i+1]>FLUID_EPS)changed=true;
    }
    if(!changed)break;
  }
  return rates;
}

// Solve each constant-rate segment analytically. Stop at the next failure,
// repair, start, arrival-rate change, sensor threshold or buffer boundary.
export function simulateScenarioFluidRound(input,{cancelled,progress}={}){
  const model=fluidBuild(input),{machines,links,run}=model,measurement=run.durationSeconds,warmup=run.scenarioWarmupSeconds??0,horizon=measurement+warmup;
  if(!(measurement>0&&Number.isFinite(measurement)&&Number.isFinite(warmup)&&warmup>=0&&warmup<=measurement&&Number.isFinite(horizon)))throw Error('SCENARIO_FLUID_INVALID_HORIZON');
  let t=0,source=0,output=0,events=0,initialInventory=0,measuring=warmup===0;
  progress?.(0);
  while(t<horizon-FLUID_EPS){
    if(cancelled?.())throw Error('BATCH_CANCELLED');
    if(++events>FLUID_EVENT_LIMIT)throw Error('SCENARIO_FLUID_EVENT_LIMIT');
    if(!measuring&&t>=warmup-FLUID_EPS){measuring=true;initialInventory=links.reduce((n,l)=>n+(l?.total||0),0);for(const m of machines){m.output=0;m.failures=0;m.microStops=0;}}
    fluidUpdate(model,t);
    const rates=fluidRates(model,t);
    let next=measuring?horizon:warmup;
    const at=x=>{if(Number.isFinite(x)&&x>t+FLUID_EPS&&x<next)next=x;};
    const crossing=(v,rate,target)=>{if(Number.isFinite(target)&&Math.abs(rate)>FLUID_EPS){const dt=(target-v)/rate;if(dt>FLUID_EPS)at(t+dt);}};
    for(let i=0;i<machines.length;i++){
      const m=machines[i];
      at(m.repairUntil);at(m.microUntil);at(m.startUntil);
      if(!m.repairUntil&&!m.microUntil){if(rates[i]>FLUID_EPS)at(t+m.exposure);at(t+m.microExposure);}
      const l=links[i];if(!l)continue;
      if(Math.abs(l.lastIn-rates[i])>FLUID_EPS){l.lastIn=rates[i];l.arrivals.push({t:t+l.travel,rate:rates[i]});}
      if(l.head<l.arrivals.length)at(l.arrivals[l.head].t);
      const net=rates[i]-rates[i+1],qnet=l.arrival-rates[i+1];
      crossing(l.total,net,l.cap);crossing(l.ready,qnet,0);crossing(l.ready,qnet,l.prime);crossing(l.ready,qnet,l.backup);crossing(l.ready,qnet,l.clear);
      at(l.blockAt);at(l.clearAt);at(l.stopAt);
      // A debounce condition can cease immediately at a threshold crossing.
      // Re-evaluate its timer just past the crossing rather than charging a
      // long interval with a stale condition.
      if((!l.blocked&&Number.isFinite(l.blockAt)&&qnet<0&&l.ready<=l.backup+FLUID_EPS)||(l.blocked&&Number.isFinite(l.clearAt)&&qnet>0&&l.ready>=l.clear-FLUID_EPS))at(t+Math.min(.01,Math.max(1e-5,10*FLUID_EPS/Math.abs(qnet))));
    }
    const dt=next-t;
    if(!(dt>0))throw Error('SCENARIO_FLUID_CLOCK');
    for(let i=0;i<machines.length;i++){
      const m=machines[i];m.output+=rates[i]*dt;
      if(!m.repairUntil&&!m.microUntil){if(rates[i]>FLUID_EPS)m.exposure-=dt;m.microExposure-=dt;}
      const l=links[i];if(!l)continue;
      const total=l.total+(rates[i]-rates[i+1])*dt,ready=l.ready+(l.arrival-rates[i+1])*dt;
      if(total<-1e-4||total>l.cap+1e-4||ready<-1e-4||ready>total+1e-4)throw Error('SCENARIO_FLUID_BALANCE');
      l.total=fluidClamp(total,0,l.cap);l.ready=fluidClamp(ready,0,l.total);
    }
    if(measuring){source+=rates[0]*dt;output+=rates.at(-1)*dt;}t=next;
    if(events%128===0)progress?.(Math.min(1,t/horizon));
  }
  const inventory=links.reduce((n,l)=>n+(l?.total||0),0),residual=initialInventory+source-output-inventory;
  if(Math.abs(residual)>Math.max(1e-4,source*1e-8))throw Error('SCENARIO_FLUID_MASS_BALANCE');
  const summary={outputCount:output,lineOeePercent:Math.min(100,100*output/(model.reference*measurement)),totalOverflowUnits:0,materialBalance:{initialInventoryUnits:initialInventory,inputUnits:source,outputUnits:output,inventoryUnits:inventory,overflowUnits:0,residualUnits:residual},fluidEvents:events,totalFailureCount:machines.reduce((n,m)=>n+m.failures,0)};
  progress?.(1);
  return {ok:true,result:{caseId:input.case.id,unitOfFlow:model.unitOfFlow,engineVersion:'CAPEX_FLUID_SCREEN_V1',scenarioFidelity:'FLUID_SCREEN_V1',durationSeconds:measurement,screeningWarmupSeconds:warmup,seed:run.seed,summary,equipmentMetrics:Object.fromEntries(machines.map(m=>[m.e.id,{outputCount:m.output,failureCount:m.failures,microStopCount:m.microStops}])),screeningLimitations:['CONTINUOUS_FLOW','FIXED_TRANSPORT_DELAY','APPROXIMATE_SENSOR_HYSTERESIS','AVERAGE_RAMP_DELAY','NO_INDIVIDUAL_PACKAGES_OR_INTERNAL_RESIDENCE','NO_PHYSICAL_OVERFLOW_CERTIFICATION']}};
}
