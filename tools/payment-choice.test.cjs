// 执行真实页面方法；替换平台/API 边界，不调用微信或线上服务。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page({ native = true, paymentMode = 'wechat', api } = {}) {
  const calls = [], storage = new Map();
  const pending = { id: 'local-order', status: 'pending', paymentChoice: 'offline' };
  let source = fs.readFileSync(path.join(__dirname, '../components/beauty-screen.js'), 'utf8')
    .replace(/^import .+$/gm, '')
    .replace('export default decorateScreen(screen)', 'globalThis.options = screen');
  if (!native) source = source.replace('mpWeixin=true', 'mpWeixin=false');
  const context = {
    PackagePicker: {}, BookingAvailability: {}, IncomeDashboard: {}, version: 'test',
    money: value => Number(value).toFixed(2), go: () => {},
    packageSelectionError: () => '', fallbackCatalogue: {},
    toast: message => calls.push(['toast', message]),
    api: async (...args) => { calls.push(['api', ...args]); return api ? api(...args) : pending; },
    uni: {
      getStorageSync: key => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      showModal: async options => { calls.push(['cash', options]); return { confirm: false }; },
      redirectTo: options => calls.push(['redirect', options]),
      requestPayment: async options => calls.push(['wechat', options])
    }
  };
  vm.runInNewContext(source, context);
  const options = context.options;
  const instance = Object.assign(options.data(), options.methods, {
    page: 'checkout', query: {}, paymentMode, order: pending,
    product: { id: 'service', kind: 'service' }, isPackage: false,
    chosenStore: { id: 'store' }, chosenAddress: {},
    recordStore: () => ({ name: '测试门店' })
  });
  for (const name of ['onlinePay', 'onlinePayNotice']) {
    Object.defineProperty(instance, name, { get: () => options.computed[name].call(instance) });
  }
  return { instance, calls, pending, uni: context.uni };
}

test('小程序下单默认微信；刷新保留主动选择的现金；未开通或 H5 保留现金', async () => {
  for (const [native, paymentMode, expected] of [[true, 'wechat', 'wechat'], [true, 'off', 'offline'], [false, 'wechat', 'offline']]) {
    const { instance } = page({ native, paymentMode, api: () => ({ paymentMode, stores: [], products: [], config: {} }) });
    instance.page = 'home';
    await instance.refresh();
    assert.equal(instance.checkoutPayment, expected);
    instance.checkoutPayment = 'offline';
    await instance.refresh();
    assert.equal(instance.checkoutPayment, 'offline');
  }
});

test('下单传递所选渠道，只有选择微信才调起支付', async () => {
  for (const choice of ['wechat', 'offline']) {
    const { instance, calls } = page();
    instance.checkoutPayment = choice;
    instance.wechatPay = async order => calls.push(['pay', order.id]);
    await instance.createOrder();
    assert.equal(calls.find(row => row[0] === 'api' && row[1] === '/orders')[3].paymentChoice, choice);
    assert.equal(calls.filter(row => row[0] === 'pay').length, choice === 'wechat' ? 1 : 0);
    assert.equal(calls.filter(row => row[0] === 'redirect').length, 1);
  }
});

test('现金订单主动选微信会调起微信；现金按钮只提示门店收款，不自动标记已付', async () => {
  const { instance, calls, pending } = page();
  instance.wechatPay = async order => calls.push(['pay', order.id]);
  instance.refresh = async () => calls.push(['refresh']);
  await instance.pay(pending, 'wechat');
  assert.equal(calls.filter(row => row[0] === 'pay').length, 1);
  await instance.pay(pending, 'offline');
  assert.equal(calls.filter(row => row[0] === 'cash').length, 1);
  assert.equal(calls.filter(row => row[0] === 'api').length, 0);
  assert.equal(pending.status, 'pending');
});

test('微信取消后订单仍待付，可以继续选现金；不会发起支付结果查单', async () => {
  const { instance, calls, pending, uni } = page({ api: () => ({ payment: { package: 'prepay_id=local' } }) });
  instance.refresh = async () => {};
  uni.requestPayment = async () => { throw { errMsg: 'requestPayment:fail cancel' }; };
  await instance.pay(pending, 'wechat');
  assert.equal(pending.status, 'pending');
  assert.equal(calls.filter(row => row[0] === 'api').length, 1);
  assert.ok(calls.some(row => row[0] === 'toast' && row[1].includes('已取消支付')));
  await instance.pay(pending, 'offline');
  assert.equal(calls.filter(row => row[0] === 'cash').length, 1);
});

test('未开通、非小程序、非待付款、处理中都不会发起新的在线付款', async () => {
  for (const settings of [{ paymentMode: 'off' }, { native: false }, { status: 'ready' }, { busy: true }]) {
    const { instance, calls, pending } = page(settings);
    if (settings.status) pending.status = settings.status;
    if (settings.busy) instance.busy = true;
    await instance.pay(pending, 'wechat');
    assert.equal(calls.filter(row => ['api', 'wechat', 'cash'].includes(row[0])).length, 0);
  }
});
