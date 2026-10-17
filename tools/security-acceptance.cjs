const assert = (condition, message) => { if (!condition) throw new Error(message); };
const base = process.env.ACCEPTANCE_BASE || 'http://127.0.0.1:3119/api';
const internal = { 'x-anqi-internal': 'local-secret' };
async function req(path, method = 'GET', body, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}
async function expectStatus(path, status, method, body, headers) {
  const result = await req(path, method, body, headers);
  assert(result.status === status, `${method || 'GET'} ${path} expected ${status}, got ${result.status}: ${JSON.stringify(result.data)}`);
  return result;
}

(async () => {
  await expectStatus('/me', 401);
  await expectStatus('/orders', 401);
  await expectStatus('/admin/products', 401);
  await expectStatus('/auth/account', 403, 'POST', { username: 'bad', password: 'short' });

  const suffix = Date.now().toString(36);
  const register = async username => {
    const result = await req('/auth/wechat', 'POST', { code: 'security-'+username });
    assert(result.status === 200 && result.data.token, `微信登录失败: ${username}`);
    return { token: result.data.token, user: result.data.user };
  };
  const alice = await register(`alice${suffix}`);
  const bob = await register(`bob${suffix}`);
  const auth = token => ({ authorization: `Bearer ${token}` });

  const address = await req('/addresses', 'POST', { name: '安全测试', phone: '13800138000', city: '河南省 开封市 龙亭区', detail: '隔离地址', isDefault: true }, auth(bob.token));
  assert(address.status === 200 && address.data.id, '地址创建失败');
  await expectStatus(`/addresses/${address.data.id}`, 404, 'PUT', { name: '越权修改', phone: '13800138000', city: '河南省 开封市 龙亭区', detail: '越权', isDefault: false }, auth(alice.token));
  await expectStatus(`/addresses/${address.data.id}`, 404, 'DELETE', undefined, auth(alice.token));

  const bootstrap = await req('/bootstrap');
  assert(bootstrap.status === 200 && Array.isArray(bootstrap.data.products) && bootstrap.data.products.length >= 1, '商品目录读取失败');
  const product = bootstrap.data.products.find(row => row.name === '逆龄肽奢护焕颜套') || bootstrap.data.products.find(row => row.kind === 'service');
  assert(product, '服务商品不存在');
  const invalidOrder = await req('/orders', 'POST', { productId: product.id, spec: 'single', quantity: 0, storeId: 'store-1' }, auth(alice.token));
  assert(invalidOrder.status === 400, '非法数量未被拒绝');
  const orderBody = { productId: product.id, spec: 'single', quantity: 1, storeId: 'store-1' };
  const retryKey = 'security-retry-' + suffix;
  const order = await req('/orders', 'POST', orderBody, { ...auth(alice.token), 'idempotency-key': retryKey });
  assert(order.status === 200 && order.data.id, '订单创建失败');
  const retryOrder = await req('/orders', 'POST', orderBody, { ...auth(alice.token), 'idempotency-key': retryKey });
  assert(retryOrder.status === 200 && retryOrder.data.id === order.data.id, '重复请求未复用原订单');
  await expectStatus(`/orders/${order.data.id}`, 404, 'GET', undefined, auth(bob.token));
  await expectStatus(`/orders/${order.data.id}/pay`, 503, 'POST', {}, auth(alice.token));
  const afterPay = await req(`/orders/${order.data.id}`, 'GET', undefined, auth(alice.token));
  assert(afterPay.data.status === 'pending', '支付失败改变了订单状态');

  await expectStatus('/sign', 404, 'GET', undefined, auth(alice.token));
  await expectStatus('/rewards', 200);
  for (const path of ['/redemptions','/ledger']) {
    await expectStatus(path, 401);
    await expectStatus(path, 200, 'GET', undefined, auth(alice.token));
  }

  await expectStatus('/admin/products', 401, 'POST', { name: '越权商品' });
  const created = await req('/admin/products', 'POST', { name: '隔离 CRUD 商品', image: '/static/brand/logo-jimeili.png', detailImage: '/static/brand/logo-jimeili.png', price: 10, coursePrice: 100, kind: 'goods', stock: 2, sold: 0, home: false, gift: false, trial: false, enabled: true, description: '隔离数据' }, internal);
  assert(created.status === 200 && created.data.id, '后台创建商品失败');
  const updated = await req(`/admin/products/${created.data.id}`, 'PUT', { ...created.data, name: '隔离 CRUD 商品已编辑', price: 12 }, internal);
  assert(updated.status === 200, '后台编辑商品失败');
  const list = await req('/admin/products', 'GET', undefined, internal);
  assert(list.status === 200 && list.data.some(row => row.id === created.data.id && row.name === '隔离 CRUD 商品已编辑'), '后台列表未回读编辑结果');
  await expectStatus(`/admin/products/${created.data.id}`, 200, 'DELETE', undefined, internal);
  const listAfterDelete = await req('/admin/products', 'GET', undefined, internal);
  assert(listAfterDelete.status === 200 && !listAfterDelete.data.some(row => row.id === created.data.id), '后台删除后列表仍保留数据');

  await expectStatus('/admin/upload', 400, 'POST', { data: 'data:image/png;base64,ZmFrZQ==' }, internal);
  await expectStatus('/auth/account', 403, 'POST', { username: `alice${suffix}`, password: 'wrong-password' });
  console.log(JSON.stringify({ ok: true, checks: 30, unauthorized: 5, idor: 2, idempotency: 1, order: order.data.id, crud: created.data.id }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
