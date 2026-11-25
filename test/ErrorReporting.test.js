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

test('error report composes Gmail locally with optional case download and an explicit send step',()=>{
  const dom=new JSDOM('<meta name="st-error-report-email" content="support@company.com"><body></body>',{url:'https://example.test',runScripts:'outside-only'});
  const w=dom.window,d=w.document,opened=[];
  w.eval(read('TextResources.gs'));w.STIcons={svg:()=>'<svg></svg>'};
  w.open=(...args)=>opened.push(args);
  let downloads=0,hasCase=true,fail=false,partial=false;
  const api=w.eval('(function(){var errorReporting=null;\n'+providerSource+'\nreturn {connectErrorReporting,errorReportCompose,mountErrorReport};})()');
  api.connectErrorReporting({hasCase:()=>hasCase,downloadCase:()=>{downloads++;if(fail)throw Error('case unavailable');return {partial};}});
  const options={title:'Simulation error',message:'Failure & <test> / ñ',details:'Error code: E123\nTechnical trace:\nClient:15'};
  function mount(){
    const dialog=d.createElement('dialog'),body=d.createElement('div'),footer=d.createElement('footer');
    dialog.append(body,footer);d.body.append(dialog);api.mountErrorReport(options,dialog,body,footer);
    return {dialog,attach:body.querySelector('.error-report-attach'),button:footer.querySelector('.error-report-button'),status:body.querySelector('.error-report-status'),retry:body.querySelector('.error-report-retry')};
  }
  try{
    let ui=mount();
    assert.equal(ui.attach.checked,false);assert.equal(ui.attach.disabled,false);
    ui.button.click();
    assert.equal(downloads,0);
    const url=new URL(opened[0][0]);
    assert.equal(url.origin,'https://mail.google.com');
    assert.equal(url.searchParams.get('to'),'support@company.com');
    assert.match(url.searchParams.get('body'),/Failure & <test> \/ ñ/);
    assert.match(url.searchParams.get('body'),/Client:15/);
    assert.equal(ui.retry.hidden,false);
    ui.attach.checked=true;ui.attach.dispatchEvent(new w.Event('change'));ui.button.click();
    assert.equal(downloads,1);assert.equal(opened.length,2);
    assert.match(ui.status.textContent,/Attach the downloaded file in Gmail/);
    partial=true;ui.button.click();assert.match(ui.status.textContent,/some live detail could not be captured/);
    fail=true;ui.button.click();assert.equal(opened.length,3);assert.match(ui.status.textContent,/could not be prepared/);
    hasCase=false;ui=mount();assert(ui.attach.disabled);ui.button.click();assert.equal(opened.length,4);
    const long=api.errorReportCompose({...options,details:'🚨 á '.repeat(16000)});
    assert(long.truncated);assert(long.url.length<=7500);assert.match(new URL(long.url).searchParams.get('body'),/paste the complete diagnostic/);
    d.querySelector('meta').content='';assert.equal(api.errorReportCompose(options).recipient,'');
  }finally{w.close();}
});

test('optional error attachment captures an independent case without a save or forced input validation',()=>{
  const src=read('ClientCases.html');
  const body=src.slice(src.indexOf('    function downloadErrorReportCase('),src.indexOf('    async function exportCompleteCase('));
  const state={activeCase:{id:'c',expectedRevision:2,simulations:[{id:'s',results:{summary:{outputCount:4}}}]},activeSimulationId:'s'};
  const before=JSON.stringify(state),saved=[];
  const ctx=vm.createContext({state,cloneJson:v=>JSON.parse(JSON.stringify(v)),captureCaseNumerical:d=>{d.simulations[0].results.extra='history';},captureCase2D:d=>{d.simulations[0].simulation2d={checkpoint:{time:42}};},STReports:{exportCompleteCase:d=>saved.push(d)}});
  vm.runInContext(body,ctx);
  assert.equal(ctx.downloadErrorReportCase().partial,false);
  assert.equal(saved[0].simulations[0].results.extra,'history');
  assert.equal(saved[0].simulations[0].simulation2d.checkpoint.time,42);
  assert.equal(saved[0].expectedRevision,undefined);
  assert.equal(JSON.stringify(state),before);
  state.activeCase=null;assert.equal(ctx.downloadErrorReportCase(),null);
});
