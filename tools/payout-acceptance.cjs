// 收益兑现验收：门店线下付款后登记，只记账不转账；待兑现 = 累计净收益 − 已兑现，登记不超额、不重复，可撤销留痕。
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {makeSuperVip}=require('./test-super-vip.cjs');
const {spawn}=require('node:child_process'),{once}=require('node:events'),income=require('../server/income.cjs'),seed=require('../server/seed.cjs');
const checks=[];
const rid=()=>crypto.randomUUID();
const credit=(db,userId,cents,extra={})=>db.earnings.push({id:rid(),userId,type:'static',source:'pool',kind:'credit',amountCents:cents,amount:cents/100,createdAt:new Date().toISOString(),...extra});

(function unit(){
  const db={users:[{id:'a',name:'甲'},{id:'b',name:'乙'},{id:'old',mergedInto:'a'}],earnings:[],audit:[]};income.init(db);
  credit(db,'a',54800);credit(db,'a',-4980,{kind:'reversal'});credit(db,'b',1000);
  assert.deepEqual(income.balanceOf(db,'a'),{earnedCents:49820,paidOutCents:0,reservedCents:0,availableCents:49820});
  const pay=(o={})=>income.managePayout(db,{action:'payout',userId:'a',amount:300,method:'wechat',note:'微信转账',confirmed:true,requestId:rid(),...o},'店长');
  const first=pay({requestId:'req-00000001'});
  assert.equal(first.amountCents,30000);assert.equal(first.status,'paid');assert.equal(first.actor,'店长');
  assert.equal(pay({requestId:'req-00000001'}).id,first.id);assert.equal(db.payouts.length,1);
  assert.throws(()=>pay({requestId:'req-00000001',amount:1}),/已经提交过/);
  checks.push('登记 300 元后待兑现 198.20；同一登记编号重复提交只记一次，编号被改用他途会被拒绝');
  for(const [o,msg] of [[{amount:198.21},/不能超过待兑现 ¥198.20/],[{amount:0},/须大于0/],[{amount:-5},/兑现金额无效/],[{amount:1.234},/兑现金额无效/],[{amount:'100'},/兑现金额无效/],[{method:'card'},/兑现方式/],[{confirmed:false},/确认已经线下付款/],[{userId:'old'},/会员不存在/],[{userId:'nobody'},/会员不存在/],[{requestId:'x'},/登记编号无效/]])assert.throws(()=>pay(o),msg);
  pay({amount:198.20});assert.equal(income.balanceOf(db,'a').availableCents,0);assert.throws(()=>pay({amount:0.01}),/不能超过待兑现 ¥0.00/);
  checks.push('超额、0 元、负数、三位小数、文本金额、未知方式、未勾选已付款、已合并或不存在的会员、无效编号都被拒绝；余额兑完后不能再登记');
  assert.throws(()=>income.managePayout(db,{action:'cancel',id:first.id,reason:'  '},'店长'),/撤销原因/);
  const cancelled=income.managePayout(db,{action:'cancel',id:first.id,reason:'金额登记错了'},'店长');
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cancelledBy,'店长');assert.equal(income.balanceOf(db,'a').availableCents,30000);
  assert.throws(()=>income.managePayout(db,{action:'cancel',id:first.id,reason:'再撤'},'店长'),/已经撤销/);
  assert.equal(db.audit.filter(a=>a.resource==='payouts').length,3);
  checks.push('撤销需填写原因，撤销后待兑现加回 300、原记录保留，不能重复撤销；每次登记和撤销都写入操作日志');
  const s=income.summary(db,'a');assert.deepEqual([s.total,s.paidOut,s.available],[498.2,198.2,300]);
  assert.deepEqual(income.customerPayouts(db,'a').map(p=>[p.amount,p.method]),[[198.2,'微信转账']]);assert.deepEqual(income.customerPayouts(db,'b'),[]);
  const o=income.payoutOverview(db);assert.deepEqual(o.members.map(m=>[m.userId,m.available]),[['a',300],['b',10]]);assert.deepEqual(o.totals,{earned:508.2,paidOut:198.2,available:310});
  checks.push('会员收益汇总：累计 498.20、已兑现 198.20、待兑现 300；会员只看到自己未撤销的兑现；后台合计正确、已合并账号不单列');
  credit(db,'a',-50000,{kind:'reversal'});assert.equal(income.balanceOf(db,'a').availableCents,-20000);assert.throws(()=>pay({amount:1}),/不能超过待兑现 ¥0.00/);
  checks.push('兑现后又发生退款冲回时待兑现显示负数，且不能再登记兑现');
})();

const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'payout-')),file=path.join(dir,'db.json'),secret=crypto.randomBytes(16).toString('hex');
let child,base;
async function req(route,method='GET',data,token,status=200,internal=false){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(internal?{'x-anqi-internal':secret,'x-anqi-actor':'shopadmin'}:{})},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();assert.equal(r.status,status,`${method} ${route}: ${JSON.stringify(b)}`);return b}
const admin=(route,method='GET',data,status=200)=>req('/admin/'+route,method,data,null,status,true);
async function start(){const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/api`;child=spawn(process.execPath,['server/index.cjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:'',NODE_ENV:'test',DEMO_MODE:'false',WECHAT_MOCK:'true',ADMIN_PASSWORD:secret,INTERNAL_SECRET:secret,PAYMENT_MODE:'off'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(errors);try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error(errors||'startup timeout')}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}}
(async()=>{
  const data=seed();delete data.payouts;fs.writeFileSync(file,JSON.stringify(data));await start();
  const boot=await req('/bootstrap'),store=boot.stores[0].id,kit=boot.products.find(p=>p.id==='jimeili-rejuvenation-set');
  const rules=await admin('incomeRules');await admin('incomeRules/referral','PUT',{...rules.referral,enabled:true});
  const me=await req('/auth/wechat','POST',{code:'payout-me-'+Date.now()});await makeSuperVip(admin,me.user.id,'payout');
  const friend=await req('/auth/wechat','POST',{code:'payout-friend-'+Date.now(),invite:me.user.id.slice(0,8)}),other=await req('/auth/wechat','POST',{code:'payout-other-'+Date.now()});
  const o=await req('/orders','POST',{productId:kit.id,quantity:1,spec:'single',storeId:store},friend.token);await admin('orders/'+o.id,'POST',{action:'confirmPayment',note:'门店收款'});
  const earned=Math.round(o.total*50)/100;let s=await req('/earnings-summary','GET',undefined,me.token);
  assert.deepEqual([s.total,s.paidOut,s.available,s.payouts.length],[earned,0,earned,0]);
  checks.push('旧数据（没有兑现表）升级后正常：推荐奖励 '+earned+' 元，已兑现 0，待兑现 '+earned);
  const requestId=crypto.randomUUID(),body={action:'payout',userId:me.user.id,amount:500,method:'cash',note:'到店现金',confirmed:true,requestId};
  const [p1,p2]=await Promise.all([admin('earnings/payouts','POST',body),admin('earnings/payouts','POST',body)]);assert.equal(p1.id,p2.id);
  await admin('earnings/payouts','POST',{...body,requestId:crypto.randomUUID(),amount:earned},400);
  s=await req('/earnings-summary','GET',undefined,me.token);assert.deepEqual([s.paidOut,s.available],[500,earned-500]);assert.deepEqual(s.payouts.map(p=>[p.amount,p.method,p.note]),[[500,'现金','到店现金']]);
  assert.equal((await req('/earnings-summary','GET',undefined,other.token)).payouts.length,0);
  await req('/earnings-summary','GET',undefined,null,401);
  checks.push('API：同时点两次“确认登记”只记一笔 500 元；超额被拒；会员看到已兑现 500、待兑现 '+(earned-500)+'；别的会员看不到，未登录不能查看');
  const overview=await admin('earnings/payouts');const row=overview.members.find(m=>m.userId===me.user.id);
  assert.deepEqual([row.earned,row.paidOut,row.available],[earned,500,earned-500]);assert.equal(overview.payouts[0].actor,'shopadmin');assert.equal(overview.payouts[0].methodName,'现金');
  await admin('earnings/payouts','PUT',{},405);await admin('earnings/payouts','POST',{action:'cancel',id:p1.id},400);
  await admin('earnings/payouts','POST',{action:'cancel',id:p1.id,reason:'登记错会员'});
  assert.equal((await req('/earnings-summary','GET',undefined,me.token)).available,earned);
  checks.push('API：后台列表显示会员余额和登记人；撤销必须写原因，撤销后会员待兑现恢复为 '+earned);
  await stop();await start();
  const after=await admin('earnings/payouts');assert.equal(after.payouts.length,1);assert.equal(after.payouts[0].status,'cancelled');assert.equal(after.payouts[0].cancelReason,'登记错会员');
  checks.push('重启后兑现记录和撤销原因都还在');
  console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
