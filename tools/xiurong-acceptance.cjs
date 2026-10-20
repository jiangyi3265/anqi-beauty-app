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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anqi-xiurong-'));
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
  const previous=seed(); previous.config.appointmentCapacity=100; previous.config._brandVisualAndPricingV3=true; previous.config._trialCatalogSeedV2=true;
  const trialIds=['69b6dac2-7ba3-4e92-a008-09056c7019f9','6fdfb407-ab3f-47b1-8c8c-b9e3c9b2586b','29525620-e803-44b9-98f9-b0b7369f4744'];
  const paidIds=['3eeaa4b1-19dc-42a2-adbf-b4a6f8a4e679','2504b7af-3dbb-4780-b50c-600204a1314e','b83752e9-b64f-43d7-9539-8bf8dd26aa7d'];
  previous.products.filter(p=>p.trialOnly).forEach((p,i)=>{p.id=trialIds[i];previous.products.push({...p,id:paidIds[i],trialOnly:false,trial:false,price:p.referencePrice})});
  previous.claims.push({id:'old-claim',userId:'old-user',type:'vip',productIds:[previous.products[0].id],products:[structuredClone(previous.products[0])]});
  fs.writeFileSync(file,JSON.stringify(previous));await start();await request('/bootstrap');
  const admin=(route,method='GET',body,expected=200)=>request('/admin'+route,method,body,undefined,expected,true);
  const oldProducts=await admin('/products');
  const oldTrials=oldProducts.filter(p=>p.trial);
  const oldStores=await admin('/stores');
  const media=new Proxy({}, {get:(_,key)=>'/static/uploads/'+key,set:()=>true});
  const plan=require('./xiurong-catalogue.cjs').cataloguePlan(oldProducts,await admin('/categories'),media);
  for(const m of plan.mutations) await admin('/products'+(m.id?'/'+m.id:''),m.id?'PUT':'POST',m.patch);
  for(const s of plan.stores)await admin('/stores','POST',s);
  const data=await request('/bootstrap');const vip=data.products.filter(p=>p.gift),trials=data.products.filter(p=>p.trial);
  assert.equal(vip.length,10);assert.ok(vip.every(p=>p.price===0&&p.trialOnly));
  assert.deepEqual(vip.map(p=>p.referencePrice),[598,598,598,598,980,3980,6980,3980,6980,6980]);
  assert.deepEqual(trials.map(p=>[p.id,p.price,p.referencePrice,p.stock]).sort(),oldTrials.map(p=>[p.id,p.price,p.referencePrice,p.stock]).sort());
  assert.equal(data.products.filter(p=>p.home&&p.categoryId===data.categories.find(c=>c.name==='特色项目').id&&!p.trialOnly).length,5);
  assert.equal(data.products.find(p=>p.id==='jimeili-rejuvenation-set').home,oldProducts.find(p=>p.id==='jimeili-rejuvenation-set').home);
  assert.equal(data.stores.length,oldStores.length+2);assert.deepEqual(data.stores.find(s=>s.id===oldStores[0].id),oldStores[0]);
  assert.equal(data.stores.find(s=>s.name.includes('和谐')).gallery.length,11);
  const store=data.stores.find(s=>s.name.includes('建业'));
  await admin('/stores/'+store.id,'PUT',{gallery:['javascript:alert(1)']},400);
  await admin('/stores/'+store.id,'PUT',{gallery:Array(21).fill('/static/a.jpg')},400);
  const alice=await request('/auth/wechat','POST',{code:'xiurong-alice'});
  await request('/claims','POST',{type:'vip',productIds:vip.slice(0,3).map(p=>p.id)},alice.token,400);
  await admin('/users/'+alice.user.id,'PUT',{invited:true});
  await request('/claims','POST',{type:'vip',productIds:vip.slice(0,2).map(p=>p.id)},alice.token,400);
  await request('/claims','POST',{type:'vip',productIds:[vip[0].id,vip[0].id,vip[1].id]},alice.token,400);
  await request('/claims','POST',{type:'vip',productIds:vip.slice(0,3).map(p=>p.id)},alice.token);
  await request('/claims','POST',{type:'trial',productIds:trials.map(p=>p.id)},alice.token);
  assert.equal((await request('/claims','GET',undefined,alice.token)).length,2);
  await request('/orders','POST',{productId:vip[0].id,quantity:1,spec:'single',storeId:store.id},alice.token,400);
  const eye=data.products.find(p=>p.code==='XIURONG-9D-EYE');
  for(const invalid of [0,1.5,1000,'10'])await admin('/products/'+eye.id,'PUT',{skus:[{...eye.skus[1],serviceSessions:invalid}]},400);
  await admin('/products/'+eye.id,'PUT',{kind:'goods',skus:eye.skus},400);
  const order=await request('/orders','POST',{productId:eye.id,skuId:'9d-eye-course',quantity:1,spec:'single',storeId:store.id,price:1,serviceSessions:999,package:{services:[{total:999}]}},alice.token);
  assert.equal(order.total,12800);assert.equal(order.package.services[0].total,10);
  await admin('/orders/'+order.id,'POST',{action:'confirmPayment',note:'隔离验收'});
  const booking={orderId:order.id,entitlementId:order.package.services[0].id,date:new Date(Date.now()+86400000*2).toISOString().slice(0,10),time:'09:00'};
  for(let n=0;n<10;n++){
    const a=await request('/appointments','POST',booking,alice.token);await admin('/appointments/'+a.id,'PUT',{status:'completed'});
    const saved=await request('/orders/'+order.id,'GET',undefined,alice.token);assert.equal(saved.package.services[0].used,n+1);assert.equal(saved.status,n===9?'completed':'ready');
    if(n===0)await admin('/orders/'+order.id,'POST',{action:'refund',note:'已使用不可退'},400);
  }
  await request('/appointments','POST',booking,alice.token,400);
  await admin('/products/'+eye.id,'PUT',{skus:eye.skus.map(s=>({...s,price:2,serviceSessions:1}))});
  const saved=await request('/orders/'+order.id,'GET',undefined,alice.token);assert.equal(saved.total,12800);assert.equal(saved.package.services[0].total,10);
  const snapshot=JSON.parse(fs.readFileSync(file));assert.deepEqual(snapshot.claims.find(c=>c.id==='old-claim'),previous.claims[0]);
  await stop();await start();const reloaded=await request('/bootstrap');assert.equal(reloaded.products.filter(p=>p.gift).length,10);assert.equal(reloaded.stores.length,3);
  console.log(JSON.stringify({ok:true,checks:['ten VIP choices with correct values','exactly three unique choices and eligibility','three original trial entitlements preserved','five homepage services','two new stores and gallery validation','card products cannot be purchased','server price and course sessions resist client tampering','ten separate bookings and use exhaustion','used course refund guard','immutable order and historical claim snapshots','restart preserves catalogue']}));
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await stop();fs.rmSync(temp,{recursive:true,force:true})});
