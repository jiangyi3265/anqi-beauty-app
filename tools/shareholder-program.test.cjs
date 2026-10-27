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
  // 已保存的旧方案和认证，验证升级后继续保留历史分支。
  db.config.shareholderProgram={enabled:true,activatedAt:new Date(start).toISOString(),revision:1,settleTime:'23:00',plans:[1,2,3].map((units,i)=>({id:'p'+i,name:'方案'+i,units,enabled:true}))};
  for (let i=0;i<3;i++) {
    db.users.push({id:'u'+i,name:'会员'+i});
    db.orders.push({id:'o'+i,userId:'u'+i,product:{packagePlans:[{id:'vip'}]},total:100,paidAt:new Date(start).toISOString(),paymentStatus:'paid',status:'ready'});
    Object.assign(db.users[i],{memberRevision:1,shareholder:{approved:true,planId:'p'+i,orderId:'o'+i,approvedAt:new Date(start).toISOString()}});
  }
  return db;
}
test('旧认证按份数分到分，历史不重算，跨日公共池归零',()=>{
  const db=fixture();
  sh.savePool(db,{date:'2026-10-26',amount:5000,revision:0},'test',start);
  assert.equal(sh.today(db,'u0',start).personalAmount,833.33);
  const rule=sh.rule(db);rule.plans.find(p=>p.id==='p0').units=2;
  assert.throws(()=>sh.configure(db,rule,'test',start+hour),/旧方案/);
  assert.equal(sh.today(db,'u0',start+hour).personalAmount,833.33);
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
test('公共池游客和普通用户可见，北京时间零点归零且历史、个人积分不变',()=>{
  const db=fixture();
  db.users.push({id:'ordinary',points:5000});
  db.ledger=[{id:'points',userId:'ordinary',amount:5000}];
  sh.savePool(db,{date:'2026-10-26',amount:5000,revision:0},'test',start);
  for(const userId of [undefined,'ordinary','u0']) assert.equal(sh.today(db,userId,start).amount,5000);
  assert.equal(sh.today(db,undefined,start).personalAmount,0);
  assert.equal(sh.today(db,'ordinary',start).personalAmount,0);
  const midnight=Date.parse('2026-10-27T00:00:00+08:00');
  income.settle(db,midnight-1);
  const history=structuredClone({pools:db.shareholderPools,earnings:db.earnings,ledger:db.ledger});
  assert.equal(sh.today(db,undefined,midnight-1).amount,5000);
  assert.deepEqual(sh.today(db,'u0',midnight),{enabled:true,date:'2026-10-27',amount:0,personalAmount:0,status:'empty',revision:0});
  assert.equal(sh.overview(db,midnight).today.amount,0);
  assert.deepEqual({pools:db.shareholderPools,earnings:db.earnings,ledger:db.ledger},history);
  assert.equal(db.users.find(u=>u.id==='ordinary').points,5000);
  assert.throws(()=>sh.savePool(db,{date:'2026-10-26',amount:999,revision:1},'test',midnight),/今天/);
  sh.savePool(db,{date:'2026-10-27',amount:1200,revision:0},'test',midnight);
  sh.savePool(db,{date:'2026-10-27',amount:1500,revision:1},'test',midnight+1);
  assert.equal(sh.today(db,undefined,midnight+1).amount,1500);
  assert.deepEqual(db.shareholderPools[0],history.pools[0]);
  assert.deepEqual(db.earnings,history.earnings);
});

test('错过结算后跨日也显示零，补结算只处理历史池',()=>{
  const db=fixture(),midnight=Date.parse('2026-10-27T00:00:00+08:00');
  sh.savePool(db,{date:'2026-10-26',amount:600,revision:0},'test',start);
  assert.equal(sh.today(db,'u0',midnight).amount,0);
  income.settle(db,midnight);
  assert.equal(db.earnings.reduce((n,e)=>n+e.amountCents,0),60000);
  assert.equal(sh.today(db,'u0',midnight).personalAmount,0);
  assert.equal(db.shareholderPools[0].date,'2026-10-26');
});

test('认证要求本人的已付款订单，退款和停用停止后续资格',()=>{
  const db=fixture();db.users.push({id:'new'});
  assert.throws(()=>sh.certify(db,{userId:'new',approved:true,planId:'p0',orderId:'o0',revision:0},'x',start),/该会员/);
  db.orders.push({id:'service',userId:'new',product:{name:'普通服务'},paidAt:new Date(start).toISOString(),paymentStatus:'paid',status:'ready'});
  assert.throws(()=>sh.certify(db,{userId:'new',approved:true,planId:'p0',orderId:'service',revision:0},'x',start),/套餐订单/);
  assert.equal(sh.eligible(db,db.users[0],start),true);
  db.orders[0].refundStatus='refunded';db.orders[0].refundAt=new Date(start+hour).toISOString();db.orders[0].status='aftersale';
  assert.equal(sh.eligible(db,db.users[0],start),true);
  assert.equal(sh.eligible(db,db.users[0],start+2*hour),false);
  db.users[1].disabled=true;assert.equal(sh.holders(db,start+2*hour).length,1);
  assert.throws(()=>sh.certify(db,{userId:'u2',approved:false,revision:0},'x',start),/刷新/);
});
test('旧认证若未绑定购买方案订单，不再获得分红和分享资格',()=>{
  const db=fixture();
  db.orders.push({id:'ordinary',userId:'u0',product:{name:'普通服务'},paidAt:new Date(start).toISOString(),paymentStatus:'paid',status:'ready'});
  db.users[0].shareholder.orderId='ordinary';
  assert.equal(sh.eligible(db,db.users[0],start),false);
  assert.equal(sh.holders(db,start).some(member=>member.userId==='u0'),false);
});
test('旧收益计划与旧结算防重；无股东不伪造分配',()=>{
  const db=fixture();db.poolSettlements.push({start:'2026-10-26T00:00:00+08:00',end:'2026-10-27T00:00:00+08:00'});
  assert.throws(()=>sh.savePool(db,{date:'2026-10-26',amount:10,revision:0},'x',start),/旧规则/);
  db.poolSettlements=[];db.users.forEach(u=>u.disabled=true);
  sh.savePool(db,{date:'2026-10-26',amount:10,revision:0},'x',start);income.settle(db,start+14*hour);
  assert.equal(db.shareholderPools[0].status,'noMembers');assert.equal(db.earnings.length,0);
  const old={config:{},users:[],orders:[],incomePlans:[{type:'static',status:'active',posted:0,periods:3}]};income.init(old);
  assert.throws(()=>sh.configure(old,{...sh.rule(old),enabled:true},'x',start),/旧静态收益/);
  old.incomePlans=[];
  old.orders.push({id:'pending-old',status:'pending',incomeSnapshot:{rule:{static:{enabled:true}}}});
  assert.throws(()=>sh.configure(old,{...sh.rule(old),enabled:true},'x',start),/旧静态收益/);
  old.orders[0].status='cancelled';
  assert.doesNotThrow(()=>sh.configure(old,{...sh.rule(old),enabled:true},'x',start));
});

test('新订单只奖励直接推荐人，旧多级快照保留原账',()=>{
  const db=fixture();
  db.users[0].inviterId='u1';
  db.users.push({id:'buyer',inviterId:'u0'});
  db.config.referralReward={enabled:false};
  const first={enabled:true,mode:'percent',value:10,trigger:'paid',delayDays:0};
  const second={...first,value:5};
  db.incomeRules=[{productId:'service',revision:1,static:{enabled:false},dynamic:[first,second],refundPolicy:'reverse'}];
  const order={id:'new',userId:'buyer',productId:'service',product:{name:'普通服务'},total:100,status:'ready',paymentStatus:'paid',paidAt:new Date(start+hour).toISOString()};
  income.snapshot(db,order);db.orders.push(order);
  income.activate(db,order);assert.deepEqual(db.incomePlans.map(p=>p.userId),['u0']);
  const old=structuredClone(order);old.id='old';old.incomeSnapshot.rule.dynamic.push(second);
  old.incomeSnapshot.ancestors.push({id:'u1',enabled:true});delete old.incomeSnapshot.shareholderRequired;db.orders.push(old);
  income.activate(db,old);assert.deepEqual(db.incomePlans.filter(p=>p.orderId==='old').map(p=>p.userId),['u0','u1']);
  db.products.push({id:'service',packagePlans:[{id:'plan'}]});
  assert.throws(()=>income.manage(db,'PUT','service',{revision:1,static:{enabled:false,mode:'fixed',value:0,trigger:'paid',delayDays:0,periods:1,intervalDays:1},dynamic:[first,second],refundPolicy:'reverse'},'x'),/一级/);
});
test('未认证购买者没有静态收益；认证后新订单才参与',()=>{
  const db={config:{shareholderProgram:{plans:[{id:'p',name:'方案',units:1,enabled:true}]}},users:[{id:'buyer'}],orders:[],products:[],earnings:[]};
  income.init(db);
  db.incomeRules=[{productId:'vip',revision:1,static:{enabled:true,mode:'fixed',value:10,trigger:'paid',delayDays:0,periods:1,intervalDays:1},dynamic:[],refundPolicy:'reverse'}];
  const buy=(id,paidAt)=>({id,userId:'buyer',productId:'vip',product:{name:'套餐',price:6980,packagePlans:[{id:'plan'}]},total:100,status:'ready',paymentStatus:'paid',paidAt:new Date(paidAt).toISOString()});
  const first=buy('first',start);income.snapshot(db,first);db.orders.push(first);income.activate(db,first);
  assert.equal(db.incomePlans.length,0);
  sh.certify(db,{userId:'buyer',approved:true,planId:'package-6980',orderId:'first',revision:0},'test',start+hour);
  income.activate(db,first);assert.equal(db.incomePlans.length,0);
  const later=buy('later',start+2*hour);income.snapshot(db,later);db.orders.push(later);income.activate(db,later);
  assert.equal(db.incomePlans.length,1);assert.equal(db.incomePlans[0].orderId,'later');
});
test('旧分红池也只分给已认证股东',()=>{
  const db={config:{shareholderProgram:{plans:[{id:'p',name:'方案',units:1,enabled:true}]},poolReward:{enabled:true,startDate:'2026-10-26',cycle:'daily',activityDays:0,source:'fixed',baseAmount:100,percent:10,revision:1}},users:[{id:'buyer'}],orders:[],products:[],earnings:[]};
  income.init(db);
  db.orders.push({id:'proof',userId:'buyer',product:{name:'套餐',price:6980,packagePlans:[{id:'plan'}]},total:100,paidAt:new Date(start).toISOString(),paymentStatus:'paid',status:'ready'});
  income.settle(db,start+24*hour);
  assert.equal(db.poolSettlements[0].members,0);assert.equal(db.earnings.length,0);
  sh.certify(db,{userId:'buyer',approved:true,planId:'package-6980',orderId:'proof',revision:0},'test',start+25*hour);
  income.settle(db,start+48*hour);
  assert.equal(db.poolSettlements[1].members,1);assert.equal(db.earnings.length,1);
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
