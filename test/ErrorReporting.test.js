import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const read=file=>fs.readFileSync('apps-script/'+file,'utf8');
const script=file=>read(file).match(/<script>([\s\S]*?)<\/script>/)[1];
const fragment=script('Dialogs.html');
const providerSource=fragment.slice(fragment.indexOf('  function connectErrorReporting('),fragment.indexOf('  function open(options)'));

test('error reports use a configured single support mailbox and do not invent a recipient',()=>{
  const context=vm.createContext({});
  vm.runInContext(read('DeveloperConfig.gs'),context);
  assert.equal(context.getErrorReportEmail_(),'');
  context.ST_ERROR_REPORT_EMAIL=' support@company.com ';
  assert.equal(context.getErrorReportEmail_(),'support@company.com');
  for(const value of ['a@b.com,c@d.com','a@b.com;cc@d.com','a@b.com\r\nBcc:other@example.com','invalid']){
    context.ST_ERROR_REPORT_EMAIL=value;
    assert.equal(context.getErrorReportEmail_(),'');
  }
});

test('error report asks whether to attach the case and only prepares a draft on explicit opt-in',async()=>{
  const dom=new JSDOM('<meta name="st-error-report-email" content="support@company.com"><body></body>',{url:'https://example.test',runScripts:'outside-only'});
  const w=dom.window,d=w.document,opened=[];
  w.eval(read('TextResources.gs'));w.STIcons={svg:()=>'<svg></svg>'};w.open=(...args)=>opened.push(args);
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let downloads=0,captures=0,drafts=0,hasCase=true,fail=false;
  const api=w.eval('(function(){var errorReporting=null;\n'+providerSource+'\nreturn {connectErrorReporting,errorReportCompose,mountErrorReport};})()');
  api.connectErrorReporting({hasCase:()=>hasCase,captureCase:()=>{captures++;return {record:{id:'c'}};},createDraft:async()=>{drafts++;if(fail)throw Error('unavailable');return {attached:true};},downloadCase:()=>{downloads++;return {partial:false};}});
  const options={title:'Simulation error',message:'Failure & <test> / ñ',details:'Error code: E123\nTechnical trace:\nClient:15'};
  function mount(){
    const dialog=d.createElement('dialog'),body=d.createElement('div'),footer=d.createElement('footer');dialog.append(body,footer);d.body.append(dialog);api.mountErrorReport(options,dialog,body,footer);
    assert.equal(body.querySelector('.error-report-attach'),null);footer.querySelector('.error-report-button').click();
    const prompt=d.querySelector('.error-report-dialog');
    return {prompt,attach:prompt.querySelector('.error-report-attach'),proceed:prompt.querySelector('.error-report-continue'),status:prompt.querySelector('.error-report-status'),cancel:prompt.querySelector('.dialog-actions .ghost')};
  }
  try{
    let ui=mount();assert.equal(ui.attach.checked,false);assert.equal(ui.attach.disabled,false);
    await ui.proceed.onclick();assert.equal(captures,0);assert.equal(drafts,0);assert.equal(downloads,0);
    const url=new URL(opened[0][0]);assert.equal(url.origin,'https://mail.google.com');assert.equal(url.searchParams.get('to'),'support@company.com');assert.match(url.searchParams.get('body'),/Failure & <test> \/ ñ/);ui.cancel.click();
    ui=mount();ui.attach.checked=true;await ui.proceed.onclick();assert.equal(captures,1);assert.equal(drafts,1);assert.equal(downloads,0);assert.match(ui.status.textContent,/Gmail draft created with attachment/);ui.cancel.click();
    fail=true;ui=mount();ui.attach.checked=true;await ui.proceed.onclick();assert.equal(downloads,1);assert.match(ui.status.textContent,/Attach the downloaded file in Gmail/);ui.cancel.click();
    hasCase=false;ui=mount();assert(ui.attach.disabled);ui.cancel.click();
    const long=api.errorReportCompose({...options,details:'🚨 á '.repeat(16000)});assert(long.truncated);assert(long.url.length<=7500);
    d.querySelector('meta').content='';assert.equal(api.errorReportCompose(options).recipient,'');
  }finally{w.close();}
});

test('optional error attachment captures an independent case without a save or forced input validation',()=>{
  const src=read('ClientCases.html');
  const body=src.slice(src.indexOf('    function errorReportCaseSnapshot('),src.indexOf('    async function exportCompleteCase('));
  const state={activeCase:{id:'c',expectedRevision:2,simulations:[{id:'s',geminiHistory:[{text:'private'}],results:{summary:{outputCount:4}}},{id:'s2',geminiHistory:[{text:'private2'}]}]},activeSimulationId:'s'};
  const before=JSON.stringify(state),saved=[];
  const ctx=vm.createContext({state,cloneJson:v=>JSON.parse(JSON.stringify(v)),captureCaseNumerical:d=>{d.simulations[0].results.extra='history';},captureCase2D:d=>{d.simulations[0].simulation2d={checkpoint:{time:42}};},STReports:{exportCompleteCase:d=>saved.push(d)}});
  vm.runInContext(body,ctx);
  assert.equal(ctx.downloadErrorReportCase().partial,false);
  assert.equal(saved[0].simulations[0].results.extra,'history');
  assert.equal(saved[0].simulations[0].simulation2d.checkpoint.time,42);
  assert.equal(saved[0].expectedRevision,undefined);
  assert(saved[0].simulations.every(sim=>!('geminiHistory' in sim)));
  assert.equal(JSON.stringify(state),before);
  state.activeCase=null;assert.equal(ctx.downloadErrorReportCase(),null);
});
