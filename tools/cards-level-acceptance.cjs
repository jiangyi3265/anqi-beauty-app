// 体验卡设置与次数、贵宾卡资格、会员等级、后台开通套餐后的待核销项目、今日营业额与分红记录营业额
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anqi-cards-'));
const file = path.join(dir, 'db.json');
const secret = crypto.randomBytes(24).toString('hex');
const HOUR = 3600000, DAY = 86400000;
const checks = [];
let child, base;

async function startServer(offset = 0) {
  const s = net.createServer().listen(0, '127.0.0.1'); await once(s, 'listening'); const port = s.address().port; await new Promise(r => s.close(r));
  base = `http://127.0.0.1:${port}/api`;
  child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-clock.cjs'), 'server/index.cjs'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ANQI_TEST_CLOCK_OFFSET_MS: String(offset), HOST: '127.0.0.1', PORT: String(port), DATA_FILE: file, DB_NAME: '', NODE_ENV: 'test', DEMO_MODE: 'false', WECHAT_MOCK: 'true', ADMIN_PASSWORD: secret, INTERNAL_SECRET: secret, PAYMENT_MODE: 'off' } });
  let errors = ''; child.stderr.on('data', b => errors += b);
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw Error(errors || '业务服务启动超时');
}
async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
async function req(route, method = 'GET', body, token, expected = 200) {
  const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  assert.equal(r.status, expected, `${method} ${route}: ${JSON.stringify(data)}`); return data;
}
const admin = (route, method = 'GET', body, expected = 200) => fetch(base + '/admin/' + route, { method, headers: { 'content-type': 'application/json', 'x-anqi-internal': secret }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => { const d = await r.json().catch(() => ({})); assert.equal(r.status, expected, `admin ${method} ${route}: ${JSON.stringify(d)}`); return d; });
const login = code => req('/auth/wechat', 'POST', { code: code + '-' + crypto.randomBytes(4).toString('hex') });
const later = days => new Date(Date.now() + 8 * HOUR + days * DAY).toISOString().slice(0, 10);
const selectionFor = product => { const plan = product.packagePlans[0]; return { planId: plan.id, groups: Object.fromEntries(plan.groups.map(g => [g.id, g.services.slice(0, g.pick).map(s => ({ serviceId: s.id, ...(s.options?.length ? { option: s.options[0] } : {}) }))])) }; };

(async () => {
  fs.writeFileSync(file, JSON.stringify(seed()));
  // 测试固定在北京时间当天中午进行，避开午夜前后
  const NOON = Date.parse(new Date(Date.now() + 8 * HOUR).toISOString().slice(0, 10) + 'T12:00:00+08:00') - Date.now();
  await startServer(NOON);
  let boot = await req('/bootstrap');
  assert.equal(boot.config.trialPick, 3); assert.equal(boot.config.trialUses, 1); assert.equal(boot.config.maxGifts, 3);
  checks.push('默认值不改变原行为：体验卡选 3 项、每项 1 次，贵宾卡选 3 项');

  // 1. 设置：体验卡选 2 项、每项 2 次；越界值被拒绝
  await admin('config', 'PUT', { trialPick: 0 }, 400); await admin('config', 'PUT', { trialUses: 51 }, 400);
  await admin('config', 'PUT', { trialPick: 2, trialUses: 2 });
  boot = await req('/bootstrap'); assert.equal(boot.config.trialPick, 2); assert.equal(boot.config.trialUses, 2); assert.equal(boot.config.maxGifts, 3);
  checks.push('后台可单独设置体验卡可选项目数和每项可用次数（1–50），不影响贵宾卡的可选数');

  // 2. 把商城付费项目加入体验卡
  const mall = boot.products.find(p => p.kind === 'service' && !p.trialOnly && !p.trial && !p.packagePlans?.length && (p.memberPrice ?? p.price) > 0 && p.stock > 2);
  const trialOnly = boot.products.find(p => p.trial && p.trialOnly);
  await admin('products/' + mall.id, 'PUT', { trial: true });
  boot = await req('/bootstrap'); assert.ok(boot.products.find(p => p.id === mall.id).trial);
  const stockBefore = boot.products.find(p => p.id === mall.id).stock;
  const alice = await login('cards-alice');
  await req('/claims', 'POST', { type: 'trial', productIds: [trialOnly.id, mall.id, boot.products.find(p => p.trial && p.id !== trialOnly.id && p.id !== mall.id).id] }, alice.token, 400);
  const claim = await req('/claims', 'POST', { type: 'trial', productIds: [trialOnly.id, mall.id] }, alice.token);
  assert.equal(claim.uses, 2);
  boot = await req('/bootstrap'); assert.equal(boot.products.find(p => p.id === mall.id).stock, stockBefore - 1);
  checks.push('商城付费项目勾选“体验卡项目”后可被领取，按设置只能选 2 项，库存扣 1；该项目仍可正常购买');

  // 3. 每项 2 次：同一时间只能有一个预约，核销两次后用完
  const store = boot.stores[0].id;
  const a1 = await req('/appointments', 'POST', { claimId: claim.id, productId: mall.id, storeId: store, date: later(2), time: '10:00' }, alice.token);
  const dup = await req('/appointments', 'POST', { claimId: claim.id, productId: mall.id, storeId: store, date: later(3), time: '10:00' }, alice.token, 400);
  assert.match(dup.error, /已有预约/);
  await admin('appointments/' + a1.id, 'PUT', { status: 'completed' });
  let mine = (await req('/claims', 'GET', undefined, alice.token))[0].products.find(p => p.id === mall.id);
  assert.deepEqual([mine.usesTotal, mine.usesCompleted, mine.usesRemaining, mine.useStatus], [2, 1, 1, 'available']);
  const a2 = await req('/appointments', 'POST', { claimId: claim.id, productId: mall.id, storeId: store, date: later(3), time: '11:00' }, alice.token);
  await admin('appointments/' + a2.id, 'PUT', { status: 'completed' });
  const over = await req('/appointments', 'POST', { claimId: claim.id, productId: mall.id, storeId: store, date: later(4), time: '10:00' }, alice.token, 400);
  assert.match(over.error, /次数已用完/);
  mine = (await req('/claims', 'GET', undefined, alice.token))[0].products.find(p => p.id === mall.id);
  assert.deepEqual([mine.usesRemaining, mine.useStatus], [0, 'completed']);
  checks.push('每项 2 次：同一项目同时只能有一个预约；核销 1 次后剩 1 次可再约；2 次用完后不能再约');

  // 4. 贵宾卡：未开通不能领取，但项目列表是公开的（可浏览）
  const gifts = boot.products.filter(p => p.gift);
  assert.ok(gifts.length >= 3, '公开目录中能看到贵宾卡项目');
  const vipDenied = await req('/claims', 'POST', { type: 'vip', productIds: gifts.slice(0, 3).map(p => p.id) }, alice.token, 400);
  assert.match(vipDenied.error, /受邀/);
  checks.push('贵宾卡项目在公开目录中可浏览；未开通的会员提交领取被拒绝');

  // 5. 会员等级：后台开通套餐（已用部分次数）→ 等级与待核销；再买更高档 → 升级；退款 → 回落
  assert.equal((await req('/me', 'GET', undefined, alice.token)).vipLevel, null);
  const vips = boot.products.filter(p => p.packagePlans?.length).sort((a, b) => (a.memberPrice ?? a.price) - (b.memberPrice ?? b.price));
  const gold = vips[0], platinum = vips[1];
  const before = await admin('users');
  const aliceRow = before.find(u => u.id === alice.user.id);
  const sel = selectionFor(gold);
  const preview = require('../server/vip-packages.cjs').selectPackage(gold, sel);
  const firstService = preview.services[0];
  const granted = await admin('legacyMembers/' + alice.user.id, 'POST', { action: 'grant', requestId: 'grant-' + Date.now(), revision: aliceRow.memberRevision || 0, confirmed: true, note: '门店纸质卡补录', reference: 'PAPER-' + Date.now(), productId: gold.id, storeId: store, total: gold.memberPrice ?? gold.price, paidAt: new Date(Date.now() + NOON - 2 * DAY).toISOString(), incomeTreatment: 'historical', packageSelection: sel, used: { [firstService.id]: 1 } });
  let me = await req('/me', 'GET', undefined, alice.token);
  assert.equal(me.vipLevel?.name, gold.name.replace(/套餐$/, '') + '会员');
  const orders = await req('/orders', 'GET', undefined, alice.token);
  const pkg = orders.find(o => o.id === granted.id);
  assert.equal(pkg.status, 'ready');
  const remaining = pkg.package.services.map(s => s.total - s.used);
  assert.equal(remaining[0], firstService.total - 1); assert.ok(remaining.reduce((n, v) => n + v, 0) > 0);
  checks.push(`后台开通 ${gold.name}（已用 1 次）：会员等级显示“${me.vipLevel.name}”，订单为待使用，剩余次数 = 总次数 − 已用次数`);
  const up = await req('/orders', 'POST', { productId: platinum.id, quantity: 1, spec: 'single', storeId: store, packageSelection: selectionFor(platinum) }, alice.token);
  assert.equal((await req('/me', 'GET', undefined, alice.token)).vipLevel?.name, gold.name.replace(/套餐$/, '') + '会员', '未付款的订单不提升等级');
  await admin('orders/' + up.id, 'POST', { action: 'confirmPayment', note: '门店收款' });
  me = await req('/me', 'GET', undefined, alice.token); assert.equal(me.vipLevel?.name, platinum.name.replace(/套餐$/, '') + '会员');
  await admin('orders/' + up.id, 'POST', { action: 'refund', note: '退卡' });
  me = await req('/me', 'GET', undefined, alice.token); assert.equal(me.vipLevel?.name, gold.name.replace(/套餐$/, '') + '会员');
  checks.push('会员等级取持有中的最高一档：未付款不算，确认收款后升级，整单退款后回落');

  // 6. 今日营业额（工作台）：只算今天确认收款、未退款的订单；历史补录不算
  const bob = await login('cards-bob');
  const o1 = await req('/orders', 'POST', { productId: mall.id, quantity: 1, spec: 'single', storeId: store }, bob.token);
  await admin('orders/' + o1.id, 'POST', { action: 'confirmPayment', note: '现金' });
  const dash = await admin('dashboard');
  assert.equal(dash.todayRevenue, o1.total); assert.equal(dash.todayPaidOrders, 1);
  checks.push(`工作台“今日营业额”= 今天确认收款且未退款的订单合计（${dash.todayRevenue} 元）；退款单和历史补录不计入`);

  // 7. 分红记录写入当日营业额
  const rules = await admin('incomeRules');
  await admin('incomeRules/pool', 'PUT', { ...rules.pool, enabled: true, source: 'revenue', percent: 5, cycle: 'daily', activityDays: 0, startDate: '' });
  await stop();
  const today = new Date(Date.now() + NOON + 8 * HOUR).toISOString().slice(0, 10);
  await startServer(Date.parse(today + 'T00:00:00+08:00') + DAY + HOUR - Date.now());
  const record = (await admin('incomeRules')).poolOverview.settlements[0];
  assert.equal(record.revenueCents, Math.round(o1.total * 100)); assert.equal(record.poolCents, Math.round(o1.total * 5));
  assert.equal(record.members, 1);
  checks.push('不分轮（每轮天数 0）时，所有持卡会员每天都参与；分红记录写入当日营业额，奖池 = 营业额 × 5%');

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
})().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
