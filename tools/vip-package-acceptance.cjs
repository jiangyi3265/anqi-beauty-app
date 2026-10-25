const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const seed = require('../server/seed.cjs');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anqi-vip-packages-'));
const file = path.join(temp, 'db.json');
const secret = crypto.randomBytes(24).toString('hex');
let server;
let base;

async function start() {
  const socket = net.createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}/api`;
  server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_FILE: file, DB_NAME: '', DEMO_MODE: 'false', NODE_ENV: 'test', WECHAT_MOCK: 'true', ADMIN_PASSWORD: secret, INTERNAL_SECRET: secret, PAYMENT_MODE: 'off' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = '';
  server.stderr.on('data', data => errors += data);
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error(errors || 'Server exited');
    try { if ((await fetch(base + '/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Server did not start: ' + errors);
}

async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, 'exit');
  server.kill();
  await exited;
  server = null;
}

async function request(route, method = 'GET', body, token, expected = 200, admin = false) {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(admin ? { 'x-anqi-internal': secret } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  const previous = seed();
  previous.config.appointmentCapacity = 100;
  fs.writeFileSync(file, JSON.stringify(previous));
  await start();
  const data = await request('/bootstrap');
  const products = data.products.filter(p => p.packagePlans?.length);
  assert.deepEqual(products.map(p => p.price), [6980,13800,26800,49800,99800,199800]);
  assert.deepEqual(products.map(p => p.packagePlans.length), [1,1,1,1,1,1]);
  assert.deepEqual(products.map(p => p.packagePlans[0].services.length), [6,6,7,11,13,13]);
  assert.deepEqual(products.map(p => p.packagePlans[0].services.reduce((n,s)=>n+s.total,0)+2), [22,33,34,38,80,98]);
  for (const p of products) {
    const [glow,star]=p.packagePlans[0].groups;
    assert.deepEqual([glow.services.length,glow.pick,star.services.length,star.pick],[5,1,3,1]);
    assert.ok(glow.services.every(s=>s.total===1&&s.referencePrice===3980));
    assert.ok(star.services.every(s=>s.total===1&&s.referencePrice===1980));
    assert.equal(star.services[0].name,'中医养生特调');
  }
  assert.equal(data.products.filter(p=>!p.trialOnly).at(-1).id,'jimeili-rejuvenation-set');
  const alice = await request('/auth/wechat','POST',{code:'vip-alice'});
  const bob = await request('/auth/wechat','POST',{code:'vip-bob'});
  const admin = (route,method,body,expected=200) => request('/admin'+route,method,body,undefined,expected,true);
  const select = plan => ({planId:plan.id,groups:Object.fromEntries(plan.groups.map(g=>[g.id,g.services.slice(0,g.pick).map(s=>({serviceId:s.id,...(s.options?.length?{option:s.options[0]}:{})}))]))});
  const body = (p,plan=p.packagePlans[0]) => ({productId:p.id,quantity:1,spec:'single',storeId:'store-1',packageSelection:select(plan)});
  // Custom package creation must leave existing members and orders untouched.
  const beforeMembers=await admin('/users','GET');
  const beforeOrders=await admin('/orders','GET');
  const custom=await admin('/products','POST',{name:'自定义护理套餐',kind:'service',price:1688,stock:10,status:'draft',enabled:false,packagePlans:[{id:'custom-plan',name:'标准方案',services:[{id:'custom-service',name:'深层护理',total:6,referencePrice:0}],groups:[]}]});
  assert.equal(custom.price,1688);assert.equal(custom.packagePlans[0].services[0].total,6);
  assert.deepEqual(await admin('/users','GET'),beforeMembers);
  assert.deepEqual(await admin('/orders','GET'),beforeOrders);
  await admin('/products/'+custom.id,'PUT',{status:'published',enabled:true});
  const customOrder=await request('/orders','POST',body(custom),alice.token);
  assert.equal(customOrder.total,1688);assert.equal(customOrder.package.services[0].total,6);
  await admin('/products/'+custom.id,'PUT',{name:'调整后的套餐',price:2000,packagePlans:[{id:'custom-plan',name:'新方案',services:[{id:'custom-service',name:'新项目',total:9,referencePrice:0}],groups:[]}]});
  const oldCustomOrder=await request('/orders/'+customOrder.id,'GET',undefined,alice.token);
  assert.equal(oldCustomOrder.total,1688);assert.equal(oldCustomOrder.package.services[0].total,6);assert.equal(oldCustomOrder.package.services[0].name,'深层护理');
  const gold=products[0], goldBody=body(gold);
  await request('/orders','POST',goldBody,undefined,401);
  await request('/orders','POST',{...goldBody,packageSelection:{planId:'wrong',groups:{}}},alice.token,400);
  await request('/orders','POST',{...goldBody,packageSelection:{planId:'a',groups:{}}},alice.token,400);
  await request('/orders','POST',{...goldBody,quantity:2},alice.token,400);
  await request('/orders','POST',{...goldBody,spec:'course'},alice.token,400);
  const invalid=JSON.parse(JSON.stringify(goldBody));
  const groupId=Object.keys(invalid.packageSelection.groups)[0];
  invalid.packageSelection.groups[groupId][0].option='不存在的护理';
  await request('/orders','POST',invalid,alice.token,400);
  invalid.packageSelection.groups[groupId]=[null];
  await request('/orders','POST',invalid,alice.token,400);
  const duplicated=body(products[2]);
  const multi=products[2].packagePlans[0].groups[0];
  duplicated.packageSelection.groups[multi.id]=[duplicated.packageSelection.groups[multi.id][0],duplicated.packageSelection.groups[multi.id][0]];
  await request('/orders','POST',duplicated,alice.token,400);
  await admin('/products/'+gold.id,'PUT',{packagePlans:[null]},400);
  const unsafe=JSON.parse(JSON.stringify(gold.packagePlans)); unsafe[0].groups[0].id='__proto__';
  await admin('/products/'+gold.id,'PUT',{packagePlans:unsafe},400);
  const orders=[];
  for(const p of products)for(const plan of p.packagePlans){
    const order=await request('/orders','POST',{...body(p,plan),price:1,total:1,package:{services:[{total:9999}]}},alice.token);
    assert.equal(order.total,p.price);assert.equal(order.package.planId,plan.id);
    assert.equal(order.package.services.length,plan.services.length+plan.groups.reduce((n,g)=>n+g.pick,0));
    assert.ok(order.package.services.every(s=>s.used===0&&s.total>=1));
    orders.push(order);
  }
  const order=orders[0], entitlement=order.package.services.find(s=>s.total===1);
  const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const booking=(id=entitlement.id,orderId=order.id)=>({orderId,entitlementId:id,date,time:'09:00'});
  await request('/appointments','POST',booking(),alice.token,400);
  await admin('/orders/'+order.id,'POST',{action:'confirmPayment',note:'隔离验收收款'});
  await request('/appointments','POST',booking(),bob.token,404);
  await request('/appointments','POST',{...booking(),entitlementId:undefined},alice.token,400);
  await request('/appointments','POST',{...booking(),entitlementId:'bad'},alice.token,400);
  await request('/appointments','POST',{...booking(),storeId:'different-store'},alice.token,400);
  // Same entitlement concurrent requests cannot exceed the single available use.
  const results=await Promise.all([1,2].map(()=>fetch(base+'/appointments',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+alice.token},body:JSON.stringify(booking())})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  const first=await results.find(r=>r.status===200).json();
  await admin('/appointments/'+first.id,'PUT',{status:'cancelled'});
  const second=await request('/appointments','POST',booking(),alice.token);
  await admin('/appointments/'+second.id,'PUT',{status:'completed'});
  await admin('/appointments/'+second.id,'PUT',{status:'completed'},400);
  await request('/appointments','POST',booking(),alice.token,400);
  let saved=await request('/orders/'+order.id,'GET',undefined,alice.token);
  assert.equal(saved.package.services.find(s=>s.id===entitlement.id).used,1);assert.equal(saved.status,'ready');
  await admin('/orders/'+order.id,'PUT',{status:'completed'},400);
  await admin('/orders/'+order.id,'POST',{action:'refund',note:'已核销不可全额退'},400);
  const changed=JSON.parse(JSON.stringify(gold.packagePlans));changed[0].services[1].total=9;
  await admin('/products/'+gold.id,'PUT',{name:'后台自定义黄金套餐',price:6999,packagePlans:changed});
  saved=await request('/orders/'+order.id,'GET',undefined,alice.token);
  assert.equal(saved.package.services[1].total,3);assert.equal(saved.total,6980);
  for(const item of saved.package.services){for(let n=item.used;n<item.total;n++){
    const appointment=await request('/appointments','POST',booking(item.id),alice.token);
    await admin('/appointments/'+appointment.id,'PUT',{status:'completed'});
  }}
  saved=await request('/orders/'+order.id,'GET',undefined,alice.token);
  assert.equal(saved.status,'completed');assert.ok(saved.package.services.every(s=>s.used===s.total));
  await request('/appointments','POST',booking(),alice.token,400);
  const refundable=orders[1];
  await admin('/orders/'+refundable.id,'POST',{action:'confirmPayment',note:'隔离验收收款'});
  const pendingBooking=await request('/appointments','POST',booking(refundable.package.services[0].id,refundable.id),alice.token);
  const beforeStock=(await admin('/products','GET')).find(p=>p.id===refundable.productId).stock;
  await admin('/orders/'+refundable.id,'POST',{action:'refund',note:'未使用全额退'});
  assert.equal((await request('/appointments','GET',undefined,alice.token)).find(a=>a.id===pendingBooking.id).status,'cancelled');
  await admin('/appointments/'+pendingBooking.id,'PUT',{status:'completed'},400);
  assert.equal((await admin('/products','GET')).find(p=>p.id===refundable.productId).stock,beforeStock+1);
  await admin('/orders/'+refundable.id,'POST',{action:'refund',note:'重复退款'},400);
  assert.deepEqual(await request('/earnings','GET',undefined,alice.token),[]);
  const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
  await stop();await start();await request('/bootstrap');
  const after=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(after.products.length,snapshot.products.length);
  assert.equal(after.categories.length,snapshot.categories.length);
  assert.equal(after.products.find(p=>p.id===gold.id).price,6999);
  assert.equal(after.products.find(p=>p.id===gold.id).packagePlans[0].services[1].total,9);
  assert.deepEqual(after.orders,snapshot.orders);
  assert.ok(previous.products.every(p=>after.products.some(x=>x.id===p.id)));
  console.log(JSON.stringify({ok:true,plans:6,checks:['six document-aligned plans, service counts and choice rules','strict choice and option validation','server pricing','independent immutable entitlements','pending payment guard','ownership and store restriction','concurrent overbooking rejected','cancel releases quota','single-use completion','partial completion keeps order active','full completion closes order','unused refund cancels bookings and restores stock once','used refund rejected','operator edits survive restart','previous data preserved','no invented commissions']}));
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await stop();fs.rmSync(temp,{recursive:true,force:true})});
