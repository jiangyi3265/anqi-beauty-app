const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{once}=require('node:events'),seed=require('../server/seed.cjs'),legacy=require('../server/legacy-members.cjs'),income=require('../server/income.cjs');
const checks=[],id=()=>crypto.randomUUID(),DAY=86400000;
const profile=(name,phone,extra={})=>({requestId:id(),name,phone,note:'隔离测试线下约定',invited:true,disabled:false,incomeAccess:{static:true,dynamic:true},inviterId:'',...extra});
const selection=p=>{const plan=p.packagePlans[0];return {planId:plan.id,groups:Object.fromEntries(plan.groups.map(g=>[g.id,g.services.slice(0,g.pick).map(s=>({serviceId:s.id,...(s.options?.length?{option:s.options[0]}:{})}))]))}};
const grant=(db,u,extra={})=>({action:'grant',revision:u.memberRevision||0,confirmed:true,requestId:id(),productId:db.products.find(p=>p.packagePlans?.length).id,storeId:db.stores[0].id,total:6980,paidAt:new Date(Date.now()-1000).toISOString(),reference:id(),note:'隔离收款凭证',incomeTreatment:'historical',packageSelection:selection(db.products.find(p=>p.packagePlans?.length)),used:{},...extra});
{
 const db=seed();require('../server/vip-packages.cjs').seedCatalogue(db);income.init(db);const a=profile('线下甲','13900000001');const u=legacy.manage(db,'POST',null,a,'tester');assert.equal(legacy.manage(db,'POST',null,a,'tester').id,u.id);assert.throws(()=>legacy.manage(db,'POST',null,profile('重复','13900000001'),'tester'),/手机号/);assert.throws(()=>legacy.manage(db,'POST',null,{...a,name:'变更'},'tester'),/不一致/);
 const v=legacy.manage(db,'POST',null,profile('线下乙','13900000002',{inviterId:u.id}),'tester');assert.throws(()=>legacy.manage(db,'PUT',u.id,{...a,revision:1,inviterId:v.id},'tester'),/循环/);assert.throws(()=>legacy.manage(db,'PUT',u.id,{...a,revision:0},'tester'),/更新/);checks.push('offline profiles: unique phone, exact replay, stale edit and inviter cycle rejection');
 db.config.referralReward={enabled:true,firstPercent:50,laterPercent:10};const input=grant(db,v);const stock=db.products.find(p=>p.id===input.productId).stock;const o=legacy.manage(db,'POST',v.id,input,'tester');assert.equal(o.paymentStatus,'paid');assert.equal(db.earnings.length,0);assert.equal(db.products.find(p=>p.id===input.productId).stock,stock);assert.equal(legacy.manage(db,'POST',v.id,input,'tester').id,o.id);assert.throws(()=>legacy.manage(db,'POST',u.id,input,'tester'),/不一致/);assert.throws(()=>legacy.manage(db,'POST',v.id,{...input,requestId:id()},'tester'),/已录入/);
 const newOrder=legacy.manage(db,'POST',v.id,grant(db,v,{incomeTreatment:'apply'}),'tester');assert.equal(income.summary(db,u.id).dynamic,698);assert.equal(db.incomePlans[0].tier,'later');assert.throws(()=>legacy.manage(db,'POST',v.id,grant(db,v,{incomeTreatment:'apply',paidAt:new Date(Date.now()-2*DAY).toISOString()}),'tester'),/历史订单/);checks.push('historical grants: no stock movement or retrospective reward, retry safety, subsequent order 10%');
 const fresh=legacy.manage(db,'POST',null,profile('线下丙','13900000003',{inviterId:u.id}),'tester');legacy.manage(db,'POST',fresh.id,grant(db,fresh,{incomeTreatment:'apply',total:100}),'tester');assert.equal(income.summary(db,u.id).dynamic,748);
 legacy.manage(db,'PUT',u.id,{...a,revision:1,incomeAccess:{static:false,dynamic:false}},'tester');legacy.manage(db,'POST',fresh.id,grant(db,fresh,{incomeTreatment:'apply',total:100}),'tester');assert.equal(income.summary(db,u.id).dynamic,748);checks.push('original first-order 50% and customer-level eligibility on future orders');
 const target={id:id(),openid:'test-openid',wechatAppId:'wx-test',phone:'',points:100,streak:1,lastSign:'2026-10-22',createdAt:new Date().toISOString()};db.users.push(target);db.ledger.push({id:id(),userId:target.id,amount:100});
 const bound=legacy.manage(db,'POST',v.id,{action:'bind',revision:1,targetId:target.id,targetCode:target.id.slice(0,8),note:'已核对本人会员编号',confirmed:true},'tester');assert.equal(bound.member.openid,'test-openid');assert.equal(bound.member.points,100);assert.equal(db.ledger.at(-1).userId,v.id);assert.equal(target.openid,undefined);assert.equal(target.mergedInto,v.id);assert.equal(db.orders.find(x=>x.id===o.id).userId,v.id);checks.push('identity association preserves offline entitlements, moves verified identity and points, retires empty account');
 const busy={id:id(),openid:'busy',phone:'',createdAt:new Date().toISOString()};db.users.push(busy);db.orders.push({id:id(),userId:busy.id});assert.throws(()=>legacy.manage(db,'POST',fresh.id,{action:'bind',revision:1,targetId:busy.id,targetCode:busy.id.slice(0,8),note:'test',confirmed:true},'tester'),/已有业务/);
 const invalid=grant(db,fresh);invalid.used={'invalid':1};assert.throws(()=>legacy.manage(db,'POST',fresh.id,invalid,'tester'),/无效项目/);
 // An imported old payment must never enter a period ending before the import itself.
 const now=Date.now(),start=new Date(now-2*DAY+8*3600000).toISOString().slice(0,10);db.config.poolReward={enabled:true,source:'revenue',percent:5,cycle:'daily',activityDays:0,startDate:start};db.poolSettlements=[];db.earnings=[];
 income.settlePool(db,now);assert.ok(db.poolSettlements.every(s=>s.poolCents===0));checks.push('no reopening historical pool periods; existing-account merge and invalid consumption rejected');
}
{
 const vip=require('../server/vip-packages.cjs'),db=seed();vip.seedCatalogue(db);income.init(db);
 const a=legacy.manage(db,'POST',null,profile('次数验收','13900000005'),'tester');
 const g=grant(db,a),p=db.products.find(p=>p.id===g.productId),pack=vip.selectPackage(p,g.packageSelection);
 g.used=Object.fromEntries(pack.services.map(s=>[s.id,s.total]));g.used[pack.services[0].id]--;
 const order=legacy.manage(db,'POST',a.id,g,'tester'),sid=order.package.services[0].id;
 assert.equal(vip.remaining(order,sid,[]),1);assert.equal(vip.remaining(order,sid,[{orderId:order.id,entitlementId:sid,status:'booked'}]),0);
 vip.complete(order,{entitlementId:sid});assert.equal(order.status,'completed');assert.equal(vip.remaining(order,sid,[]),0);assert.throws(()=>vip.complete(order,{entitlementId:sid}),/不可核销/);
 checks.push('imported used counts and reservation limits, last service completes package, double redemption rejected');
 const start=Date.parse('2026-10-22T00:00:00+08:00');
 const pooled={config:{poolReward:{enabled:true,source:'revenue',percent:5,cycle:'daily',activityDays:3,startDate:'2026-10-22'}},users:[{id:'a'},{id:'b',incomeAccess:{static:false,dynamic:true}}],orders:[],products:[p],incomeRules:[],incomePlans:[],earnings:[],poolSettlements:[]};
 for(const uid of ['a','b'])pooled.orders.push({id:uid,userId:uid,productId:p.id,product:p,total:100,status:'ready',paymentStatus:'paid',paidAt:new Date(start+3600000).toISOString()});
 income.settle(pooled,start+DAY+1);assert.deepEqual(pooled.earnings.map(e=>[e.userId,e.amountCents]),[['a',1000]]);
 checks.push('static eligibility excludes ineligible recipient while paid revenue remains in the original 5% pool');
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xiurong-offline-')),file=path.join(dir,'db.json'),secret=id();let child,base;
async function req(route,method='GET',body,token,status=200,admin=false){const r=await fetch(base+route,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(admin?{'x-anqi-internal':secret}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
const adm=(r,m='GET',b,s=200)=>req('/admin/'+r,m,b,null,s,true);
async function start(){const sock=net.createServer().listen(0,'127.0.0.1');await once(sock,'listening');const port=sock.address().port;await new Promise(r=>sock.close(r));base=`http://127.0.0.1:${port}/api`;child=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:'',NODE_ENV:'test',WECHAT_MOCK:'true',DEMO_MODE:'false',ADMIN_PASSWORD:secret,INTERNAL_SECRET:secret,PAYMENT_MODE:'off'},stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',b=>err+=b);for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(err);try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error(err||'start failed')}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}}
(async()=>{fs.writeFileSync(file,JSON.stringify(seed()));await start();await req('/admin/legacyMembers','GET',null,null,401);const init=await adm('legacyMembers');const body=profile('离线客户','13900000004');const created=await adm('legacyMembers','POST',body);assert.equal(created.adminNote,undefined);assert.equal(created.offlineFingerprint,undefined);assert.equal(created.wechatBound,false);
 const db={products:init.products,stores:init.stores};const payload=grant(db,created);const [a,b]=await Promise.all([adm('legacyMembers/'+created.id,'POST',payload),adm('legacyMembers/'+created.id,'POST',payload)]);assert.equal(a.id,b.id);assert.equal((await adm('orders')).filter(o=>o.userId===created.id).length,1);
 const login=await req('/auth/wechat','POST',{code:'offline-link-test'});await req('/sign','POST',{},login.token);const linked=await adm('legacyMembers/'+created.id,'POST',{action:'bind',revision:1,targetId:login.user.id,targetCode:login.user.id.slice(0,8),note:'验收本人编号',confirmed:true});assert.equal(linked.wechatBound,true);assert.equal(linked.points,1);await req('/me','GET',null,login.token,401);checks.push('API authorization, atomic concurrent replay, account association and old-session revocation');
 await stop();let saved=JSON.parse(fs.readFileSync(file));const old=saved.users.find(u=>u.id===created.id);old.wechatLoginCodes=[];fs.writeFileSync(file,JSON.stringify(saved));await start();const again=await req('/auth/wechat','POST',{code:'offline-link-test'});assert.equal(again.user.id,created.id);const orders=await req('/orders','GET',null,again.token);assert.equal(orders.length,1);assert.equal(orders[0].status,'ready');assert.equal(orders[0].package.services.length,a.package.services.length);assert.equal((await req('/me','GET',null,again.token)).points,1);checks.push('restart persistence and real login resolves original offline identity and service entitlements');
 const beforeStock=(await adm('products')).find(p=>p.id===payload.productId).stock;
 await adm('orders/'+a.id,'POST',{action:'refund',note:'隔离测试退款'});
 assert.equal((await adm('products')).find(p=>p.id===payload.productId).stock,beforeStock);
 assert.equal((await req('/orders','GET',null,again.token))[0].refundStatus,'refunded');
 checks.push('imported unused package refund removes entitlement without inflating inventory');
 const registered=await req('/auth/wechat','POST',{code:'registered-direct-management'});
 const beforeMembers=(await adm('users')).length;
 await adm('legacyMembers/'+registered.user.id,'PUT',{...profile('直接办理会员','13900000006'),revision:0,inviterId:created.id});
 const current=(await adm('users')).find(u=>u.id===registered.user.id);
 const directOrder=await adm('legacyMembers/'+current.id,'POST',grant(db,current));
 assert.equal((await adm('users')).length,beforeMembers);
 assert.equal((await req('/me','GET',null,registered.token)).invited,true);
 assert.ok((await req('/orders','GET',null,registered.token)).some(o=>o.id===directOrder.id));
 await adm('users/'+current.id,'POST',{action:'points',amount:500,note:'隔离测试增加积分'});
 assert.equal((await req('/me','GET',null,registered.token)).points,500);
 await adm('users/'+current.id,'POST',{action:'points',amount:-120,note:'隔离测试扣减积分'});
 assert.equal((await req('/me','GET',null,registered.token)).points,380);
 await adm('users/'+current.id,'POST',{action:'points',amount:-381,note:'禁止负余额'},400);
 assert.equal((await req('/me','GET',null,registered.token)).points,380);
 const entries=await req('/ledger','GET',null,registered.token);assert.deepEqual(entries.map(e=>e.amount),[500,-120]);
 checks.push('direct registered-account eligibility and package grants without creating or merging identities; points credit/debit, ledger and negative-balance rejection');
 console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(stop);
