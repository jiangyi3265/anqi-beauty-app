const crypto = require('node:crypto');
const DAY = 86400000;
const clone = x => JSON.parse(JSON.stringify(x));
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function init(db) { db.incomeRules ||= []; db.incomePlans ||= []; db.earnings ||= []; }
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
function manage(db, method, productId, body, actor) {
  init(db);
  if (method==='GET' && !productId) return { rules:db.incomeRules, products:db.products.filter(p=>p.packagePlans?.length).map(p=>({id:p.id,name:p.name,price:p.memberPrice??p.price,enabled:p.enabled})) };
  if (method!=='PUT' || !productId) fail('方法不允许',405);
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
function publicRules(db) { init(db);return db.incomeRules.filter(r=>r.static.enabled).map(r=>({productId:r.productId,revision:r.revision,static:r.static,refundPolicy:r.refundPolicy})); }
function snapshot(db, order) {
  init(db);
  const rule=db.incomeRules.find(r=>r.productId===order.productId);
  if(!rule)return;
  const seen=new Set([order.userId]),ancestors=[];
  let user=db.users.find(u=>u.id===order.userId);
  for(let i=0;i<rule.dynamic.length;i++) {
    const next=db.users.find(u=>u.id===user?.inviterId);
    if(!next||seen.has(next.id))break;
    seen.add(next.id);ancestors.push({id:next.id,enabled:!next.disabled});user=next;
  }
  order.incomeSnapshot={rule:clone(rule),ancestors};
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
function activate(db,order) {
  init(db);const s=order.incomeSnapshot;
  if(!s||order.paymentStatus!=='paid'||order.refundStatus==='refunded'||['cancelled','aftersale','pending'].includes(order.status))return;
  addPlan(db,order,'static',s.rule.static,order.userId);
  s.rule.dynamic.forEach((part,i)=>{if(s.ancestors[i]?.enabled)addPlan(db,order,'dynamic',part,s.ancestors[i].id,i+1)});
}
function settle(db,now=Date.now(),limit=2000) {
  init(db);let posted=0;
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
        db.earnings.push({id:crypto.randomUUID(),accrualKey:key,planId:p.id,orderId:p.orderId,userId:p.userId,type:p.type,level:p.level,period,revision:p.revision,kind:'credit',amountCents:p.amountCents,amount:p.amountCents/100,name:`${p.productName} · ${p.type==='static'?'静态收益 第'+period+'期':'动态收益 第'+p.level+'级'}`,dueAt:new Date(due).toISOString(),createdAt:new Date(now).toISOString()});keys.add(key);posted++;
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
  for(const p of db.incomePlans.filter(p=>p.orderId===order.id)) {p.status='cancelled';p.cancelledAt=new Date(now).toISOString();}
  if(order.incomeSnapshot?.rule.refundPolicy!=='reverse')return;
  const existing=new Set(db.earnings.map(e=>e.reversalOf).filter(Boolean));
  for(const e of db.earnings.filter(e=>e.orderId===order.id&&e.kind==='credit')) {
    if(existing.has(e.id))continue;
    db.earnings.push({...e,id:crypto.randomUUID(),accrualKey:'reverse:'+e.id,kind:'reversal',reversalOf:e.id,amountCents:-e.amountCents,amount:-e.amountCents/100,name:e.name+'（退款冲回）',createdAt:new Date(now).toISOString()});existing.add(e.id);
  }
}
function summary(db,userId) {
  init(db);const records=db.earnings.filter(e=>e.userId===userId);
  const sum=type=>records.filter(e=>type===undefined||e.type===type).reduce((n,e)=>n+(Number.isSafeInteger(e.amountCents)?e.amountCents:Math.round(Number(e.amount||0)*100)),0)/100;
  const plans=db.incomePlans.filter(p=>p.userId===userId&&p.status==='active');
  return {total:sum(),static:sum('static'),dynamic:sum('dynamic'),pending:plans.reduce((n,p)=>n+(p.periods-p.posted)*p.amountCents,0)/100};
}
function customerPlans(db,userId) {init(db);return db.incomePlans.filter(p=>p.userId===userId).map(p=>({id:p.id,type:p.type,name:p.productName,level:p.level,amount:p.amountCents/100,periods:p.periods,posted:p.posted,status:p.status,nextAt:p.status==='active'?new Date(Date.parse(p.startAt)+p.posted*p.intervalDays*DAY).toISOString():'',paused:!!db.users.find(u=>u.id===userId)?.disabled}));}
module.exports={init,manage,publicRules,snapshot,activate,settle,refund,summary,customerPlans,centsFor};
