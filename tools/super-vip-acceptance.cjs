// 股东邀请验收：购买 VIP 套餐并由后台认证后才有专属二维码；被邀请的普通顾客不会自动成为股东。
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {spawn}=require('node:child_process'),{once}=require('node:events'),seed=require('../server/seed.cjs');
const {makeSuperVip}=require('./test-super-vip.cjs');
const checks=[],root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'super-vip-')),file=path.join(dir,'db.json'),secret=crypto.randomBytes(16).toString('hex');
let child,base;
async function req(route,method='GET',data,token,status=200,internal=false){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(internal?{'x-anqi-internal':secret}:{})},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();assert.equal(r.status,status,`${method} ${route}: ${JSON.stringify(b)}`);return b}
const admin=(route,method='GET',data,status=200)=>req('/admin/'+route,method,data,null,status,true);
async function start(){const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/api`;child=spawn(process.execPath,['server/index.cjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:'',NODE_ENV:'test',DEMO_MODE:'false',WECHAT_MOCK:'true',ADMIN_PASSWORD:secret,INTERNAL_SECRET:secret,PAYMENT_MODE:'off'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(errors);try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error(errors||'startup timeout')}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}}
const login=(code,invite)=>req('/auth/wechat','POST',{code:code+'-'+Date.now(),...(invite?{invite}:{})});
const codeOf=u=>u.user.id.slice(0,8).toUpperCase();
const userRow=async id=>(await admin('users')).find(u=>u.id===id);
(async()=>{
  fs.writeFileSync(file,JSON.stringify(seed()));await start();
  const boot=await req('/bootstrap'),store=boot.stores[0].id,kit=boot.products.find(p=>p.id==='jimeili-rejuvenation-set');
  const rules=await admin('incomeRules');await admin('incomeRules/referral','PUT',{...rules.referral,enabled:true,requireCard:true});
  const pay=async who=>{const o=await req('/orders','POST',{productId:kit.id,quantity:1,spec:'single',storeId:store},who.token);await admin('orders/'+o.id,'POST',{action:'confirmPayment',note:'门店收款'});return o};
  const dyn=async who=>(await req('/earnings-summary','GET',undefined,who.token)).dynamic;

  const jia=await login('jia');
  const locked=await req('/share-code','GET',undefined,jia.token);
  assert.deepEqual(locked,{locked:true,memberCode:codeOf(jia)});
  const stranger=await login('stranger',codeOf(jia));const sRow=await userRow(stranger.user.id);
  assert.equal(sRow.inviterId,undefined);assert.equal(sRow.invited,false);assert.equal((await req('/shares','GET',undefined,jia.token)).length,0);
  checks.push('甲未购卡也未认证：没有二维码，会员编号不能用于邀请');

  await makeSuperVip(admin,jia.user.id,'jia');
  const share=await req('/share-code','GET',undefined,jia.token);assert.ok(share.image&&!share.locked);
  const linked=await req('/invite/bind','POST',{invite:codeOf(jia)},stranger.token);
  assert.equal(linked.status,'bound');assert.equal(linked.user.inviterId,jia.user.id);
  assert.equal((await req('/invite/bind','POST',{invite:codeOf(jia)},stranger.token)).status,'alreadyBound');
  assert.equal((await req('/shares','GET',undefined,jia.token)).filter(row=>row.memberId===stranger.user.id).length,1);
  checks.push('已有账号未付款时扫码自动绑定；重复扫码不产生第二条邀请记录');
  const yi=await login('yi',codeOf(jia));const yRow=await userRow(yi.user.id);
  assert.equal(yRow.inviterId,jia.user.id);assert.equal(yRow.invited,true);
  const o1=await pay(yi);assert.equal(await dyn(jia),Math.round(o1.total*50)/100);
  checks.push('甲购卡并认证股东后有二维码；乙首单 '+o1.total+' 元，甲拿 '+Math.round(o1.total*50)/100+' 元');
  const oldBuyer=await login('old-buyer');await pay(oldBuyer);
  const beforeOldBuyerBind=await dyn(jia);
  assert.equal((await req('/invite/bind','POST',{invite:codeOf(jia)},oldBuyer.token)).status,'bound');
  assert.equal((await userRow(oldBuyer.user.id)).inviterId,jia.user.id);
  assert.equal(await dyn(jia),beforeOldBuyerBind);
  checks.push('已有付款订单的老会员首次扫码可绑定推荐人；旧订单不追溯奖励');
  const pendingBuyer=await login('pending-buyer');
  const pending=await req('/orders','POST',{productId:kit.id,quantity:1,spec:'single',storeId:store},pendingBuyer.token);
  assert.equal((await req('/invite/bind','POST',{invite:codeOf(jia)},pendingBuyer.token)).status,'bound');
  assert.equal((await userRow(pendingBuyer.user.id)).inviterId,jia.user.id);
  const beforePending=await dyn(jia);
  await admin('orders/'+pending.id,'POST',{action:'confirmPayment',note:'门店收款'});
  assert.equal(await dyn(jia),beforePending);
  checks.push('已有待付款订单的会员仍可绑定；已创建订单不追溯推荐奖励，后续新订单按新关系处理');

  assert.equal((await req('/share-code','GET',undefined,yi.token)).locked,true);
  const bing=await login('bing',codeOf(yi));assert.equal((await userRow(bing.user.id)).inviterId,undefined);
  const before=await dyn(jia);await pay(bing);assert.equal(await dyn(jia),before);assert.equal(await dyn(yi),0);
  checks.push('乙未认证股东：没有二维码；丙用乙的编号注册不绑定，甲乙均无间接奖励');

  const ding=await login('ding',codeOf(jia));const o2=await pay(ding);
  assert.equal(await dyn(jia),Math.round((before+o2.total*0.5)*100)/100);assert.equal(await dyn(yi),0);
  checks.push('乙带来的朋友丁扫甲的码进来，算甲直接推荐的，丁首单甲拿 50%，乙不拿');

  await makeSuperVip(admin,yi.user.id,'yi');
  assert.ok((await req('/share-code','GET',undefined,yi.token)).image);
  assert.equal((await req('/invite/bind','POST',{invite:codeOf(yi)},jia.token)).status,'invalid');
  assert.equal((await userRow(jia.user.id)).inviterId,undefined);
  checks.push('已有推荐链不能反向扫码形成循环');
  assert.equal((await req('/invite/bind','POST',{invite:codeOf(yi)},stranger.token)).status,'hasInviter');
  assert.equal((await userRow(stranger.user.id)).inviterId,jia.user.id);
  const wu=await login('wu',codeOf(yi));assert.equal((await userRow(wu.user.id)).inviterId,yi.user.id);
  const jiaBefore=await dyn(jia);const o3=await pay(wu);
  assert.equal(await dyn(yi),Math.round(o3.total*50)/100);assert.equal(await dyn(jia),jiaBefore);
  checks.push('乙购卡并认证股东后有自己的码；戊首单乙拿 50%，甲不拿');

  const yiOrder=await pay(yi);assert.equal(await dyn(jia),Math.round((jiaBefore+yiOrder.total*0.1)*100)/100);
  checks.push('乙自己以后的消费，仍按后续 10% 奖励给推荐他的甲');
  const beforeStranger=await dyn(jia),strangerOrder=await pay(stranger);
  assert.equal(await dyn(jia),Math.round((beforeStranger+strangerOrder.total*0.5)*100)/100);
  checks.push('老会员扫码绑定后创建的新首单按原收益规则入账');

  const arch=(name,phone,extra={})=>({requestId:'sv-'+crypto.randomUUID(),name,phone,note:'测试线下档案',invited:false,disabled:false,incomeAccess:{static:true,dynamic:true},inviterId:'',...extra});
  const listed=(await admin('legacyMembers')).members;assert.equal(listed.find(m=>m.id===jia.user.id).superVip,true);assert.equal(listed.find(m=>m.id===bing.user.id).superVip,false);
  assert.match((await admin('legacyMembers','POST',arch('线下档案一','13900000101',{inviterId:bing.user.id}),400)).error,/认证股东/);
  const off=await admin('legacyMembers','POST',arch('线下档案二','13900000102',{inviterId:jia.user.id}));assert.equal(off.inviterId,jia.user.id);
  checks.push('后台建线下档案：直接推荐人只能选认证股东（选丙被拒绝，选甲可以）');

  const card=(await admin('orders')).find(o=>o.userId===jia.user.id&&o.product?.packagePlans?.length);await admin('orders/'+card.id,'POST',{action:'refund',note:'退卡',refundConfirmed:true,refundAmount:card.total,refundedAt:new Date().toISOString(),refundMethod:'隔离测试',refundReference:'test-'+card.id});
  assert.equal((await req('/share-code','GET',undefined,jia.token)).locked,true);
  const late=await login('late',codeOf(jia));assert.equal((await userRow(late.user.id)).inviterId,undefined);
  checks.push('甲退卡后失去股东分享资格：二维码收回，之后用甲的码注册不算甲推荐的');
  const kept=await admin('legacyMembers/'+off.id,'PUT',{...arch('线下档案二改名','13900000102',{inviterId:jia.user.id}),revision:off.memberRevision});assert.equal(kept.inviterId,jia.user.id);
  assert.match((await admin('legacyMembers/'+off.id,'PUT',{...arch('线下档案二','13900000102',{inviterId:bing.user.id}),revision:kept.memberRevision},400)).error,/认证股东/);
  checks.push('以前登记的推荐人退卡后，改档案其他内容照常保存；但不能新改成非认证股东');

  await stop();await start();assert.equal((await req('/share-code','GET',undefined,yi.token)).locked,undefined);
  checks.push('重启后规则不变');
  console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
