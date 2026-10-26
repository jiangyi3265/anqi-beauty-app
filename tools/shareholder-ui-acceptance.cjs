// 真实组件 + 本地构建 + 模拟接口。所有远程请求均被拦截，不访问线上。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')] }));
const root = path.resolve(__dirname, '..'), admin = path.resolve(root, '../anqi-beauty-admin');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'shareholder-ui-'));
const harness = path.join(admin, 'shareholder-preview.local.html');
const rule = { enabled: true, activatedAt: '2026-10-26', revision: 1, settleTime: '23:00', plans: [{ id: 'one', name: '标准方案', units: 1, enabled: true }] };
const member = { id: 'ui-member', name: '测试会员', memberRevision: 0, points: 3210, canShare: true, trialQuota: { limit: 3, used: 0, booked: 0, remaining: 3 } };
const dailyPool = { date: '2026-10-26', enabled: true, amount: 5000, personalAmount: 1250, status: 'pending', revision: 1 };
const program = { rule, today: dailyPool, members: [{ userId: member.id }], totalUnits: 4, pools: [], transfers: [], transferReady: false };
let server, vite, browser, harnessCreated = false;
async function main() {
  assert.ok(!fs.existsSync(harness), '预览文件已存在，拒绝覆盖');
  fs.writeFileSync(harness, `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:20px"><div id="app"></div><script type="module">
    import {createApp,ref,h} from 'vue'; import ElementPlus from 'element-plus'; import 'element-plus/dist/index.css';
    import Program from '/src/views/anqi/earnings/ShareholderProgram.vue'; import Dialog from '/src/views/anqi/users/ShareholderDialog.vue';
    createApp({setup(){const open=ref(false);return ()=>h('main',[h(Program,{canEdit:true}),h('button',{onClick:()=>open.value=true},'打开认证'),open.value?h(Dialog,{member:${JSON.stringify(member)},onClose:()=>open.value=false}):null])}}).use(ElementPlus).mount('#app');
  </script></body></html>`);
  harnessCreated = true;
  const { createServer } = await import(pathToFileURL(path.join(admin, 'node_modules/vite/dist/node/index.js')).href);
  vite = await createServer({ root: admin, configFile: path.join(admin, 'vite.config.js'), server: { host: '127.0.0.1', port: 0, open: false } });
  await vite.listen();
  const adminBase = 'http://127.0.0.1:' + vite.httpServer.address().port;
  const dist = path.join(root, 'dist/build/h5');
  server = http.createServer((req, res) => {
    const target = path.resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!target.startsWith(dist + path.sep) && target !== dist) { res.writeHead(403); return res.end(); }
    const file = target === dist || fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, 'index.html') : target;
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const miniBase = 'http://127.0.0.1:' + server.address().port;
  const seed = require('../server/seed.cjs')();
  const service = { id: 'trial-ui', name: '测试体验项目', subtitle: '每次选一个即可预约', image: '', kind: 'service', trial: true, trialOnly: true, enabled: true, status: 'published', stock: 10, price: 100 };
  const ordinary = { ...service, id: 'paid-ui', trial: false, trialOnly: false, categoryId: 'category-featured' };
  const order = { id: 'paid-order', userId: member.id, product: ordinary, status: 'ready', paymentStatus: 'paid', total: 100, quantity: 1, storeId: seed.stores[0].id, createdAt: '2026-10-26T09:00:00Z' };
  const blankStore = { ...seed.stores[0], id: 'store-no-image', name: '无图门店', image: '', gallery: [], phone: '' };
  const bootstrap = { ...seed, stores: [...seed.stores, blankStore], products: [service, ordinary], config: { ...seed.config, storeDefaultImage: '', shareholderProgram: rule }, dailyPool, paymentMode: 'off' };
  const mocks = { '/bootstrap': bootstrap, '/me': member, '/auth/refresh': { expiresAt: Date.now() + 3600000 }, '/orders': [order], '/orders/paid-order': order, '/claims': [], '/appointments': [], '/appointment-options': { scheduled: false, slots: [{ time: '18:00', remaining: 1 }], durationMinutes: 60 }, '/addresses': [], '/earnings': [], '/ledger': [], '/shares': [], '/redemptions': [], '/rewards': [], '/activities': [], '/alliances': [], '/subscriptions': { templates: [] }, '/share-code': { code: 'ABCDEFGH', image: '' }, '/earnings-summary': { total: 100, static: 100, dynamic: 0, pending: 0, paidOut: 0, available: 100, dailyPool, plans: [{ id: 'plan-ui', name: '测试收益计划', status: 'active', type: 'static', posted: 0, periods: 1, amount: 100, nextAt: '2026-11-01' }], payouts: [], transfers: [] } };
  const customerPages = [
    ['home', '', '在线预约'], ['mall', '', '商城'], ['discover', '', '积分商城'],
    ['product', '?id=paid-ui', '测试体验项目'], ['gifts', '?type=trial', '预约这个项目'], ['gifts', '?type=vip', '联系门店开通'],
    ['checkout', '?id=paid-ui', '门店收银'], ['orders', '', '预约服务'], ['order-detail', '?id=paid-order', '预约服务'],
    ['appointments', '', '待预约'], ['booking', '?orderId=paid-order', '选择日期'],
    ['mine', '', '今日公共积分池'], ['share', '', '我的邀请码'], ['earnings', '', '今日分配'],
    ['sign', '', '立即签到'], ['points', '', '兑换积分'], ['redemptions', '', '暂无兑换记录'],
    ['stores', '', '找到你的美肤空间'], ['activities', '', '暂无进行中的活动'], ['alliances', '', '暂无合作商家'],
    ['profile', '', '姓名'], ['addresses', '', '还没有收货地址'], ['address-edit', '', '保存地址'],
    ['shares', '', '还没有邀请记录'], ['login', '', '微信一键登录'], ['about', '', '小程序版本'],
    ['legal', '?type=agreement', '用户服务协议'], ['legal', '?type=privacy', '隐私政策'], ['legal', '?type=pointsRules', '积分规则']
  ];
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const writes = [], errors = [];
  for (const width of [320, 375, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 812 } });
    await context.addInitScript(() => localStorage.setItem('token', 'local-ui-token'));
    await context.route('**/*', route => {
      const uri = new URL(route.request().url()), pathname = uri.pathname.replace(/^\/api/, '');
      if (uri.pathname.startsWith('/api/')) {
        if (route.request().method() === 'POST') writes.push({ path: pathname, body: route.request().postDataJSON() });
        const value = mocks[pathname];
        return route.fulfill({ status: value === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(value ?? { error: 'missing mock' }) });
      }
      return uri.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    for (const [name, query, text] of customerPages) {
      await page.goto(miniBase + '/?screen=' + encodeURIComponent(name + query + width) + '#/pages/' + name + '/index' + query);
      await page.getByText(text, { exact: false }).first().waitFor();
      await page.locator('.xr-screen[data-loading="false"]').waitFor();
      await page.waitForTimeout(300);
      const screenName = name + (query ? '-' + query.slice(1).replace(/[^a-z0-9]+/gi, '-') : '');
      await page.screenshot({ path: path.join(output, `${screenName}-${width}.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      assert.equal(overflow, false, name + ' horizontal overflow at ' + width);
      if (name === 'home') {
        assert.equal(await page.locator('.xr-home-entry-grid .xr-home-entry').count(), 3);
        await page.locator('.xr-quick').filter({ hasText: '贵宾卡' }).click();
        await page.getByText('联系门店开通', { exact: true }).waitFor();
        await page.goto(miniBase + '/?screen=home-return-' + width + '#/pages/home/index');
        await page.locator('.xr-home-booking').click();
        await page.waitForURL('**/pages/appointments/index');
      }
      if (name === 'mall') assert.ok(await page.locator('.xr-catalogue-row').count());
      if (name === 'stores') {
        assert.equal(await page.locator('.xr-store-card').count(), 2);
        assert.equal(await page.locator('.xr-store-card .xr-store-photo').count(), 1);
      }
      if (name === 'discover') {
        assert.equal(await page.getByText('兑换记录', { exact: true }).count(), 1);
        await page.locator('.xr-page-discover .xr-menu-row').filter({ hasText: '百业联盟' }).click();
        await page.waitForURL('**/pages/alliances/index');
      }
      if (name === 'orders') {
        await page.locator('.xr-order-card .xr-order-actions .xr-button-primary').click();
        await page.waitForURL('**/pages/order-detail/index?id=paid-order');
      }
      if (name === 'order-detail') {
        await page.locator('.xr-dock .xr-button-primary').click();
        await page.waitForURL('**/pages/appointments/index');
      }
      if (name === 'earnings') {
        assert.equal(await page.locator('.xr-income-footnote').count(), 1);
        await page.locator('.xr-income-more').click();
        await page.getByText('收起结算信息', { exact: true }).waitFor();
      }
      if (name === 'gifts' && query.includes('trial')) {
        assert.equal(await page.getByText('确认免费领取', { exact: true }).count(), 0);
        const selection = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/claims');
        await page.getByText('预约这个项目', { exact: true }).click();
        assert.deepEqual((await selection).postDataJSON(), { type: 'trial', productIds: ['trial-ui'] });
      }
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.route('**/*', route => {
    const uri = new URL(route.request().url());
    if (/^\/(?:dev-api\/|prod-api\/)?anqi\//.test(uri.pathname)) {
      if (route.request().method() === 'POST') writes.push({ path: uri.pathname, body: route.request().postDataJSON() });
      const value = uri.pathname.endsWith('/orders') ? [{ id: 'proof', userId: member.id, number: 'TEST', product: { name: '普通项目' }, total: 100, paymentStatus: 'paid', status: 'ready' }] : program;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 200, data: value }) });
    }
    return uri.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(adminBase + '/shareholder-preview.local.html');
  await page.getByRole('button', { name: '保存今日总额', exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(writes.some(w => w.path.endsWith('/shareholders/pool') && w.body.amount === 5000));
  await page.getByText('方案与结算设置', { exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).waitFor({state:'visible'});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(output, 'admin-settings.png'), fullPage: true });
  await page.locator('.el-table .el-input-number input').fill('2');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(writes.some(w => w.path.endsWith('/shareholders/program') && w.body.plans[0].units === 2));
  await page.getByRole('button', { name: '打开认证', exact: true }).click();
  await page.locator('.el-dialog .el-select').nth(1).click();
  await page.getByRole('option', { name: '标准方案 · 1份' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(output, 'admin-certification.png'), fullPage: true });
  await page.getByRole('button', { name: '确认认证', exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(writes.some(w => w.path.endsWith('/shareholders/member') && w.body.approved === true && w.body.orderId === 'proof' && w.body.planId === 'one'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, output, checks: [`3 mobile widths / ${customerPages.length} customer page states`, 'home, alliance and paid order appointment routes', 'VIP gift eligibility and earnings detail disclosure', 'single-project action', 'admin amount save', 'certification with own proof + plan', 'no JS errors or horizontal page overflow'] }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (harnessCreated && fs.existsSync(harness)) fs.unlinkSync(harness);
});
