// 分红池（静态收益）验收：奖池按办卡金额占比分给已认证股东，按北京时间周期结算。
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {spawn}=require('node:child_process'),{once}=require('node:events'),income=require('../server/income.cjs'),seed=require('../server/seed.cjs');
const checks=[],DAY=86400000,HOUR=3600000;
const D0='2026-10-18',start=Date.parse(D0+'T00:00:00+08:00');
const pool=(o={})=>({revision:0,enabled:true,source:'fixed',baseAmount:100000,percent:5,cycle:'daily',activityDays:0,startDate:D0,...o});
const vip={id:'vip',name:'黄金VIP套餐',packagePlans:[{}]};
let n=0;
function fixture(){return {config:{shareholderProgram:{plans:[{id:'pool-proof',name:'验收方案',units:1,enabled:true}]}},products:[vip,{id:'kit',name:'焕颜套'}],users:[],orders:[],earnings:[],incomeRules:[],incomePlans:[],poolSettlements:[]}}
function member(db,id,total,paidAt,extra={}){if(!db.users.some(u=>u.id===id))db.users.push({id});const o={id:'o'+(n++),userId:id,productId:extra.productId||'vip',product:extra.productId==='kit'?{name:'焕颜套'}:{...vip},total,status:'ready',paymentStatus:'paid',paidAt:new Date(paidAt).toISOString(),...extra};db.orders.push(o);if(o.product?.packagePlans?.length&&o.paymentStatus==='paid'&&o.refundStatus!=='refunded'&&!['pending','cancelled','aftersale'].includes(o.status)){const user=db.users.find(u=>u.id===id);user.shareholder={approved:true,planId:'pool-proof',orderId:o.id,approvedAt:o.paidAt}}return o}
function enable(db,o={},now=start+HOUR){return income.managePool(db,pool({revision:income.poolRule(db).revision,...o}),'tester',now)}
const cents=(db,uid)=>db.earnings.filter(e=>e.userId===uid&&e.source==='pool').reduce((s,e)=>s+e.amountCents,0);

(function unit(){
  let db=fixture();
  assert.deepEqual(income.poolRule(db),{revision:0,enabled:false,source:'revenue',baseAmount:100000,percent:5,cycle:'daily',activityDays:3,startDate:''});
  member(db,'u-a',6980,start+HOUR);income.settle(db,start+2*DAY);assert.equal(db.poolSettlements.length,0);
  checks.push('defaults: 5% of each day\'s revenue, daily, 3-day activity rounds, disabled until an administrator enables it');

  db=fixture();enable(db);
  member(db,'u-a',6980,start+HOUR);member(db,'u-b',13800,start+2*HOUR);member(db,'u-c',26800,start+3*HOUR);
  income.settle(db,start+DAY-1);assert.equal(db.poolSettlements.length,0);
  income.settle(db,start+DAY+HOUR);
  assert.deepEqual(['u-a','u-b','u-c'].map(u=>cents(db,u)),[73350,145019,281631]);
  for(const id of ['n1','n2','n3','n4','n5'])member(db,id,6980,start+DAY+2*HOUR);
  income.settle(db,start+2*DAY+HOUR);income.settle(db,start+2*DAY+HOUR);
  const day2=db.earnings.filter(e=>e.poolSettlementId==='pool:D:2026-10-19');
  const by=Object.fromEntries(day2.map(e=>[e.userId,e.amountCents]));
  assert.deepEqual([by['u-a'],by['u-b'],by['u-c'],by.n1,by.n2],[42313,83657,162464,42314,42313]);
  assert.equal(day2.reduce((s,e)=>s+e.amountCents,0),500000);assert.equal(db.poolSettlements.length,2);
  assert.match(day2[0].name,/分红池 2026-10-19（每天）/);
  checks.push('worked example: day 1 A 733.50 / B 1,450.19 / C 2,816.31; day 2 with 5 more members A 423.13; every period sums to exactly 5,000.00 and settles once');

  db=fixture();enable(db);
  member(db,'ok',6980,start+HOUR);member(db,'refunded',6980,start+HOUR,{refundStatus:'refunded',status:'aftersale'});
  member(db,'pending',6980,start+HOUR,{paymentStatus:'unpaid',status:'pending'});member(db,'cancelled',6980,start+HOUR,{status:'cancelled'});
  member(db,'disabled',6980,start+HOUR);db.users.find(u=>u.id==='disabled').disabled=true;member(db,'goods',6980,start+HOUR,{productId:'kit'});
  member(db,'late',6980,start+DAY+HOUR);
  income.settle(db,start+DAY+HOUR);
  assert.deepEqual(db.earnings.filter(e=>e.source==='pool').map(e=>[e.userId,e.amountCents]),[['ok',500000]]);
  checks.push('only certified shareholders with paid, unrefunded VIP cards active before the period end share the pool');

  const end=start+DAY;
  db=fixture();enable(db);member(db,'a',6980,start+HOUR);const late=member(db,'b',6980,start+HOUR);
  Object.assign(late,{refundStatus:'refunded',status:'aftersale',refundAt:new Date(end+30000).toISOString()});income.settle(db,end+60000);
  assert.deepEqual(db.earnings.filter(e=>e.source==='pool').map(e=>[e.userId,e.amountCents]),[['a',250000],['b',250000]]);
  income.settle(db,end+DAY+HOUR);assert.deepEqual(db.earnings.filter(e=>e.poolSettlementId==='pool:D:2026-10-19').map(e=>[e.userId,e.amountCents]),[['a',500000]]);
  db=fixture();enable(db);member(db,'a',6980,start+HOUR);member(db,'b',6980,start+HOUR,{refundStatus:'refunded',status:'aftersale',refundAt:new Date(end-1000).toISOString()});income.settle(db,end+HOUR);
  assert.deepEqual(db.earnings.filter(e=>e.source==='pool').map(e=>e.userId),['a']);
  db=fixture();enable(db,{source:'sales'});const sold=member(db,'a',6980,start+HOUR);Object.assign(sold,{refundStatus:'refunded',status:'aftersale',refundAt:new Date(end+30000).toISOString()});income.settle(db,end+60000);
  assert.equal(db.poolSettlements[0].poolCents,34900);
  checks.push('holders are judged as of the period end: a refund just after midnight still shares the previous day (2,500 each) and only leaves from the next period');

  db=fixture();enable(db,{source:'sales'});
  member(db,'u-a',6980,start+HOUR);member(db,'u-b',13800,start+HOUR);member(db,'u-c',26800,start+HOUR);
  income.settle(db,start+DAY+HOUR);assert.equal(db.poolSettlements[0].poolCents,237900);
  income.settle(db,start+2*DAY+HOUR);assert.equal(db.poolSettlements[1].poolCents,0);assert.equal(db.earnings.filter(e=>e.poolSettlementId==='pool:D:2026-10-19').length,0);
  checks.push('sales mode: the pool is 5% of VIP card sales paid within the period (47,580 → 2,379; no sales → 0)');

  db=fixture();enable(db,{source:'revenue'});
  member(db,'u-a',6980,start+HOUR);member(db,'u-b',13800,start+HOUR);member(db,'u-c',26800,start+HOUR);
  member(db,'k',1980,start+2*HOUR,{productId:'kit'});member(db,'p',9999,start+2*HOUR,{productId:'kit',paymentStatus:'unpaid',status:'pending'});
  member(db,'r',5000,start+2*HOUR,{productId:'kit',refundStatus:'refunded',status:'aftersale',refundAt:new Date(start+3*HOUR).toISOString()});
  income.settle(db,start+DAY+HOUR);
  assert.equal(db.poolSettlements[0].poolCents,247800);assert.equal(db.poolSettlements[0].distributedCents,247800);
  assert.deepEqual(db.earnings.filter(e=>e.source==='pool').map(e=>e.userId).sort(),['u-a','u-b','u-c']);
  income.settle(db,start+2*DAY+HOUR);assert.equal(db.poolSettlements[1].poolCents,0);
  checks.push('revenue mode (default): 5% of all paid orders that day, including ordinary products (49,560 → 2,478.00), shared only by certified shareholders; unpaid and refunded orders excluded');

  db=fixture();enable(db,{source:'revenue',activityDays:3});
  member(db,'old',99999,start-2*DAY);
  member(db,'a',6980,start+HOUR);member(db,'k',1980,start+2*HOUR,{productId:'kit'});
  member(db,'b',13800,start+DAY+HOUR);member(db,'c',26800,start+2*DAY+HOUR);member(db,'d',6980,start+3*DAY+HOUR);member(db,'k',1000,start+4*DAY+HOUR,{productId:'kit'});
  income.settle(db,start+5*DAY+HOUR);
  const days=db.poolSettlements.map(x=>({label:x.label,round:x.activityRound,day:x.activityDay,pool:x.poolCents,who:db.earnings.filter(e=>e.poolSettlementId===x.id).map(e=>e.userId).sort().join('')}));
  assert.deepEqual(days.map(d=>[d.round,d.day,d.pool,d.who]),[[1,1,44800,'a'],[1,2,69000,'ab'],[1,3,134000,'abc'],[2,1,34900,'d'],[2,2,5000,'d']]);
  assert.equal(db.earnings.filter(e=>e.poolSettlementId===db.poolSettlements[1].id).reduce((n,e)=>n+e.amountCents,0),69000);
  assert.match(db.earnings.find(e=>e.poolSettlementId===db.poolSettlements[1].id).name,/第1轮活动第2天/);
  assert.equal(db.earnings.some(e=>e.userId==='old'),false);
  assert.throws(()=>income.managePool(fixture(),pool({activityDays:3,cycle:'weekly'}),'x',start+HOUR),/按天结算/);
  checks.push('3-day rounds: day 1 pays day-1 card buyers, day 2 pays day-1 and day-2 buyers, day 3 pays days 1-3, day 4 starts a new round; members from before the round do not share');

  db=fixture();enable(db,{cycle:'monthly'});member(db,'u-a',6980,start+HOUR);
  const nov=Date.parse('2026-11-01T00:00:00+08:00');income.settle(db,nov-1);assert.equal(db.poolSettlements.length,0);
  income.settle(db,nov+1);assert.equal(db.poolSettlements[0].label,'2026-10-18 至 2026-10-31');
  db=fixture();enable(db,{cycle:'weekly'});member(db,'u-a',6980,start+HOUR);income.settle(db,start+7*DAY+1);assert.equal(db.poolSettlements[0].label,'2026-10-18 至 2026-10-24');
  db=fixture();enable(db);member(db,'u-a',6980,start+HOUR);income.settle(db,start+3*DAY+HOUR);assert.equal(db.poolSettlements.length,3);
  checks.push('Beijing-time daily, weekly and calendar-month periods; missed periods are caught up after downtime');

  db=fixture();assert.equal(enable(db,{startDate:'2026-10-01'},start+HOUR).startDate,D0);
  member(db,'u-a',6980,start-10*DAY);income.settle(db,start+2*DAY+HOUR);assert.equal(db.poolSettlements[0].periodKey,'D:2026-10-18');
  income.managePool(db,pool({revision:1,enabled:false}),'t',start+2*DAY+2*HOUR);income.settle(db,start+5*DAY);
  const off=db.poolSettlements.length;const back=income.managePool(db,pool({revision:2}),'t',start+5*DAY+HOUR);
  assert.equal(back.startDate,'2026-10-23');income.settle(db,start+6*DAY+HOUR);assert.equal(db.poolSettlements.length,off+1);assert.equal(db.poolSettlements.at(-1).periodKey,'D:2026-10-23');
  checks.push('no backfill: past start dates move to today, and re-enabling skips the days it was off');

  db=fixture();enable(db);member(db,'u-a',6980,start+HOUR);income.settle(db,start+2*DAY+HOUR);
  const weekly=income.managePool(db,pool({revision:1,cycle:'weekly'}),'t',start+2*DAY+2*HOUR);
  assert.equal(weekly.startDate,'2026-10-20');income.settle(db,start+9*DAY+HOUR);
  const spans=db.poolSettlements.map(s=>[Date.parse(s.start),Date.parse(s.end)]);for(let i=1;i<spans.length;i++)assert.ok(spans[i][0]>=spans[i-1][1]);
  checks.push('switching cycle never overlaps a settled period, so no member is paid twice for the same days');

  db=fixture();income.manage(db,'PUT','vip',{revision:0,static:{enabled:true,mode:'fixed',value:10,trigger:'paid',delayDays:0,intervalDays:1,periods:1},dynamic:[],refundPolicy:'reverse'},'t');
  assert.equal(income.publicRules(db).length,1);enable(db);assert.equal(income.publicRules(db).length,0);
  db.users.push({id:'buyer'});const o={id:'pkg',userId:'buyer',productId:'vip',product:{...vip},total:6980,status:'ready',paymentStatus:'paid',paidAt:new Date(start+HOUR).toISOString()};income.snapshot(db,o);db.orders.push(o);income.activate(db,o);
  assert.equal(db.incomePlans.filter(p=>p.type==='static').length,0);
  checks.push('while the pool is on, package static income is replaced for new orders and hidden from checkout');

  const total=income.allocate(100,new Map([['a',1],['b',1],['c',1]]));assert.deepEqual(total.map(r=>r.cents),[34,33,33]);
  assert.deepEqual(income.allocate(0,new Map([['a',1]])),[]);assert.deepEqual(income.allocate(100,new Map()),[]);
  db=fixture();assert.throws(()=>enable(db,{revision:3}),/其他管理员/);
  for(const bad of [{percent:101},{percent:0},{baseAmount:-1},{baseAmount:0},{cycle:'yearly'},{source:'x'},{startDate:'2026-02-30'},{enabled:'yes'}])assert.throws(()=>enable(fixture(),bad));
  checks.push('cent allocation is exact; invalid values and stale edits are rejected');
})();

const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'anqi-pool-')),file=path.join(dir,'db.json'),secret=crypto.randomBytes(24).toString('hex');let child,base;
async function req(route,method='GET',data,token,status=200,admin=false){const r=await fetch(base+route,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(admin?{'x-anqi-internal':secret}:{})},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();assert.equal(r.status,status,`${method} ${route}: ${JSON.stringify(b)}`);return b}
const admin=(route,method='GET',data,status=200)=>req('/admin/'+route,method,data,null,status,true);
async function startServer(offset=0){const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/api`;child=spawn(process.execPath,['--require',path.join(__dirname,'test-clock.cjs'),'server/index.cjs'],{cwd:root,env:{...process.env,ANQI_TEST_CLOCK_OFFSET_MS:String(offset),HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:process.env.POOL_TEST_DB_NAME||'',NODE_ENV:'test',DEMO_MODE:'false',WECHAT_MOCK:'true',ADMIN_PASSWORD:secret,INTERNAL_SECRET:secret,PAYMENT_MODE:'off'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(errors);try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error(errors||'startup timeout')}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}}
(async()=>{
  if(process.env.POOL_TEST_DB_NAME&&!/^anqi_audit_[a-zA-Z0-9_]+$/.test(process.env.POOL_TEST_DB_NAME))throw Error('Use a dedicated anqi_audit_ database');
  // 接口验收固定在北京时间当天中午进行：午夜附近运行时，拨到“明天凌晨”会超过 24 小时登录有效期
  const NOON=Date.parse(new Date(Date.now()+8*HOUR).toISOString().slice(0,10)+'T12:00:00+08:00')-Date.now();
  fs.writeFileSync(file,JSON.stringify(seed()));await startServer(NOON);
  const boot=await req('/bootstrap'),store=boot.stores[0].id,card=boot.products.find(p=>p.packagePlans?.length);
  const rules=await admin('incomeRules');assert.equal(rules.pool.enabled,false);assert.equal(rules.poolOverview.members,0);
  await admin('incomeRules/pool','PUT',pool({revision:5,startDate:''}),409);
  const saved=await admin('incomeRules/pool','PUT',pool({source:'revenue',activityDays:3,startDate:''}));
  const today=new Date(Date.now()+NOON+8*HOUR).toISOString().slice(0,10);assert.equal(saved.startDate,today);
  // 把服务时钟拨到明天凌晨 1 点 / 2 点（北京时间），恰好跨过一个结算日
  const tomorrow=Date.parse(today+'T00:00:00+08:00')+DAY;
  const plan=card.packagePlans[0],selection={planId:plan.id,groups:Object.fromEntries(plan.groups.map(g=>[g.id,g.services.slice(0,g.pick).map(s=>({serviceId:s.id,...(s.options?.length?{option:s.options[0]}:{})}))]))};
  await admin('shareholders/program','POST',(await admin('shareholders')).rule);
  const buyers=[];
  for(const i of [1,2,3]){const u=await req('/auth/wechat','POST',{code:'pool-'+i+'-'+Date.now()});const o=await req('/orders','POST',{productId:card.id,quantity:1,spec:'single',storeId:store,packageSelection:selection},u.token);await admin('orders/'+o.id,'POST',{action:'confirmPayment',note:'分红池验收'});assert.equal((await admin('incomeRules')).poolOverview.members,i-1);const user=(await admin('users')).find(row=>row.id===u.user.id);await admin('shareholders/member','POST',{userId:u.user.id,approved:true,planId:'package-'+card.price,orderId:o.id,revision:user.memberRevision||0});buyers.push({u,o})}
  const live=(await admin('incomeRules')).poolOverview,sales=buyers.reduce((n,b)=>n+b.o.total,0);assert.equal(live.members,3);
  assert.equal(live.currentIncome,sales);assert.deepEqual([live.activity.round,live.activity.day],[1,1]);assert.equal(live.estimatedPool,Math.round(sales*5)/100);
  assert.equal((await req('/earnings-summary','GET',undefined,buyers[0].u.token)).static,0);
  await stop();await startServer(tomorrow+HOUR-Date.now());
  const overview=(await admin('incomeRules')).poolOverview;assert.equal(overview.settlements.length,1);
  assert.deepEqual([overview.settlements[0].members,overview.settlements[0].distributedCents],[3,Math.round(sales*5)]);
  const each=(await req('/earnings-summary','GET',undefined,buyers[0].u.token)).static;assert.ok(Math.abs(each-sales*0.05/3)<0.02,String(each));
  assert.match((await req('/earnings','GET',undefined,buyers[0].u.token)).map(e=>e.name).join(),/分红池/);
  await stop();await startServer(tomorrow+2*HOUR-Date.now());assert.equal((await admin('incomeRules')).poolOverview.settlements.length,1);
  checks.push(`API (default revenue mode): the day's revenue ${sales} gives a live estimate of ${Math.round(sales*5)/100}; after midnight the running service settles it once across 3 certified shareholders, and a restart does not repeat it`);
  console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
