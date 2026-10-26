// 微信支付验收：业务服务连接本地模拟的微信支付 API v3，不连接真实微信。
// 覆盖：调起参数签名、复用预支付单、回调验签/解密/防篡改、重复回调、查单兜底、取消前关单、
// 后台收款前关单、原路退款及退款回调、套餐已核销禁止退款、超时对账关单、重启持久化、配置不全时停用、平台证书模式。
// MySQL：WECHAT_PAY_TEST_DB_NAME=anqi_audit_xxx（需已建库）。
const assert = require('node:assert/strict');
const {makeSuperVip}=require('./test-super-vip.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const seed = require('../server/seed.cjs');
const { createSimulator } = require('./wechat-pay-simulator.cjs');

const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anqi-wxpay-'));
const file = path.join(dir, 'db.json');
const secret = crypto.randomBytes(24).toString('hex');
const APPID = 'wx' + crypto.randomBytes(8).toString('hex');
const MCHID = '1900000109', SERIAL = crypto.randomBytes(20).toString('hex').toUpperCase(), APIV3 = crypto.randomBytes(16).toString('hex');
const merchant = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(dir, 'apiclient_key.pem'); fs.writeFileSync(keyFile, merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const DB = process.env.WECHAT_PAY_TEST_DB_NAME || '';
if (DB && !/^anqi_audit_[a-zA-Z0-9_]+$/.test(DB)) throw Error('Use a dedicated anqi_audit_ database');
const checks = [];
let child, base, port;

async function freePort() { const s = net.createServer().listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function startServer(sim, { offset = 0, extra = {}, keepPort = false } = {}) {
  if (!keepPort || !port) port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  const env = { ...process.env, ANQI_TEST_CLOCK_OFFSET_MS: String(offset), HOST: '127.0.0.1', PORT: String(port), DATA_FILE: file, DB_NAME: DB, NODE_ENV: 'test', DEMO_MODE: 'false', WECHAT_MOCK: 'true', WECHAT_APPID: APPID, ADMIN_PASSWORD: secret, INTERNAL_SECRET: secret,
    PAYMENT_MODE: 'wechat', WECHAT_PAY_MCHID: MCHID, WECHAT_PAY_SERIAL_NO: SERIAL, WECHAT_PAY_PRIVATE_KEY_FILE: keyFile, WECHAT_PAY_API_V3_KEY: APIV3, WECHAT_PAY_BASE_URL: sim.base, WECHAT_PAY_NOTIFY_URL: `http://127.0.0.1:${port}/api/pay/notify`, ...extra };
  if (sim.mode === 'publicKey') { const pk = path.join(dir, 'pub_key.pem'); fs.writeFileSync(pk, sim.platformPublicPem); env.WECHAT_PAY_PUBLIC_KEY_FILE = pk; env.WECHAT_PAY_PUBLIC_KEY_ID = sim.publicKeyId; }
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-clock.cjs'), 'server/index.cjs'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; child.stderr.on('data', b => errors += b);
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) return () => errors; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw Error(errors || '业务服务启动超时');
}
async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
async function req(route, method = 'GET', body, token, expected = 200) {
  const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  assert.equal(r.status, expected, `${method} ${route}: ${JSON.stringify(data)}`); return data;
}
const admin = (route, method = 'GET', body, expected = 200) => fetch(base + '/admin/' + route, { method, headers: { 'content-type': 'application/json', 'x-anqi-internal': secret }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => { const d = await r.json().catch(() => ({})); assert.equal(r.status, expected, `admin ${method} ${route}: ${JSON.stringify(d)}`); return d; });
const login = (code, invite) => req('/auth/wechat', 'POST', { code: code + '-' + crypto.randomBytes(4).toString('hex'), ...(invite ? { invite } : {}) });
const openidOf = code => 'mock_' + crypto.createHash('sha256').update(code).digest('hex');
const order = (product, token, extra = {}) => req('/orders', 'POST', { productId: product.id, quantity: 1, spec: 'single', storeId: 'store-1', ...extra }, token);
const pay = (o, token, expected = 200) => req('/orders/' + o.id + '/pay', 'POST', {}, token, expected);
const audits = async o => (await admin('paymentAudits')).filter(a => a.orderId === o.id);
const verifyPaySign = p => crypto.createVerify('RSA-SHA256').update(`${p.appId}\n${p.timeStamp}\n${p.nonceStr}\n${p.package}\n`).verify(merchant.publicKey, p.paySign, 'base64');

(async () => {
  const sim = await createSimulator({ mchid: MCHID, appid: APPID, apiV3Key: APIV3, merchantPublicKey: merchant.publicKey, merchantSerial: SERIAL }).start();
  fs.writeFileSync(file, JSON.stringify(seed()));
  await startServer(sim);
  const health = await req('/health'), boot = await req('/bootstrap');
  assert.equal(health.paymentMode, 'wechat'); assert.equal(boot.paymentMode, 'wechat');
  const service = boot.products.find(p => p.kind === 'service' && !p.trialOnly && !p.packagePlans?.length && !p.skus?.length && (p.memberPrice ?? p.price) > 0 && p.stock > 5);
  const vip = boot.products.find(p => p.packagePlans?.length);
  assert.ok(service && vip, '缺少测试商品');
  const ref = (await admin('incomeRules')).referral;
  await admin('incomeRules/referral', 'PUT', { ...ref, enabled: true });
  const inviter = await login('wxpay-inviter'), buyerCode = 'wxpay-buyer-' + Date.now();
  await makeSuperVip(admin, inviter.user.id, 'wxpay');
  const buyer = await req('/auth/wechat', 'POST', { code: buyerCode, invite: inviter.user.id.slice(0, 8) });
  checks.push('业务服务和小程序启动参数均显示已开通微信支付');

  const offlineChoice = await order(service, buyer.token, { paymentChoice: 'offline' });
  await pay(offlineChoice, buyer.token, 400);
  assert.equal(sim.count('POST', '/v3/pay/transactions/jsapi'), 0);
  await req('/orders/' + offlineChoice.id + '/cancel', 'POST', {}, buyer.token);
  checks.push('即使在线支付已启用，明确选择门店收银的订单也不会创建微信预支付单；仍可正常取消');

  // 1. 下单 → 预支付 → 调起参数
  const stockBefore = (await req('/bootstrap')).products.find(p => p.id === service.id).stock;
  const o1 = await order(service, buyer.token);
  const r1 = await pay(o1, buyer.token);
  const jsapi = sim.calls.find(c => c.path === '/v3/pay/transactions/jsapi');
  assert.equal(jsapi.body.amount.total, Math.round(o1.total * 100)); assert.equal(jsapi.body.payer.openid, openidOf(buyerCode));
  assert.equal(jsapi.body.out_trade_no, o1.number); assert.equal(jsapi.body.notify_url, `http://127.0.0.1:${port}/api/pay/notify`);
  assert.equal(Date.parse(jsapi.body.time_expire), Date.parse(o1.createdAt) + 2 * 3600000 - (Date.parse(o1.createdAt) % 1000));
  assert.equal(r1.payment.appId, APPID); assert.equal(r1.payment.signType, 'RSA'); assert.ok(verifyPaySign(r1.payment), '调起支付签名无效');
  assert.equal(r1.payment.package, 'prepay_id=' + sim.orders.get(o1.number).prepay_id);
  const r1b = await pay(o1, buyer.token);
  assert.equal(r1b.payment.package, r1.payment.package); assert.equal(sim.count('POST', '/v3/pay/transactions/jsapi'), 1);
  assert.equal(sim.rejected, 0, '有请求未通过商户签名校验');
  checks.push(`下单后生成预支付单：金额 ${jsapi.body.amount.total} 分、付款人 openid、2 小时支付期限、回调地址正确；调起参数签名有效，重复点击复用同一预支付单`);

  // 2. 伪造/过期/金额不符的回调一律不入账
  sim.orders.get(o1.number).state = 'SUCCESS'; sim.orders.get(o1.number).transaction_id = '4200000000000000000000000001';
  assert.equal(await sim.notifyAgain(o1.number, { badSignature: true }), 401);
  assert.equal(await sim.notifyAgain(o1.number, { stale: true }), 401);
  assert.equal(await sim.notifyAgain(o1.number, { wrongSerial: true }), 401);
  const wrong = await sim.pay(o1.number, { override: { amount: { total: 1, payer_total: 1, currency: 'CNY', payer_currency: 'CNY' } } });
  assert.equal(wrong.status, 200);
  assert.equal((await req('/orders/' + o1.id, 'GET', undefined, buyer.token)).status, 'pending');
  assert.ok((await audits(o1)).some(a => a.outcome === 'rejected' && a.reason === '金额不一致'));
  checks.push('签名被篡改、时间戳过期、未知公钥的回调返回 401；金额不符的回调被记录为拒绝，订单不入账');

  // 3. 正常回调入账，重复回调幂等
  const ok = await sim.notifyAgain(o1.number);
  assert.equal(ok, 200);
  let paid = await req('/orders/' + o1.id, 'GET', undefined, buyer.token);
  assert.equal(paid.status, 'ready'); assert.equal(paid.paymentMode, 'wechat'); assert.equal(paid.paymentTransactionId, '4200000000000000000000000001'); assert.equal(paid.paymentStatus, 'paid');
  const reward1 = (await req('/earnings-summary', 'GET', undefined, inviter.token)).dynamic;
  assert.equal(reward1, Math.round(o1.total * 50) / 100);
  const sold = (await admin('products')).find(p => p.id === service.id).sold;
  for (let i = 0; i < 2; i++) assert.equal(await sim.notifyAgain(o1.number), 200);
  assert.equal((await req('/earnings-summary', 'GET', undefined, inviter.token)).dynamic, reward1);
  assert.equal((await admin('products')).find(p => p.id === service.id).sold, sold);
  assert.equal((await audits(o1)).filter(a => a.outcome === 'success').length, 1);
  checks.push(`微信回调验签解密后入账：订单变为待使用、记录微信交易号；推荐人首单奖励 ${reward1} 元；重复回调不重复入账、不重复计销量`);

  // 4. 回调丢失时，小程序付款后主动查单兜底
  const o2 = await order(service, buyer.token); await pay(o2, buyer.token);
  await sim.pay(o2.number, { notify: false });
  const synced = await req('/orders/' + o2.id + '/pay', 'POST', { sync: true }, buyer.token);
  assert.equal(synced.status, 'ready'); assert.equal(synced.paymentMode, 'wechat');
  assert.equal((await req('/earnings-summary', 'GET', undefined, inviter.token)).dynamic, Math.round((reward1 + o2.total * 0.1) * 100) / 100);
  checks.push('回调未到达时，小程序付款完成后主动查单入账；第二单推荐人按 10% 计算');

  // 5. 顾客取消：先关闭微信订单，之后无法再付款；关单时发现已付款则改为入账
  const o3 = await order(service, buyer.token); await pay(o3, buyer.token);
  await req('/orders/' + o3.id + '/cancel', 'POST', {}, buyer.token);
  assert.equal(sim.orders.get(o3.number).state, 'CLOSED'); assert.ok((await sim.pay(o3.number)).closed);
  assert.equal((await req('/orders/' + o3.id, 'GET', undefined, buyer.token)).status, 'cancelled');
  const o4 = await order(service, buyer.token); await pay(o4, buyer.token); await sim.pay(o4.number, { notify: false });
  const cancelPaid = await req('/orders/' + o4.id + '/cancel', 'POST', {}, buyer.token, 409);
  assert.match(cancelPaid.error, /已通过微信支付/);
  assert.equal((await req('/orders/' + o4.id, 'GET', undefined, buyer.token)).status, 'ready');
  checks.push('取消订单前先关闭微信订单，关闭后顾客无法再付款；若顾客已付款，取消被拒绝并自动入账');

  // 6. 后台确认线下收款前也先关闭微信订单
  const o5 = await order(service, buyer.token); await pay(o5, buyer.token);
  await admin('orders/' + o5.id, 'POST', { action: 'confirmPayment', note: '门店现金' });
  assert.equal(sim.orders.get(o5.number).state, 'CLOSED');
  const o5b = await req('/orders/' + o5.id, 'GET', undefined, buyer.token);
  assert.equal(o5b.paymentMode, 'offline'); assert.equal(o5b.status, 'ready');
  const o6 = await order(service, buyer.token); await pay(o6, buyer.token); await sim.pay(o6.number, { notify: false });
  const offlineDup = await admin('orders/' + o6.id, 'POST', { action: 'confirmPayment', note: '门店现金' }, 409);
  assert.match(offlineDup.error, /已通过微信支付/);
  assert.equal((await req('/orders/' + o6.id, 'GET', undefined, buyer.token)).paymentMode, 'wechat');
  checks.push('门店确认线下收款前先关闭微信订单；顾客已微信付款时拒绝重复收款并按微信入账');

  // 7. 原路退款、退款回调；退款冲回推荐奖励；重复退款被拒绝
  const before = (await req('/earnings-summary', 'GET', undefined, inviter.token)).dynamic;
  const refunded = await admin('orders/' + o1.id, 'POST', { action: 'refund', note: '顾客改期，原路退回' });
  const call = sim.calls.filter(c => c.path === '/v3/refund/domestic/refunds').at(-1);
  assert.equal(call.body.transaction_id, '4200000000000000000000000001'); assert.equal(call.body.amount.refund, Math.round(o1.total * 100)); assert.equal(call.body.out_refund_no, 'R' + o1.number);
  assert.equal(refunded.status, 'aftersale'); assert.equal(refunded.refundStatus, 'refunded'); assert.equal(refunded.wechatRefund.status, 'PROCESSING');
  assert.equal((await req('/earnings-summary', 'GET', undefined, inviter.token)).dynamic, Math.round((before - reward1) * 100) / 100);
  assert.equal(await sim.finishRefund('R' + o1.number), 200);
  assert.equal((await req('/orders/' + o1.id, 'GET', undefined, buyer.token)).wechatRefund.status, 'SUCCESS');
  const again = await admin('orders/' + o1.id, 'POST', { action: 'refund', note: '再次' }, 400);
  assert.match(again.error, /当前订单不可售后|已退款/);
  assert.equal(sim.count('POST', '/v3/refund/domestic/refunds'), 1);
  checks.push('后台退款原路退回微信（交易号、全额、退款单号正确），订单转售后并冲回推荐奖励；退款成功回调更新为已到账；不能重复退款');

  // 8. 套餐已核销不退款，且不调用微信；线下收款订单退款不走微信
  const plan = vip.packagePlans[0], selection = { planId: plan.id, groups: Object.fromEntries(plan.groups.map(g => [g.id, g.services.slice(0, g.pick).map(s => ({ serviceId: s.id, ...(s.options?.length ? { option: s.options[0] } : {}) }))])) };
  const o7 = await order(vip, buyer.token, { packageSelection: selection }); await pay(o7, buyer.token); await sim.pay(o7.number);
  const o7p = await req('/orders/' + o7.id, 'GET', undefined, buyer.token); assert.equal(o7p.status, 'ready');
  const ent = o7p.package.services[0], date = new Date(Date.now() + 8 * 3600000 + 3 * 86400000).toISOString().slice(0, 10);
  const appt = await req('/appointments', 'POST', { orderId: o7.id, entitlementId: ent.id, date, time: '10:00' }, buyer.token);
  await admin('appointments/' + appt.id, 'PUT', { status: 'completed' });
  const refundsBefore = sim.count('POST', '/v3/refund/domestic/refunds');
  await admin('orders/' + o7.id, 'POST', { action: 'refund', note: '测试' }, 400);
  assert.equal(sim.count('POST', '/v3/refund/domestic/refunds'), refundsBefore);
  await admin('orders/' + o5.id, 'POST', { action: 'refund', note: '线下退现金', refundConfirmed:true, refundAmount:o5.total, refundedAt:new Date().toISOString(), refundMethod:'隔离测试', refundReference:'test-'+o5.id });
  assert.equal(sim.count('POST', '/v3/refund/domestic/refunds'), refundsBefore);
  checks.push('套餐已有核销记录时在调用微信前拒绝退款；线下收款的订单退款不经过微信');

  // 9. 超时对账：未付款的关闭并取消、库存恢复；已付款但回调丢失的自动入账；重启后数据保留
  const o8 = await order(service, buyer.token); await pay(o8, buyer.token);
  const o9 = await order(service, buyer.token); await pay(o9, buyer.token); await sim.pay(o9.number, { notify: false });
  const stockMid = (await admin('products')).find(p => p.id === service.id).stock;
  await stop(); sim.clockOffset = 2 * 3600000 + 5 * 60000;
  await startServer(sim, { offset: sim.clockOffset, keepPort: true });
  const o8a = await admin('orders').then(rows => rows.find(x => x.id === o8.id)), o9a = await admin('orders').then(rows => rows.find(x => x.id === o9.id));
  assert.equal(o8a.status, 'cancelled'); assert.equal(sim.orders.get(o8.number).state, 'CLOSED');
  assert.equal(o9a.status, 'ready'); assert.equal(o9a.paymentMode, 'wechat');
  assert.equal((await admin('products')).find(p => p.id === service.id).stock, stockMid + 1);
  assert.equal((await admin('orders')).find(x => x.id === o1.id).wechatRefund.status, 'SUCCESS');
  assert.ok(stockBefore > 0);
  checks.push('超过 2 小时未付款的订单在对账时关闭微信订单并取消、恢复库存；已付款但回调丢失的订单对账入账；重启后支付和退款记录保留');

  // 10. 配置不全时不开放在线支付
  await stop(); sim.clockOffset = 0;
  await startServer(sim, { extra: { WECHAT_PAY_API_V3_KEY: 'too-short' } });
  assert.equal((await req('/health')).paymentMode, 'off');
  const fresh = await login('wxpay-off'); const o10 = await order(service, fresh.token);
  const off = await pay(o10, fresh.token, 503); assert.match(off.error, /未开通在线支付/);
  const notifyOff = await fetch(base + '/pay/notify', { method: 'POST', body: '{}' }); assert.equal(notifyOff.status, 404); assert.match((await notifyOff.json()).error, /微信支付未开通/);
  checks.push('商户配置不全时自动保持“门店收款”，在线支付接口拒绝调用，不会生成预支付单；回调地址返回“微信支付未开通”');
  await stop(); await sim.stop();

  // 11. 平台证书模式（未配置微信支付公钥的老商户）
  const certSim = await createSimulator({ mchid: MCHID, appid: APPID, apiV3Key: APIV3, merchantPublicKey: merchant.publicKey, merchantSerial: SERIAL, mode: 'certificate' }).start();
  await startServer(certSim);
  const certBuyer = await login('wxpay-cert'); const o11 = await order(service, certBuyer.token); await pay(o11, certBuyer.token);
  assert.equal((await certSim.pay(o11.number)).status, 200);
  assert.equal((await req('/orders/' + o11.id, 'GET', undefined, certBuyer.token)).status, 'ready');
  assert.equal(certSim.count('GET', '/v3/certificates'), 1);
  checks.push('平台证书模式：自动下载并解密平台证书后验签，支付回调正常入账');
  await stop(); await certSim.stop();

  console.log(JSON.stringify({ ok: true, mode: DB ? 'mysql' : 'file', checks }, null, 2));
})().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
