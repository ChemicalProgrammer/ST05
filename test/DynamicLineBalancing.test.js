import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateLine} from '../src/simulation/LineSimulationEngine.js';
import {canonicalSimulationInputSignature} from '../src/simulation/SimulationProvenance.js';
const format={id:'s',name:'S',bottlesPerCase:12,bottleLengthMm:60,caseLengthMm:310};
const machine=(id,rate)=>({id,name:id,type:'CUSTOM',unitOfFlow:'bottles',initialMode:'AUTO',nominalRatePerSecond:rate,
  noiseProfile:{},processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'},equipment:{internalCapacityBottles:1,residenceTimeSeconds:0,occupancyMode:'STORAGE'}}});
const control={enabled:true,maxSpeedMPerMinute:36,boostPercent:50,lowReserveSeconds:3,highReserveSeconds:7,accelerationSeconds:1,decelerationSeconds:1,confirmSeconds:.2,minDwellSeconds:.5};
const belt={id:'belt',name:'belt',type:'CONVEYOR',unitOfFlow:'bottles',initialMode:'AUTO',nominalRatePerSecond:4,
 processData:{role:'CONVEYOR',flowUnits:{input:'BOTTLES',output:'BOTTLES'},accumulation:{speedMode:'MANUAL',usableLengthMm:6000,productLengthMm:60,productPitchMm:100,gapMm:40,accumulatedGapMm:0,conveyorSpeedMmPerSecond:400,primeSensorPositionMm:5700,backupSensorPositionMm:500,backupRestartPositionMm:500,blockedTimeDelaySeconds:.5,clearTimeDelaySeconds:.5,upstreamStopResponseSeconds:0,bottlesDischargedAtStop:0,downstreamRampUpSeconds:0}}};
function input(on,config=control){
 const conveyor=JSON.parse(JSON.stringify(belt));if(config)conveyor.processData.dynamicLineBalancing={...config};
 return {case:{id:'dynamic',unitOfFlow:'bottles',equipment:[machine('source',4),conveyor,machine('sink',4)]},run:{durationSeconds:120,tickSeconds:.25,sampleEverySeconds:1,seed:7,machineResidenceEnabled:true,numericalResolution:'PRECISE',reliabilityEnabled:false,productCatalog:[format],initialProductId:format.id,commands:[],...(on?{dynamicLineBalancingEnabled:true}:{})}};
}
function checks(api,assert){
 const baseline=api.simulateLine(input(false,null)),disabled=api.simulateLine(input(false)),on=api.simulateLine(input(true));
 assert(baseline.ok,'baseline '+JSON.stringify(baseline.error));assert(disabled.ok,'off '+JSON.stringify(disabled.error));assert(on.ok,'on '+JSON.stringify(on.error));
 assert(JSON.stringify(baseline.result)===JSON.stringify(disabled.result),'disabled reproduces baseline exactly');
 assert(api.inputSignature(input(false,null))===api.inputSignature(input(false)),'off signature unchanged');
 assert(api.inputSignature(input(false))!==api.inputSignature(input(true)),'on signature distinct');
 const metrics=Object.values(on.result.accumulationZoneMetrics)[0],c=metrics.dynamicLineBalancing;
 assert(c.boostRequests>0,'requests recovery');assert(c.boostSeconds>0,'recovery time');assert(c.rampSeconds>0,'ramps recorded');
 assert(c.peakSpeedMmPerSecond<=600+1e-6,'speed limit');
 assert(Math.abs(c.lowSensorPositionMm-5280)<1e-6&&Math.abs(c.highSensorPositionMm-4320)<1e-6,'sensor placement');
 assert(metrics.conveyorSpeedMmPerSecond===400,'nominal geometry unchanged');
 assert(on.result.summary.materialBalance.residualUnits===0,'balance closed');
 assert(Math.abs(c.boostSeconds+c.nominalSeconds+c.stoppedSeconds-120)<1e-4,'exclusive duration accounting');
 const samples=on.result.samples.flatMap(s=>s.accumulationZones.map(z=>z.dynamicLineBalancing).filter(Boolean));
 assert(samples.some(s=>s.actualSpeedMmPerSecond>400),'sample telemetry');
 assert(samples.every(s=>s.actualSpeedMmPerSecond<=600+1e-6),'all samples bounded');
 const invalid=api.simulateLine(input(true,{...control,maxSpeedMPerMinute:20}));assert(!invalid.ok,'invalid maximum rejected');
 const bad=api.simulateLine(input(true,{...control,lowReserveSeconds:1,highReserveSeconds:2}));assert(!bad.ok,'bad sensor geometry rejected');
 const none=api.simulateLine(input(true,{...control,enabled:false}));assert(!none.ok,'no configured belt rejected');
 const halted=input(true);halted.run.commands=[{equipmentId:'sink',action:'STOP',atVirtualSecond:30},{equipmentId:'sink',action:'RUN',atVirtualSecond:45},{equipmentId:'belt',action:'STOP',atVirtualSecond:60},{equipmentId:'belt',action:'RUN',atVirtualSecond:65}];
 const h=api.simulateLine(halted);assert(h.ok,'interlock fixture '+JSON.stringify(h.error));const hs=h.result.samples.flatMap(s=>s.accumulationZones.map(z=>({t:s.virtualSecond,c:z.dynamicLineBalancing})).filter(z=>z.c));
 assert(hs.some(s=>s.t>=61&&s.t<=64&&s.c.actualSpeedMmPerSecond===0&&s.c.mode==='STOPPED'),'belt stop overrides controller');
 assert(h.result.summary.materialBalance.residualUnits===0,'interlock material balance');
 return {baseline:baseline.result.summary.outputCount,enabled:on.result.summary.outputCount,boostRequests:c.boostRequests,peak:c.peakSpeedMmPerSecond};
}

test('dynamic conveyor control is opt-in, physically bounded, and preserves material balance',()=>{checks({simulateLine,inputSignature:canonicalSimulationInputSignature},assert.ok);});
test('generated Apps Script browser engine implements the same controller',()=>{const host={};new Function('window',fs.readFileSync('apps-script/SimulationEngine.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1])(host);checks(host.SimulatorEngine,assert.ok);});
