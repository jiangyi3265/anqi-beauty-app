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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anqi-trial-booking-'));
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
  // Upgrade the previous trial descriptions without resetting stock or issued records.
  const previous = seed();
  previous.config._trialCatalogSeedV1 = true;
  previous.config._brandVisualAndPricingV3 = true;
  const oldNames = ['水润焕肤体验', '舒缓修护体验', '光感焕亮体验'];
  const oldImages = ['product-salmon-aquatic.jpg', 'product-vitamin-c.jpg', 'product-composite-aqueous.jpg'];
  const oldDescriptions = ['深层补水与肤感提亮', '舒缓肌肤、改善干燥紧绷', '焕亮肤色、改善暗沉'];
  const previousTrials = previous.products.filter(product => product.trialOnly);
  previousTrials.forEach((product, i) => {
    const retiredId = product.id;
    product.id = 'legacy-imported-trial-' + i;
    product.name = oldNames[i];
    product.image = product.detailImage = '/static/brand/' + oldImages[i];
    product.description = '免费体验项目：' + oldDescriptions[i] + '。领取后可选择门店、日期和时间预约使用。';
    product.subtitle = '';
    delete product.referencePrice;
    product.stock = 10 + i;
    product.sold = i;
    previous.products.push({ ...product, id: retiredId, trial: false, trialOnly: false, enabled: false, status: 'offline' });
  });
  previousTrials[0].enabled = false;
  previousTrials[0].status = 'offline';
  previous.claims.push({ id: 'issued-claim', userId: 'previous-user', type: 'trial', productIds: previousTrials.map(product => product.id), products: JSON.parse(JSON.stringify(previousTrials)) });
  previous.appointments.push({ id: 'used-booking', userId: 'previous-user', claimId: 'issued-claim', productId: previousTrials[0].id, name: oldNames[0], storeId: 'store-1', status: 'completed' });
  fs.writeFileSync(file, JSON.stringify(previous));
  await start();
  await request('/bootstrap');
  const updated = (await request('/admin/products', 'GET', undefined, undefined, 200, true)).filter(product => product.trialOnly);
  assert.deepEqual(updated.map(product => product.name), ['9D变脸术', 'AI大师', '超玛吉']);
  assert.deepEqual(updated.map(product => product.id), previousTrials.map(product => product.id));
  assert.deepEqual(updated.map(product => product.referencePrice), [999, 6980, 6980]);
  assert.deepEqual(updated.map(product => product.subtitle), ['单部位', '单部位', '单部位']);
  assert.deepEqual(updated.map(product => product.stock), [10, 11, 12]);
  assert.equal(updated[0].status, 'offline');
  const migratedHistory = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(migratedHistory.claims[0].products[0].name, oldNames[0]);
  assert.equal(migratedHistory.appointments[0].status, 'completed');
  await request('/admin/products/' + updated[1].id, 'PUT', { referencePrice: -1 }, undefined, 400, true);
  await request('/admin/products/' + updated[1].id, 'PUT', { referencePrice: '6980' }, undefined, 400, true);
  await request('/admin/products/' + updated[1].id, 'PUT', { referencePrice: 6666, subtitle: '后台自定义范围', image: '/static/brand/operator-custom.jpg' }, undefined, 200, true);
  await stop();
  await start();
  await request('/bootstrap');
  const customized = (await request('/admin/products', 'GET', undefined, undefined, 200, true)).find(product => product.id === updated[1].id);
  assert.equal(customized.referencePrice, 6666);
  assert.equal(customized.subtitle, '后台自定义范围');
  assert.equal(customized.image, '/static/brand/operator-custom.jpg');
  await stop();

  // Recover a deployed database whose old initialization flag exists but trial products are missing.
  const legacy = seed();
  legacy.products = legacy.products.filter(product => !product.trialOnly);
  legacy.config._trialCatalogSeedV1 = true;
  legacy.orders.push({ id: 'legacy-store-order', userId: 'legacy-user', storeId: 'store-1', status: 'completed' });
  legacy.appointments.push({ id: 'legacy-store-booking', userId: 'legacy-user', storeId: 'store-1', status: 'completed' });
  fs.writeFileSync(file, JSON.stringify(legacy));
  await start();
  const catalogue = await request('/bootstrap');
  const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(migrated.orders.find(row => row.id === 'legacy-store-order').store.address, legacy.stores[0].address);
  assert.equal(migrated.appointments.find(row => row.id === 'legacy-store-booking').store.address, legacy.stores[0].address);
  const trials = catalogue.products.filter(product => product.trialOnly && product.trial);
  assert.equal(trials.length, 3);
  assert.deepEqual(trials.map(product => [product.name, product.subtitle, product.referencePrice]), [['9D变脸术', '单部位', 999], ['AI大师', '单部位', 6980], ['超玛吉', '单部位', 6980]]);
  assert.deepEqual(trials.map(product => product.image), ['/static/brand/trial-9d-face.jpg', '/static/brand/trial-ai-master.jpg', '/static/brand/trial-super-thermage.jpg']);
  assert.ok(trials.every(product => product.kind === 'service' && product.price === 0));
  assert.equal(catalogue.products.find(product => product.id === 'jimeili-collagen-type-iii').price, 498);
  assert.equal(catalogue.products.filter(product => !product.trialOnly).at(-1).id, 'jimeili-rejuvenation-set');
  assert.equal(catalogue.products.find(product => product.id === 'jimeili-ai-light-restart').image, '/static/brand/product-ai-light-restart-v2.jpg');

  const login = code => request('/auth/wechat', 'POST', { code });
  const alice = await login('trial-booking-alice');
  const bob = await login('trial-booking-bob');
  assert.equal(alice.user.invited, false);
  const originalStore = catalogue.stores.find(store => store.id === 'store-1');
  await request('/admin/stores', 'POST', { name: '验收二店', address: '  ' }, undefined, 400, true);
  const branch = await request('/admin/stores', 'POST', { name: '验收二店', address: '验收地址二号', contact: '验收联系人', phone: '13100000002', hours: '10:00—19:00', enabled: true }, undefined, 200, true);
  await request('/admin/stores/' + branch.id, 'PUT', { address: '  验收地址二号二楼  ' }, undefined, 200, true);
  const stores = (await request('/bootstrap')).stores;
  assert.equal(stores.find(store => store.id === branch.id).address, '验收地址二号二楼');
  assert.equal(stores.find(store => store.id === originalStore.id).address, originalStore.address);

  const ids = trials.map(product => product.id);
  await request('/claims', 'POST', { type: 'trial', productIds: ids }, undefined, 401);
  await request('/claims', 'POST', { type: 'trial', productIds: ids.slice(0, 1) }, alice.token, 400);
  await request('/claims', 'POST', { type: 'vip', productIds: ids }, alice.token, 400);
  await request('/orders', 'POST', { productId: ids[0], spec: 'single', quantity: 1, storeId: 'store-1' }, alice.token, 400);
  const claim = await request('/claims', 'POST', { type: 'trial', productIds: ids }, alice.token);
  assert.deepEqual(claim.products.map(product => product.referencePrice), [999, 6980, 6980]);
  await request('/claims', 'POST', { type: 'trial', productIds: ids }, alice.token, 400);
  assert.equal((await request('/orders', 'GET', undefined, alice.token)).length, 0);
  const afterClaim = await request('/bootstrap');
  assert.ok(afterClaim.products.filter(product => ids.includes(product.id)).every(product => product.stock === 99));

  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const booking = (productId, time, claimId = claim.id) => ({ claimId, productId, storeId: 'store-1', date, time });
  await request('/appointments', 'POST', booking(ids[0], '09:00'), bob.token, 404);
  await request('/appointments', 'POST', booking('not-in-claim', '09:00'), alice.token, 400);
  await request('/appointments', 'POST', { claimId: claim.id, productId: ids[0], date, time: '09:00' }, alice.token, 400);
  const first = await request('/appointments', 'POST', booking(ids[0], '09:00'), alice.token);
  await request('/appointments', 'POST', booking(ids[0], '10:00'), alice.token, 400);
  const second = await request('/appointments', 'POST', booking(ids[1], '10:00'), alice.token);
  const products = () => request('/claims', 'GET', undefined, alice.token).then(rows => rows.find(row => row.id === claim.id).products);
  assert.deepEqual((await products()).map(product => product.useStatus), ['booked', 'booked', 'available']);

  const bobClaim = await request('/claims', 'POST', { type: 'trial', productIds: ids }, bob.token);
  await request('/appointments', 'POST', booking(ids[0], '09:00', bobClaim.id), bob.token, 400);
  const otherBranch = await request('/appointments', 'POST', { ...booking(ids[1], '09:00', bobClaim.id), storeId: branch.id }, bob.token);
  assert.equal(first.store.id, originalStore.id);
  assert.equal(first.store.address, originalStore.address);
  assert.equal(otherBranch.store.id, branch.id);
  assert.equal(otherBranch.store.address, '验收地址二号二楼');
  await request('/appointments', 'POST', booking(ids[0], '11:00', bobClaim.id), bob.token);
  const branchOrder = await request('/orders', 'POST', { productId: 'jimeili-ai-light-restart', quantity: 1, spec: 'single', storeId: branch.id, store: originalStore }, bob.token);
  assert.equal(branchOrder.store.id, branch.id);
  assert.equal(branchOrder.store.address, '验收地址二号二楼');
  assert.equal(branchOrder.address, null);
  await request('/admin/orders/' + branchOrder.id, 'POST', { action: 'confirmPayment', note: '隔离验收数据' }, undefined, 200, true);
  await request('/appointments', 'POST', { orderId: branchOrder.id, storeId: originalStore.id, date, time: '14:00' }, bob.token, 400);
  const branchOrderBooking = await request('/appointments', 'POST', { orderId: branchOrder.id, date, time: '14:00' }, bob.token);
  assert.equal(branchOrderBooking.store.id, branch.id);
  assert.equal(branchOrderBooking.store.address, '验收地址二号二楼');
  await request('/admin/stores/' + branch.id, 'PUT', { enabled: false }, undefined, 200, true);
  assert.ok(!(await request('/bootstrap')).stores.some(store => store.id === branch.id));
  await request('/orders', 'POST', { productId: 'jimeili-ai-light-restart', quantity: 1, spec: 'single', storeId: branch.id }, bob.token, 400);
  await request('/appointments', 'POST', { ...booking(ids[2], '15:00', bobClaim.id), storeId: branch.id }, bob.token, 400);
  await request('/admin/stores/' + branch.id, 'DELETE', undefined, undefined, 200, true);
  assert.equal((await request('/orders/' + branchOrder.id, 'GET', undefined, bob.token)).store.address, '验收地址二号二楼');
  assert.equal((await request('/appointments', 'GET', undefined, bob.token)).find(row => row.id === otherBranch.id).store.address, '验收地址二号二楼');

  const adminRows = await request('/admin/appointments', 'GET', undefined, undefined, 200, true);
  assert.ok(adminRows.some(row => row.claimId === claim.id && row.productId === ids[0]));

  await request('/admin/appointments/' + first.id, 'PUT', { status: 'cancelled' }, undefined, 200, true);
  assert.equal((await products()).find(product => product.id === ids[0]).useStatus, 'available');
  const rebooked = await request('/appointments', 'POST', booking(ids[0], '14:00'), alice.token);
  await request('/admin/appointments/' + second.id, 'PUT', { status: 'completed' }, undefined, 200, true);
  assert.equal((await products()).find(product => product.id === ids[1]).useStatus, 'completed');
  await request('/appointments', 'POST', booking(ids[1], '15:00'), alice.token, 400);
  const third = await request('/appointments', 'POST', booking(ids[2], '15:00'), alice.token);
  for (const appointment of [rebooked, third]) await request('/admin/appointments/' + appointment.id, 'PUT', { status: 'completed' }, undefined, 200, true);
  assert.ok((await products()).every(product => product.useStatus === 'completed'));

  // Once migrated, bootstrap and restart must preserve operator changes and consumed stock.
  await request('/admin/products/' + ids[0], 'PUT', { status: 'offline', stock: 0 }, undefined, 200, true);
  await stop();
  await start();
  await request('/bootstrap');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.config._trialCatalogSeedV2, true);
  assert.equal(saved.products.find(product => product.id === ids[0]).stock, 0);
  assert.equal(saved.products.find(product => product.id === ids[0]).status, 'offline');
  assert.equal(saved.products.find(product => product.id === ids[1]).stock, 98);
  assert.equal(saved.claims.filter(row => row.userId === alice.user.id).length, 1);
  console.log(JSON.stringify({ ok: true, checks: ['legacy catalogue recovery', 'three free trial services with correct posters, scope and reference values', 'old trial content migrates without resetting stock or history', 'admin reference value and scope survive restart', 'ordinary member claim', 'claim quota and one-time limit', 'no purchase/payment required', 'per-project booking', 'ownership validation', 'duplicate and capacity validation', 'admin appointment visibility', 'cancel and rebook', 'completion cannot be reused', 'stock and operator changes survive restart', 'previous price, order and cover changes preserved', 'admin per-store address configuration', 'independent capacity for two stores', 'order store cannot be swapped', 'disabled store rejects new bookings', 'store snapshots survive deletion'] }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await stop(); fs.rmSync(temp, { recursive: true, force: true }); });
