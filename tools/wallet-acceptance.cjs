// 本地业务服务 + 本地微信接口替身，临时数据和密钥；不连接真实微信或线上数据库。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-acceptance-'));
const file = path.join(dir, 'db.json'), secret = crypto.randomUUID();
const merchant = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const platform = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
fs.writeFileSync(path.join(dir, 'merchant.pem'), merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }));
fs.writeFileSync(path.join(dir, 'platform.pem'), platform.publicKey.export({ type: 'spki', format: 'pem' }));
const bills = new Map(), recharges = new Map(), calls = [], checks = [];
let child, base, mock, paid = false, wrongAmount = false, badSignature = false, transferState = 'WAIT_USER_CONFIRM', offset = 0;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(WECHAT_|DB_|DATA_FILE|NODE_OPTIONS|ANQI_TEST_)/.test(key)));
const appid = 'wx1234567890abcdef', mchid = '1900000109';
async function port() { const socket = net.createServer().listen(0, '127.0.0.1'); await once(socket, 'listening'); const value = socket.address().port; await new Promise(r => socket.close(r)); return value; }
async function req(route, method = 'GET', body, user = '', expected = 200) {
  assert.equal(new URL(base).hostname, '127.0.0.1');
  const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json',
    ...(user === 'admin' ? { 'x-anqi-internal': secret, 'x-anqi-actor': 'test-admin' } : user ? { authorization: 'Bearer ' + user } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json(); assert.equal(response.status, expected, route + ': ' + JSON.stringify(value)); return value;
}
const admin = (key, body, expected = 200) => req('/admin/wallet' + (key ? '/' + key : ''), body === undefined ? 'GET' : 'POST', body, 'admin', expected);
async function until(read, predicate) {
  for (let i = 0; i < 80; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('本地验收等待超时');
}
async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
async function start() {
  await stop(); const p = await port(); base = 'http://127.0.0.1:' + p + '/api';
  child = spawn(process.execPath, ['--require', './tools/test-clock.cjs', 'server/index.cjs'], { cwd: root, env: { ...env,
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(p), DATA_FILE: file, DB_NAME: '', WECHAT_MOCK: 'true', DEMO_MODE: 'false',
    INTERNAL_SECRET: secret, ADMIN_PASSWORD: secret, PAYMENT_MODE: 'off', ANQI_TEST_CLOCK_OFFSET_MS: String(offset),
    WECHAT_APPID: appid, WECHAT_APPSECRET: '', WECHAT_PAY_MCHID: mchid, WECHAT_PAY_SERIAL_NO: '1234567890ABCDEF',
    WECHAT_PAY_PRIVATE_KEY_FILE: path.join(dir, 'merchant.pem'), WECHAT_PAY_PUBLIC_KEY_FILE: path.join(dir, 'platform.pem'),
    WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_LOCAL', WECHAT_PAY_API_V3_KEY: 'a'.repeat(32), WECHAT_PAY_NOTIFY_URL: 'https://example.test/api/pay/notify',
    WECHAT_PAY_BASE_URL: 'http://127.0.0.1:' + mock.address().port, WECHAT_RECHARGE_ENABLED: 'true', WECHAT_TRANSFER_ENABLED: 'true',
    WECHAT_TRANSFER_MODE: 'confirm', WECHAT_TRANSFER_SCENE_ID: '1000', WECHAT_TRANSFER_SCENE_REPORTS: '[{"info_type":"活动名称","info_content":"隔离测试"}]',
    WECHAT_TRANSFER_NOTIFY_URL: 'https://example.test/api/transfer-notify' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; child.stderr.on('data', b => errors += b);
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(errors);
    try { if ((await fetch(base + '/health')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(errors || '服务启动失败');
}
async function mockRequest(request, response) {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const signed = Object.fromEntries([...request.headers.authorization.matchAll(/(\w+)="([^"]+)"/g)].map(m => [m[1], m[2]]));
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${request.method}\n${request.url}\n${signed.timestamp}\n${signed.nonce_str}\n${raw}\n`), merchant.publicKey, Buffer.from(signed.signature, 'base64')));
  const body = raw ? JSON.parse(raw) : {}; calls.push({ method: request.method, path: request.url, body });
  let data;
  if (request.url === '/v3/recharge/bank-transfer-recharges/apply') {
    assert.equal(body.account_type, 'OPERATION');
    recharges.set(body.out_recharge_no, body);
    data = { out_recharge_no: body.out_recharge_no, recharge_id: 'recharge-' + body.out_recharge_no,
      transfer_in_account: { bank_name: '隔离测试银行', bank_account_name: '隔离测试公司', bank_account_no: '0000000000000000' } };
  } else if (request.url.startsWith('/v3/recharge/bank-transfer-recharges/out-recharge-no/')) {
    const number = request.url.split('/').pop(), original = recharges.get(number); assert.ok(original);
    data = { ...original, mchid, recharge_id: 'recharge-' + number, recharge_state: paid ? 'SUCCESS' : 'RECHARGING',
      success_time: new Date().toISOString(), recharge_amount: { amount: original.recharge_amount.amount + (wrongAmount ? 1 : 0), currency: 'CNY' } };
  } else if (request.url === '/v3/fund-app/mch-transfer/transfer-bills') {
    if (bills.has(body.out_bill_no)) assert.deepEqual(body, bills.get(body.out_bill_no));
    bills.set(body.out_bill_no, body); data = { out_bill_no: body.out_bill_no, state: 'WAIT_USER_CONFIRM', package_info: 'local-package-' + body.out_bill_no };
  } else if (request.url.startsWith('/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/')) {
    const number = request.url.split('/').pop(), original = bills.get(number); assert.ok(original);
    data = { out_bill_no: number, appid, mch_id: mchid, openid: original.openid, transfer_amount: original.transfer_amount, state: transferState };
  } else throw new Error('未允许的外部接口：' + request.url);
  const result = JSON.stringify(data), timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'local-nonce';
  response.writeHead(200, { 'content-type': 'application/json', 'Wechatpay-Serial': 'PUB_KEY_ID_LOCAL', 'Wechatpay-Timestamp': timestamp,
    'Wechatpay-Nonce': nonce, 'Wechatpay-Signature': badSignature ? 'invalid' : crypto.sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${result}\n`), platform.privateKey).toString('base64') });
  response.end(result);
}
(async () => {
  mock = http.createServer((q, s) => mockRequest(q, s).catch(e => { console.error(e); s.writeHead(500); s.end('{}'); }));
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const db = require('../server/seed.cjs')(), now = Date.now();
  db.config._trialDeviceCatalogV2 = true;
  db.config.poolReward = { enabled: false };
  db.config.shareholderProgram = { enabled: true, plans: [], revision: 0, activatedAt: new Date(now - 60000).toISOString() };
  db.users = ['a', 'b'].map((id, i) => ({ id, name: '本地会员' + id, points: 500, openid: 'local-openid-' + id, wechatAppId: appid,
    shareholder: { approved: true, planId: 'package-' + (i ? 13800 : 6980), orderId: id + '-proof', approvedAt: new Date(now - 10000).toISOString() } }));
  db.orders = db.users.map((u, i) => ({ id: u.id + '-proof', number: u.id + '-proof', userId: u.id, total: i ? 13800 : 6980,
    paymentStatus: 'paid', status: 'ready', paidAt: new Date(now - 20000).toISOString(), product: { price: i ? 13800 : 6980, packagePlans: [{}] } }));
  db.sessions = db.users.map(u => ({ id: 'token-' + u.id, userId: u.id, role: 'user', expires: now + 3600000 }));
  fs.writeFileSync(file, JSON.stringify(db)); await start();
  await req('/admin/wallet', 'GET', undefined, '', 401); await req('/admin/wallet/recharge', 'POST', {}, 'token-a', 403);
  await req('/withdrawals', 'POST', {}, '', 401);
  await admin('activate', { confirmed: true, revision: 0, pending: [] });
  const body = { amount: 300, requestId: 'local-recharge-0001' };
  const first = await admin('recharge', body), repeated = await admin('recharge', body); assert.equal(first.id, repeated.id);
  await until(() => admin(''), state => !!state.recharges[0].bankAccount);
  assert.equal((await req('/earnings-summary', 'GET', undefined, 'token-a')).available, 0);
  paid = true; badSignature = true; await admin('sync', { id: first.id });
  await until(() => admin(''), state => state.recharges[0].status === 'unknown');
  assert.equal((await req('/earnings-summary', 'GET', undefined, 'token-a')).available, 0);
  badSignature = false; wrongAmount = true; await admin('sync', { id: first.id });
  await until(() => admin(''), state => state.recharges[0].error.includes('金额'));
  assert.equal((await req('/earnings-summary', 'GET', undefined, 'token-a')).available, 0);
  wrongAmount = false; await admin('sync', { id: first.id });
  await until(() => admin(''), state => state.recharges[0].status === 'distributed');
  assert.equal((await req('/earnings-summary', 'GET', undefined, 'token-a')).available, 100);
  assert.equal((await req('/earnings-summary', 'GET', undefined, 'token-b')).available, 200);
  assert.equal(bills.size, 0);
  checks.push('充值指向运营账户；未到账、伪签名、金额不符不分配；到账300按1:2分100/200，不直接转微信');
  const withdrawal = { amount: 100, requestId: 'local-withdrawal-001' };
  const submitted = await Promise.all([req('/withdrawals', 'POST', withdrawal, 'token-a'), req('/withdrawals', 'POST', withdrawal, 'token-a')]);
  assert.equal(submitted[0].id, submitted[1].id);
  await req('/withdrawals', 'POST', { amount: 1, requestId: 'local-withdrawal-002' }, 'token-a', 400);
  assert.equal((await req('/withdrawals', 'GET', undefined, 'token-b')).length, 0);
  const waiting = await until(() => req('/earnings-summary', 'GET', undefined, 'token-a'), value => !!value.transfers[0]?.confirmation);
  assert.equal(waiting.transferring, 100); assert.equal(waiting.available, 0); assert.equal(waiting.paidOut, 0);
  await req('/admin/earnings/payouts', 'POST', { action: 'payout', userId: 'a', amount: 1, method: 'cash', confirmed: true, requestId: 'local-cash-001' }, 'admin', 400);
  checks.push('客户不能充值、游客不能提现；重复并发提现仅一笔，不能超提或再线下兑现，其他会员看不到记录');
  transferState = 'SUCCESS'; offset += 61000; await start();
  const settled = await until(() => req('/earnings-summary', 'GET', undefined, 'token-a'), value => value.paidOut === 100);
  assert.equal(settled.transferring, 0); assert.equal(settled.available, 0);
  assert.equal(calls.filter(c => c.path === '/v3/fund-app/mch-transfer/transfer-bills').length, 1);
  const duplicate = await req('/withdrawals', 'POST', withdrawal, 'token-a'); assert.equal(duplicate.status, 'paid');
  await start();
  assert.equal((await req('/earnings', 'GET', undefined, 'token-a')).length, 1);
  assert.equal((await req('/earnings-summary', 'GET', undefined, 'token-a')).payouts.length, 1);
  assert.equal((await req('/me', 'GET', undefined, 'token-a')).points, 500);
  assert.equal((await req('/orders', 'GET', undefined, 'token-a'))[0].total, 6980);
  checks.push('重启后原单继续查账，成功只扣一次；重复提交不重提，原订单、会员积分和余额记录保留');
  console.log(JSON.stringify({ ok: true, checks, isolation: 'localhost mock only; temporary JSON and RSA keys' }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await stop(); if (mock) await new Promise(r => mock.close(r));
  if (!dir.startsWith(path.join(os.tmpdir(), 'wallet-acceptance-'))) throw new Error('Unexpected cleanup directory');
  fs.rmSync(dir, { recursive: true, force: true });
});
