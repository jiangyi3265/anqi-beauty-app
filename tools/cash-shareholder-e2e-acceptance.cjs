// 真实页面组件联动本地业务服务；临时数据、模拟微信身份，浏览器禁止访问外网。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')] }));

const root = path.resolve(__dirname, '..'), adminRoot = path.resolve(root, '../anqi-beauty-admin');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cash-shareholder-e2e-'));
const file = path.join(output, 'db.json'), secret = crypto.randomUUID();
const harness = path.join(adminRoot, 'cash-shareholder-preview.local.html');
const tiers = [6980, 13800, 26800, 49800, 99800, 199800];
const dayOne = '2026-10-28', dayTwo = '2026-10-29';
const checks = [], errors = [], browserWrites = [];
let child, base, staticServer, vite, browser, harnessCreated = false;
const testEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(WECHAT_|DB_|NODE_OPTIONS$|ANQI_TEST_|DATA_FILE$)/.test(key) && !/_TEST_DB_NAME$/.test(key)));

async function request(route, method = 'GET', body, token, admin = false, expected = 200, extra = {}) {
  assert.equal(new URL(base).hostname, '127.0.0.1');
  const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json',
    ...(token ? { authorization: 'Bearer ' + token } : {}), ...(admin ? { 'x-anqi-internal': secret } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(value)}`);
  return value;
}
const admin = (route, method = 'GET', body, expected = 200) => request('/admin/' + route, method, body, '', true, expected);
const me = user => request('/me', 'GET', undefined, user.token);
const summary = user => request('/earnings-summary', 'GET', undefined, user.token);
async function stopServer() {
  if (child && child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
}
async function startServer(at) {
  await stopServer();
  const socket = net.createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}/api`;
  child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-clock.cjs'), 'server/index.cjs'], { cwd: root,
    env: { ...testEnv, DATA_FILE: file, DB_NAME: '', HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test',
      ANQI_TEST_CLOCK_OFFSET_MS: String(Date.parse(at) - Date.now()), WECHAT_MOCK: 'true', WECHAT_APPID: 'wxmocktest00000000',
      WECHAT_APPSECRET: '', WECHAT_TRANSFER_ENABLED: 'false', DEMO_MODE: 'false', PAYMENT_MODE: 'off', ADMIN_PASSWORD: secret, INTERNAL_SECRET: secret },
    stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', value => { stderr += value });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(stderr);
    try { if ((await fetch(base + '/health')).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Local server did not start: ' + stderr);
}
async function login(name) {
  const user = await request('/auth/wechat', 'POST', { code: name + '-' + crypto.randomUUID() });
  await request('/me', 'PUT', { name }, user.token);
  return user;
}
function orderBody(productId) {
  return { productId, spec: 'single', quantity: 1, storeId: 'store-1', paymentChoice: 'offline',
    ...(productId.startsWith('audit-package-') ? { packageSelection: { planId: 'audit-plan', groups: {} } } : {}) };
}
async function buy(user, productId) {
  const order = await request('/orders', 'POST', orderBody(productId), user.token);
  await admin('orders/' + order.id, 'POST', { action: 'confirmPayment', confirmed: true });
  return order;
}
async function certify(user, order, price) {
  await admin('shareholders/member', 'POST', { userId: user.user.id, orderId: order.id, planId: 'package-' + price,
    approved: true, revision: (await me(user)).memberRevision || 0 });
}
async function bind(user, inviter) {
  const code = await request('/share-code', 'GET', undefined, inviter.token);
  assert.ok(code.code);
  const result = await request('/invite/bind', 'POST', { invite: code.code }, user.token);
  assert.equal(result.user.inviterId, inviter.user.id);
}
async function bridge(context, isAdmin) {
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const match = isAdmin ? url.pathname.match(/^\/(?:dev-api\/|prod-api\/)?anqi\/(.*)$/) : url.pathname.match(/^\/api\/(.*)$/);
    if (match) {
      const routePath = (isAdmin ? '/admin/' : '/') + match[1] + url.search;
      if (req.method() !== 'GET') browserWrites.push({ path: routePath, body: req.postDataJSON() });
      const response = await fetch(base + routePath, { method: req.method(), headers: { 'content-type': 'application/json',
        ...(isAdmin ? { 'x-anqi-internal': secret } : { authorization: req.headers().authorization || '' }),
        ...(req.headers()['idempotency-key'] ? { 'idempotency-key': req.headers()['idempotency-key'] } : {}) },
        body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData() });
      const value = await response.json();
      return route.fulfill({ status: isAdmin ? 200 : response.status, contentType: 'application/json',
        body: JSON.stringify(isAdmin ? { code: response.status === 200 ? 200 : response.status, data: value, msg: value.error } : value) });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
}
async function startPages() {
  assert.ok(!fs.existsSync(harness), 'Refuse to overwrite existing harness');
  fs.writeFileSync(harness, `<html><body><div id="app"></div><script type="module">
    import {createApp,ref,h,onMounted} from 'vue';import {createPinia} from 'pinia';
    import {createRouter,createMemoryHistory} from 'vue-router';import ElementPlus from 'element-plus';import 'element-plus/dist/index.css';
    import Management from '/src/views/anqi/Management.vue';import Program from '/src/views/anqi/earnings/ShareholderProgram.vue';
    import Dialog from '/src/views/anqi/users/ShareholderDialog.vue';import useUserStore from '/src/store/modules/user.js';import request from '/src/utils/request.js';
    const pinia=createPinia();useUserStore(pinia).permissions=['*:*:*'];const query=new URLSearchParams(location.search);
    const app=createApp({setup(){const member=ref(null),closed=ref(false);onMounted(async()=>{if(query.get('mode')==='cert')member.value=(await request({url:'/anqi/users'})).data.find(u=>u.id===query.get('user'));});
      return()=>query.get('mode')==='pool'?h(Program,{canEdit:true}):query.get('mode')==='cert'?(closed.value?h('p','认证已保存'):member.value?h(Dialog,{member:member.value,onClose:()=>closed.value=true}):h('p','加载中')):h(Management,{resource:'orders'});}});
    app.use(pinia).use(createRouter({history:createMemoryHistory(),routes:[]})).use(ElementPlus).mount('#app');
    </script></body></html>`);
  harnessCreated = true;
  const { createServer } = await import(pathToFileURL(path.join(adminRoot, 'node_modules/vite/dist/node/index.js')).href);
  vite = await createServer({ root: adminRoot, configFile: path.join(adminRoot, 'vite.config.js'), server: { host: '127.0.0.1', port: 0, open: false } });
  await vite.listen();
  const dist = path.join(root, 'dist/build/h5');
  staticServer = http.createServer((req, res) => {
    const uri = new URL(req.url, 'http://localhost'), target = path.resolve(dist, '.' + decodeURIComponent(uri.pathname));
    if (!target.startsWith(dist + path.sep) && target !== dist) { res.writeHead(403); return res.end(); }
    const source = target === dist ? path.join(target, 'index.html') : target;
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' }[path.extname(source)] || 'application/octet-stream');
    fs.createReadStream(source).pipe(res);
  }).listen(0, '127.0.0.1'); await once(staticServer, 'listening');
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  return { customerBase: 'http://127.0.0.1:' + staticServer.address().port,
    adminBase: 'http://127.0.0.1:' + vite.httpServer.address().port + '/cash-shareholder-preview.local.html' };
}
async function main() {
  const db = require('../server/seed.cjs')();
  db.config.poolReward = { enabled: false }; db.config._trialDeviceCatalogV2 = true;
  db.products.push(...tiers.map(price => ({ id: 'audit-package-' + price, name: '隔离测试方案' + price, price,
    categoryId: 'category-featured', kind: 'service', status: 'published', enabled: true, stock: 100, sold: 0,
    packagePlans: [{ id: 'audit-plan', name: '隔离护理方案', services: [{ id: 'care', name: '隔离护理', total: 3 }], groups: [] }] })),
    { id: 'audit-service', name: '隔离测试3980项目', price: 3980, kind: 'service', categoryId: 'category-featured', status: 'published', enabled: true, stock: 100, sold: 0 });
  fs.writeFileSync(file, JSON.stringify(db));
  await startServer(dayOne + 'T10:00:00+08:00');
  const rule = (await admin('shareholders')).rule;
  await admin('shareholders/program', 'POST', { ...rule, enabled: true, settleTime: '23:00' });
  const referral = (await admin('incomeRules')).referral;
  await admin('incomeRules/referral', 'PUT', { ...referral, enabled: true, firstPercent: 50, laterPercent: 10, requireCard: true });
  const a = await login('隔离会员A'), b = await login('隔离会员B'), c = await login('隔离会员C');
  assert.equal((await request('/share-code', 'GET', undefined, a.token)).locked, true);
  const { customerBase, adminBase } = await startPages();
  const customerContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await customerContext.addInitScript(token => localStorage.setItem('token', token), a.token);
  await bridge(customerContext, false);
  const customerPage = await customerContext.newPage(); customerPage.on('pageerror', e => errors.push(e.message));
  await customerPage.clock.setFixedTime(new Date(dayOne + 'T10:00:00+08:00'));
  await customerPage.goto(customerBase + '/#/pages/checkout/index?id=audit-package-6980&quantity=1');
  await customerPage.locator('.xr-screen[data-loading="false"]').waitFor();
  await customerPage.getByText('现金支付（门店收银，可扫码付款）', { exact: true }).waitFor();
  await customerPage.getByText('提交订单', { exact: true }).click();
  await customerPage.waitForURL('**/pages/order-detail/index?id=*');
  await customerPage.locator('.xr-screen[data-loading="false"]').waitFor();
  const first = (await admin('orders')).find(o => o.userId === a.user.id);
  assert.equal(first.paymentChoice, 'offline'); assert.equal(first.status, 'pending');
  await customerPage.getByText('现金支付', { exact: true }).click();
  await customerPage.getByText('门店在后台点击通过并确认收款后', { exact: false }).waitFor();
  await customerPage.screenshot({ path: path.join(output, 'cash-payment-dialog.png'), fullPage: true });
  assert.equal((await admin('orders')).find(o => o.id === first.id).status, 'pending');
  await admin('shareholders/member', 'POST', { userId: a.user.id, orderId: first.id, planId: 'package-6980', approved: true, revision: 0 }, 400);
  await request('/admin/orders/' + first.id, 'POST', { action: 'confirmPayment', confirmed: true }, a.token, false, 403);
  await admin('orders/' + first.id, 'POST', { action: 'confirmPayment' }, 400);

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await bridge(adminContext, true);
  const adminPage = await adminContext.newPage(); adminPage.on('pageerror', e => errors.push(e.message));
  await adminPage.goto(adminBase);
  await adminPage.getByRole('button', { name: '通过并确认付款', exact: true }).click();
  await adminPage.getByText('已确认付款', { exact: true }).waitFor();
  const paid = (await admin('orders')).find(o => o.id === first.id);
  assert.equal(paid.paymentStatus, 'paid'); assert.equal(paid.paymentMode, 'offline'); assert.equal(paid.status, 'ready');
  assert.equal((await request('/share-code', 'GET', undefined, a.token)).locked, true);
  const soldBefore = (await admin('products')).find(p => p.id === paid.productId).sold;
  await admin('orders/' + first.id, 'POST', { action: 'confirmPayment', confirmed: true }, 400);
  assert.equal((await admin('products')).find(p => p.id === paid.productId).sold, soldBefore);
  await customerPage.goto(customerBase + '/?paid=1#/pages/order-detail/index?id=' + first.id);
  await customerPage.getByText('预约服务', { exact: true }).waitFor();
  await customerPage.screenshot({ path: path.join(output, 'paid-order.png'), fullPage: true });
  checks.push('页面现金下单→弹付款说明→后台按钮确认→订单可预约；未付款不能认证，顾客不能确认收款，重复确认不重复增加销量');

  await adminPage.goto(adminBase + '?mode=cert&user=' + a.user.id);
  await adminPage.getByText('6980元方案 · 1份', { exact: true }).waitFor();
  await adminPage.getByRole('button', { name: '确认认证', exact: true }).click();
  await adminPage.getByText('认证已保存', { exact: true }).waitFor();
  assert.equal((await me(a)).canShare, true);
  await bind(b, a);
  const one = await buy(b, 'audit-service'), two = await buy(b, 'audit-service');
  assert.equal((await summary(a)).dynamic, 1990 + 398);
  assert.equal((await me(b)).canShare, false);
  const bOrder = await buy(b, 'audit-package-13800'); await certify(b, bOrder, 13800);
  const aBeforeIndirect = (await summary(a)).dynamic;
  await bind(c, b); const indirect = await buy(c, 'audit-service');
  assert.equal((await summary(a)).dynamic, aBeforeIndirect);
  assert.equal((await summary(b)).dynamic, 1990); assert.equal((await me(c)).canShare, false);
  assert.equal((await admin('shares')).filter(s => s.userId === a.user.id && s.memberId === b.user.id).length, 1);
  checks.push('买方案后仍无分享权，后台认证才解锁；已有普通账号自动首次绑定；3980首单奖励1990、复购398；下一级付款不奖励上上级');

  const members = [{ user: a, order: first }, { user: b, order: bOrder }];
  for (const price of tiers.slice(2)) {
    const user = await login('隔离会员' + price), order = await buy(user, 'audit-package-' + price);
    await certify(user, order, price); members.push({ user, order });
  }
  assert.equal((await admin('shareholders')).totalUnits, 63);
  await adminPage.goto(adminBase + '?mode=pool');
  const input = adminPage.locator('.daily input'); await input.fill('6300');
  await adminPage.getByRole('button', { name: '保存今日总额', exact: true }).click();
  await adminPage.getByText('已保存，当日生效', { exact: true }).waitFor();
  assert.equal((await request('/bootstrap')).dailyPool.amount, 6300);
  assert.equal((await summary(c)).dailyPool.personalAmount, 0);
  for (let i = 0; i < members.length; i++) assert.equal((await summary(members[i].user)).dailyPool.personalAmount, 100 * 2 ** i);
  await customerPage.goto(customerBase + '/#/pages/mine/index');
  await customerPage.getByText('VIP积分池', { exact: true }).waitFor();
  await customerPage.locator('.xr-daily-pool .xr-stat-value').filter({ hasText: '6,300' }).waitFor();
  await customerPage.screenshot({ path: path.join(output, 'vip-pool-before-settlement.png'), fullPage: true });
  await admin('shareholders/pool', 'POST', { date: dayOne, amount: 1, revision: 0 }, 400);
  await admin('shareholders/pool', 'POST', { date: dayOne, amount: -1, revision: 1 }, 400);
  await admin('shareholders/pool', 'POST', { date: dayOne, amount: 0.001, revision: 1 }, 400);
  await startServer(dayOne + 'T23:00:01+08:00');
  for (let i = 0; i < members.length; i++) assert.equal((await summary(members[i].user)).static, 100 * 2 ** i);
  const firstHistory = (await admin('earnings')).filter(e => e.source === 'shareholder');
  assert.equal(firstHistory.length, 6); assert.equal(firstHistory.reduce((sum, e) => sum + e.amountCents, 0), 630000);
  await summary(a); assert.equal((await admin('earnings')).filter(e => e.source === 'shareholder').length, 6);
  await admin('shareholders/pool', 'POST', { date: dayOne, amount: 500, revision: 1 }, 400);
  checks.push('后台录入6300积分→小程序显示6300→63份分别分100/200/400/800/1600/3200；非法金额、旧版本覆盖、结算后改账均拒绝；重复结算不重复入账');

  const points = (await me(a)).points;
  await startServer(dayTwo + 'T00:00:01+08:00');
  assert.equal((await request('/bootstrap')).dailyPool.amount, 0); assert.equal((await summary(a)).dailyPool.personalAmount, 0);
  assert.equal((await summary(a)).static, 100); assert.equal((await me(a)).points, points);
  // 页面每次进入都会续期登录；时间跳转前按同一接口模拟第二天重新打开页面。
  for (const user of [...members.map(row => row.user), c]) await request('/auth/refresh', 'POST', {}, user.token);
  const cOrder = await buy(c, 'audit-package-6980'); await certify(c, cOrder, 6980);
  await admin('shareholders/pool', 'POST', { date: dayTwo, amount: 6400, revision: 0 });
  await startServer(dayTwo + 'T23:00:01+08:00');
  assert.equal((await summary(c)).static, 100); assert.equal((await summary(a)).static, 200);
  const pools = (await admin('shareholders')).pools;
  assert.equal(pools.find(p => p.date === dayTwo).totalUnits, 64);
  assert.equal(pools.find(p => p.date === dayTwo).allocations.length, 7);
  assert.deepEqual((await admin('earnings')).filter(e => firstHistory.some(old => old.id === e.id)), firstHistory);
  checks.push('北京时间跨日池归零且个人积分、历史收益保留；次日加入1份会员，老会员与新会员共64份分6400，旧账不重算');

  await admin('orders/' + two.id, 'POST', { action: 'refund', refundConfirmed: true, refundAmount: two.total,
    refundedAt: dayTwo + 'T23:00:01+08:00', refundMethod: '隔离现金', refundReference: 'TEST-' + two.id, note: '隔离验收退款' });
  assert.equal((await summary(a)).dynamic, aBeforeIndirect - 398);
  const last = members.at(-1);
  await admin('orders/' + last.order.id, 'POST', { action: 'refund', refundConfirmed: true, refundAmount: last.order.total,
    refundedAt: dayTwo + 'T23:00:01+08:00', refundMethod: '隔离现金', refundReference: 'TEST-' + last.order.id, note: '隔离验收资格退款' });
  assert.equal((await me(last.user)).canShare, false); assert.equal((await admin('shareholders')).totalUnits, 32);
  assert.equal((await summary(last.user)).static, 6400);
  const pending = await request('/orders', 'POST', orderBody('audit-service'), c.token);
  const stockAfterOrder = (await admin('products')).find(p => p.id === 'audit-service').stock;
  await request('/auth/refresh', 'POST', {}, c.token);
  await startServer('2026-10-30T02:00:02+08:00');
  assert.equal((await request('/orders/' + pending.id, 'GET', undefined, c.token)).status, 'cancelled');
  assert.equal((await admin('products')).find(p => p.id === 'audit-service').stock, stockAfterOrder + 1);
  assert.equal((await admin('shareholders')).transfers.length, 0);
  assert.deepEqual(errors, []);
  assert.ok(browserWrites.some(w => w.path === '/orders' && w.body.paymentChoice === 'offline'));
  assert.ok(browserWrites.some(w => w.path === '/admin/orders/' + first.id && w.body.confirmed === true));
  checks.push('退款只冲回对应推荐奖励；认证套餐退款停止后续资格但保留已结算历史；未付款超2小时取消并恢复库存；未生成真实转账');
  const report = { ok: true, output, checks, isolation: 'localhost only; temporary JSON data; mocked WeChat identity; transfers disabled',
    browserWriteCount: browserWrites.length, firstDay: { pool: 6300, units: 63 }, secondDay: { pool: 6400, units: 64 } };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error); console.error('Artifacts: ' + output); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (staticServer) await new Promise(resolve => staticServer.close(resolve));
  await stopServer();
  if (harnessCreated) fs.unlinkSync(harness);
});
