const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anqi-integrity-'));
const secret = crypto.randomBytes(24).toString('hex');
const createdFiles = [];
const checks = [];
const testDatabase = process.env.INTEGRITY_DB_NAME || '';
if (testDatabase && !/^anqi_audit_[a-z0-9_]+$/.test(testDatabase)) throw Error('MySQL test requires an isolated anqi_audit_ database');
let server, base;
async function request(route, method = 'GET', body, token = '', expected = 200) {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...(token === 'admin' ? { 'x-anqi-internal': secret } : token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (expected !== null) assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
  return expected === null ? { status: response.status, data } : data;
}
const admin = (route, method = 'GET', body, status = 200) => request('/admin' + route, method, body, 'admin', status);
const beijingDate = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

(async () => {
  const socket = net.createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}/api`;
  server = spawn(process.execPath, ['server/index.cjs'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_NAME: testDatabase, DATA_FILE: path.join(temp, 'db.json'), NODE_ENV: 'test', DEMO_MODE: 'false', WECHAT_MOCK: 'true', ADMIN_PASSWORD: secret, INTERNAL_SECRET: secret, PAYMENT_MODE: 'off' }, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) throw Error('Isolated server exited');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'Isolated server did not start');
  const catalogue = await request('/bootstrap');
  const config = await admin('/config');
  assert.equal(config.customerQr, '');
  assert.equal((await admin('/config', 'PUT', config)).customerQr, '');
  checks.push('完整配置可保存空客服二维码');
  for (const signPoints of [-1, 0, 1.5, '100', 10001]) await admin('/config', 'PUT', { signPoints }, 400);
  for (const appointmentTimes of ['', '25:00', '09:60', '9:00', '09:00,09:00', '09:00,']) await admin('/config', 'PUT', { signPoints: 50, appointmentTimes }, 400);
  assert.equal((await admin('/config')).signPoints, config.signPoints);
  checks.push('非法积分与时间被拒绝，失败配置保存整体回滚');
  await admin('/config', 'PUT', { customerQr: 'javascript:alert(1)' }, 400);
  await admin('/config', 'PUT', { customerQr: '' });
  for (const value of [null, [], 'string']) await request('/auth/wechat', 'POST', value, '', 400);
  checks.push('图片地址及非对象请求校验');

  const product = await admin('/products', 'POST', { name: '隔离回归服务', kind: 'service', price: 10, stock: 5, status: 'published', recommended: true, image: '/static/brand/logo-jimeili.png' });
  await admin('/products/' + product.id, 'PUT', { ...product, recommended: false });
  let current = (await request('/bootstrap')).products.find(p => p.id === product.id);
  assert.equal(current.recommended, false); assert.equal(current.home, false);
  await admin('/products/' + product.id, 'PUT', { home: true });
  assert.equal((await request('/bootstrap')).products.find(p => p.id === product.id).recommended, true);
  await admin('/products/' + product.id, 'PUT', { enabled: false });
  assert.equal((await request('/bootstrap')).products.some(p => p.id === product.id), false);
  await admin('/products/' + product.id, 'PUT', { status: 'published' });
  checks.push('推荐开关兼容旧字段，商品上下架即时生效');

  const alice = await request('/auth/wechat', 'POST', { code: 'integrity-alice-' + crypto.randomUUID() });
  const bob = await request('/auth/wechat', 'POST', { code: 'integrity-bob-' + crypto.randomUUID() });
  const signed = await Promise.all([1, 2].map(() => request('/sign', 'POST', {}, alice.token, null)));
  assert.deepEqual(signed.map(r => r.status).sort(), [200, 400]);
  assert.equal((await request('/me', 'GET', undefined, alice.token)).points, config.signPoints);
  assert.equal((await request('/ledger', 'GET', undefined, alice.token)).length, 1);
  assert.deepEqual(await request('/ledger', 'GET', undefined, bob.token), []);
  await request('/sign', 'POST', {}, bob.token);
  checks.push('并发签到仅入账一次，用户积分明细隔离');
  const reward = await admin('/rewards', 'POST', { name: '最后一件积分商品', points: config.signPoints, stock: 1, enabled: true });
  const redeemed = await Promise.all([alice, bob].map(u => request('/redemptions', 'POST', { rewardId: reward.id }, u.token, null)));
  assert.deepEqual(redeemed.map(r => r.status).sort(), [200, 400]);
  for (const [i, u] of [alice, bob].entries()) {
    const won = redeemed[i].status === 200;
    assert.equal((await request('/me', 'GET', undefined, u.token)).points, won ? 0 : config.signPoints);
    assert.equal((await request('/redemptions', 'GET', undefined, u.token)).length, won ? 1 : 0);
    const ledger = await request('/ledger', 'GET', undefined, u.token);
    assert.equal(ledger.reduce((n, r) => n + r.amount, 0), won ? 0 : config.signPoints);
  }
  assert.equal((await admin('/rewards')).find(r => r.id === reward.id).stock, 0);
  const expensive = await admin('/rewards', 'POST', { name: '积分不足商品', points: config.signPoints + 1, stock: 2, enabled: true });
  await request('/redemptions', 'POST', { rewardId: expensive.id }, bob.token, 400);
  assert.equal((await admin('/rewards')).find(r => r.id === expensive.id).stock, 2);
  checks.push('并发兑换最后一件不超卖，积分不足和失败兑换不扣款');

  const upload = await admin('/upload', 'POST', { name: 'audit.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' });
  createdFiles.push(path.join(root, upload.url.slice(1)));
  await admin('/assets/' + upload.id, 'PUT', {}, 405);
  await admin('/config', 'PUT', { customerQr: upload.url });
  await admin('/assets/' + upload.id, 'DELETE', undefined, 409);
  await admin('/config', 'PUT', { customerQr: '' });
  await admin('/products/' + product.id, 'PUT', { image: upload.url });
  const order = await request('/orders', 'POST', { productId: product.id, spec: 'single', quantity: 1, storeId: catalogue.stores[0].id }, alice.token);
  await admin('/products/' + product.id, 'PUT', { image: product.image });
  await admin('/assets/' + upload.id, 'DELETE', undefined, 409);
  assert.ok(fs.existsSync(createdFiles[0]));
  const unused = await admin('/upload', 'POST', { name: 'unused.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' });
  createdFiles.push(path.join(root, unused.url.slice(1)));
  await admin('/assets/' + unused.id, 'DELETE');
  assert.equal(fs.existsSync(createdFiles[1]), false);
  checks.push('图片删除保护配置和历史订单，仅删除未使用资源');

  await admin('/orders/' + order.id + '/action', 'POST', { action: 'confirmPayment', note: '隔离测试，不涉及真实收款' });
  await admin('/config', 'PUT', { appointmentTimes: '00:00,09:00' });
  const booking = { orderId: order.id, date: beijingDate(Date.now()), time: '00:00' };
  await request('/appointments', 'POST', booking, alice.token, 400);
  await request('/appointments', 'POST', { ...booking, date: '2026-02-30' }, alice.token, 400);
  const next = { ...booking, date: beijingDate(Date.now() + 86400000), time: '09:00' };
  const reservations = await Promise.all([1, 2].map(() => request('/appointments', 'POST', next, alice.token, null)));
  assert.deepEqual(reservations.map(r => r.status).sort(), [200, 400]);
  assert.equal((await request('/appointments', 'GET', undefined, alice.token)).length, 1);
  checks.push('北京时间已过时段和无效日期被拒绝，重复预约仅创建一次');
  console.log(JSON.stringify({ ok: true, storage: testDatabase ? 'mysql' : 'json', scenarios: checks.length, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
  for (const file of createdFiles) fs.rmSync(file, { force: true });
  fs.rmSync(temp, { recursive: true, force: true });
});
