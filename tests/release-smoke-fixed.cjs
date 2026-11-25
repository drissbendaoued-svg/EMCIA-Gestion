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
 assert.equal(target.pathname,'/emcia.html');assert.equal(target.searchParams.get('v'),'2026.11.17.2');assert.equal(target.searchParams.get('request'),'example');assert.equal(target.hash,'#access_token=test&type=recovery');
}

function createDOM(){
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://emcia.invalid/emcia.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  const RuntimeDate=w.Date;w.Date=class extends RuntimeDate{constructor(...args){super(...(args.length?args:['2026-11-14T12:00:00Z']))}static now(){return new RuntimeDate('2026-11-14T12:00:00Z').getTime()}};
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
  assert.equal(d.querySelector('#emcia-release').textContent,'2026.11.17.2');
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
  const edits=['السبت','09:30','10:30','1','1'];w.prompt=()=>edits.shift();w.eval("editSchedule('m1')");assert.equal(w.eval("db.sch[0].start"),'09:30');
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
  w.eval("show('reportcenter')");w.rcChooseCategory('student');d.querySelector('#rcType').value='studentAccounts';d.querySelector('#rcMonth').value='2026-11';w.rcBuildReport();assert.match(d.querySelector('#rcPreview .rc-paper').textContent,/أداء المتعلمين/);
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
  // Common metric presentation preserves calculations, form controls and live cash targets.
  data=make();data.p=[{id:'layout-payment',sid:'s1',gid:'g1',a:200,d:100,e:100,date:'2026-11-14',receiptMonth:'2026-11',allocMonth:'2026-11',method:'cash'}];seed(data);
  w.eval("window.tpTid='t1';window.tpMonth='2026-11';teacherpay()");
  assert.equal(d.querySelectorAll('#teacherpay .emcia-metric-card').length,3);assert.equal(d.querySelectorAll('#teacherpay .emcia-metric-head svg').length,3);
  assert.deepEqual([...d.querySelectorAll('#teacherpay .emcia-metric-label')].map(x=>x.textContent),['المستحق','المستلم','المتبقي']);
  assert.equal(d.querySelector('#tpDue').value,'100.00');assert.match(d.querySelector('#teacherpay .metric-status-bar').textContent,/لم يؤد بعد/);
  w.tpConfirmCalculated();assert.equal(d.querySelector('#tpDue').value,'100.00');
  w.cashbox();const cashTarget=d.querySelector('#cbcashin');w.cashboxRefresh();assert.equal(d.querySelector('#cbcashin'),cashTarget);assert.equal(cashTarget.textContent,'200.00 DH');assert.equal(d.querySelectorAll('#cashbox .emcia-metric-card').length,6);
  w.eval("window.bm='2026-11';budget()");assert.equal(d.querySelectorAll('#budget .emcia-metric-card').length,8);assert.equal(w.dashboardStats('2026-11').gross,200);
  w.applyLang();w.applyLang();assert.equal(d.querySelectorAll('#teacherpay .emcia-metric-head svg').length,3);
  w.setLang('fr');assert.deepEqual([...d.querySelectorAll('#teacherpay .emcia-metric-label')].map(x=>x.textContent),['Dû','Reçu','Reste']);w.setLang('ar');
  // Selecting a learner must preserve the full-width payment grid rather than collapse it into one column.
  data=make();seed(data);w.eval("window.pg='g1';window.emciaPaymentMode='monthly';payments()");
  assert.equal(d.querySelector('#regularPaymentBox').style.display,'grid');
  d.querySelector('#ps').value='s1';d.querySelector('#ps').dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelector('#regularPaymentBox').style.display,'grid');
  assert.equal(w.getComputedStyle(d.querySelector('#regularPaymentBox')).gridColumn,'1/-1');
  assert.equal(d.querySelector('#paymentReceiptHelp').open,false);
  w.eval("window.emciaPaymentMode='session';emciaSessionPaymentSelection()");assert.equal(d.querySelector('#regularPaymentBox').style.display,'none');
  w.eval("window.emciaPaymentMode='monthly';emciaSessionPaymentSelection()");assert.equal(d.querySelector('#regularPaymentBox').style.display,'grid');
  // Lesson-based monthly agreement is separate from actual cash, limited to its month.
  data=make();data.e[0].start='2026-11-10';seed(data);
  w.eval("window.pg='g1';window.emciaPaymentMode='monthly';payments()");d.querySelector('#ps').value='s1';d.querySelector('#pty').value='settlement';w.toggleCompositePayment();
  assert.equal(d.querySelector('#pSettlement').hidden,false);assert.equal(d.querySelector('#settleFrom').value,'2026-11-10');
  assert.equal(d.querySelector('#settleCount').value,'6');assert.equal(d.querySelector('#settleUnit').value,'25');
  w.emciaUseSettlementAmount();assert.equal(d.querySelector('#pa').value,'150.00');
  d.querySelector('#pa').value='50';d.querySelector('#preceipt').value='period-1';w.addPayment();
  assert.equal(w.eval("db.p[0].type"),'settlement');assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-11')"),150);assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-12')"),200);
  assert.equal(w.eval('db.p[0].d'),25);assert.equal(w.eval('db.p[0].e'),25);assert.equal(w.eval('db.p[0].a'),50);
  // Saving revised terms alone never records cash. Existing payments leave only the real balance.
  d.querySelector('#ps').value='s1';d.querySelector('#pty').value='settlement';w.toggleCompositePayment();d.querySelector('#settleCount').value='4';w.emciaSaveBillingAgreement();
  assert.equal(w.eval('db.p.length'),1);assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-11')"),100);assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-12')"),200);
  // Different start days count lessons in the covered interval, rather than calendar-day prorating.
  assert.equal(w.emciaScheduledCount('g1','2026-11-15','2026-11-30'),4);assert.equal(w.emciaScheduledCount('g1','2026-11-20','2026-11-30'),4);assert.equal(w.emciaScheduledCount('g1','2026-11-25','2026-11-30'),2);
  // Invalid dates/counts and already-paid teacher periods cannot mutate the billing agreement.
  d.querySelector('#settleTo').value='2026-12-01';const termsBefore=w.eval('JSON.stringify(db.e[0].monthlySettlements)');w.emciaSaveBillingAgreement();assert.equal(w.eval('JSON.stringify(db.e[0].monthlySettlements)'),termsBefore);
  w.emciaSettlementPanel();w.eval("db.tp.push({id:'paid-teacher',tid:'t1',month:'2026-11',amount:25})");d.querySelector('#settleCount').value='2';w.emciaSaveBillingAgreement();assert.equal(w.eval('JSON.stringify(db.e[0].monthlySettlements)'),termsBefore);w.eval('db.tp=[]');
  // Discount follows its bearer and is prorated using the lesson agreement; the next month is regular.
  w.eval("Object.assign(db.e[0],{discountAmount:20,discountBearer:'teacher',discountStart:'2026-11',discountTerm:'until_stop'});save()");
  assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-11')"),90);assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-12')"),180);
  assert.equal(w.eval("Math.round(paymentSplit('s1','g1',90,'2026-11').teacher*100)/100"),40);
  // Stop is available directly in learner editing; it ends all enrollments but preserves historical debt and cash.
  data=make();data.sc=[];data.p=[{id:'nov',sid:'s1',gid:'g1',a:50,date:'2026-11-14',allocMonth:'2026-11',receiptMonth:'2026-11'},{id:'future',sid:'s1',gid:'g1',a:200,date:'2026-11-14',allocMonth:'2026-12',receiptMonth:'2026-11'}];seed(data);
  w.students();w.editStudentRegistration('s1');d.querySelector('#studyStatus').value='stopped';d.querySelector('#studyEnd').value='2026-11-20';d.querySelector('#studyStopCharge').value='yes';w.emciaSaveStudy('s1');
  assert.equal(w.eval("db.s[0].studyStatus"),'stopped');assert.equal(w.eval('db.e.every(e=>e.end==="2026-11-20"&&!e.active)'),true);
  assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-11')"),200);assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-12')"),0);assert.equal(w.eval("activeEnrollmentsForMonth('2026-12').length"),0);
  assert.equal(w.eval("db.p.find(p=>p.id==='future').d"),0);assert.equal(w.eval("db.p.find(p=>p.id==='future').e"),0);assert.equal(w.eval("db.p.find(p=>p.id==='future').creditAmount"),200);assert.equal(w.eval('db.p.reduce((n,p)=>n+p.a,0)'),250);
  assert.equal(w.teacherCalculatedDue('t1','2026-12'),0);assert.equal(w.emciaEnrollmentDate(w.eval('db.e[0]'),'2026-11-14'),true);assert.equal(w.emciaEnrollmentDate(w.eval('db.e[0]'),'2026-11-21'),false);
  w.eval("window.arm='2027-01';arrears()");assert.match(d.querySelector('#arrears').textContent,/150/);assert.doesNotMatch(d.querySelector('#arrears').textContent,/2026-12،/);
  w.eval("window.sfSid='s1';studentfile()");assert.match(d.querySelector('#studentfile').textContent,/متوقف عن الدراسة/);assert.match(d.querySelector('#studentfile').textContent,/رصيد يحتاج مراجعة/);
  // Last partial month can be settled after stopping; no future receipt can be booked.
  w.eval("window.pg='g1';payments()");d.querySelector('#ps').value='s1';d.querySelector('#pty').value='settlement';w.toggleCompositePayment();assert.equal(d.querySelector('#settleTo').value,'2026-11-20');assert.equal(d.querySelector('#settleCount').value,'4');w.emciaSaveBillingAgreement();
  assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-11')"),100);assert.equal(w.eval("db.p.find(p=>p.id==='nov').d"),25);
  d.querySelector('#pam').value='2026-12';d.querySelector('#pa').value='100';d.querySelector('#preceipt').value='blocked-future';d.querySelector('#pty').value='payment';w.addPayment();assert.equal(w.eval('db.p.length'),2);
  // Reload recomputes exactly the same agreement, historical teacher share, future credit and stop dates.
  w.eval('save()');await saved(w);dom.window.close();dom=createDOM();w=await login(dom);d=w.document;
  assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-11')"),100);assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2026-12')"),0);assert.equal(w.eval("db.p.find(p=>p.id==='nov').d"),25);assert.equal(w.eval("db.p.find(p=>p.id==='future').creditAmount"),200);assert.equal(w.eval("db.s[0].stoppedOn"),'2026-11-20');
  // A later re-enrollment uses its own period; the stopped gap remains uncharged.
  w.eval("db.e.push({id:'return',sid:'s1',gid:'g1',active:true,billingMode:'monthly',start:'2027-02-01'});save()");
  assert.equal(w.eval("dueForEnrollmentMonth(db.e[0],'2027-01')"),0);assert.equal(w.eval("enrollmentFor('s1','g1','2026-11').id"),'e1');assert.equal(w.eval("enrollmentFor('s1','g1','2027-02').id"),'return');assert.equal(w.eval("dueForEnrollmentMonth(db.e.find(e=>e.id==='return'),'2027-02')"),200);
  assert.equal(w.eval("db.p.find(p=>p.id==='future').d"),0);assert.equal(w.eval("db.p.find(p=>p.id==='future').creditAmount"),200);
  // Session audit regression: one legacy attendance, two receipts, shared discount, independent learner IDs.
  data=make();data.sc=[];data.att=[{id:'legacy-session',sid:'s1',gid:'g2',date:'2026-11-13',status:'present'}];
  Object.assign(data.e[1],{sessionPrice:100,discountAmount:20,discountBearer:'half'});
  data.s.push({id:'s-duplicate-name',n:'متعلم اختبار',active:true});data.e.push({...data.e[1],id:'e-separate',sid:'s-duplicate-name'});
  data.sp=[{id:'session-cash-1',sid:'s1',gid:'g2',a:80,date:'2026-11-13'},{id:'session-cash-2',sid:'s1',gid:'g2',a:80,date:'2026-11-13'}];seed(data);
  assert.equal(w.emciaSessionLedger().lessons.length,1);assert.equal(w.emciaSessionBalance('s1','g2').credit,80);
  assert.equal(w.emciaSessionBalance('s-duplicate-name','g2').paid,0);
  assert.equal(w.teacherCalculatedDue('t1','2026-11'),40);assert.equal(w.dashboardStats('2026-11').em,40);assert.equal(w.dashboardStats('2026-11').gross,160);
  assert.equal(w.eval("emciaAnalysisDue(db.e[1],'2026-11')"),80);
  assert.equal(w.emciaAnalysisPayments('2026-11').reduce((sum,p)=>sum+p.a,0),80);
  w.eval("window.fam='2026-11';show('analysis')");
  const analysisTeacherRow=[...d.querySelectorAll('#analysis tr')].find(r=>r.textContent.includes('أستاذ اختبار'));
  assert.deepEqual([...analysisTeacherRow.cells].slice(3).map(c=>c.textContent),['280.00 DH','80.00 DH','200.00 DH','28.6%','40.00 DH']);
  w.eval("window.rm='2026-11';window.rg='g2';window.rt='t1';show('reports')");
  assert.match(d.querySelector('#legacyTeacherSummary').textContent,/160.00 DH/);assert.match(d.querySelector('#legacyTeacherSummary').textContent,/مستحق الأستاذ: 40.00 DH/);
  const sessionGroupRow=[...d.querySelectorAll('#reports tr')].find(r=>r.cells[0]?.textContent==='متعلم اختبار');
  assert.equal(sessionGroupRow.cells[4].textContent,'80,00');assert.equal(sessionGroupRow.cells[5].textContent,'80,00');
  w.eval("show('reportcenter')");d.querySelector('#rcType').value='executive';d.querySelector('#rcMonth').value='2026-11';w.rcBuildReport();
  const reportRows=()=>[...d.querySelectorAll('#rcPreview tr')];
  assert.match(reportRows().find(r=>r.cells[0]?.textContent==='المستحقات عن الشهر').textContent,/280.00/);
  assert.match(reportRows().find(r=>r.cells[0]?.textContent==='المحصل عن استحقاقات الشهر').textContent,/80.00/);
  // A late receipt belongs to its lesson month for collection analysis, and recognition month for earnings.
  w.eval("db.e[1].start='2026-10-01';db.e[1].discountStart='2026-10';db.att[0].date='2026-10-20';db.sp=db.sp.slice(0,1);db.sp[0].date='2026-11-10'");
  assert.equal(w.eval("emciaAnalysisDue(db.e[1],'2026-10')"),80);assert.equal(w.emciaAnalysisPayments('2026-10').reduce((sum,p)=>sum+p.a,0),80);
  assert.equal(w.emciaAnalysisPayments('2026-11').reduce((sum,p)=>sum+p.a,0),0);assert.equal(w.teacherCalculatedDue('t1','2026-11'),40);assert.equal(w.teacherCalculatedDue('t1','2026-10'),0);
  // Learner filters read actual control IDs, combine criteria, and retain headers with zero matches.
  data=make();data.s=[
   {id:'filter-1',n:'آدم',nAr:'آدم',nFr:'Adam Test',level:'A1',ph:'0600111222',active:true,requestedSubjectLevels:[{subject:'الألمانية',level:'A1'}]},
   {id:'filter-2',n:'سلمى',level:'A2',ph:'0600333444',active:true,requestedSubjectLevels:[]},
   {id:'filter-3',n:'ياسين',level:'A10',ph:'0600555666',active:true,requestedSubjectLevels:[{subject:'الألمانية',level:'A10'}]}
  ];
  data.g[0].subject='الألمانية';data.g[1].subject='الفرنسية';
  data.e=data.s.map((s,i)=>({id:'filter-e'+i,sid:s.id,gid:i===1?'g2':'g1',active:true,start:'2026-11-01',billingMode:'monthly'}));seed(data);w.eval("show('students')");
  const visibleStudents=()=>[...d.querySelectorAll('#studentRecordsTable tr[data-student-id]')].filter(r=>r.style.display!=='none').map(r=>r.dataset.studentId).sort();
  const filterStudent=(suffix,value)=>{const el=d.getElementById('studentTableQuery'+suffix);el.value=value;el.dispatchEvent(new w.Event(suffix?'change':'input',{bubbles:true}))};
  assert.deepEqual(visibleStudents(),['filter-1','filter-2','filter-3']);
  filterStudent('','آدم');assert.deepEqual(visibleStudents(),['filter-1']);
  filterStudent('','0600333');assert.deepEqual(visibleStudents(),['filter-2']);
  filterStudent('','adam');assert.deepEqual(visibleStudents(),['filter-1']);filterStudent('','');
  // Subject/Level filter controls were removed from the student list UI (Nov 2026 redesign); only text, group and status filters remain.
  filterStudent('Group','g1');assert.deepEqual(visibleStudents(),['filter-1','filter-3']);
  filterStudent('','0600111');assert.deepEqual(visibleStudents(),['filter-1']);
  filterStudent('','لا يوجد اسم مماثل');assert.deepEqual(visibleStudents(),[]);assert.equal(d.querySelector('#studentRecordsTable tr').style.display,'');
  filterStudent('','');filterStudent('Group','');assert.equal(visibleStudents().length,3);
  // Additional income: direct save, batch save, lower table, monthly totals and persisted reload.
  data=make();seed(data);w.eval("show('expenses')");
  const fillIncome=(cat,amount,date='2026-11-14')=>{
   for(const[id,value]of Object.entries({oc:cat,oa:amount,om:date,oiGroup:'g1',oiStudent:'s1',oiReceipt:'EXTRA-1',on:'رسوم اختبار'}))d.getElementById(id).value=value;
  };
  fillIncome('التسجيل','37.50');d.querySelector('button[onclick="addOther()"]').click();
  assert.equal(w.eval('db.oi.length'),1);assert.equal(w.eval('db.oi[0].a'),37.5);assert.equal(w.eval('db.oi[0].sid'),'s1');
  assert.match(d.querySelector('#oiRegistered').textContent,/EXTRA-1/);assert.equal(d.querySelector('#oiRegisteredTotal').textContent,'37.50 DH');
  fillIncome('التأمين (مبالغ محصلة)','12.25');d.querySelector('button[onclick="emciaExtraAdd()"]').click();
  assert.equal(w.eval('db.oi.length'),1);assert.match(d.querySelector('#oiDraft').textContent,/12.25/);
  fillIncome('التسجيل','20');d.querySelector('button[onclick="emciaExtraAdd()"]').click();
  d.querySelector('button[onclick="addOther()"]').click();assert.equal(w.eval('db.oi.length'),3);
  assert.equal(d.querySelector('#oiRegisteredTotal').textContent,'69.75 DH');assert.equal(w.dashboardStats('2026-11').other,69.75);
  w.eval("window.bm='2026-11';budget()");assert.match(d.querySelector('#budget').textContent,/69.75/);
  for(const type of ['monthly','executive']){
   w.eval("show('reportcenter')");w.rcChooseCategory('management');d.querySelector('#rcType').value=type;d.querySelector('#rcMonth').value='2026-11';w.rcBuildReport();
   assert.match(d.querySelector('#rcPreview').textContent,/69.75/);
  }
  // The secretary financial report deliberately hides institution income/expense totals.
  w.eval("show('reportcenter')");w.rcChooseCategory('secretary');d.querySelector('#rcType').value='financial';d.querySelector('#rcMonth').value='2026-11';w.rcBuildReport();
  assert.doesNotMatch(d.querySelector('#rcPreview').textContent,/69.75/);
  w.eval('save()');await saved(w);assert.equal(fin.payload.oi.length,3);
  dom.window.close();role='accountant';dom=createDOM();w=await login(dom);d=w.document;
  assert.equal(w.eval('db.oi.length'),3);assert.equal(w.dashboardStats('2026-11').other,69.75);
  w.eval("show('expenses')");assert.equal(d.querySelector('#oiRegisteredTotal').textContent,'69.75 DH');
  // Editing the receipt date moves both table display and budget/report accounting into the same month.
  let answersIncome=['40.25','2026-12-03'];w.prompt=()=>answersIncome.shift();w.eval("editSimple('oi',db.oi[0].id)");
  assert.equal(w.eval('db.oi[0].date'),'2026-12-03');assert.equal(w.eval('db.oi[0].month'),'2026-12');
  assert.equal(w.dashboardStats('2026-11').other,32.25);assert.equal(w.dashboardStats('2026-12').other,40.25);
  // Empty, negative and invalid dates do not change stored amounts or dates.
  const incomeBefore=w.eval('JSON.stringify(db.oi)');
  for(const inputs of [['-1'],[''],['50','2026-02-30']]){answersIncome=inputs;w.eval("editSimple('oi',db.oi[0].id)");assert.equal(w.eval('JSON.stringify(db.oi)'),incomeBefore)}
  fillIncome('التسجيل','-5');w.addOther();assert.equal(w.eval('db.oi.length'),3);
  d.querySelector('#oa').value='';d.querySelector('#oc').value='';w.addOther();assert.equal(w.eval('db.oi.length'),3);
  // Delete updates totals, and legacy month-only records remain included in reports.
  w.eval("delTx('oi',db.oi[0].id)");assert.equal(w.dashboardStats('2026-12').other,0);assert.equal(d.querySelector('#oiRegisteredTotal').textContent,'32.25 DH');
  w.eval("db.oi.push({id:'legacy-income',cat:'التسجيل',a:7,month:'2026-11'});db.x.push({id:'legacy-expense',a:5,month:'2026-11'});db.sv.push({id:'legacy-saving',a:2,month:'2026-11'});save()");
  assert.equal(w.dashboardStats('2026-11').other,39.25);
  for(const type of ['monthly','executive']){
   w.eval("show('reportcenter')");w.rcChooseCategory('management');d.querySelector('#rcType').value=type;d.querySelector('#rcMonth').value='2026-11';w.rcBuildReport();
   const row=[...d.querySelectorAll('#rcPreview tr')].find(x=>x.textContent.includes('مداخيل أخرى'));
   assert.match(row.textContent,/39.25/);
   assert.match([...d.querySelectorAll('#rcPreview tr')].find(x=>x.textContent.includes('المصاريف')).textContent,/5.00/);
   assert.match([...d.querySelectorAll('#rcPreview tr')].find(x=>x.textContent.includes('الادخار')).textContent,/2.00/);
  }
  await saved(w);dom.window.close();role='director';dom=createDOM();w=await login(dom);d=w.document;
  assert.equal(w.eval('db.oi.length'),3);assert.equal(w.dashboardStats('2026-11').other,39.25);assert.equal(w.dashboardStats('2026-12').other,0);
  // Institutional recurring reminders: configuration never books expenses; only linked payments settle a month.
  data=make();data.obligations=[];seed(data);w.eval("window.obligationMonth='2026-11';show('expenses')");
  const obFill=(fields)=>{for(const[id,value]of Object.entries(fields))d.getElementById(id).value=value};
  obFill({obName:'كراء المقر',obCat:'الكراء',obAmount:'1000',obDay:'16',obLead:'3',obStart:'2026-11'});
  d.querySelector('button[onclick="emciaSaveObligation()"]').click();
  const rentId=w.eval('db.obligations[0].id');assert.equal(w.eval('db.x.length'),0);assert.equal(w.dashboardStats('2026-11').exp,0);
  let obligationRows=w.emciaObligationRows('2026-11-14','2026-11');assert.equal(obligationRows[0].status,'soon');assert.equal(obligationRows[0].remaining,1000);
  assert.equal(w.emciaObligationRows('2026-11-16','2026-11')[0].status,'today');assert.equal(w.emciaObligationRows('2026-11-17','2026-11')[0].status,'overdue');
  assert.equal(w.emciaObligationDueDate('2027-02',31),'2027-02-28');assert.equal(w.emciaObligationDueDate('2028-02',31),'2028-02-29');assert.equal(w.emciaObligationDueDate('2026-04',31),'2026-04-30');
  w.eval("show('home')");assert.match(d.querySelector('#workspace .emcia-obligation-alerts').textContent,/كراء المقر/);
  w.eval("window.dailyDate='2026-11-14';show('daily')");assert.match(d.querySelector('#daily .emcia-obligation-alerts').textContent,/اقترب الموعد/);
  w.emciaPayObligation(rentId,'2026-11');assert.equal(d.querySelector('#xa').value,'1000');assert.equal(w.eval('db.x.length'),0);
  d.querySelector('#xa').value='400';d.querySelector('button[onclick="addExpense()"]').click();
  assert.equal(w.eval('db.x.length'),1);assert.equal(w.emciaObligationRows('2026-11-14','2026-11')[0].remaining,600);assert.equal(w.dashboardStats('2026-11').exp,400);
  // Existing expenses can settle a reminder without any new cash transaction.
  w.eval("db.x.push({id:'existing-rent',cat:'الكراء',a:600,month:'2026-11',date:'2026-11-14',type:'fixed'})");
  w.emciaPayObligation(rentId,'2026-11');d.querySelector('#obligationExisting').value='existing-rent';w.emciaLinkObligationExpense();
  assert.equal(w.eval('db.x.length'),2);assert.equal(w.emciaObligationRows('2026-11-14','2026-11')[0].status,'paid');assert.equal(w.dashboardStats('2026-11').exp,1000);
  w.emciaPayObligation(rentId,'2026-11');assert.equal(w.eval('window.pendingObligation'),null);
  // Deleting a linked expense reopens the remaining amount. A new month has its own balance.
  w.eval("db.x=db.x.filter(x=>x.id!=='existing-rent')");assert.equal(w.emciaObligationRows('2026-11-14','2026-11')[0].remaining,600);assert.equal(w.emciaObligationRows('2026-12-01','2026-12')[0].paid,0);
  // Terms change from the selected month and leave earlier amounts intact.
  w.eval('window.obligationEditId='+JSON.stringify(rentId)+';expenses()');obFill({obAmount:'1200',obStart:'2026-12'});w.emciaSaveObligation();
  assert.equal(w.emciaObligationRows('2026-11-14','2026-11')[0].amount,1000);assert.equal(w.emciaObligationRows('2026-12-01','2026-12')[0].amount,1200);
  w.emciaStopObligation(rentId);assert.equal(w.emciaObligationRows('2026-12-01','2026-12').length,0);assert.equal(w.emciaObligationRows('2026-11-14','2026-11').length,1);
  // Variable bills are settled by an actual expense; next-month reminders can appear before month-end.
  obFill({obName:'فاتورة الماء',obCat:'الماء',obAmount:'',obDay:'1',obLead:'3',obStart:'2026-12'});w.emciaSaveObligation();
  const waterId=w.eval('db.obligations[1].id');assert.equal(w.emciaObligationRows('2026-11-28').find(x=>x.rule.id===waterId).status,'soon');
  assert.equal(w.emciaObligationRows('2026-11-14').filter(x=>x.rule.id===waterId).length,1);assert.equal(w.emciaObligationRows('2026-11-14').find(x=>x.rule.id===waterId).status,'future');
  w.emciaPayObligation(waterId,'2026-12');d.querySelector('#xa').value='35.50';w.addExpense();assert.equal(w.emciaObligationRows('2026-12-01','2026-12').find(x=>x.rule.id===waterId).status,'paid');
  assert.equal(w.emciaObligationRows('2027-01-01','2027-01').find(x=>x.rule.id===waterId).status,'today');
  w.eval("db.x.push({id:'late-rent',cat:'الكراء',a:600,date:'2026-12-03',month:'2026-12',obligationId:db.obligations[0].id,obligationMonth:'2026-11'})");
  assert.equal(w.emciaObligationRows('2026-12-04','2026-11')[0].status,'paid');assert.equal(w.emciaObligationRows('2026-11-14','2026-11')[0].remaining,600);
  assert.equal(w.dashboardStats('2026-12').exp,600);w.eval("db.x=db.x.filter(x=>x.id!=='late-rent')");
  // Invalid configuration does not save, and no user is assigned an invented amount or deadline.
  obFill({obName:'راتب مستخدم',obCat:'المدير',obAmount:'2000',obDay:'32',obLead:'3',obStart:'2026-11'});w.emciaSaveObligation();assert.equal(w.eval('db.obligations.length'),2);
  obFill({obDay:'25'});w.emciaSaveObligation();assert.equal(w.eval('db.obligations.length'),3);
  w.emciaPayObligation(w.eval('db.obligations[2].id'),'2026-11');d.querySelector('#xa').value='2000';w.addExpense();assert.equal(w.emciaObligationRows('2026-11-14','2026-11').find(x=>x.rule.n==='راتب مستخدم').status,'paid');
  w.eval('save()');await saved(w);assert.equal(fin.payload.obligations.length,3);assert.equal(op.payload.obligations,undefined);
  // Configuration stays in the financial state, hidden from secretaries and preserved by operational-only writes.
  const storedObligations=JSON.stringify(fin.payload.obligations);dom.window.close();role='secretary_morning';dom=createDOM();w=await login(dom);d=w.document;
  assert.equal(w.eval('db.obligations.length'),0);assert.equal(w.emciaObligationRows().length,0);w.eval("show('expenses')");assert.equal(d.querySelector('#obligationsManager'),null);
  w.eval('save()');await saved(w);assert.equal(JSON.stringify(fin.payload.obligations),storedObligations);
  dom.window.close();role='accountant';dom=createDOM();w=await login(dom);d=w.document;assert.equal(w.eval('db.obligations.length'),3);
  assert.equal(w.emciaObligationRows('2026-11-14','2026-11').find(x=>x.rule.n==='كراء المقر').remaining,600);role='director';
  // A cloud conflict must preserve both remote payloads; there is no sequential-write fallback.
  failAtomic=true;const beforeOp=JSON.stringify(op),beforeFin=JSON.stringify(fin);let rejected=false;try{await w.EMCIA_CLOUD_SYNC.restore(fixtures())}catch{rejected=true}assert.equal(rejected,true);assert.equal(JSON.stringify(op),beforeOp);assert.equal(JSON.stringify(fin),beforeFin);failAtomic=false;
  // Legacy financial fields must keep their target when another account deletes an earlier record.
  dom.window.close();op={id:'main',payload:fixtures(),revision:1};fin={id:'main',payload:{e:[{_index:1,discountTeacher:20}]},revision:1};role='secretary_morning';dom=createDOM();w=await login(dom);w.eval("db.e=db.e.filter(x=>x.id!=='e1');save()");await saved(w);assert.deepEqual(op.payload._legacyFinancialIds.e,['e1','e2']);
  dom.window.close();role='director';dom=createDOM();w=await login(dom);assert.equal(w.eval("db.e.find(x=>x.id==='e2').discountTeacher"),20);assert.equal(w.eval("db.e.find(x=>x.id==='e1')"),undefined);
  assert.deepEqual(errors,[]);
  console.log('PASS: actual DOM attendance handlers, independent sessions, lesson completion, receipt add/edit, cloud reload, strict dates, duplicate receipts, cash, schedule conflicts, stable IDs, legacy compatibility, atomic conflict rollback, advances, late/partial payments, discount bearers, individual balances, reports, teacher privacy, daily payment reminders/filtering/deduplication, lesson-based monthly settlements, dated study stops, preserved historical arrears, future credits re-enrollment gaps, additional-income direct/batch entry, decimal totals, month edits, deletion, legacy monthly reports, recurring institutional obligations, partial payments, linked existing expenses, calendar edges, versioned terms, financial privacy and accountant/director reload. Mock writes:',writes);
 }finally{dom.window.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

