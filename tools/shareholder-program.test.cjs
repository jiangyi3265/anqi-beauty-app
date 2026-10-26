const { test } = require('node:test');
const assert = require('node:assert/strict');
const income = require('../server/income.cjs');
const sh = require('../server/shareholders.cjs');
const trial = require('../server/trial-quota.cjs');
const start = Date.parse('2026-10-26T09:00:00+08:00');
const hour = 3600000;
function fixture() {
  const db = { config: {}, users: [], orders: [], products: [], claims: [], appointments: [], earnings: [] };
  income.init(db);
  sh.configure(db, { enabled: true, revision: 0, settleTime: '23:00', plans: [1,2,3].map((units,i)=>({id:'p'+i,name:'方案'+i,units,enabled:true})) }, 'test', start);
  for (let i=0;i<3;i++) {
    db.users.push({id:'u'+i,name:'会员'+i});
    db.orders.push({id:'o'+i,userId:'u'+i,total:100,paidAt:new Date(start).toISOString(),paymentStatus:'paid',status:'ready'});
    sh.certify(db,{userId:'u'+i,approved:true,planId:'p'+i,orderId:'o'+i,revision:0},'test',start);
  }
  return db;
}
test('方案当日调整；按份数分到分，历史不重算，跨日公共池归零',()=>{
  const db=fixture();
  sh.savePool(db,{date:'2026-10-26',amount:5000,revision:0},'test',start);
  assert.equal(sh.today(db,'u0',start).personalAmount,833.33);
  const rule=sh.rule(db);rule.plans[0]={...rule.plans[0],units:2};
  sh.configure(db,rule,'test',start+hour);
  assert.equal(sh.today(db,'u0',start+hour).personalAmount,1428.57);
  assert.throws(()=>sh.savePool(db,{date:'2026-10-26',amount:999,revision:0},'test',start+hour),/刷新/);
  income.settle(db,start+14*hour);
  const original=structuredClone(db.earnings);
  assert.equal(db.earnings.reduce((n,e)=>n+e.amountCents,0),500000);
  income.settle(db,start+15*hour);assert.deepEqual(db.earnings,original);
  assert.throws(()=>sh.savePool(db,{date:'2026-10-26',amount:1,revision:1},'test',start+14*hour),/结算/);
  assert.equal(sh.today(db,'u0',start+24*hour).amount,0);
  assert.equal(sh.today(db,'u0',start+24*hour).personalAmount,0);
  sh.savePool(db,{date:'2026-10-27',amount:7000,revision:0},'test',start+24*hour);
  income.settle(db,start+38*hour);assert.equal(db.shareholderPools[1].allocations.length,3);
  assert.deepEqual(db.earnings.slice(0,3),original);
});
test('认证要求本人的已付款订单，退款和停用停止后续资格',()=>{
  const db=fixture();db.users.push({id:'new'});
  assert.throws(()=>sh.certify(db,{userId:'new',approved:true,planId:'p0',orderId:'o0',revision:0},'x',start),/该会员/);
  assert.equal(sh.eligible(db,db.users[0],start),true);
  db.orders[0].refundStatus='refunded';assert.equal(sh.eligible(db,db.users[0],start),false);
  db.users[1].disabled=true;assert.equal(sh.holders(db,start).length,1);
  assert.throws(()=>sh.certify(db,{userId:'u2',approved:false,revision:0},'x',start),/刷新/);
});
test('旧收益计划与旧结算防重；无股东不伪造分配',()=>{
  const db=fixture();db.poolSettlements.push({start:'2026-10-26T00:00:00+08:00',end:'2026-10-27T00:00:00+08:00'});
  assert.throws(()=>sh.savePool(db,{date:'2026-10-26',amount:10,revision:0},'x',start),/旧规则/);
  db.poolSettlements=[];db.users.forEach(u=>u.disabled=true);
  sh.savePool(db,{date:'2026-10-26',amount:10,revision:0},'x',start);income.settle(db,start+14*hour);
  assert.equal(db.shareholderPools[0].status,'noMembers');assert.equal(db.earnings.length,0);
  const old={config:{},users:[],orders:[],incomePlans:[{type:'static',status:'active',posted:0,periods:3}]};income.init(old);
  assert.throws(()=>sh.configure(old,{...sh.rule(db),revision:0},'x',start),/旧静态收益/);
  old.incomePlans=[];
  old.orders.push({id:'pending-old',status:'pending',incomeSnapshot:{rule:{static:{enabled:true}}}});
  assert.throws(()=>sh.configure(old,{...sh.rule(db),revision:0},'x',start),/旧静态收益/);
  old.orders[0].status='cancelled';
  assert.doesNotThrow(()=>sh.configure(old,{...sh.rule(db),revision:0},'x',start));
});

test('多级动态收益新单也要求认证；旧快照仍按原规则处理',()=>{
  const db=fixture();
  db.users.push({id:'buyer',inviterId:'u0'});
  db.config.referralReward={enabled:false};
  db.incomeRules=[{productId:'service',revision:1,static:{enabled:false},dynamic:[{enabled:true,mode:'percent',value:10,trigger:'paid',delayDays:0}],refundPolicy:'reverse'}];
  const order={id:'new',userId:'buyer',productId:'service',product:{name:'普通服务'},total:100,status:'ready',paymentStatus:'paid',paidAt:new Date(start+hour).toISOString()};
  income.snapshot(db,order);db.orders.push(order);
  sh.certify(db,{userId:'u0',approved:false,revision:1},'x',start+hour);
  income.activate(db,order);assert.equal(db.incomePlans.length,0);
  const old=structuredClone(order);old.id='old';delete old.incomeSnapshot.shareholderRequired;db.orders.push(old);
  income.activate(db,old);assert.equal(db.incomePlans.length,1);assert.equal(db.incomePlans[0].orderId,'old');
});
test('新推荐奖励在付款时检查认证，历史奖励不改写',()=>{
  const db=fixture();db.users.push({id:'buyer',inviterId:'u0',createdAt:new Date(start).toISOString()});
  db.config.referralReward={enabled:true,firstPercent:50,laterPercent:10,scope:'all',trigger:'paid'};
  const order={id:'buy',userId:'buyer',product:{name:'服务'},productId:'service',total:100,status:'pending'};
  income.snapshot(db,order);db.orders.push(order);
  sh.certify(db,{userId:'u0',approved:false,revision:1},'x',start+hour);
  Object.assign(order,{paymentStatus:'paid',status:'ready',paidAt:new Date(start+hour).toISOString()});
  income.activate(db,order);assert.equal(order.incomeSnapshot.referral.skipped,'notShareholder');assert.equal(db.incomePlans.length,0);
});
test('体验单项可选；三次总额度、并发占用、取消归还与库存一致',()=>{
  const db={claims:[],appointments:[],products:[1,2,3,4].map(n=>({id:'p'+n,trial:true,kind:'service',enabled:true,status:'published',stock:5}))};
  const claim=trial.select(db,'u',['p1']);assert.equal(db.products[0].stock,5);
  for(let n=1;n<=3;n++){
    trial.select(db,'u',['p'+n]);const a={id:'a'+n,claimId:claim.id,productId:'p'+n,status:'booked'};
    trial.reserve(db,claim,'p'+n,a);db.appointments.push(a);
  }
  assert.equal(trial.summary(db,'u').remaining,0);
  assert.throws(()=>trial.select(db,'u',['p4']),/用完或已预约/);
  const a=db.appointments[0];a.status='cancelled';trial.release(db,a);trial.release(db,a);
  assert.equal(trial.summary(db,'u').remaining,1);assert.equal(db.products[0].stock,5);
  db.appointments[1].status='completed';assert.equal(trial.summary(db,'u').used,1);assert.equal(trial.summary(db,'u').remaining,1);
});

test('订单完成后入账分支沿用付款时资格，不因后来停止认证改变已付订单',()=>{
  const db=fixture();db.users.push({id:'buyer',inviterId:'u0',createdAt:new Date(start).toISOString()});
  db.config.referralReward={enabled:true,firstPercent:50,laterPercent:10,scope:'all',trigger:'completed'};
  const order={id:'later-complete',userId:'buyer',product:{name:'服务'},productId:'service',total:100,status:'ready',paymentStatus:'paid',paidAt:new Date(start+hour).toISOString()};
  income.snapshot(db,order);db.orders.push(order);income.activate(db,order);
  assert.equal(db.incomePlans.length,0);
  sh.certify(db,{userId:'u0',approved:false,revision:1},'x',start+2*hour);
  Object.assign(order,{status:'completed',completedAt:new Date(start+3*hour).toISOString()});income.activate(db,order);
  assert.equal(db.incomePlans.length,1);assert.equal(db.incomePlans[0].amountCents,5000);
});
test('历史体验卡不重发，贵宾权益不计入新体验额度',()=>{
  const db={claims:[{id:'old',userId:'u',type:'trial',uses:5},{id:'vip',userId:'v',type:'vip'}],appointments:[]};
  assert.equal(trial.summary(db,'u').legacy,true);
  assert.throws(()=>trial.select(db,'u',['x']),/原卡/);
  assert.equal(trial.summary(db,'v').remaining,3);
});
