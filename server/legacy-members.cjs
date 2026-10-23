const crypto = require('node:crypto');
const vip = require('./vip-packages.cjs');
const income = require('./income.cjs');
const clone = v => JSON.parse(JSON.stringify(v));
const fail = (message, status=400) => { throw Object.assign(new Error(message), {status}); };
const text = (v, label, max=200) => { if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(label+'不能为空或过长');return v.trim(); };
const active = (db,id) => {const u=db.users.find(u=>u.id===id&&!u.mergedInto);if(!u)fail('会员不存在',404);return u;};
const fingerprint = b => crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex');
function requestId(b) { const key=text(b.requestId,'操作编号',80);if(!/^[a-zA-Z0-9-]+$/.test(key))fail('操作编号无效');return key; }
function access(v) {if(!v||typeof v.static!=='boolean'||typeof v.dynamic!=='boolean')fail('请设置静态、动态收益资格');return {static:v.static,dynamic:v.dynamic};}
function profile(db,b,self) {
 const name=text(b.name,'姓名',40),phone=text(b.phone,'手机号',11),note=text(b.note,'操作说明',500);
 if(!/^1\d{10}$/.test(phone))fail('请输入11位手机号');
 if(db.users.some(u=>!u.mergedInto&&u.id!==self&&u.phone===phone))fail('该手机号已有档案，请选择已有会员',409);
 if(typeof b.invited!=='boolean'||typeof b.disabled!=='boolean')fail('会员权限开关无效');
 const inviterId=b.inviterId||'';if(typeof inviterId!=='string')fail('推荐人无效');
 const seen=new Set(self?[self]:[]);let next=inviterId;
 while(next){if(seen.has(next))fail('推荐关系不能形成循环');seen.add(next);const parent=active(db,next);if(parent.disabled)fail('推荐人已停用');next=parent.inviterId;}
 return {name,phone,adminNote:note,invited:b.invited,disabled:b.disabled,inviterId,incomeAccess:access(b.incomeAccess)};
}
function audit(db,actor,action,target,details) {db.audit||=[];db.audit.unshift({id:crypto.randomUUID(),actor,resource:'legacyMembers',method:action,target,details,createdAt:new Date().toISOString()});}
function syncInviter(db,u) {
 db.shares||=[];const existing=db.shares.find(s=>s.memberId===u.id&&s.userId===u.inviterId);db.shares=db.shares.filter(s=>s.memberId!==u.id);
 if(u.inviterId)db.shares.push(existing?{...existing,name:u.name}:{id:crypto.randomUUID(),userId:u.inviterId,memberId:u.id,name:u.name,source:'admin',createdAt:new Date().toISOString()});
}
function checkRevision(u,b) {if(b.revision!==(u.memberRevision||0))fail('会员资料已更新，请刷新后再操作',409);}
function manage(db,method,key,b,actor) {
 if(method==='POST'&&!key){
  const rid=requestId(b),hash=fingerprint(b),existing=db.users.find(u=>u.offlineRequestId===rid);
  if(existing){if(existing.offlineFingerprint!==hash)fail('操作编号重复，内容不一致',409);return existing;}
  const value=profile(db,b),u={id:crypto.randomUUID(),...value,source:'offline',offlineRequestId:rid,offlineFingerprint:hash,memberRevision:1,avatar:'/static/assets/avatar.png',gender:'',points:0,streak:0,lastSign:'',lastSignAt:'',createdAt:new Date().toISOString()};
  db.users.push(u);syncInviter(db,u);audit(db,actor,'CREATE',u.id,{note:value.adminNote});return u;
 }
 const u=active(db,key);
 if(method==='PUT') {
  checkRevision(u,b);const value=profile(db,b,u.id);income.settle(db);
  const previous={inviterId:u.inviterId||'',incomeAccess:u.incomeAccess||{static:true,dynamic:true},invited:u.invited,disabled:!!u.disabled};
  Object.assign(u,value,{memberRevision:(u.memberRevision||0)+1});syncInviter(db,u);audit(db,actor,'CONFIGURE',u.id,{previous,next:{inviterId:u.inviterId,incomeAccess:u.incomeAccess,invited:u.invited,disabled:u.disabled},note:value.adminNote});return u;
 }
 if(method!=='POST')fail('方法不允许',405);
 if(b.action==='grant') {
  const rid=requestId(b),hash=fingerprint({key,...b}),prior=db.orders.find(o=>o.offlineRequestId===rid);
  if(prior){if(prior.offlineFingerprint!==hash)fail('操作编号重复，内容不一致',409);return prior;}
  checkRevision(u,b);if(b.confirmed!==true)fail('请核实线下收款和剩余次数');if(u.disabled)fail('请先启用该会员');
  const note=text(b.note,'线下凭证说明',500),reference=text(b.reference,'线下单据编号',80);
  if(db.orders.some(o=>o.userId===u.id&&o.offlineReference===reference))fail('该会员的线下单据已录入',409);
  const p=db.products.find(p=>p.id===b.productId&&p.enabled&&p.status==='published'&&p.packagePlans?.length);if(!p)fail('请选择已上架的VIP套餐');
  const store=db.stores.find(s=>s.id===b.storeId&&s.enabled!==false);if(!store)fail('请选择有效门店');
  if(typeof b.total!=='number'||!Number.isFinite(b.total)||b.total<=0||b.total>10000000||Math.abs(b.total*100-Math.round(b.total*100))>0.000001)fail('实付金额须大于0，最多两位小数');
  const paid=Date.parse(b.paidAt),now=Date.now();if(typeof b.paidAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(b.paidAt)||!Number.isFinite(paid)||paid>now||paid<Date.parse('2000-01-01T00:00:00Z'))fail('请填写有效的历史收款时间，不能晚于现在');
  if(!['historical','apply'].includes(b.incomeTreatment))fail('请选择收益处理方式');
  const today=new Date(now+8*3600000).toISOString().slice(0,10);
  if(b.incomeTreatment==='apply'&&paid<Date.parse(today+'T00:00:00+08:00'))fail('按规则发放仅适用于今日新收款；历史订单请选不重复发放');
  const pack=vip.selectPackage(p,b.packageSelection),used=b.used||{};
  if(typeof used!=='object'||Array.isArray(used)||Object.keys(used).some(id=>!pack.services.some(s=>s.id===id)))fail('已使用次数包含无效项目');
  for(const s of pack.services){const n=used[s.id]??0;if(!Number.isInteger(n)||n<0||n>s.total)fail(s.name+'已使用次数无效');s.used=n;}
  if(b.incomeTreatment==='apply'&&pack.services.some(s=>s.used>0))fail('已使用套餐应按历史订单录入');
  // Close earlier periods before importing historical facts. Do not reopen old settlements.
  income.settle(db);
  const at=new Date(now).toISOString(),o={id:crypto.randomUUID(),number:'OFF'+now+crypto.randomInt(100,999),userId:u.id,productId:p.id,product:clone(p),package:pack,quantity:1,spec:'single',skuId:'',price:b.total,total:b.total,storeId:store.id,store:Object.fromEntries(['id','name','address','contact','phone','hours'].map(k=>[k,store[k]||''])),status:pack.services.every(s=>s.used===s.total)?'completed':'ready',paymentStatus:'paid',paymentMode:'offline',paymentNote:note,paidAt:new Date(paid).toISOString(),createdAt:at,refundStatus:'',address:null,message:'门店补录线下套餐',source:'offlineImport',inventoryReserved:false,offlineReference:reference,offlineRequestId:rid,offlineFingerprint:hash,incomeTreatment:b.incomeTreatment};
  if(o.status==='completed')o.completedAt=at;
  if(b.incomeTreatment==='apply')income.snapshot(db,o);
  db.orders.unshift(o);income.activate(db,o);income.settle(db);audit(db,actor,'GRANT',u.id,{orderId:o.id,total:o.total,paidAt:o.paidAt,incomeTreatment:o.incomeTreatment,note});return o;
 }
 if(b.action==='bind') {
  checkRevision(u,b);text(b.note,'核实说明',500);if(b.confirmed!==true)fail('请先核对客户本人的会员编号');
  if(u.source!=='offline'||u.openid)fail('仅未绑定的线下档案可关联微信');
  const target=active(db,b.targetId);
  if(typeof b.targetCode!=='string'||b.targetCode.trim().toUpperCase()!==target.id.slice(0,8).toUpperCase())fail('请输入客户本人小程序邀请码页面上的8位会员编号进行核对');
  if(target.id===u.id||!target.openid||target.disabled||target.source==='offline')fail('请选择有效的微信会员');
  // Never silently merge two established customers or their financial relationships.
  const hasBusiness=['orders','appointments','claims','redemptions','earnings','incomePlans','payouts'].some(k=>(db[k]||[]).some(r=>r.userId===target.id));
  if(hasBusiness||target.inviterId||db.users.some(x=>x.inviterId===target.id)||(db.shares||[]).some(x=>x.userId===target.id||x.memberId===target.id))fail('目标微信会员已有业务或推荐关系，请直接在该会员名下补录，不能合并',409);
  if(target.phone&&target.phone!==u.phone)fail('双方手机号不一致，请先核实身份',409);
  for(const k of ['openid','wechatAppId','wechatLoginCodes','subscriptionCredits','unionid']){if(target[k]!==undefined)u[k]=target[k];delete target[k];}
  for(const k of ['ledger','addresses','notifications'])for(const r of db[k]||[])if(r.userId===target.id)r.userId=u.id;
  u.points=(u.points||0)+(target.points||0);u.streak=target.streak||0;u.lastSign=target.lastSign||'';u.lastSignAt=target.lastSignAt||'';
  u.memberRevision=(u.memberRevision||0)+1;u.wechatBoundAt=new Date().toISOString();target.points=0;target.disabled=true;target.mergedInto=u.id;
  audit(db,actor,'BIND',u.id,{previousWechatMemberId:target.id,note:b.note});return {member:u,revokeUserId:target.id};
 }
 fail('不支持的会员操作');
}
module.exports={manage};
