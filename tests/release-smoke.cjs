/* Full DOM/auth/sync integration with synthetic records; fetch is mocked and never uses the network. */
const {JSDOM,VirtualConsole}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const fixtures=require('./fixtures.cjs');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../emcia.html'),'utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let op={id:'main',payload:fixtures(),revision:1},fin={id:'main',payload:{e:[{_index:1,discountTeacher:20,discountEmcia:0}]},revision:1};
let role='director',writes=0,errors=[],alerts=[];
for(const alias of ['index.html','EMCIA_Integrated_Release_Candidate.html','EMCIA_V5_15_16_Cloud_Test.html','EMCIA_V5_15_16_Supabase_Director_Test.html','EMCIA_Certification_Integration_Test.html','EMCIA_Certification_Issuance_Test.html']){
 const redirect=fs.readFileSync(path.join(__dirname,'..',alias),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
 let target;vm.runInNewContext(redirect,{URL,location:{href:'https://emcia.invalid/'+alias+'?v=103&request=example#access_token=test&type=recovery',search:'?v=103&request=example',hash:'#access_token=test&type=recovery',replace(value){target=new URL(value)}}});
 assert.equal(target.pathname,'/emcia.html');assert.equal(target.searchParams.get('v'),'2026.11.14.1');assert.equal(target.searchParams.get('request'),'example');assert.equal(target.hash,'#access_token=test&type=recovery');
}

function createDOM(){
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://emcia.invalid/emcia.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.confirm=()=>true;w.alert=x=>alerts.push(x);w.prompt=()=>null;
  w.fetch=async(url,options={})=>{
   const u=new URL(url);assert.equal(u.hostname,'gfhmkijxiinoqkxhicza.supabase.co');
   let out=[];
   if(u.pathname==='/auth/v1/token')out={access_token:'test-only',refresh_token:'test-refresh',expires_in:3600,user:{id:'test-user'}};
   else if(u.pathname.endsWith('/profiles'))out=[{role,active:true,display_name:'حساب اختبار'}];
   else if(u.pathname.includes('emcia_operational_state_v2')||u.pathname.includes('emcia_financial_state_v2')){
    const row=u.pathname.includes('operational')?op:fin;
    if(options.method==='PATCH'){if(u.searchParams.get('revision')==='eq.'+row.revision){Object.assign(row,JSON.parse(options.body));writes++;out=[row]}else out=[]}else out=[row];
   }
   return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(out))};
  };
 }});return dom;
}
async function login(dom){const w=dom.window,d=w.document;d.querySelector('#authEmail').value='test@example.invalid';d.querySelector('#authPassword').value='test-password';d.querySelector('#authForm').dispatchEvent(new w.Event('submit',{cancelable:true}));for(let i=0;i<100&&!d.body.classList.contains('emcia-authorized');i++)await wait(10);assert.ok(d.body.classList.contains('emcia-authorized'),d.querySelector('#authStatus').textContent);return w}
async function saved(w){for(let i=0;i<120&&!w.document.querySelector('#emcia-cloud-status')?.textContent.includes('تم الحفظ');i++)await wait(10);assert.match(w.document.querySelector('#emcia-cloud-status').textContent,/تم الحفظ/)}
(async()=>{
 let dom=createDOM(),w=await login(dom),d=w.document;
 try{
  assert.equal(d.querySelector('#emcia-release').textContent,'2026.11.14.1');
  w.eval("window.attDate='2026-11-14';window.attGid='';show('attendance')");
  const timed=()=>d.querySelectorAll('#attendance select[onchange^="emciaSaveTimedAttendance"]');
  assert.equal(timed().length,3);
  function select(index,status){const input=timed()[index];input.value=status;input.dispatchEvent(new w.Event('change',{bubbles:true}))}
  select(0,'absent');select(1,'present');select(2,'present');
  assert.equal(w.eval('db.at2.length'),3);assert.equal(w.eval('emciaAttendanceRecords().length'),3);
  assert.equal(w.eval("db.at2.find(x=>x.ref==='m:m1').status"),'absent');
  assert.equal(w.eval("db.at2.find(x=>x.ref==='m:m2').status"),'present');
  assert.equal(w.eval("sessionAttendanceStatus(db.sch[0],'2026-11-14').marked"),1);
  assert.equal(w.eval("sessionAttendanceStatus(db.sch[1],'2026-11-14').marked"),1);
  assert.equal(w.eval("emciaCompletedFlexibleLessons(db.e[1],'2026-11').length"),1);
  select(2,'absent');assert.equal(w.eval("emciaCompletedFlexibleLessons(db.e[1],'2026-11').length"),0);
  // Current estimates must not charge an explicitly absent flexible lesson.
  w.eval("window.emciaPaymentMode='session';window.pg='g2';show('payments')");d.querySelector('#ps').value='s1';w.emciaSessionPaymentSelection();
  assert.match(d.querySelector('#sessionPaymentSummary').textContent,/تقدير الحصص من الحضور: 0.00/);
  for(const [id,value]of Object.entries({spa:'100',spd:'2026-11-14',spr:'TEST-SESSION-1'}))d.getElementById(id).value=value;
  w.emciaAddSessionPayment();assert.equal(w.eval('db.sp.length'),1);
  const answers=['125','2026-11-14','TEST-SESSION-1','cash','advance','تم التعديل'];w.prompt=()=>answers.shift();w.eval('emciaEditSessionPayment(db.sp[0].id)');
  assert.equal(w.eval('db.sp[0].a'),125);assert.equal(w.eval("cashPaymentsForDay('2026-11-14').reduce((s,p)=>s+p.a,0)"),125);
  assert.equal(w.emciaValidDate('2026-11-14'),true);assert.equal(w.emciaValidDate('2026-02-30'),false);assert.equal(w.emciaValidDate('2026-13-01'),false);
  w.eval("window.emciaPaymentMode='monthly';window.pg='g1';show('payments')");for(const[id,value]of Object.entries({ps:'s1',pa:'200',preceipt:'TEST-SESSION-1'}))d.getElementById(id).value=value;
  w.addPayment();assert.match(alerts.pop(),/مسجل سابقاً/);assert.equal(w.eval('db.p.length'),0);
  assert.equal(w.eval("scheduleConflict({...db.sch[0]},'m1').length"),0);
  const edits=['السبت','09:30','10:30','1'];w.prompt=()=>edits.shift();w.eval("editSchedule('m1')");assert.equal(w.eval("db.sch[0].start"),'09:30');
  assert.match(w.emciaScheduleAttendance('m1'),/removeSchedule/);
assert.ok(w.eval("scheduleConflict({...db.sch[0],start:'15:00',end:'16:00'},'m1').length")>0);
  await saved(w);assert.equal(op.payload.sp[0].a,125);assert.ok(fin.payload.e.every(x=>x._id));
  dom.window.close();dom=createDOM();w=await login(dom);d=w.document;assert.equal(w.eval('db.sp[0].a'),125);assert.equal(w.eval('db.at2.length'),3);
  w.eval("removeSchedule('m1')");assert.equal(w.eval("db.sch.find(x=>x.id==='m1').active"),false);assert.equal(w.eval("db.at2.filter(x=>x.ref==='m:m1').length"),1);await saved(w);
  // Legacy financial fields must keep their target when another account deletes an earlier record.
  dom.window.close();op={id:'main',payload:fixtures(),revision:1};fin={id:'main',payload:{e:[{_index:1,discountTeacher:20}]},revision:1};role='secretary_morning';dom=createDOM();w=await login(dom);w.eval("db.e=db.e.filter(x=>x.id!=='e1');save()");await saved(w);assert.deepEqual(op.payload._legacyFinancialIds.e,['e1','e2']);
  dom.window.close();role='director';dom=createDOM();w=await login(dom);assert.equal(w.eval("db.e.find(x=>x.id==='e2').discountTeacher"),20);assert.equal(w.eval("db.e.find(x=>x.id==='e1')"),undefined);
  assert.deepEqual(errors,[]);
  console.log('PASS: actual DOM attendance handlers, independent sessions, lesson completion, receipt add/edit, cloud reload, strict dates, duplicate receipts, cash, schedule conflicts, stable IDs and legacy compatibility. Mock writes:',writes);
 }finally{dom.window.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
