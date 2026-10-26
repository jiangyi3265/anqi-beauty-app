const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {makeSuperVip}=require('./test-super-vip.cjs');
const {spawn}=require('node:child_process'),{once}=require('node:events'),income=require('../server/income.cjs'),seed=require('../server/seed.cjs');
const checks=[],DAY=86400000;
const part=(overrides={})=>({enabled:true,mode:'fixed',value:10,trigger:'paid',delayDays:0,...overrides});
const policy=(overrides={})=>({revision:0,static:part({periods:3,intervalDays:1}),dynamic:[part({value:5}),part({value:2})],refundPolicy:'reverse',...overrides});
const fixture=()=>({config:{},products:[{id:'vip-test',name:'测试套餐',packagePlans:[{}]}],users:[{id:'buyer',inviterId:'parent'},{id:'parent',inviterId:'grandparent'},{id:'grandparent'}],orders:[],earnings:[]});
function unitOrder(db,id='order-one',total=100){const o={id,userId:'buyer',productId:'vip-test',product:{name:'测试套餐'},total,status:'ready',paymentStatus:'paid',paidAt:'2026-01-01T00:00:00Z'};income.snapshot(db,o);db.orders.push(o);return o}
(function unit(){
 let db=fixture();income.manage(db,'PUT','vip-test',policy(),'tester');const o=unitOrder(db);income.activate(db,o);income.activate(db,o);assert.equal(db.incomePlans.length,3);
 const t=Date.parse(o.paidAt);assert.equal(income.settle(db,t-1),0);assert.equal(income.settle(db,t),3);assert.equal(income.settle(db,t),0);assert.equal(income.summary(db,'buyer').total,10);assert.equal(income.summary(db,'buyer').pending,20);
 assert.equal(income.settle(db,t+DAY-1),0);assert.equal(income.settle(db,t+DAY),1);income.settle(db,t+3*DAY);assert.equal(income.summary(db,'buyer').total,30);assert.equal(income.summary(db,'parent').total,5);assert.equal(db.incomePlans.every(p=>p.status==='completed'),true);checks.push('period boundaries, invitation levels, catch-up and idempotent credits');
 income.refund(db,o);income.refund(db,o);assert.equal(income.summary(db,'buyer').total,0);assert.equal(income.summary(db,'parent').total,0);assert.equal(db.earnings.filter(e=>e.kind==='reversal').length,5);checks.push('full refund creates exact negative entries once');
 db=fixture();income.manage(db,'PUT','vip-test',policy({refundPolicy:'retain'}),'tester');const keep=unitOrder(db);income.activate(db,keep);income.settle(db,t);keep.refundStatus='refunded';income.refund(db,keep);income.settle(db,t+10*DAY);assert.equal(income.summary(db,'buyer').total,10);assert.equal(income.summary(db,'buyer').pending,0);checks.push('retain policy keeps only posted entries and cancels the remainder');
 db=fixture();income.manage(db,'PUT','vip-test',policy({static:part({mode:'percent',value:1.25,trigger:'completed',delayDays:2,periods:2,intervalDays:7}),dynamic:[] }),'tester');const completion=unitOrder(db,'completed',99.99);income.activate(db,completion);assert.equal(db.incomePlans.length,0);completion.status='completed';completion.completedAt='2026-01-05T00:00:00Z';income.activate(db,completion);income.settle(db,Date.parse(completion.completedAt)+2*DAY);assert.equal(income.summary(db,'buyer').total,1.25);checks.push('completion trigger, first delay, weekly interval and cent rounding');
 db=fixture();income.manage(db,'PUT','vip-test',policy(),'tester');const frozen=unitOrder(db);income.manage(db,'PUT','vip-test',policy({revision:1,static:part({value:999,periods:1,intervalDays:1})}),'tester');db.users[0].inviterId='grandparent';income.activate(db,frozen);income.settle(db,t);assert.equal(income.summary(db,'buyer').total,10);assert.equal(income.summary(db,'parent').total,5);assert.throws(()=>income.manage(db,'PUT','vip-test',policy(),'tester'),/其他管理员/);checks.push('order rule and inviter snapshots stay fixed; stale edits are rejected');
 db=fixture();db.users[1].inviterId='buyer';income.manage(db,'PUT','vip-test',policy(),'tester');const cyclic=unitOrder(db);income.activate(db,cyclic);assert.equal(db.incomePlans.length,2);db.users[0].disabled=true;income.settle(db,t);assert.equal(income.summary(db,'buyer').total,0);db.users[0].disabled=false;income.settle(db,t+2*DAY);assert.equal(income.summary(db,'buyer').total,30);checks.push('self/cyclic invitations stop, disabled accounts pause and later catch up');
 assert.equal(income.centsFor(part({mode:'percent',value:0.01}),100),1);assert.equal(income.centsFor(part({mode:'percent',value:50}),0.01),1);
 for(const bad of [NaN,Infinity,-1,1.001])assert.throws(()=>income.manage(fixture(),'PUT','vip-test',policy({static:part({value:bad,periods:1,intervalDays:1})}),'x'));
 assert.throws(()=>income.manage(fixture(),'PUT','vip-test',policy({dynamic:Array(11).fill(part())}),'x'));checks.push('invalid values, precision and level limits validated');
})();
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'anqi-income-')),file=path.join(dir,'db.json'),secret=crypto.randomBytes(24).toString('hex');let child,base;
async function req(route,method='GET',data,token,status=200,admin=false){const r=await fetch(base+route,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(admin?{'x-anqi-internal':secret}:{})},body:data===undefined?undefined:JSON.stringify(data)});const b=await r.json();assert.equal(r.status,status,`${method} ${route}: ${JSON.stringify(b)}`);return b}
const admin=(route,method='GET',data,status=200)=>req('/admin/'+route,method,data,null,status,true);
async function start(){const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/api`;child=spawn(process.execPath,['server/index.cjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:process.env.INCOME_TEST_DB_NAME||'',NODE_ENV:'test',DEMO_MODE:'false',WECHAT_MOCK:'true',ADMIN_PASSWORD:secret,INTERNAL_SECRET:secret,PAYMENT_MODE:'off'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(errors);try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error(errors||'startup timeout')}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}}
(async()=>{
 if(process.env.INCOME_TEST_DB_NAME&&!/^anqi_audit_[a-zA-Z0-9_]+$/.test(process.env.INCOME_TEST_DB_NAME))throw Error('Use a dedicated anqi_audit_ database');
 fs.writeFileSync(file,JSON.stringify(seed()));await start();const boot=await req('/bootstrap');const products=boot.products.filter(p=>p.packagePlans?.length);assert.equal(products.length,6);
 await req('/admin/incomeRules','GET',undefined,null,401);await req('/earnings-summary','GET',undefined,null,401);
 const parent=await req('/auth/wechat','POST',{code:'income-parent-'+Date.now()});await makeSuperVip(admin,parent.user.id,'income');
 const buyer=await req('/auth/wechat','POST',{code:'income-buyer-'+Date.now(),invite:parent.user.id.slice(0,8)});
 function selection(p){const plan=p.packagePlans[0];return {planId:plan.id,groups:Object.fromEntries(plan.groups.map(g=>[g.id,g.services.slice(0,g.pick).map(s=>({serviceId:s.id,...(s.options?.length?{option:s.options[0]}:{})}))]))}}
 const p=products[0];const body={productId:p.id,quantity:1,spec:'single',storeId:boot.stores[0].id,packageSelection:selection(p)};
 const old=await req('/orders','POST',body,buyer.token);
 await admin('incomeRules/'+p.id,'PUT',policy());
 await admin('orders/'+old.id,'POST',{action:'confirmPayment',note:'isolated old-order test'});assert.equal((await req('/earnings', 'GET',undefined,buyer.token)).length,0);
 const order=await req('/orders','POST',body,buyer.token);assert.equal(order.incomeSnapshot,undefined);
 await admin('orders/'+order.id,'POST',{action:'confirmPayment',note:'isolated test'});
 await admin('orders/'+order.id,'POST',{action:'confirmPayment',note:'duplicate'},400);
 assert.equal((await req('/earnings-summary','GET',undefined,buyer.token)).static,10);assert.equal((await req('/earnings-summary','GET',undefined,parent.token)).dynamic,5);
 assert.equal((await req('/earnings','GET',undefined,buyer.token)).some(e=>e.userId!==buyer.user.id),false);
 assert.equal((await req('/orders/'+order.id,'GET',undefined,buyer.token)).incomeSnapshot,undefined);checks.push('API auth, real invitation binding, offline-payment trigger, no historical backfill and snapshot privacy');
 const before=(await admin('incomeRules')).rules[0];await admin('incomeRules/'+p.id,'PUT',policy({revision:0}),409);assert.deepEqual((await admin('incomeRules')).rules[0],before);
 await Promise.all([req('/earnings-summary','GET',undefined,buyer.token),req('/earnings-summary','GET',undefined,buyer.token)]);assert.equal((await req('/earnings','GET',undefined,buyer.token)).length,1);
 await admin('orders/'+order.id,'POST',{action:'refund',note:'isolated refund',refundConfirmed:true,refundAmount:order.total,refundedAt:new Date().toISOString(),refundMethod:'test',refundReference:'test-'+order.id});assert.equal((await req('/earnings-summary','GET',undefined,buyer.token)).total,0);assert.equal((await req('/earnings-summary','GET',undefined,parent.token)).total,0);assert.equal((await req('/earnings-summary','GET',undefined,buyer.token)).pending,0);checks.push('transactional revision conflicts, concurrent reads and refund reversal');
 // Exercise the actual package completion hook with one service.
 await admin('products/'+p.id,'PUT',{packagePlans:[{id:'single',name:'单项验收',services:[{id:'service',name:'测试服务',total:1}],groups:[]}]});
 await admin('incomeRules/'+p.id,'PUT',policy({revision:1,static:part({trigger:'completed',periods:1,intervalDays:1}),dynamic:[]}));
 const complete=await req('/orders','POST',{...body,packageSelection:{planId:'single',groups:{}}},buyer.token);await admin('orders/'+complete.id,'POST',{action:'confirmPayment',note:'isolated completion'});
 assert.equal((await req('/earnings-summary','GET',undefined,buyer.token)).total,0);
 const date=new Date(Date.now()+5*DAY+8*3600000).toISOString().slice(0,10);const a=await req('/appointments','POST',{orderId:complete.id,entitlementId:'fixed:service',date,time:'09:00'},buyer.token);await admin('appointments/'+a.id,'PUT',{status:'completed'});assert.equal((await req('/earnings-summary','GET',undefined,buyer.token)).total,10);checks.push('actual package final redemption activates completion-based income');
 const count=(await admin('earnings')).length;await stop();await start();assert.equal((await admin('earnings')).length,count);assert.equal((await admin('incomeRules')).rules[0].revision,2);checks.push('income plans, rules and immutable ledger persist without duplicate credits after restart');
 console.log(JSON.stringify({ok:true,checks},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
