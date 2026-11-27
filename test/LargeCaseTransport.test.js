import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';
import {webcrypto} from 'node:crypto';
const read=p=>fs.readFileSync('apps-script/'+p,'utf8');
function harness(){
 const cache=new Map(),calls=[],user={email:'owner@example.test'};
 const blob=data=>({getBytes:()=>Array.from(Buffer.from(data)),getDataAsString:()=>Buffer.from(data).toString('utf8')});
 const c=vm.createContext({Utilities:{newBlob:blob,base64Decode:s=>Array.from(Buffer.from(s,'base64')),ungzip:b=>blob(gunzipSync(Buffer.from(b.getBytes())))},CacheService:{getUserCache:()=>({get:k=>cache.get(k)||null,putAll:o=>Object.entries(o).forEach(([k,v])=>cache.set(k,v)),getAll:ks=>Object.fromEntries(ks.filter(k=>cache.has(k)).map(k=>[k,cache.get(k)])),removeAll:ks=>ks.forEach(k=>cache.delete(k))})},createSimulatorError_:(code,message)=>Object.assign(Error(message),{simulatorError:true,code})});
 vm.runInContext(read('CaseTransport.gs'),c);
 const w=vm.createContext({window:{},Blob,Response,CompressionStream,crypto:webcrypto,btoa:s=>Buffer.from(s,'binary').toString('base64')});
 vm.runInContext(read('LocalDrive.html').match(/<script>([\s\S]*?)<\/script>/)[1],w);
 const request=async(name,args)=>{calls.push(name);return name==='stageCaseTransfer'?c.stageCaseTransfer_(args[0],user):c.discardCaseTransfer_(...args);};
 return {c,w,cache,calls,user,request};
}
test('a case larger than the former 3 MB cap round-trips with native gzip, without removing evidence',async()=>{
 const h=harness(),record={id:'G',simulations:[{results:{evidence:'ñ data '.repeat(600000)}},{equipment:[{id:'new-scenario'}]}]};
 const original=JSON.stringify(record);assert(Buffer.byteLength(original)>3*1024*1024);
 const packed=await h.w.window.STCaseTransport.pack(record,h.request);assert.equal(packed.format,'gzip-base64');
 assert.equal(JSON.stringify(h.c.decodeCasePayload_(packed,h.user)),original);
});
test('staged transfers preserve exact UTF-8 content and reject missing chunks before saving',async()=>{
 const h=harness();h.w.CompressionStream=undefined;
 const record={id:'case',simulations:[{results:{evidence:'ñ'.repeat(1800000)}}]};
 const packed=await h.w.window.STCaseTransport.pack(record,h.request);assert(packed.token);assert(h.calls.length>1);
 assert.equal(JSON.stringify(h.c.decodeCasePayload_(packed,h.user)),JSON.stringify(record));assert.equal(h.cache.size,0);
 const again=await h.w.window.STCaseTransport.pack(record,h.request);h.cache.delete('st-case-transfer:'+again.token+':0');
 assert.throws(()=>h.c.decodeCasePayload_(again,h.user),/incomplete|expired/);assert.equal(h.cache.size,0);
});
test('report sanitization excludes Gemini conversations recursively without touching numerical evidence',()=>{
 const c=vm.createContext({createSimulatorError_:(code,message)=>Error(message)});
 vm.runInContext(read('ErrorReportService.gs'),c);
 const record={ownerEmail:'owner@example.test',simulations:[{geminiHistory:[{text:'secret'}],results:{summary:{outputCount:17}},metadata:{geminiConversation:['private']}}]};
 const clean=JSON.parse(c.errorReportCaseJson_(record,{email:record.ownerEmail}));
 assert.equal(clean.simulations[0].results.summary.outputCount,17);assert(!('geminiHistory' in clean.simulations[0]));assert(!('geminiConversation' in clean.simulations[0].metadata));assert(record.simulations[0].geminiHistory.length);
});
test('Basic progress is visible at header and animated controls use the shared motion helper',()=>{
 assert(!read('MinimalModeStyles.html').includes('.case-open #request-progress,'));
 assert.match(read('MinimalMode.html'),/headerProgress:headerProgress/);
 assert.match(read('MinimalMode.html'),/STMotion\.visibility\(element,visible\)/);
 assert.match(read('ClientCases.html'),/bar\.dataset\.determinate='true'/);
 assert.match(read('ShellStyles.html'),/#request-progress\[data-determinate=true\]/);
});
