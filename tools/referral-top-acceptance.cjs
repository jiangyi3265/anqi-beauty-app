// 推荐奖励给推荐链第一位推荐人（beneficiary=top）验收：甲推荐乙、乙推荐丙，乙和丙的消费都奖励给甲，乙拿不到；
// 甲不符合条件（未办卡、停用、关闭动态资格）时谁都不给；比例按每位付款人自己的首单 50% / 后续 10%。默认 direct 行为不变。
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {spawn}=require('node:child_process'),{once}=require('node:events'),income=require('../server/income.cjs'),seed=require('../server/seed.cjs');
const checks=[],T0=Date.parse('2026-11-01T02:00:00Z'),MIN=60000;
const referral=(o={})=>({revision:0,enabled:true,firstPercent:50,laterPercent:10,scope:'all',trigger:'paid',delayDays:0,durationDays:0,refundPolicy:'reverse',requireCard:true,beneficiary:'top',...o});
const fixture=()=>({config:{},products:[{id:'vip',name:'黄金VIP套餐',packagePlans:[{}]},{id:'kit',name:'焕颜套'}],
  users:[{id:'jia'},{id:'yi',inviterId:'jia'},{id:'bing',inviterId:'yi'},{id:'ding',inviterId:'bing'}].map(u=>({...u,createdAt:new Date(T0).toISOString()})),orders:[],earnings:[]});
let seq=0;
function order(db,{userId,productId='kit',total=1000,at}){
  const o={id:'o'+(seq++),userId,productId,product:JSON.parse(JSON.stringify(db.products.find(p=>p.id===productId))),total,status:'ready',paymentStatus:'paid',paidAt:new Date(at).toISOString(),createdAt:new Date(at).toISOString()};
  income.snapshot(db,o);db.orders.push(o);income.activate(db,o);return o;
}
const plans=db=>db.incomePlans.filter(p=>p.source==='referral').map(p=>[p.userId,p.tier,p.amountCents,p.level]);
const setup=(rule={})=>{const db=fixture();income.init(db);income.manage(db,'PUT','referral',referral(rule),'tester');return db};

(function unit(){
  let db=fixture();income.init(db);
  assert.equal(income.manage(db,'GET',null).referral.beneficiary,'direct');
  checks.push('默认仍是“奖励给直接推荐人”，原有规则不变');

  db=setup();order(db,{userId:'jia',productId:'vip',total:6980,at:T0});
  order(db,{userId:'yi',total:1980,at:T0+MIN});order(db,{userId:'bing',total:1000,at:T0+2*MIN});order(db,{userId:'bing',total:500,at:T0+3*MIN});order(db,{userId:'ding',total:2000,at:T0+4*MIN});
  assert.deepEqual(plans(db),[['jia','first',99000,1],['jia','first',50000,2],['jia','later',5000,2],['jia','first',100000,3]]);
  income.settle(db,T0+5*MIN);assert.equal(income.summary(db,'yi').dynamic,0);assert.equal(income.summary(db,'bing').dynamic,0);assert.equal(income.summary(db,'jia').dynamic,2540);
  checks.push('甲推荐乙、乙推荐丙、丙推荐丁：乙首单 1,980 → 甲 990；丙首单 1,000 → 甲 500、丙再买 500 → 甲 50；丁首单 2,000 → 甲 1,000；乙和丙都拿 0');

  db=setup();order(db,{userId:'yi',productId:'vip',total:6980,at:T0});order(db,{userId:'bing',total:1000,at:T0+MIN});
  assert.deepEqual(plans(db),[]);assert.equal(db.orders.at(-1).incomeSnapshot.referral.skipped,'inviterNoCard');
  checks.push('第一位推荐人甲没办卡：乙办了卡也拿不到丙的奖励，谁都不给，后台订单注明原因');

  db=setup();order(db,{userId:'jia',productId:'vip',total:6980,at:T0});db.users.find(u=>u.id==='jia').incomeAccess={dynamic:false};order(db,{userId:'bing',total:1000,at:T0+MIN});
  db.users.find(u=>u.id==='jia').incomeAccess={dynamic:true};db.users.find(u=>u.id==='jia').disabled=true;order(db,{userId:'bing',total:1000,at:T0+2*MIN});
  assert.deepEqual(plans(db),[]);
  checks.push('甲被关闭动态收益资格或停用：下面的人消费谁都不给');

  db=setup({beneficiary:'direct'});order(db,{userId:'yi',productId:'vip',total:6980,at:T0});order(db,{userId:'bing',total:1000,at:T0+MIN});
  assert.deepEqual(plans(db),[['yi','first',50000,1]]);
  checks.push('切回“直接推荐人”：丙的消费奖励给乙（已办卡），和以前一样');

  db=setup();db.users.find(u=>u.id==='jia').inviterId='bing';order(db,{userId:'bing',total:1000,at:T0});assert.deepEqual(plans(db),[]);
  checks.push('推荐关系异常成环时不发奖励，不会出错');

  db=setup();const kept=income.manage(db,'PUT','referral',(({beneficiary,...r})=>({...r,revision:1,laterPercent:8}))(referral()),'tester');
  assert.equal(kept.beneficiary,'top');assert.equal(kept.laterPercent,8);
  assert.throws(()=>income.manage(db,'PUT','referral',referral({revision:2,beneficiary:'all'}),'tester'),/推荐奖励给谁/);
  checks.push('后台保存推荐规则时没带这一项就保持原值；填错会被拒绝');
})();

const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'referral-top-')),file=path.join(dir,'db.json'),secret=crypto.randomBytes(16).toString('hex');
let child,base;
async function req(route,method='GET',data,token,status=200,internal=false){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(internal?{'x-anqi-internal':secret}:{})},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();assert.equal(r.status,status,`${method} ${route}: ${JSON.stringify(b)}`);return b}
const admin=(route,method='GET',data,status=200)=>req('/admin/'+route,method,data,null,status,true);
async function start(){const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/api`;child=spawn(process.execPath,['server/index.cjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:'',NODE_ENV:'test',DEMO_MODE:'false',WECHAT_MOCK:'true',ADMIN_PASSWORD:secret,INTERNAL_SECRET:secret,PAYMENT_MODE:'off'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(errors);try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error(errors||'startup timeout')}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}}
(async()=>{
  fs.writeFileSync(file,JSON.stringify(seed()));await start();
  const boot=await req('/bootstrap'),store=boot.stores[0].id,kit=boot.products.find(p=>p.id==='jimeili-rejuvenation-set'),gold=boot.products.filter(p=>p.packagePlans?.length).sort((a,b)=>(a.memberPrice??a.price)-(b.memberPrice??b.price))[0];
  const rules=await admin('incomeRules');await admin('incomeRules/referral','PUT',{...rules.referral,enabled:true,requireCard:true,beneficiary:'top'});
  assert.equal((await req('/bootstrap')).config.referralReward.beneficiary,'top');
  const jia=await req('/auth/wechat','POST',{code:'top-jia-'+Date.now()}),yi=await req('/auth/wechat','POST',{code:'top-yi-'+Date.now(),invite:jia.user.id.slice(0,8)}),bing=await req('/auth/wechat','POST',{code:'top-bing-'+Date.now(),invite:yi.user.id.slice(0,8)});
  const plan=gold.packagePlans[0],sel={planId:plan.id,groups:Object.fromEntries(plan.groups.map(g=>[g.id,g.services.slice(0,g.pick).map(s=>({serviceId:s.id,...(s.options?.length?{option:s.options[0]}:{})}))]))};
  for(const u of [jia,yi])await admin('legacyMembers/'+u.user.id,'POST',{action:'grant',requestId:'top-'+u.user.id,revision:0,confirmed:true,note:'门店开卡',reference:'TOP-'+u.user.id.slice(0,8),productId:gold.id,storeId:store,total:gold.memberPrice??gold.price,paidAt:new Date(Date.now()-60000).toISOString(),incomeTreatment:'historical',packageSelection:sel});
  const o=await req('/orders','POST',{productId:kit.id,quantity:1,spec:'single',storeId:store},bing.token);await admin('orders/'+o.id,'POST',{action:'confirmPayment',note:'门店收款'});
  assert.equal((await req('/earnings-summary','GET',undefined,jia.token)).dynamic,Math.round(o.total*50)/100);
  assert.equal((await req('/earnings-summary','GET',undefined,yi.token)).dynamic,0);
  checks.push('API：甲、乙都已办卡，丙（乙推荐的）付款 '+o.total+' 元，甲得 '+Math.round(o.total*50)/100+' 元，乙得 0');
  await stop();await start();assert.equal((await admin('incomeRules')).referral.beneficiary,'top');
  checks.push('重启后“奖励给推荐链第一位推荐人”设置仍在');
  console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
