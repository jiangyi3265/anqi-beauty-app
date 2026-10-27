// 使用真实组件和本地 H5 构建；所有业务接口模拟，禁止访问线上。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')] }));
const root = path.resolve(__dirname, '..'), admin = path.resolve(root, '../anqi-beauty-admin');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-ui-'));
const harness = path.join(admin, 'wallet-preview.local.html');
let browser, server, vite, harnessCreated = false;
async function main() {
  assert.ok(!fs.existsSync(harness), '拒绝覆盖现有预览文件');
  fs.writeFileSync(harness, `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:20px"><div id="app"></div><script type="module">
    import {createApp,h} from 'vue'; import ElementPlus from 'element-plus'; import zhCn from 'element-plus/es/locale/lang/zh-cn'; import 'element-plus/dist/index.css';
    import Wallet from '/src/views/anqi/earnings/WalletProgram.vue';
    createApp({render:()=>h(Wallet,{canEdit:true})}).use(ElementPlus,{locale:zhCn}).mount('#app');
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
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const miniBase = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const errors = [], seed = require('../server/seed.cjs')();
  for (const width of [320, 375, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 812 } });
    await context.addInitScript(() => localStorage.setItem('token', 'local-wallet-ui'));
    const member = { id: 'wallet-ui', name: '测试会员', points: 500 };
    const summary = { walletUserId: member.id, walletEnabled: true, withdrawalReady: true, withdrawalLimits: {min: 0.1, max: 200}, available: 100, transferring: 0, paidOut: 0, total: 100, static: 100, dynamic: 0, pending: 0, transfers: [] };
    const writes = []; let dropped = false;
    const mocks = { '/bootstrap': { ...seed, config: { ...seed.config, shareholderProgram: { enabled: true, fundingMode: 'recharge', activatedAt: '2026-10-26' } } }, '/me': member, '/earnings-summary': summary, '/earnings': [{ id: 'credit', type: 'static', source: 'recharge', amount: 100, createdAt: '2026-10-26T12:00:00Z' }], '/auth/refresh': { expiresAt: Date.now() + 3600000 }, '/orders': [], '/appointments': [], '/claims': [], '/shares': [], '/ledger': [], '/redemptions': [] };
    await context.route('**/*', route => {
      const uri = new URL(route.request().url()), pathname = uri.pathname.replace(/^\/api/, '');
      if (uri.pathname.startsWith('/api/')) {
        if (pathname === '/withdrawals') {
          writes.push(route.request().postDataJSON());
          Object.assign(summary, { available: 0, transferring: 100, transfers: [{ id: 'withdrawal', date: '2026-10-26', amount: 100, statusText: '处理中' }] });
          if (!dropped) { dropped = true; return route.abort(); }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'withdrawal', status: 'processing' }) });
        }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(mocks[pathname] || []) });
      }
      return uri.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(miniBase + '/#/pages/earnings/index');
    await page.locator('.xr-screen[data-loading="false"]').waitFor();
    await page.getByText('充值分红', { exact: true }).waitFor();
    await page.locator('.xr-wallet').getByText('提现', { exact: true }).click();
    await page.locator('.xr-withdraw-sheet').waitFor();
    await page.getByText('单笔可提 0.1—200 元', {exact: true}).waitFor();
    const input = page.locator('.xr-withdraw-input input');
    await input.fill('101');
    await page.getByText('确认提现', { exact: true }).click();
    await page.getByText('请输入不超过可提现余额的金额，最多两位小数', { exact: true }).waitFor();
    assert.equal(writes.length, 0);
    await input.fill('100');
    // UniApp H5 的输入事件会节流，等待一次输入同步后再模拟点击。
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, 'withdraw-' + width + '.png'), fullPage: true });
    const bounds = await page.locator('.xr-withdraw-sheet').boundingBox();
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, '弹窗不超出屏幕');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.getByText('确认提现', { exact: true }).click();
    await page.getByText('查询上次提交结果', { exact: true }).waitFor();
    await page.reload();
    await page.locator('.xr-screen[data-loading="false"]').waitFor();
    // 首次已经提交成功但响应丢失；余额已冻结，仍可恢复原请求。
    await page.getByText('查询上次提现', { exact: true }).click();
    assert.equal(await input.inputValue(), '100');
    assert.equal(await input.isDisabled(), true);
    await page.getByText('查询上次提交结果', { exact: true }).click();
    await page.locator('.xr-withdraw-sheet').waitFor({ state: 'hidden' });
    assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1], '恢复原提现，不能创建第二笔');
    Object.assign(summary, { available: 100, transferring: 0, withdrawalReady: false });
    await page.reload(); await page.locator('.xr-screen[data-loading="false"]').waitFor();
    assert.equal(await page.locator('.xr-wallet').getByText('提现', { exact: true }).evaluate(el => el.hasAttribute('disabled')), true);
    summary.walletEnabled = false;
    await page.reload(); await page.locator('.xr-screen[data-loading="false"]').waitFor();
    assert.equal(await page.locator('.xr-wallet').count(), 0, '未切换模式沿用旧收益页面');
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const wallet = { enabled: false, revision: 1, rechargeReady: true, withdrawalReady: true, pendingLegacy: [{ id: 'old', revision: 1, amount: 6000 }], heldLegacy: [], recharges: [], withdrawals: [] };
  const writes = [];
  await context.route('**/*', route => {
    const uri = new URL(route.request().url());
    if (/^\/(?:dev-api\/|prod-api\/)?anqi\/wallet/.test(uri.pathname)) {
      let result = wallet;
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); writes.push({ path: uri.pathname, body });
        if (uri.pathname.endsWith('/activate')) { wallet.enabled = true; wallet.heldLegacy = wallet.pendingLegacy; wallet.pendingLegacy = []; }
        if (uri.pathname.endsWith('/recharge')) {
          result = { id: 'recharge-ui', number: 'C123456789', amount: body.amount, status: 'awaiting', statusText: '待充值到账', createdAt: '2026-10-26T10:00:00Z', allocations: [], bankAccount: { bank_account_name: '测试收款单位', bank_account_no: '000000000000000000', bank_name: '测试银行' } };
          wallet.recharges = [result];
        }
        if (uri.pathname.endsWith('/sync')) {
          result = wallet.recharges[0];
          Object.assign(result, {status: 'distributed', statusText: '已分配到会员余额', allocations: [{userId: 'member-a', name: '测试分红会员', units: 1, amount: result.amount}]});
        }
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 200, data: result }) });
    }
    return uri.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(adminBase + '/wallet-preview.local.html');
  await page.getByRole('button', { name: '启用充值分配', exact: true }).click();
  await page.locator('.el-message-box').getByRole('button', { name: /确定/ }).click();
  await page.locator('.recharge-form .is-loading').waitFor({state:'hidden'});
  await page.getByRole('button', { name: '创建充值单', exact: true }).click();
  await page.getByText('收款户名：测试收款单位', { exact: true }).waitFor();
  assert.equal(writes.filter(w => w.path.endsWith('/recharge')).length, 1);
  assert.deepEqual(writes[0].body.pending, [{ id: 'old', revision: 1, amount: 6000 }]);
  assert.ok(writes[0].body.confirmed);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
  await page.screenshot({ path: path.join(output, 'admin-recharge.png'), fullPage: true });
  await page.getByRole('button', { name: '核实到账', exact: true }).click();
  await page.getByText('已分配到会员余额', {exact: true}).waitFor();
  await page.getByText('测试分红会员', {exact: true}).waitFor();
  assert.equal(await page.getByText('收款户名：测试收款单位', {exact: true}).count(), 0, '已分配后不继续展示付款指引');
  assert.equal(writes.filter(w => w.path.endsWith('/sync')).length, 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, output, checks: ['320/375/430提现弹窗无横向溢出', '超额拦截、未配置禁用、旧模式页面保留', '提现响应丢失后刷新页面沿用原请求，零可用余额仍可恢复', '后台明确切换、保留旧记录、创建充值单自动展开银行账户、核实到账'] }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (harnessCreated && fs.existsSync(harness)) fs.unlinkSync(harness);
});
