const { test } = require('node:test');
const assert = require('node:assert/strict');
const sh = require('../server/shareholders.cjs');

const start = Date.parse('2026-10-26T09:00:00+08:00');
const day = 86400000;
const tiers = [[6980, 1], [13800, 2], [26800, 4], [49800, 8], [99800, 16], [199800, 32]];
function fixture() {
  const db = { config: {}, users: [], orders: [], earnings: [] };
  sh.configure(db, { ...sh.rule(db), enabled: true }, 'test', start);
  return db;
}
function purchase(db, userId, price, now = start) {
  if (!db.users.some(u => u.id === userId)) db.users.push({ id: userId });
  const order = { id: 'o' + db.orders.length, userId, product: { price, packagePlans: [{ id: 'vip' }] }, quantity: 1, total: price, paymentStatus: 'paid', status: 'ready', paidAt: new Date(now).toISOString() };
  db.orders.push(order);
  return order;
}
function approve(db, order, now = start) {
  const user = db.users.find(u => u.id === order.userId);
  sh.certify(db, { userId: user.id, approved: true, orderId: order.id, planId: 'package-' + order.product.price, revision: user.memberRevision || 0 }, 'test', now);
}

test('六档金额固定对应1/2/4/8/16/32份；购买后仍须门店认证', () => {
  const db = fixture();
  assert.deepEqual(sh.rule(db).plans.map(p => [p.price, p.units]), tiers);
  tiers.forEach(([price, units], i) => {
    const order = purchase(db, 'u' + i, price);
    assert.equal(sh.eligible(db, db.users[i], start), false);
    approve(db, order);
    assert.equal(sh.holders(db, start).find(m => m.userId === 'u' + i).units, units);
  });
  sh.savePool(db, { date: '2026-10-26', amount: 6300, revision: 0 }, 'test', start);
  sh.settle(db, start + 14 * 3600000);
  assert.deepEqual(db.shareholderPools[0].allocations.map(m => m.amountCents), [10000, 20000, 40000, 80000, 160000, 320000]);
  assert.equal(db.shareholderPools[0].totalUnits, 63);
  const history = structuredClone(db.earnings);
  // 第二天继续计入前一天的六人，再新增1+2+4份，总份数为70。
  tiers.slice(0, 3).forEach(([price], i) => approve(db, purchase(db, 'new' + i, price, start + day), start + day));
  sh.savePool(db, { date: '2026-10-27', amount: 7000, revision: 0 }, 'test', start + day);
  sh.settle(db, start + day + 14 * 3600000);
  assert.equal(db.shareholderPools[1].totalUnits, 70);
  assert.equal(db.shareholderPools[1].allocations.length, 9);
  assert.deepEqual(db.shareholderPools[1].allocations.map(m => m.amountCents), [10000, 20000, 40000, 80000, 160000, 320000, 10000, 20000, 40000]);
  assert.deepEqual(db.earnings.slice(0, 6), history);
  sh.settle(db, start + day + 15 * 3600000);
  assert.equal(db.earnings.length, 15, '重复结算不重复入账');
});

test('客户的1/2/3份示例按总份数分配，尾差补齐且顺序不改变金额', () => {
  const first = [1, 2, 3].map((units, i) => ({ userId: 'u' + i, units }));
  assert.deepEqual(sh.allocate(500000, first).map(m => m.amountCents), [83333, 166667, 250000]);
  const second = [...first, ...first.map(m => ({ ...m, userId: m.userId + '-new' }))];
  assert.deepEqual(sh.allocate(1200000, second).map(m => m.amountCents), [100000, 200000, 300000, 100000, 200000, 300000]);
  for (const cents of [0, 1, 2, 500000, 1000000000]) {
    const expected = sh.allocate(cents, first).sort((a, b) => a.userId.localeCompare(b.userId));
    assert.equal(expected.reduce((n, row) => n + row.amountCents, 0), cents);
    assert.deepEqual(sh.allocate(cents, [...first].reverse()).sort((a, b) => a.userId.localeCompare(b.userId)), expected);
  }
  assert.deepEqual(sh.allocate(500000, []), []);
});

test('不能伪造高档认证、金额、份数或新增任意分配方案', () => {
  const db = fixture(), order = purchase(db, 'u', 6980);
  const body = { userId: 'u', approved: true, orderId: order.id, planId: 'package-199800', revision: 0 };
  assert.throws(() => sh.certify(db, body, 'test', start), /须与已购套餐对应/);
  for (const field of ['units', 'price']) {
    const config = sh.rule(db); config.plans[0][field] = 999;
    assert.throws(() => sh.configure(db, config, 'test', start), /不能修改/);
  }
  const config = sh.rule(db); config.plans.push({ id: 'custom', name: '自定义', units: 1000, enabled: true });
  assert.throws(() => sh.configure(db, config, 'test', start), /六档/);
  assert.equal(db.users[0].shareholder, undefined);
});

test('普通服务、未知金额、多人订单、未付款和他人订单不能获得新认证', () => {
  for (const change of [o => { o.product.packagePlans = []; o.package = { planId: 'service-course' }; }, o => { o.product.price = 100; }, o => { o.quantity = 2; }, o => { o.paymentStatus = 'unpaid'; }, o => { o.userId = 'other'; }]) {
    const db = fixture(), order = purchase(db, 'u', 6980); change(order);
    assert.throws(() => sh.certify(db, { userId: 'u', approved: true, orderId: order.id, planId: 'package-6980', revision: 0 }, 'test', start), /套餐订单|须与已购套餐对应/);
  }
});

test('按购买时方案价格计份数，实付优惠、商品改价、多买套餐不自动加份', () => {
  const db = fixture(), first = purchase(db, 'u', 6980);
  first.total = 6000; first.price = 6000;
  approve(db, first);
  db.products = [{ id: 'changed', price: 199800 }];
  const later = purchase(db, 'u', 49800, start + day);
  assert.equal(sh.holders(db, start + day)[0].units, 1);
  assert.equal(sh.holders(db, start + day).length, 1);
  approve(db, later, start + day);
  assert.equal(sh.holders(db, start + day)[0].units, 8);
  assert.equal(sh.holders(db, start + day).length, 1);
});

test('退款、禁用和停止静态资格退出分母；停止新认证不剥夺已有份数', () => {
  const db = fixture();
  tiers.slice(0, 4).forEach(([price], i) => approve(db, purchase(db, 'u' + i, price)));
  const config = sh.rule(db); config.plans[0].enabled = false; sh.configure(db, config, 'test', start);
  assert.equal(sh.holders(db, start)[0].units, 1);
  const order = purchase(db, 'new', 6980);
  assert.throws(() => approve(db, order), /有效的分配方案/);
  db.orders[1].refundStatus = 'refunded'; db.orders[1].refundAt = new Date(start + 1000).toISOString();
  db.users[2].disabled = true; db.users[3].incomeAccess = { static: false };
  assert.deepEqual(sh.holders(db, start + 1000).map(m => m.userId), ['u0']);
});

test('旧认证按已购六档方案纠正份数，已结算快照和非六档历史认证保留', () => {
  const db = fixture();
  db.config.shareholderProgram.plans.push({ id: 'old', name: '旧方案', units: 3, enabled: true });
  const a = purchase(db, 'a', 26800), b = purchase(db, 'b', 100);
  for (const order of [a, b]) db.users.find(u => u.id === order.userId).shareholder = { approved: true, orderId: order.id, planId: 'old', approvedAt: new Date(start).toISOString() };
  db.shareholderPools.push({ id: 'history', date: '2026-10-25', status: 'settled', amountCents: 60000, allocations: [{ userId: 'a', units: 3, amountCents: 60000 }] });
  const before = structuredClone(db.shareholderPools);
  assert.deepEqual(sh.holders(db, start).map(m => m.units), [4, 3]);
  assert.equal(sh.eligible(db, db.users[0], start), true);
  sh.certify(db, { userId: 'b', orderId: b.id, planId: 'old', approved: true, revision: 0 }, 'test', start);
  assert.deepEqual(db.shareholderPools, before);
  sh.configure(db, sh.rule(db), 'test', start);
  assert.deepEqual(sh.holders(db, start).map(m => m.units), [4, 3]);
});

test('补充六档标准方案不挤占旧方案配置容量', () => {
  const db = { config: { shareholderProgram: { plans: Array.from({ length: 50 }, (_, i) => ({ id: 'old-' + i, name: '旧方案' + i, units: 1, enabled: true })) } }, users: [], orders: [] };
  assert.equal(sh.rule(db).plans.length, 56);
  assert.doesNotThrow(() => sh.configure(db, sh.rule(db), 'test', start));
});
