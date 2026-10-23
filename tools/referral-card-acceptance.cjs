// 推荐人须办卡验收：开启后，被推荐人付款那一刻推荐人本人已持有 VIP 套餐卡才计推荐奖励；办卡前的订单不补发。
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {makeSuperVip}=require('./test-super-vip.cjs');
const {spawn}=require('node:child_process'),{once}=require('node:events'),income=require('../server/income.cjs'),seed=require('../server/seed.cjs');
const checks=[],T0=Date.parse('2026-11-01T02:00:00Z'),MIN=60000;
const referral=(o={})=>({revision:0,enabled:true,firstPercent:50,laterPercent:10,scope:'all',trigger:'paid',delayDays:0,durationDays:0,refundPolicy:'reverse',...o});
const fixture=()=>({config:{},products:[{id:'vip',name:'黄金VIP套餐',packagePlans:[{}]},{id:'kit',name:'焕颜套'}],users:[{id:'friend',inviterId:'me',createdAt:new Date(T0).toISOString()},{id:'me'}],orders:[],earnings:[]});
let seq=0;
function order(db,{userId='friend',productId='kit',total=1000,at,extra={}}){
  const o={id:'o'+(seq++),userId,productId,product:JSON.parse(JSON.stringify(db.products.find(p=>p.id===productId))),total,status:'ready',paymentStatus:'paid',paidAt:new Date(at).toISOString(),createdAt:new Date(at).toISOString(),...extra};
  income.snapshot(db,o);db.orders.push(o);income.activate(db,o);return o;
}
const plans=db=>db.incomePlans.filter(p=>p.source==='referral').map(p=>[p.orderId,p.tier,p.amountCents]);

(function unit(){
  let db=fixture();income.init(db);
  assert.equal(income.manage(db,'GET',null).referral.requireCard,false);
  income.manage(db,'PUT','referral',referral(),'tester');
  order(db,{at:T0});assert.equal(plans(db).length,1);
  checks.push('默认不限：未办卡的推荐人照常拿推荐奖励（原有规则不变）');

  db=fixture();income.init(db);income.manage(db,'PUT','referral',referral({requireCard:true}),'tester');
  const first=order(db,{at:T0,total:1980});
  assert.equal(plans(db).length,0);assert.equal(first.incomeSnapshot.referral.skipped,'inviterNoCard');
  order(db,{userId:'me',productId:'vip',total:6980,at:T0+10*MIN});
  const later=order(db,{at:T0+20*MIN,total:498});
  assert.deepEqual(plans(db),[[later.id,'later',4980]]);assert.equal(later.incomeSnapshot.referral.skipped,undefined);
  income.activate(db,first);assert.equal(plans(db).length,1);
  checks.push('开启后：推荐人办卡前好友的首单（1980）不计、也不补发；办卡后好友下一单按后续 10% 计（49.80）');

  db=fixture();income.init(db);income.manage(db,'PUT','referral',referral({requireCard:true}),'tester');
  order(db,{userId:'me',productId:'vip',total:6980,at:T0});
  const f1=order(db,{at:T0,total:6980});
  assert.deepEqual(plans(db),[[f1.id,'first',349000]]);
  checks.push('推荐人与好友同一时刻付款：推荐人已持卡，好友首单按 50% 计（3490）');

  db=fixture();income.init(db);income.manage(db,'PUT','referral',referral({requireCard:true}),'tester');
  order(db,{userId:'me',productId:'vip',total:6980,at:T0,extra:{refundStatus:'refunded',refundAt:new Date(T0+5*MIN).toISOString(),status:'aftersale'}});
  order(db,{at:T0+10*MIN});assert.equal(plans(db).length,0);
  checks.push('推荐人已退卡：之后好友的订单不计推荐奖励');

  db=fixture();income.init(db);income.manage(db,'PUT','referral',referral({requireCard:true}),'tester');
  const card=order(db,{userId:'me',productId:'vip',total:6980,at:T0});
  const f2=order(db,{at:T0+10*MIN,total:1000});income.settle(db,T0+11*MIN);
  card.refundStatus='refunded';card.refundAt=new Date(T0+20*MIN).toISOString();card.status='aftersale';income.refund(db,card);income.settle(db,T0+21*MIN);
  assert.equal(income.summary(db,'me').dynamic,500);
  order(db,{at:T0+30*MIN});assert.equal(plans(db).length,1);assert.equal(plans(db)[0][0],f2.id);
  checks.push('推荐人退卡后：退卡前已得的推荐奖励（500）保留，退卡后的订单不再计');

  db=fixture();income.init(db);income.manage(db,'PUT','referral',referral({requireCard:true}),'tester');
  order(db,{userId:'me',productId:'vip',total:6980,at:T0-30*24*60*MIN,extra:{offlineRequestId:'legacy-1',createdAt:new Date(T0+15*MIN).toISOString()}});
  const before=order(db,{at:T0+10*MIN}),after=order(db,{at:T0+20*MIN});
  assert.deepEqual(plans(db).map(p=>p[0]),[after.id]);assert.equal(before.incomeSnapshot.referral.skipped,'inviterNoCard');
  checks.push('门店补录的老卡：从补录时起算持卡，补录前好友的订单不补发');

  db=fixture();income.init(db);
  income.manage(db,'PUT','referral',referral({requireCard:true}),'tester');
  const kept=income.manage(db,'PUT','referral',(({requireCard,...r})=>({...r,revision:1,firstPercent:40}))(referral()),'tester');
  assert.equal(kept.requireCard,true);assert.equal(kept.firstPercent,40);
  assert.equal(income.manage(db,'PUT','referral',referral({revision:2,requireCard:false}),'tester').requireCard,false);
  checks.push('后台保存推荐规则时未带此项则保持原值；可以明确关闭');
})();

const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'referral-card-')),file=path.join(dir,'db.json'),secret=crypto.randomBytes(16).toString('hex');
let child,base;
async function req(route,method='GET',data,token,status=200,internal=false){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(internal?{'x-anqi-internal':secret}:{})},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();assert.equal(r.status,status,`${method} ${route}: ${JSON.stringify(b)}`);return b}
const admin=(route,method='GET',data,status=200)=>req('/admin/'+route,method,data,null,status,true);
async function start(){const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/api`;child=spawn(process.execPath,['server/index.cjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:'',NODE_ENV:'test',DEMO_MODE:'false',WECHAT_MOCK:'true',ADMIN_PASSWORD:secret,INTERNAL_SECRET:secret,PAYMENT_MODE:'off'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(errors);try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error(errors||'startup timeout')}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}}
(async()=>{
  fs.writeFileSync(file,JSON.stringify(seed()));await start();
  const boot=await req('/bootstrap'),store=boot.stores[0].id,kit=boot.products.find(p=>p.id==='jimeili-rejuvenation-set'),gold=boot.products.filter(p=>p.packagePlans?.length).sort((a,b)=>(a.memberPrice??a.price)-(b.memberPrice??b.price))[0];
  await admin('incomeRules/referral','PUT',referral({requireCard:true}));
  assert.equal((await req('/bootstrap')).config.referralReward.requireCard,true);
  const me=await req('/auth/wechat','POST',{code:'card-me-'+Date.now()});
  await makeSuperVip(admin,me.user.id,'card1');
  const friend=await req('/auth/wechat','POST',{code:'card-friend-'+Date.now(),invite:me.user.id.slice(0,8)});
  const card1=(await admin('orders')).find(o=>o.userId===me.user.id&&o.product?.packagePlans?.length);await admin('orders/'+card1.id,'POST',{action:'refund',note:'推荐人退卡'});
  assert.equal((await req('/me','GET',undefined,me.token)).vipLevel,null);
  const o1=await req('/orders','POST',{productId:kit.id,quantity:1,spec:'single',storeId:store},friend.token);
  await admin('orders/'+o1.id,'POST',{action:'confirmPayment',note:'推荐人已退卡'});
  assert.equal((await req('/earnings-summary','GET',undefined,me.token)).dynamic,0);
  assert.equal((await admin('orders')).find(o=>o.id===o1.id).referralNote,'inviterNoCard');
  checks.push('API：推荐人（超级VIP）退卡后，好友付款 '+o1.total+' 元，推荐人收益 0，订单记录“推荐人未办卡”');
  await makeSuperVip(admin,me.user.id,'card2');
  assert.ok((await req('/me','GET',undefined,me.token)).vipLevel);
  const o2=await req('/orders','POST',{productId:kit.id,quantity:1,spec:'single',storeId:store},friend.token);
  await admin('orders/'+o2.id,'POST',{action:'confirmPayment',note:'推荐人已办卡'});
  const ps=await req('/earnings-summary','GET',undefined,me.token);
  assert.equal(ps.dynamic,Math.round(o2.total*10)/100);
  checks.push('API：推荐人重新办卡后，好友下一单 '+o2.total+' 元按后续 10% 计 '+ps.dynamic+' 元；退卡期间那单不补发');
  await stop();await start();
  assert.equal((await admin('incomeRules')).referral.requireCard,true);
  checks.push('重启后“推荐人须办卡”设置仍在');
  console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
