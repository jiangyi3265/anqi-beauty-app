// 推荐奖励验收：直接推荐人，被推荐人首单与后续订单按不同比例奖励。
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {spawn}=require('node:child_process'),{once}=require('node:events'),income=require('../server/income.cjs'),seed=require('../server/seed.cjs');
const checks=[],DAY=86400000;
const referral=(overrides={})=>({revision:0,enabled:true,firstPercent:50,laterPercent:10,scope:'all',trigger:'paid',delayDays:0,durationDays:0,refundPolicy:'reverse',...overrides});
const part=(overrides={})=>({enabled:true,mode:'fixed',value:10,trigger:'paid',delayDays:0,...overrides});
const fixture=()=>({config:{},products:[{id:'vip',name:'测试套餐',packagePlans:[{}]},{id:'kit',name:'焕颜套'}],
  users:[{id:'buyer',inviterId:'parent',createdAt:new Date().toISOString()},{id:'parent',inviterId:'grandparent'},{id:'grandparent'}],orders:[],earnings:[]});
let seq=0;
function order(db,{productId='kit',total=1000,userId='buyer',paidAt=new Date(Date.parse('2026-01-01T00:00:00Z')+(seq++)*1000).toISOString()}={}){
  const product=db.products.find(p=>p.id===productId);
  const o={id:'o'+seq,userId,productId,product:JSON.parse(JSON.stringify(product)),total,status:'ready',paymentStatus:'paid',paidAt};
  income.snapshot(db,o);db.orders.push(o);return o;
}
const referralPlans=db=>db.incomePlans.filter(p=>p.source==='referral');

(function unit(){
  let db=fixture();
  assert.deepEqual(income.manage(db,'GET',null).referral,{revision:0,enabled:false,firstPercent:50,laterPercent:10,scope:'all',trigger:'paid',delayDays:0,durationDays:0,refundPolicy:'reverse',requireCard:false});
  const off=order(db);income.activate(db,off);assert.equal(referralPlans(db).length,0);
  checks.push('defaults are 50% / 10%, all orders, unlimited, and disabled until an administrator enables them');

  db=fixture();income.manage(db,'PUT','referral',referral(),'tester');
  const first=order(db,{total:6980}),second=order(db,{total:498});income.activate(db,first);income.activate(db,first);income.activate(db,second);
  const [a,b]=referralPlans(db);
  assert.equal(referralPlans(db).length,2);assert.deepEqual([a.userId,a.tier,a.amountCents,a.level],['parent','first',349000,1]);assert.deepEqual([b.tier,b.amountCents],['later',4980]);
  assert.equal(db.incomePlans.some(p=>p.userId==='grandparent'),false);
  income.settle(db,Date.now());assert.equal(income.summary(db,'parent').dynamic,3539.8);
  assert.match(db.earnings[0].name,/推荐奖励（首单 50%）/);assert.match(db.earnings[1].name,/推荐奖励（后续订单 10%）/);
  checks.push('direct referrer only: first order 50%, later orders 10%, idempotent, labelled in the ledger');

  db=fixture();income.manage(db,'PUT','vip',{revision:0,static:part({periods:1,intervalDays:1}),dynamic:[part({value:5}),part({value:2})],refundPolicy:'reverse'},'tester');
  income.manage(db,'PUT','referral',referral(),'tester');
  const vipOrder=order(db,{productId:'vip',total:6980});income.activate(db,vipOrder);
  assert.equal(db.incomePlans.filter(p=>p.type==='static').length,1);assert.equal(db.incomePlans.filter(p=>p.type==='dynamic'&&!p.source).length,0);assert.equal(referralPlans(db).length,1);
  checks.push('enabled referral rewards replace the package multi-level dynamic income; static income stays');

  db=fixture();income.manage(db,'PUT','referral',referral({scope:'vip'}),'tester');
  const kit=order(db,{productId:'kit'}),vip1=order(db,{productId:'vip',total:6980}),vip2=order(db,{productId:'vip',total:13800});
  [kit,vip1,vip2].forEach(o=>income.activate(db,o));
  assert.deepEqual(referralPlans(db).map(p=>[p.orderId,p.tier]),[[vip1.id,'first'],[vip2.id,'later']]);
  checks.push('VIP-only scope ignores ordinary orders when choosing the first order');

  db=fixture();income.manage(db,'PUT','referral',referral({trigger:'completed'}),'tester');
  const early=order(db),late=order(db);late.status='completed';late.completedAt=new Date().toISOString();income.activate(db,late);
  early.status='completed';early.completedAt=new Date().toISOString();income.activate(db,early);
  assert.equal(referralPlans(db).find(p=>p.orderId===early.id).tier,'first');assert.equal(referralPlans(db).find(p=>p.orderId===late.id).tier,'later');
  checks.push('first order follows payment time even when a later order is completed first');

  db=fixture();const before=order(db);income.manage(db,'PUT','referral',referral(),'tester');income.activate(db,before);
  const after=order(db);income.activate(db,after);
  assert.deepEqual(referralPlans(db).map(p=>p.tier),['later']);
  checks.push('orders paid before the rule existed count as history, so no retroactive reward and the next order is not a first order');

  db=fixture();income.manage(db,'PUT','referral',referral(),'tester');
  const refunded=order(db,{total:1000});income.activate(db,refunded);income.settle(db,Date.now());
  refunded.refundStatus='refunded';refunded.status='aftersale';income.refund(db,refunded);
  assert.equal(income.summary(db,'parent').total,0);
  const next=order(db,{total:1000});income.activate(db,next);assert.equal(referralPlans(db).find(p=>p.orderId===next.id).tier,'first');
  db=fixture();income.manage(db,'PUT','referral',referral({refundPolicy:'retain'}),'tester');
  const kept=order(db,{total:1000});income.activate(db,kept);income.settle(db,Date.now());kept.refundStatus='refunded';kept.status='aftersale';income.refund(db,kept);
  assert.equal(income.summary(db,'parent').total,500);
  checks.push('refunds reverse or retain per the referral policy; a refunded first order lets the next order count as first');

  db=fixture();db.users[0].createdAt=new Date(Date.now()-31*DAY).toISOString();income.manage(db,'PUT','referral',referral({durationDays:30}),'tester');
  const stale=order(db);income.activate(db,stale);assert.equal(referralPlans(db).length,0);
  db=fixture();db.users[1].disabled=true;income.manage(db,'PUT','referral',referral(),'tester');income.activate(db,order(db));assert.equal(referralPlans(db).length,0);
  db=fixture();db.users[0].inviterId='buyer';income.manage(db,'PUT','referral',referral(),'tester');income.activate(db,order(db));assert.equal(referralPlans(db).length,0);
  checks.push('expired referral window, disabled inviter and self-invitation earn nothing');

  db=fixture();income.manage(db,'PUT','referral',referral(),'tester');const frozen=order(db,{total:1000});
  income.manage(db,'PUT','referral',referral({revision:1,firstPercent:1}),'tester');income.activate(db,frozen);
  assert.equal(referralPlans(db)[0].amountCents,50000);
  assert.throws(()=>income.manage(db,'PUT','referral',referral({revision:0}),'x'),/其他管理员/);
  for(const bad of [{firstPercent:101},{laterPercent:-1},{firstPercent:1.001},{firstPercent:0,laterPercent:0},{scope:'x'},{trigger:'x'},{durationDays:1.5},{enabled:'yes'}])
    assert.throws(()=>income.manage(fixture(),'PUT','referral',referral(bad),'x'));
  checks.push('order snapshots keep the rule in force at creation; stale edits and invalid values are rejected');
})();

const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'anqi-referral-')),file=path.join(dir,'db.json'),secret=crypto.randomBytes(24).toString('hex');let child,base;
async function req(route,method='GET',data,token,status=200,admin=false){const r=await fetch(base+route,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(admin?{'x-anqi-internal':secret}:{})},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();assert.equal(r.status,status,`${method} ${route}: ${JSON.stringify(b)}`);return b}
const admin=(route,method='GET',data,status=200)=>req('/admin/'+route,method,data,null,status,true);
async function start(){const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/api`;child=spawn(process.execPath,['server/index.cjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:process.env.REFERRAL_TEST_DB_NAME||'',NODE_ENV:'test',DEMO_MODE:'false',WECHAT_MOCK:'true',ADMIN_PASSWORD:secret,INTERNAL_SECRET:secret,PAYMENT_MODE:'off'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(errors);try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error(errors||'startup timeout')}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}}
(async()=>{
  if(process.env.REFERRAL_TEST_DB_NAME&&!/^anqi_audit_[a-zA-Z0-9_]+$/.test(process.env.REFERRAL_TEST_DB_NAME))throw Error('Use a dedicated anqi_audit_ database');
  fs.writeFileSync(file,JSON.stringify(seed()));await start();
  const boot=await req('/bootstrap'),store=boot.stores[0].id;
  const kit=boot.products.find(p=>p.id==='jimeili-rejuvenation-set'),vip=boot.products.find(p=>p.packagePlans?.length);
  const rules=await admin('incomeRules');assert.equal(rules.referral.enabled,false);assert.equal(rules.referral.firstPercent,50);
  await admin('incomeRules/referral','PUT',referral({revision:5}),409);
  await admin('incomeRules/referral','PUT',referral());
  const grand=await req('/auth/wechat','POST',{code:'ref-grand-'+Date.now()});
  const parent=await req('/auth/wechat','POST',{code:'ref-parent-'+Date.now(),invite:grand.user.id.slice(0,8)});
  const buyer=await req('/auth/wechat','POST',{code:'ref-buyer-'+Date.now(),invite:parent.user.id.slice(0,8).toUpperCase()});
  const plan=vip.packagePlans[0],selection={planId:plan.id,groups:Object.fromEntries(plan.groups.map(g=>[g.id,g.services.slice(0,g.pick).map(s=>({serviceId:s.id,...(s.options?.length?{option:s.options[0]}:{})}))]))};
  const o1=await req('/orders','POST',{productId:kit.id,quantity:1,spec:'single',storeId:store},buyer.token);
  assert.equal(o1.incomeSnapshot,undefined);
  await admin('orders/'+o1.id,'POST',{action:'confirmPayment',note:'referral first'});
  const o2=await req('/orders','POST',{productId:vip.id,quantity:1,spec:'single',storeId:store,packageSelection:selection},buyer.token);
  await admin('orders/'+o2.id,'POST',{action:'confirmPayment',note:'referral later'});
  const expected=Math.round(o1.total*50)/100+Math.round(o2.total*10)/100;
  const ps=await req('/earnings-summary','GET',undefined,parent.token);assert.equal(ps.dynamic,expected);
  assert.equal((await req('/earnings-summary','GET',undefined,grand.token)).total,0);
  const names=(await req('/earnings','GET',undefined,parent.token)).map(e=>e.name).join('|');assert.match(names,/首单 50%/);assert.match(names,/后续订单 10%/);
  assert.equal(ps.plans.filter(p=>p.source==='referral').length,2);
  checks.push(`API: an ordinary first order (${o1.total}) and a VIP later order (${o2.total}) pay the direct referrer ${expected}; the referrer's referrer gets nothing`);
  await admin('orders/'+o2.id,'POST',{action:'refund',note:'referral refund'});
  assert.equal((await req('/earnings-summary','GET',undefined,parent.token)).dynamic,Math.round(o1.total*50)/100);
  checks.push('API: a full refund reverses that order\'s referral reward only');
  const count=(await admin('earnings')).length;await stop();await start();
  assert.equal((await admin('earnings')).length,count);assert.equal((await admin('incomeRules')).referral.revision,1);
  checks.push('referral rule and ledger persist across restart without duplicate credits');
  console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
