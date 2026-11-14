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
let role='director',writes=0,errors=[],alerts=[],failAtomic=false,reminders=[];
for(const alias of ['index.html','EMCIA_Integrated_Release_Candidate.html','EMCIA_V5_15_16_Cloud_Test.html','EMCIA_V5_15_16_Supabase_Director_Test.html','EMCIA_Certification_Integration_Test.html','EMCIA_Certification_Issuance_Test.html']){
 const redirect=fs.readFileSync(path.join(__dirname,'..',alias),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
 let target;vm.runInNewContext(redirect,{URL,location:{href:'https://emcia.invalid/'+alias+'?v=103&request=example#access_token=test&type=recovery',search:'?v=103&request=example',hash:'#access_token=test&type=recovery',replace(value){target=new URL(value)}}});
 assert.equal(target.pathname,'/emcia.html');assert.equal(target.searchParams.get('v'),'2026.11.14.10');assert.equal(target.searchParams.get('request'),'example');assert.equal(target.hash,'#access_token=test&type=recovery');
}

function createDOM(){
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://emcia.invalid/emcia.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.confirm=()=>true;w.alert=x=>alerts.push(x);w.prompt=()=>null;
  w.fetch=async(url,options={})=>{
   const u=new URL(url);assert.equal(u.hostname,'gfhmkijxiinoqkxhicza.supabase.co');
   let out=[];
   if(u.pathname==='/auth/v1/token')out={access_token:'test-only',refresh_token:'test-refresh',expires_in:3600,user:{id:'test-user'}};
   else if(u.pathname.endsWith('/emcia_daily_payment_reminders'))out=reminders.filter(x=>u.searchParams.get('reminder_date')==='eq.'+x.reminder_date);
   else if(u.pathname.endsWith('/rpc/emcia_mark_daily_payment_reminder')){const body=JSON.parse(options.body);let row=reminders.find(x=>x.student_id===body.p_student_id&&x.reminder_date===body.p_date);if(!row){row={student_id:body.p_student_id,reminder_date:body.p_date,actor_name:role,created_at:new Date().toISOString()};reminders.push(row)}out=[row];}
   else if(u.pathname.endsWith('/rpc/emcia_load_state_v2'))out={operational:op,financial:['director','accountant'].includes(role)?fin:null};
   else if(u.pathname.endsWith('/rpc/emcia_save_state_v2')){
    const body=JSON.parse(options.body);
    if(failAtomic||body.p_operational_revision!==op.revision||body.p_financial&&body.p_financial_revision!==fin.revision)return {ok:false,status:409,json:async()=>({message:'Revision conflict'})};
    if(body.p_financial&&!['director','accountant'].includes(role))return {ok:false,status:403,json:async()=>({message:'Forbidden'})};
    op={...op,payload:body.p_operational,revision:op.revision+1};
    if(body.p_financial)fin={...fin,payload:body.p_financial,revision:fin.revision+1};
    writes++;out={operational_revision:op.revision,financial_revision:body.p_financial?fin.revision:null};
   }
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
  assert.equal(d.querySelector('#emcia-release').textContent,'2026.11.14.10');
  w.eval("window.attDate='2026-11-14';window.attGid='';show('attendance')");
  const timed=()=>d.querySelectorAll('#attendance select[onchange^="emciaSaveTimedAttendance"]');
  assert.equal(timed().length,3);
  function select(index,status){const input=timed()[index];input.value=status;input.dispatchEvent(new w.Event('change',{bubbles:true}))}
  assert.equal(d.querySelectorAll('#attendance details[open]').length,0);
  const firstLesson=()=>d.querySelector('.emcia-att-session[data-session-ref="m:m1"]');
  firstLesson().open=true;select(0,'absent');assert.equal(firstLesson().open,true);assert.equal(d.querySelector('.emcia-att-session[data-session-ref="m:m2"]').open,false);
  d.querySelector('.emcia-att-session[data-session-ref="m:m2"]').open=true;select(1,'present');select(2,'present');
  assert.equal(firstLesson().open,true);assert.equal(d.querySelector('.emcia-att-session[data-session-ref="m:m2"]').open,true);
  assert.equal(w.eval('db.at2.length'),3);assert.equal(w.eval('emciaAttendanceRecords().length'),3);
  assert.equal(w.eval("db.at2.find(x=>x.ref==='m:m1').status"),'absent');
  assert.equal(w.eval("db.at2.find(x=>x.ref==='m:m2').status"),'present');
  assert.equal(w.eval("sessionAttendanceStatus(db.sch[0],'2026-11-14').marked"),1);
  assert.equal(w.eval("sessionAttendanceStatus(db.sch[1],'2026-11-14').marked"),1);
  assert.equal(w.eval("emciaCompletedFlexibleLessons(db.e[1],'2026-11').length"),1);
  select(2,'absent');assert.equal(w.eval("emciaCompletedFlexibleLessons(db.e[1],'2026-11').length"),0);
  // Changing date retains the filter panel but does not open the previous date's lessons.
  let dateField=d.querySelector('#attendance input[type="date"]');dateField.closest('details').open=true;dateField.value='2026-11-21';dateField.dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelector('#attendance input[type="date"]').closest('details').open,true);assert.equal(d.querySelectorAll('.emcia-att-session[open]').length,0);
  // A day shortcut opens only its specific lesson, with the correct group selected.
  d.querySelector('button[onclick^="emciaOpenAttendanceSession"]').click();assert.equal(d.querySelector('.emcia-att-session[data-session-ref="m:m1"]').open,true);assert.equal(d.querySelectorAll('.emcia-att-session[open]').length,1);
  w.eval("window.attDate='2026-11-14';window.attGid='';attendance()");
  // Leaving and returning resets disclosures rather than reopening all learner lists.
  firstLesson().open=true;w.eval("show('payments');show('attendance')");assert.equal(d.querySelectorAll('#attendance details[open]').length,0);
  // Current estimates must not charge an explicitly absent flexible lesson.
  w.eval("window.emciaPaymentMode='session';window.pg='g2';show('payments')");d.querySelector('#ps').value='s1';w.emciaSessionPaymentSelection();
  assert.match(d.querySelector('#sessionPaymentSummary').textContent,/مستحق الحصص المنجزة: 0.00/);
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
  // Session accounting: cash, earnings and individual advances remain distinct.
  const seed=(data)=>w.eval('db='+JSON.stringify(data));
  const ledger=()=>JSON.parse(w.eval('JSON.stringify(emciaSessionLedger("2026-11-14"))'));
  const make=(bearer='none',discount=0)=>{const data=fixtures();data.att=[];data.at2=[];data.e[1].discountAmount=discount;data.e[1].discountBearer=bearer;data.e[1].discountStart='2026-11';data.e[1].discountTeacher=3;data.e[1].discountEmcia=7;return data;};
  for(const [bearer,expected]of [['none',25],['teacher',15],['emcia',25],['half',20],['custom',22]]){
   const data=make(bearer,bearer==='none'?0:10),net=50-(bearer==='none'?0:10);data.sp=[{id:'r1',sid:'s1',gid:'g2',a:15,date:'2026-11-14'},{id:'r2',sid:'s1',gid:'g2',a:net-15,date:'2026-11-14'}];seed(data);const result=ledger();
   assert.equal(result.allocations.reduce((s,x)=>s+x.teacher,0),expected,bearer);assert.equal(result.allocations.reduce((s,x)=>s+x.teacher+x.emcia,0),net);assert.equal(result.credits.length,0);
   assert.equal(w.teacherCalculatedDue('t1','2026-11'),expected);
   assert.equal(w.adminExportData('2026-11').reduce((s,x)=>s+x.paid,0),net);
   const teacher=w.teacherReportHTML('t1','2026-11');assert.doesNotMatch(teacher,/حصة EMCIA|حصة المؤسسة/);assert.match(teacher,new RegExp(expected.toFixed(2)));
  }
  // Advance received in October becomes earnings only after a November lesson.
  let data=make();data.sp=[{id:'advance',sid:'s1',gid:'g2',a:100,date:'2026-10-20'}];seed(data);
  assert.equal(w.emciaSessionBalance('s1','g2','2026-10-31').credit,100);
  assert.equal(w.dashboardStats('2026-10').gross,100);assert.equal(w.dashboardStats('2026-10').prof,0);assert.equal(w.dashboardStats('2026-10').em,0);
  assert.equal(w.dashboardStats('2026-11').gross,0);assert.equal(w.dashboardStats('2026-11').prof,25);assert.equal(w.dashboardStats('2026-11').em,25);assert.equal(w.emciaSessionBalance('s1','g2','2026-11-14').credit,50);
  w.eval("window.bm='2026-11';budget()");assert.match(d.querySelector('#budget').textContent,/الرصيد المسبق/);
  w.eval("show('reportcenter')");d.querySelector('#rcType').value='financial';d.querySelector('#rcMonth').value='2026-11';w.rcBuildReport();assert.match(d.querySelector('#rcPreview').textContent,/حسابات الأداء بالحصة/);
  // Late and partial payment leaves an individual debt and recognizes only what was collected.
  data=make();data.e[1].start='2026-10-01';data.sc[0].date='2026-10-20';data.sp=[{id:'late',sid:'s1',gid:'g2',a:30,date:'2026-11-10'}];seed(data);
  assert.equal(w.emciaSessionBalance('s1','g2','2026-10-31').debt,50);assert.equal(w.emciaSessionBalance('s1','g2','2026-11-14').debt,20);assert.equal(w.teacherCalculatedDue('t1','2026-11'),15);assert.equal(w.teacherCalculatedDue('t1','2026-10'),0);
  // Two completed sessions in one day count twice. Other learners never fund this learner's lessons.
  data=make();data.sc.push({...data.sc[0],id:'f2',time:'14:00',end:'15:00'});data.sp=[{id:'other',sid:'s2',gid:'g2',a:200,date:'2026-11-14'}];seed(data);assert.equal(w.emciaSessionBalance('s1','g2','2026-11-14').due,100);assert.equal(w.emciaSessionBalance('s1','g2','2026-11-14').paid,0);
  // Deleting a receipt changes the derived balance without leaving duplicate financial records.
  data=make();data.sp=[{id:'partial',sid:'s1',gid:'g2',a:30,date:'2026-11-14'}];seed(data);assert.equal(w.teacherCalculatedDue('t1','2026-11'),15);w.eval('db.sp=[]');assert.equal(w.teacherCalculatedDue('t1','2026-11'),0);
  // Daily monthly reminders: today's timetable, unique learners, composite payments and independent filters.
  data=make();data.g.push({id:'g3',n:'فوج ثان',tid:'t1',f:100,r:50,active:true});data.e.push({id:'e3',sid:'s1',gid:'g3',active:true,start:'2026-11-01',billingMode:'monthly'});data.sch.push({id:'m3',gid:'g3',day:'السبت',start:'08:00',end:'09:00',active:true,rid:'room30'});
  data.p=[{id:'comp',sid:'s1',gid:'g1',date:'2026-11-14',a:100,allocMonth:'2026-11',type:'composite',allocations:[{month:'2026-11',amount:50},{month:'2026-12',amount:50}]}];
  data.s.push({id:'paid',n:'مؤد بالكامل',active:true},{id:'future',n:'بداية لاحقة',active:true});data.e.push({id:'epaid',sid:'paid',gid:'g1',active:true,start:'2026-11-01'},{id:'efuture',sid:'future',gid:'g1',active:true,start:'2026-11-20'});data.p.push({id:'paidreceipt',sid:'paid',gid:'g1',a:200,date:'2026-11-14',allocMonth:'2026-11'});data.at2=[{id:'a1',sid:'s1',gid:'g3',date:'2026-11-14',ref:'m:m3',status:'present'}];seed(data);
  let daily=w.emciaDailyPaymentRows('2026-11-14');assert.equal(daily.length,1);assert.equal(daily[0].first,'08:00');assert.equal(daily[0].remaining,250);assert.equal(daily[0].details.length,2);assert.equal(daily[0].present,true);
  assert.equal(w.emciaDailyPaymentRows('2026-11-14',{status:'partial'})[0].remaining,150);assert.equal(w.emciaDailyPaymentRows('2026-11-14',{status:'unpaid'})[0].remaining,100);assert.equal(w.emciaDailyPaymentRows('2026-11-14',{group:'g2'}).length,0);assert.equal(w.emciaDailyPaymentRows('2026-11-14',{status:'previous'}).length,0);
  assert.equal(w.emciaDailyPaymentRows('2026-12-12',{status:'previous'})[0].remaining,250);
  w.eval("window.dailyDate='2026-11-14';show('daily')");await wait(20);assert.match(d.querySelector('#daily-payment-alerts-content').textContent,/250.00/);
  assert.equal(d.querySelector('#daily-payment-count-value').textContent,'1');assert.equal(d.querySelectorAll('#daily .daily-stats-grid>.card').length,6);
  d.querySelector('#dailyPaymentGroup').value='g3';d.querySelector('#dailyPaymentGroup').dispatchEvent(new w.Event('change'));assert.match(d.querySelector('#daily-payment-alerts-content').textContent,/100.00/);d.querySelector('#dailyPaymentStatus').value='previous';d.querySelector('#dailyPaymentStatus').dispatchEvent(new w.Event('change'));assert.match(d.querySelector('#daily-payment-alerts-content').textContent,/عدد المتعلمين: 0/);assert.equal(d.querySelector('#daily-payment-count-value').textContent,'1');
  d.querySelector('#daily-payment-count-card').click();assert.equal(d.querySelector('#dailyPaymentGroup').value,'');assert.match(d.querySelector('#daily-payment-alerts-content').textContent,/250.00/);
  d.querySelector('#dailyPaymentPresent').value='present';d.querySelector('#dailyPaymentPresent').dispatchEvent(new w.Event('change'));assert.match(d.querySelector('#daily-payment-alerts-content').textContent,/250.00/);
  await w.emciaMarkDailyReminder('s1');assert.equal(reminders.length,1);assert.match(d.querySelector('#daily-payment-alerts-content').textContent,/director/);
  role='secretary_evening';await w.emciaMarkDailyReminder('s1');assert.equal(reminders.length,1);assert.equal(reminders[0].actor_name,'director');role='director';
  // Payment shortcut preselects both the monthly group and learner.
  d.querySelector('#daily-pay-s1').value='g1';d.querySelector('button[onclick^="emciaDailyPay"]').click();assert.equal(d.querySelector('#ps').value,'s1');assert.equal(w.eval('window.pg'),'g1');
  w.eval("db.p.push({id:'settle1',sid:'s1',gid:'g1',a:150,date:'2026-11-14',allocMonth:'2026-11'},{id:'settle2',sid:'s1',gid:'g3',a:100,date:'2026-11-14',allocMonth:'2026-11'});save()");assert.equal(w.emciaDailyPaymentRows('2026-11-14').length,0);assert.equal(d.querySelector('#daily-payment-count-value').textContent,'0');await saved(w);
  // A cloud conflict must preserve both remote payloads; there is no sequential-write fallback.
  failAtomic=true;const beforeOp=JSON.stringify(op),beforeFin=JSON.stringify(fin);let rejected=false;try{await w.EMCIA_CLOUD_SYNC.restore(fixtures())}catch{rejected=true}assert.equal(rejected,true);assert.equal(JSON.stringify(op),beforeOp);assert.equal(JSON.stringify(fin),beforeFin);failAtomic=false;
  // Legacy financial fields must keep their target when another account deletes an earlier record.
  dom.window.close();op={id:'main',payload:fixtures(),revision:1};fin={id:'main',payload:{e:[{_index:1,discountTeacher:20}]},revision:1};role='secretary_morning';dom=createDOM();w=await login(dom);w.eval("db.e=db.e.filter(x=>x.id!=='e1');save()");await saved(w);assert.deepEqual(op.payload._legacyFinancialIds.e,['e1','e2']);
  dom.window.close();role='director';dom=createDOM();w=await login(dom);assert.equal(w.eval("db.e.find(x=>x.id==='e2').discountTeacher"),20);assert.equal(w.eval("db.e.find(x=>x.id==='e1')"),undefined);
  assert.deepEqual(errors,[]);
  console.log('PASS: actual DOM attendance handlers, independent sessions, lesson completion, receipt add/edit, cloud reload, strict dates, duplicate receipts, cash, schedule conflicts, stable IDs, legacy compatibility, atomic conflict rollback, advances, late/partial payments, discount bearers, individual balances, reports, teacher privacy and daily payment reminders/filtering/deduplication. Mock writes:',writes);
 }finally{dom.window.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
