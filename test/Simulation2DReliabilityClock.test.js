import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const script=fs.readFileSync('apps-script/Simulation2DEngine.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const w={};new Function('window',script)(w);
const create=w.STSimulation2DEngine.create;
const machine={id:'m',kind:'machine',rate:2,batch:1,startDelay:0,rampSeconds:0,capacityBottles:30,residenceSeconds:0,inputBottleFactor:1,bottlesPerUnit:1,failures:[{rate:.001,repairSeconds:1}]};
const belt={id:'belt',kind:'belt',length:5000,speed:100,packageLength:20,pitch:25,packedGap:0,prime:null,backup:null,blockDelay:.5,clearDelay:Infinity,responseDelay:0,residual:0};
test('stored product does not consume MTBF in Back-up stop or Starting',()=>{
 const model=create([machine,{...belt,upstreamRestartDelaySeconds:1}]);
 const [m,b]=model.line;
 m.resident=[0,0,0];m.exposure=5;b.backupBlocked=true;
 for(let i=0;i<40;i++)model.step(.25);
 assert.equal(m.state,'Back-up stop');assert.equal(m.resident.length,3);
 assert.equal(m.exposure,5);assert.equal(m.reliabilityChargedSeconds,0);assert.equal(m.failureCount,0);
 b.backupBlocked=false;
 for(let i=0;i<4;i++)model.step(.25);
 assert.equal(m.state,'Starting');assert.equal(m.exposure,5);assert.equal(m.reliabilityExposureSeconds,0);
 model.step(.25);
 assert.equal(m.state,'Running');assert.equal(m.exposure,4.75);
 assert.equal(m.reliabilityChargedSeconds,.25);
});
test('Prime wait, blocking, starvation and external stop do not consume the reliability clock',()=>{
 const model=create([{...machine,id:'up'}, {...belt,prime:4900}, {...machine,id:'down'}]);
 model.control('up','STOP');const m=model.line[2];
 m.resident=[0];m.exposure=4;
 model.step(.25);assert.equal(m.state,'Waiting for Prime');assert.equal(m.exposure,4);
 m.awaitPrime=false;m.resident=[];m.outletCredit=0;
 model.step(.25);assert.equal(m.state,'Starved');assert.equal(m.exposure,4);
 model.control('down','PAUSE');m.resident=[0,0];
 model.step(.25);assert.equal(m.state,'Paused');assert.equal(m.exposure,4);
 const blocked=create([machine,belt]);blocked.control('belt','STOP');
 const a=blocked.line[0];a.resident=Array(30).fill(0);a.outletCredit=1;a.exposure=3;
 blocked.step(.25);assert.equal(a.state,'Blocked');assert.equal(a.exposure,3);assert.equal(a.reliabilityChargedSeconds,0);
});
test('operating ramp consumes exposure and one threshold triggers exactly one failure',()=>{
 const model=create([{...machine,rampSeconds:1}]);const m=model.line[0];
 m.exposure=.5;
 model.step(.25);assert.equal(m.state,'Ramp up');assert.equal(m.exposure,.25);
 model.step(.25);assert.equal(m.exposure,0);assert.equal(m.failureCount,0);
 model.step(.25);assert.equal(m.state,'Failed');assert.equal(m.failureCount,1);assert.equal(m.reliabilityChargedSeconds,.5);
 for(let i=0;i<4;i++)model.step(.25);
 assert.equal(m.failureCount,1);assert.equal(m.reliabilityChargedSeconds,.5);
 assert.equal(m.restartRequests.REPAIR_COMPLETED,1);
});
test('clock stays reproducible across checkpoint restore and distinguishes disabled failures',()=>{
 const defs=[machine],model=create(defs,42),m=model.line[0];
 model.configure({failures:false});m.exposure=8;
 for(let i=0;i<8;i++)model.step(.25);
 assert(m.reliabilityExposureSeconds>0);assert.equal(m.exposure,8);assert.equal(m.reliabilityChargedSeconds,0);
 model.configure({failures:true});model.step(.25);
 const restored=create(defs,42,model.snapshot());restored.configure({failures:true});
 for(let i=0;i<100;i++){model.step(.25);restored.step(.25);}
 assert.deepEqual(restored.snapshot(),model.snapshot());
 assert.equal(m.reliabilityExposureSeconds,m.durations.running+m.durations.acceleration+m.durations.deceleration);
});
