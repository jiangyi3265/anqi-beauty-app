const crypto = require('node:crypto');
const DAY = 86400000;
const clone = x => JSON.parse(JSON.stringify(x));
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function init(db) { db.incomeRules ||= []; db.incomePlans ||= []; db.earnings ||= []; db.poolSettlements ||= []; }
function integer(v, min, max, label) { if (!Number.isInteger(v) || v < min || v > max) fail(`${label}须为${min}至${max}的整数`); return v; }
function amount(v, max, label) { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max || Math.abs(v * 100 - Math.round(v * 100)) > 0.000001) fail(label + '无效，最多保留两位小数'); return v; }
function part(v, periodic) {
  if (!v || typeof v.enabled !== 'boolean') fail('请设置收益开关');
  if (!['fixed', 'percent'].includes(v.mode)) fail('请选择固定金额或订单实付比例');
  if (!['paid', 'completed'].includes(v.trigger)) fail('请选择确认收款后或整单完成后');
  const p = { enabled:v.enabled, mode:v.mode, value:amount(v.value, v.mode==='percent'?100:1000000, '收益金额或比例'), trigger:v.trigger, delayDays:integer(v.delayDays,0,3650,'首次等待天数') };
  if (periodic) Object.assign(p, { intervalDays:integer(v.intervalDays,1,3650,'间隔天数'), periods:integer(v.periods,1,3660,'期数') });
  if (p.enabled && p.value <= 0) fail('启用收益时金额或比例必须大于0');
  return p;
}
// 推荐奖励：只奖励直接推荐人，被推荐人首单与后续订单分别按实付比例计算。
// 保存在 config 中（MySQL 模式随 anqi_lock 持久化）；默认关闭，由管理员启用。
const REFERRAL_DEFAULTS = { revision:0, enabled:false, firstPercent:50, laterPercent:10, scope:'all', trigger:'paid', delayDays:0, durationDays:0, refundPolicy:'reverse' };
function referralRule(db) { return { ...REFERRAL_DEFAULTS, ...(db.config?.referralReward || {}) }; }
function manageReferral(db, body, actor) {
  const previous = referralRule(db);
  if (body.revision !== previous.revision) fail('规则已被其他管理员修改，请刷新后再编辑',409);
  if (typeof body.enabled !== 'boolean') fail('请设置推荐奖励开关');
  const firstPercent = amount(body.firstPercent, 100, '首单奖励比例'), laterPercent = amount(body.laterPercent, 100, '后续订单奖励比例');
  if (body.enabled && firstPercent <= 0 && laterPercent <= 0) fail('启用推荐奖励时至少一个比例须大于0');
  if (!['all','vip'].includes(body.scope)) fail('请选择适用订单');
  if (!['paid','completed'].includes(body.trigger)) fail('请选择确认收款后或订单完成后');
  if (!['reverse','retain'].includes(body.refundPolicy)) fail('请选择退款收益处理方式');
  const row = { revision:previous.revision+1, enabled:body.enabled, firstPercent, laterPercent, scope:body.scope, trigger:body.trigger,
    delayDays:integer(body.delayDays,0,3650,'入账等待天数'), durationDays:integer(body.durationDays,0,3650,'推荐有效天数'), refundPolicy:body.refundPolicy, updatedAt:new Date().toISOString() };
  db.config ||= {}; db.config.referralReward = row;
  db.audit ||= [];db.audit.unshift({id:crypto.randomUUID(),actor,resource:'incomeRules',target:'referral',method:'PUT',revision:row.revision,createdAt:row.updatedAt});
  return row;
}
// 分红池（静态收益）：每个结算周期拿出一笔奖池，按办卡金额占比分给全部办卡会员。
// 周期按北京时间划分，周期结束后结算一次；保存在 config，结算记录在 poolSettlements。
// source: revenue=本期营业额（全部已付款订单）× 比例；sales=本期新增办卡金额 × 比例；fixed=固定基数 × 比例
// activityDays>0：每 N 天一轮活动，每天只分给本轮开始以来办卡的会员（第1天当天，第2天第1–2天……），下一轮重新计算
const POOL_DEFAULTS = { revision:0, enabled:false, source:'revenue', baseAmount:100000, percent:5, cycle:'daily', activityDays:3, startDate:'' };
const HOUR8 = 8*3600000;
const beijingDate = ms => new Date(ms+HOUR8).toISOString().slice(0,10);
const beijingStart = date => Date.parse(date+'T00:00:00+08:00');
function validDay(v) { return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&beijingDate(beijingStart(v))===v; }
function poolRule(db) { return { ...POOL_DEFAULTS, ...(db.config?.poolReward || {}) }; }
function lastSettledEnd(db) { return (db.poolSettlements||[]).reduce((n,s)=>Math.max(n,Date.parse(s.end)||0),0); }
function nextPeriod(rule, start) {
  const day=beijingDate(start);
  if(rule.cycle==='daily') return { key:'D:'+day, label:day, start, end:start+DAY };
  if(rule.cycle==='weekly') { const end=start+7*DAY; return { key:'W:'+day, label:`${day} 至 ${beijingDate(end-DAY)}`, start, end }; }
  const [y,m]=day.split('-').map(Number), end=Date.parse(`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01T00:00:00+08:00`);
  return { key:'M:'+day, label:`${day} 至 ${beijingDate(end-DAY)}`, start, end };
}
// 截至期末是否持有：期末前已付款，且没有在期末前退款（期末后才退款的仍计入该期）
function heldAt(o, end) {
  return o.paymentStatus==='paid'&&(!o.offlineRequestId||Date.parse(o.createdAt)<end)&&Date.parse(o.paidAt)<end&&!['cancelled','pending'].includes(o.status)&&!(o.refundStatus==='refunded'&&!(Date.parse(o.refundAt)>=end));
}
function activityWindow(rule, periodStart) {
  if(!(rule.activityDays>0)||rule.cycle!=='daily')return null;
  const anchor=beijingStart(rule.startDate),len=rule.activityDays*DAY,start=anchor+Math.floor((periodStart-anchor)/len)*len;
  return { round:Math.floor((start-anchor)/len)+1, day:Math.floor((periodStart-start)/DAY)+1, days:rule.activityDays, start, end:start+len };
}
function poolHolders(db, end, since=-Infinity) {
  const weights=new Map();
  for(const o of db.orders||[]) {
    if(!o.product?.packagePlans?.length||!heldAt(o,end)||Date.parse(o.paidAt)<since)continue;
    const user=db.users.find(u=>u.id===o.userId);if(!user||user.disabled||user.incomeAccess?.static===false)continue;
    const cents=Math.round(Number(o.total)*100);if(Number.isSafeInteger(cents)&&cents>0)weights.set(o.userId,(weights.get(o.userId)||0)+cents);
  }
  return weights;
}
// 本期收入：期内付款、且期末前未退款的订单实付合计；revenue 计全部订单，sales 只计VIP套餐
function periodIncome(db, rule, start, end) {
  return (db.orders||[]).filter(o=>(rule.source==='revenue'||o.product?.packagePlans?.length)&&heldAt(o,end)&&Date.parse(o.paidAt)>=start).reduce((n,o)=>n+Math.round(Number(o.total)*100),0);
}
function poolCents(db, rule, period) {
  const base=rule.source==='fixed'?Math.round(rule.baseAmount*100):periodIncome(db,rule,period.start,period.end);
  return Number((BigInt(base)*BigInt(Math.round(rule.percent*100))+5000n)/10000n);
}
// 按权重分到分，余数按小数部分从大到小补齐，总额恰好等于奖池
function allocate(total, weights) {
  const sum=[...weights.values()].reduce((n,w)=>n+w,0);if(!sum||!total)return [];
  const rows=[...weights].map(([userId,w])=>{const exact=BigInt(total)*BigInt(w);return {userId,cents:Number(exact/BigInt(sum)),rest:exact%BigInt(sum)}});
  let left=total-rows.reduce((n,r)=>n+r.cents,0);
  rows.slice().sort((a,b)=>b.rest>a.rest?1:b.rest<a.rest?-1:a.userId<b.userId?-1:1).forEach(r=>{if(left>0){r.cents++;left--}});
  return rows;
}
function settlePool(db, now=Date.now(), limit=400) {
  const rule=poolRule(db);if(!rule.enabled||!validDay(rule.startDate))return 0;
  let start=Math.max(beijingStart(rule.startDate),lastSettledEnd(db)),settled=0;
  while(settled<limit) {
    const period=nextPeriod(rule,start);if(period.end>now)break;
    const id='pool:'+period.key;
    if(!db.poolSettlements.some(s=>s.id===id)) {
      const win=activityWindow(rule,period.start),holders=poolHolders(db,period.end,win?win.start:-Infinity),amount=poolCents(db,rule,period),rows=allocate(amount,holders),createdAt=new Date(now).toISOString();
      const cycleText=win?`第${win.round}轮活动第${win.day}天`:{daily:'每天',weekly:'每周',monthly:'每月'}[rule.cycle];
      for(const r of rows.filter(r=>r.cents>0)) db.earnings.push({id:crypto.randomUUID(),accrualKey:`${id}:${r.userId}`,poolSettlementId:id,userId:r.userId,type:'static',source:'pool',level:0,period:1,revision:rule.revision,kind:'credit',amountCents:r.cents,amount:r.cents/100,name:`分红池 ${period.label}（${cycleText}）`,dueAt:new Date(period.end).toISOString(),createdAt});
      db.poolSettlements.push({id,periodKey:period.key,label:period.label,cycle:rule.cycle,source:rule.source,start:new Date(period.start).toISOString(),end:new Date(period.end).toISOString(),poolCents:amount,distributedCents:rows.reduce((n,r)=>n+r.cents,0),members:holders.size,totalWeightCents:[...holders.values()].reduce((n,w)=>n+w,0),...(win?{activityRound:win.round,activityDay:win.day,activityStart:new Date(win.start).toISOString()}:{}),revision:rule.revision,createdAt});
      settled++;
    }
    start=period.end;
  }
  return settled;
}
function managePool(db, body, actor, now=Date.now()) {
  const previous=poolRule(db),today=beijingDate(now);
  if (body.revision !== previous.revision) fail('规则已被其他管理员修改，请刷新后再编辑',409);
  if (typeof body.enabled !== 'boolean') fail('请设置分红池开关');
  if (!['revenue','sales','fixed'].includes(body.source)) fail('请选择奖池来源');
  if (!['daily','weekly','monthly'].includes(body.cycle)) fail('请选择结算周期');
  const baseAmount=amount(body.baseAmount,100000000,'奖池基数'),percent=amount(body.percent,100,'奖池比例'),activityDays=integer(body.activityDays??previous.activityDays,0,365,'活动天数');
  if (activityDays>0 && body.cycle!=='daily') fail('分轮活动需要按天结算，请把结算周期设为每天或把活动天数设为0');
  if (body.enabled && (percent<=0 || (body.source==='fixed'&&baseAmount<=0))) fail('启用分红池时奖池金额必须大于0');
  let startDate=body.startDate||'';
  if (startDate && !validDay(startDate)) fail('开始日期无效');
  if (body.enabled) {
    // 重新开启不补发关闭期间；开始日期不得早于今天（沿用原日期除外），也不与已结算周期重叠
    const unchanged=previous.enabled&&startDate===previous.startDate;
    if (!startDate || (!unchanged && startDate<today)) startDate=today;
    const settledUntil=lastSettledEnd(db);if(settledUntil&&beijingStart(startDate)<settledUntil)startDate=beijingDate(settledUntil);
  }
  const row={revision:previous.revision+1,enabled:body.enabled,source:body.source,baseAmount,percent,cycle:body.cycle,activityDays,startDate,updatedAt:new Date(now).toISOString()};
  db.config ||= {}; db.config.poolReward=row;
  db.audit ||= [];db.audit.unshift({id:crypto.randomUUID(),actor,resource:'incomeRules',target:'pool',method:'PUT',revision:row.revision,createdAt:row.updatedAt});
  return row;
}
function poolOverview(db, now=Date.now()) {
  const rule=poolRule(db),start=rule.enabled&&validDay(rule.startDate)?Math.max(beijingStart(rule.startDate),lastSettledEnd(db)):0;
  const period=start?nextPeriod(rule,start):null,current=period&&period.start<=now?{start:period.start,end:Math.min(now,period.end)}:null;
  const win=period?activityWindow(rule,period.start):null,holders=poolHolders(db,now+1,win?win.start:-Infinity);
  const income=current&&rule.source!=='fixed'?periodIncome(db,rule,current.start,current.end+1)/100:0;
  return { activity:win?{round:win.round,day:win.day,days:win.days,start:new Date(win.start).toISOString()}:null, members:holders.size, totalWeight:[...holders.values()].reduce((n,w)=>n+w,0)/100, nextSettlementAt:period?new Date(period.end).toISOString():'',
    currentIncome:income, estimatedPool:current?poolCents(db,rule,{start:current.start,end:current.end+1})/100:0, settlements:(db.poolSettlements||[]).slice(-90).reverse() };
}
function manage(db, method, productId, body, actor) {
  init(db);
  if (method==='GET' && !productId) return { rules:db.incomeRules, referral:referralRule(db), pool:poolRule(db), poolOverview:poolOverview(db), products:db.products.filter(p=>p.packagePlans?.length).map(p=>({id:p.id,name:p.name,price:p.memberPrice??p.price,enabled:p.enabled})) };
  if (method!=='PUT' || !productId) fail('方法不允许',405);
  if (productId === 'referral') return manageReferral(db, body, actor);
  if (productId === 'pool') return managePool(db, body, actor);
  if (!db.products.some(p=>p.id===productId&&p.packagePlans?.length)) fail('请选择现有VIP套餐');
  const previous=db.incomeRules.find(r=>r.productId===productId);
  if (body.revision !== (previous?.revision||0)) fail('规则已被其他管理员修改，请刷新后再编辑',409);
  if (!['reverse','retain'].includes(body.refundPolicy)) fail('请选择退款收益处理方式');
  if (!Array.isArray(body.dynamic) || body.dynamic.length>10) fail('动态收益最多配置10个邀请层级');
  const dynamic=body.dynamic.map((r,i)=>({level:i+1,...part(r,false)}));
  const row={id:previous?.id||crypto.randomUUID(),productId,revision:(previous?.revision||0)+1,static:part(body.static,true),dynamic,refundPolicy:body.refundPolicy,updatedAt:new Date().toISOString(),actor};
  if(previous)Object.assign(previous,row);else db.incomeRules.push(row);
  db.audit ||= [];db.audit.unshift({id:crypto.randomUUID(),actor,resource:'incomeRules',target:productId,method:'PUT',revision:row.revision,createdAt:row.updatedAt});
  return row;
}
function publicRules(db) { init(db);if(poolRule(db).enabled)return [];return db.incomeRules.filter(r=>r.static.enabled).map(r=>({productId:r.productId,revision:r.revision,static:r.static,refundPolicy:r.refundPolicy})); }
function snapshot(db, order) {
  init(db);
  const rule=db.incomeRules.find(r=>r.productId===order.productId),referral=referralRule(db),buyer=db.users.find(u=>u.id===order.userId),s={};
  if(rule) {
    // 推荐奖励启用后替代套餐中的多级动态收益，避免同一订单重复奖励
    const seen=new Set([order.userId]),ancestors=[];
    let user=buyer;
    for(let i=0;!referral.enabled&&i<rule.dynamic.length;i++) {
      const next=db.users.find(u=>u.id===user?.inviterId);
      if(!next||seen.has(next.id))break;
      seen.add(next.id);ancestors.push({id:next.id,enabled:!next.disabled&&next.incomeAccess?.dynamic!==false});user=next;
    }
    const frozen=clone(rule);if(poolRule(db).enabled||buyer?.incomeAccess?.static===false)frozen.static={...frozen.static,enabled:false};
    Object.assign(s,{rule:frozen,ancestors});
  }
  if(referral.enabled) {
    const inviter=db.users.find(u=>u.id===buyer?.inviterId);
    const inScope=referral.scope==='all'||!!order.product?.packagePlans?.length;
    const fresh=!referral.durationDays||Date.now()-Date.parse(buyer?.createdAt)<=referral.durationDays*DAY;
    if(inviter&&inviter.id!==order.userId&&!inviter.disabled&&inviter.incomeAccess?.dynamic!==false&&inScope&&fresh)s.referral={rule:clone(referral),inviterId:inviter.id};
  }
  if(s.rule||s.referral)order.incomeSnapshot=s;
}
function centsFor(part, total) { const cents=Math.round(total*100);if(!Number.isSafeInteger(cents)||cents<0)fail('订单金额无效');return part.mode==='fixed'?Math.round(part.value*100):Number((BigInt(cents)*BigInt(Math.round(part.value*100))+5000n)/10000n); }
function addPlan(db,order,type,rule,userId,level=0) {
  const id=`${order.id}:${type}:${level}`;
  if(db.incomePlans.some(p=>p.id===id)||!rule.enabled)return;
  const stamp=rule.trigger==='paid'?order.paidAt:order.completedAt;
  if(!stamp || (rule.trigger==='completed'&&order.status!=='completed'))return;
  const cents=centsFor(rule,order.total);if(!cents)return;if(!Number.isSafeInteger(cents*(type==='static'?rule.periods:1)))fail('收益总额超出可计算范围');
  const start=Date.parse(stamp)+rule.delayDays*DAY;if(!Number.isFinite(start))fail('订单收益起算时间无效');
  db.incomePlans.push({id,orderId:order.id,userId,type,level,productName:order.product.name,revision:order.incomeSnapshot.rule.revision,amountCents:cents,periods:type==='static'?rule.periods:1,intervalDays:type==='static'?rule.intervalDays:1,startAt:new Date(start).toISOString(),posted:0,status:'active',refundPolicy:order.incomeSnapshot.rule.refundPolicy,createdAt:new Date().toISOString()});
}
const isPaid=o=>o.paymentStatus==='paid'&&o.refundStatus!=='refunded'&&!['cancelled','aftersale','pending'].includes(o.status);
// 首单 = 被推荐人第一笔已付款且未退款的适用订单，按付款时间排序（历史订单同样计入）
function isFirstOrder(db,order,rule) {
  const inScope=o=>rule.scope==='all'||!!o.product?.packagePlans?.length;
  const at=o=>{const t=Date.parse(o.paidAt||o.createdAt);return Number.isFinite(t)?t:0};
  return !db.orders.some(o=>o.id!==order.id&&o.userId===order.userId&&isPaid(o)&&inScope(o)&&(at(o)<at(order)||(at(o)===at(order)&&o.id<order.id)));
}
function addReferralPlan(db,order,referral) {
  const id=`${order.id}:referral:1`,rule=referral.rule;
  if(db.incomePlans.some(p=>p.id===id))return;
  const stamp=rule.trigger==='paid'?order.paidAt:order.completedAt;
  if(!stamp||(rule.trigger==='completed'&&order.status!=='completed'))return;
  const tier=isFirstOrder(db,order,rule)?'first':'later',percent=tier==='first'?rule.firstPercent:rule.laterPercent;
  const cents=centsFor({mode:'percent',value:percent},order.total);if(!cents)return;
  const start=Date.parse(stamp)+rule.delayDays*DAY;if(!Number.isFinite(start))fail('订单收益起算时间无效');
  db.incomePlans.push({id,orderId:order.id,userId:referral.inviterId,type:'dynamic',level:1,source:'referral',tier,percent,productName:order.product.name,revision:rule.revision,amountCents:cents,periods:1,intervalDays:1,startAt:new Date(start).toISOString(),posted:0,status:'active',refundPolicy:rule.refundPolicy,createdAt:new Date().toISOString()});
}
function activate(db,order) {
  init(db);const s=order.incomeSnapshot;
  if(!s||!isPaid(order))return;
  if(s.rule) {
    addPlan(db,order,'static',s.rule.static,order.userId);
    s.rule.dynamic.forEach((part,i)=>{if(s.ancestors[i]?.enabled)addPlan(db,order,'dynamic',part,s.ancestors[i].id,i+1)});
  }
  if(s.referral)addReferralPlan(db,order,s.referral);
}
function settle(db,now=Date.now(),limit=2000) {
  init(db);let posted=settlePool(db,now);
  const keys=new Set(db.earnings.map(e=>e.accrualKey).filter(Boolean));
  for(const p of db.incomePlans) {
    if(p.status!=='active')continue;
    const order=db.orders.find(o=>o.id===p.orderId);
    if(!order||order.refundStatus==='refunded'||['cancelled','aftersale','pending'].includes(order.status))continue;
    const user=db.users.find(u=>u.id===p.userId);if(!user||user.disabled)continue;
    while(p.posted<p.periods&&posted<limit) {
      const due=Date.parse(p.startAt)+p.posted*p.intervalDays*DAY;if(due>now)break;
      const period=p.posted+1,key=`${p.id}:${period}`;
      if(!keys.has(key)) {
        const label=p.source==='referral'?`推荐奖励（${p.tier==='first'?'首单':'后续订单'} ${p.percent}%）`:p.type==='static'?'静态收益 第'+period+'期':'动态收益 第'+p.level+'级';
        db.earnings.push({id:crypto.randomUUID(),accrualKey:key,planId:p.id,orderId:p.orderId,userId:p.userId,type:p.type,level:p.level,...(p.source?{source:p.source,tier:p.tier}:{}),period,revision:p.revision,kind:'credit',amountCents:p.amountCents,amount:p.amountCents/100,name:`${p.productName} · ${label}`,dueAt:new Date(due).toISOString(),createdAt:new Date(now).toISOString()});keys.add(key);posted++;
      }
      p.posted++;
    }
    if(p.posted>=p.periods)p.status='completed';
    if(posted>=limit)break;
  }
  return posted;
}
function refund(db,order,now=Date.now()) {
  init(db);
  const plans=db.incomePlans.filter(p=>p.orderId===order.id);
  for(const p of plans) {p.status='cancelled';p.cancelledAt=new Date(now).toISOString();}
  const existing=new Set(db.earnings.map(e=>e.reversalOf).filter(Boolean));
  for(const e of db.earnings.filter(e=>e.orderId===order.id&&e.kind==='credit')) {
    // 每个计划按自己的退款处理方式（套餐规则与推荐奖励可能不同）
    const policy=plans.find(p=>p.id===e.planId)?.refundPolicy??order.incomeSnapshot?.rule?.refundPolicy;
    if(policy!=='reverse'||existing.has(e.id))continue;
    db.earnings.push({...e,id:crypto.randomUUID(),accrualKey:'reverse:'+e.id,kind:'reversal',reversalOf:e.id,amountCents:-e.amountCents,amount:-e.amountCents/100,name:e.name+'（退款冲回）',createdAt:new Date(now).toISOString()});existing.add(e.id);
  }
}
function summary(db,userId) {
  init(db);const records=db.earnings.filter(e=>e.userId===userId);
  const sum=type=>records.filter(e=>type===undefined||e.type===type).reduce((n,e)=>n+(Number.isSafeInteger(e.amountCents)?e.amountCents:Math.round(Number(e.amount||0)*100)),0)/100;
  const plans=db.incomePlans.filter(p=>p.userId===userId&&p.status==='active');
  return {total:sum(),static:sum('static'),dynamic:sum('dynamic'),pending:plans.reduce((n,p)=>n+(p.periods-p.posted)*p.amountCents,0)/100};
}
function customerPlans(db,userId) {init(db);return db.incomePlans.filter(p=>p.userId===userId).map(p=>({id:p.id,type:p.type,name:p.productName,level:p.level,...(p.source?{source:p.source,tier:p.tier,percent:p.percent}:{}),amount:p.amountCents/100,periods:p.periods,posted:p.posted,status:p.status,nextAt:p.status==='active'?new Date(Date.parse(p.startAt)+p.posted*p.intervalDays*DAY).toISOString():'',paused:!!db.users.find(u=>u.id===userId)?.disabled}));}
module.exports={init,manage,publicRules,snapshot,activate,settle,refund,summary,customerPlans,centsFor,referralRule,poolRule,settlePool,allocate,managePool};
