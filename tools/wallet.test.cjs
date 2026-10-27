const { test } = require('node:test');
const assert = require('node:assert/strict');
const wallet = require('../server/wallet.cjs');
const shareholders = require('../server/shareholders.cjs');
const income = require('../server/income.cjs');
const transfers = require('../server/shareholder-transfers.cjs');
const recharge = require('../server/wechat-recharge.cjs');
const transfer = require('../server/wechat-transfer.cjs');
const now = Date.parse('2026-10-28T10:00:00+08:00');
function fixture() {
  const db = { config: { shareholderProgram: { enabled: true, activatedAt: new Date(now - 100000).toISOString(), plans: [], revision: 2 } },
    users: [], orders: [], earnings: [], shareholderPools: [], shareholderTransfers: [], payouts: [] };
  for (const [id, price] of [['member-a', 6980], ['member-b', 13800]]) {
    db.users.push({ id, name: id, openid: id + '-openid', wechatAppId: 'test-app', points: 500,
      shareholder: { approved: true, approvedAt: new Date(now - 10000).toISOString(), planId: 'package-' + price, orderId: id + '-order' } });
    db.orders.push({ id: id + '-order', userId: id, product: { price, packagePlans: [{}] },
      total: price, paymentStatus: 'paid', status: 'ready', paidAt: new Date(now - 20000).toISOString() });
  }
  return db;
}
function activate(db) { wallet.activate(db, { confirmed: true, revision: 2, pending: [] }, 'admin', now); }
function receipt(row, extra = {}) {
  return { mchid: 'test-merchant', out_recharge_no: row.number, recharge_id: 'wechat-' + row.id,
    account_type: 'OPERATION', recharge_scene: 'NORMAL_BANK_TRANSFER', recharge_amount: { amount: row.amountCents, currency: 'CNY' },
    recharge_state: 'SUCCESS', success_time: new Date(now).toISOString(), ...extra };
}
test('充值分配与会员余额：纯内存验证，不连接微信或线上数据', async t => {
  const originals = { ready: recharge.ready, merchant: recharge.merchant, apply: recharge.apply, query: recharge.query, transferReady: transfer.ready, config: transfer.config };
  recharge.ready = () => true; recharge.merchant = () => 'test-merchant';
  transfer.ready = () => true; transfer.config = () => ({ appid: 'test-app', mchid: 'test-merchant' });
  try {
    await t.test('切换须确认旧记录；旧待分金额保留，旧收益、购买权益和积分不变', () => {
      const db = fixture(); db.shareholderPools.push({ id: 'old', date: '2026-10-28', amountCents: 600000, status: 'pending', revision: 4, dueAt: new Date(now - 1000).toISOString() });
      db.earnings.push({ id: 'old-earning', userId: 'member-a', amountCents: 10000 });
      const before = structuredClone({ users: db.users, orders: db.orders, earnings: db.earnings });
      assert.throws(() => activate(db), /旧待分配记录已变化/);
      wallet.activate(db, { confirmed: true, revision: 2, pending: [{ id: 'old', revision: 4 }] }, 'admin', now);
      assert.equal(db.shareholderPools[0].status, 'held');
      assert.equal(shareholders.settle(db, now + 86400000), 0);
      assert.throws(() => shareholders.savePool(db, {}, 'admin', now), /充值单/);
      assert.deepEqual({ users: db.users, orders: db.orders, earnings: db.earnings }, before);
      assert.equal(wallet.overview(db).heldLegacy[0].amount, 6000);
    });
    await t.test('真实充值才分配、每笔只分一次；精确到分且跨日余额不归零', () => {
      const db = fixture(); activate(db);
      const body = { amount: 100.01, requestId: 'recharge-0001' };
      const first = wallet.createRecharge(db, body, 'admin', now);
      assert.equal(wallet.createRecharge(db, body, 'admin', now).id, first.id);
      assert.throws(() => wallet.createRecharge(db, { ...body, amount: 200 }, 'admin', now), /已被使用/);
      assert.equal(db.earnings.length, 0);
      const row = db.recharges[0], result = receipt(row);
      wallet.applyRecharge(db, row.id, { ...result, recharge_state: 'RECHARGING' }, now);
      assert.equal(db.earnings.length, 0);
      wallet.applyRecharge(db, row.id, result, now);
      assert.deepEqual(row.allocations.map(a => a.amountCents), [3334, 6667]);
      assert.equal(row.allocations.reduce((n, a) => n + a.amountCents, 0), 10001);
      db.users[0].shareholder.approved = false;
      wallet.applyRecharge(db, row.id, result, now + 1000);
      assert.equal(db.earnings.length, 2); assert.equal(db.shareholderTransfers.length, 0);
      assert.equal(income.balanceOf(db, 'member-a').availableCents, 3334);
      assert.equal(shareholders.today(db, 'member-a', now + 86400000).amount, 0);
      assert.equal(income.balanceOf(db, 'member-a').availableCents, 3334);
      assert.equal(shareholders.today(db, 'member-a', now).personalAmount, 33.34);
    });
    await t.test('伪造金额、商户、币种、账户及充值单号全部拒绝', () => {
      for (const change of [{ mchid: 'other' }, { out_recharge_no: 'other' }, { account_type: 'BASIC' },
        { recharge_amount: { amount: 1, currency: 'CNY' } }, { recharge_amount: { amount: 10000, currency: 'USD' } },
        { recharge_scene: 'OTHER' }, { recharge_id: '' }, { recharge_state: 'UNKNOWN' }]) {
        const db = fixture(); activate(db); wallet.createRecharge(db, { amount: 100, requestId: 'bad-proof-001' }, 'admin', now);
        assert.throws(() => wallet.applyRecharge(db, db.recharges[0].id, receipt(db.recharges[0], change), now));
        assert.equal(db.earnings.length, 0);
      }
    });
    await t.test('充值申请响应丢失：先核对原单，已到账只分一次，不要求重新充值', async () => {
      const db = fixture(); activate(db); wallet.createRecharge(db, { amount: 300, requestId: 'lost-recharge-001' }, 'admin', now);
      const row = db.recharges[0]; let attempts = 0;
      recharge.apply = async () => { attempts++; throw new Error('模拟响应丢失'); };
      recharge.query = async () => receipt(row);
      await wallet.drain(async fn => fn(db), now);
      assert.equal(row.status, 'unknown'); assert.equal(db.earnings.length, 0);
      row.checkedAt = '';
      await wallet.drain(async fn => fn(db), now);
      assert.equal(row.status, 'distributed'); assert.equal(attempts, 1); assert.equal(db.earnings.length, 2);
      await wallet.drain(async fn => fn(db), now);
      assert.equal(db.earnings.length, 2);
    });
    await t.test('到账前资格变化：无合格会员时资金留待分配，核对后仅分一次', () => {
      const db = fixture(); activate(db); wallet.createRecharge(db, { amount: 300, requestId: 'no-members-001' }, 'admin', now);
      db.users.forEach(u => u.disabled = true);
      const row = db.recharges[0]; wallet.applyRecharge(db, row.id, receipt(row), now);
      assert.equal(row.status, 'funded'); assert.equal(db.earnings.length, 0);
      assert.throws(() => wallet.createRecharge(db, { amount: 300, requestId: 'no-members-002' }, 'admin', now), /暂无/);
      db.users[0].disabled = false;
      wallet.manage(db, 'distribute', { id: row.id, confirmed: true }, 'admin', now + 1000);
      wallet.manage(db, 'distribute', { id: row.id, confirmed: true }, 'admin', now + 2000);
      assert.equal(income.balanceOf(db, 'member-a').availableCents, 30000); assert.equal(db.earnings.length, 1);
    });
    await t.test('提现锁余额、防重与人工兑现互斥；旧收益仍可提，退款冲回后不能超提', () => {
      const db = fixture(); activate(db); db.earnings.push({ userId: 'member-a', amountCents: 10000 });
      const body = { amount: 60, requestId: 'withdraw-001' };
      const result = wallet.withdraw(db, db.users[0], body, now);
      assert.equal(wallet.withdraw(db, db.users[0], body, now).id, result.id);
      assert.equal(db.shareholderTransfers.length, 1);
      assert.equal(income.balanceOf(db, 'member-a').availableCents, 4000);
      assert.equal(income.balanceOf(db, 'member-a').reservedCents, 6000);
      assert.throws(() => wallet.withdraw(db, db.users[0], { amount: 50, requestId: 'withdraw-002' }, now), /余额/);
      assert.throws(() => income.managePayout(db, { action: 'payout', userId: 'member-a', amount: 50, method: 'cash', confirmed: true, requestId: 'cash-paid-001' }, 'admin'), /待兑现/);
      db.earnings.push({ userId: 'member-a', amountCents: -5000 });
      assert.throws(() => wallet.withdraw(db, db.users[0], { amount: 1, requestId: 'withdraw-003' }, now), /余额/);
      const row = db.shareholderTransfers[0]; Object.assign(row, { appid: 'test-app', mchid: 'test-merchant' });
      transfers.apply(db, row.id, { out_bill_no: row.billNo, appid: row.appid, mch_id: row.mchid, openid: row.openid, transfer_amount: row.amountCents, state: 'FAIL' });
      assert.equal(income.balanceOf(db, 'member-a').availableCents, 5000);
      assert.equal(db.payouts.length, 0);
    });
    await t.test('充值和提现通道未配置时关闭；非法金额、无本人微信身份不接收', () => {
      const db = fixture(); activate(db); db.earnings.push({ userId: 'member-a', amountCents: 10000 });
      for (const amount of [0, -1, 0.001, 0.01, 201, '100', NaN, Infinity]) assert.throws(() => wallet.withdraw(db, db.users[0], { amount, requestId: 'invalid-001' }, now));
      transfer.ready = () => false;
      assert.throws(() => wallet.withdraw(db, db.users[0], { amount: 1, requestId: 'invalid-001' }, now), /尚未开通/);
      transfer.ready = () => true; delete db.users[0].openid;
      assert.throws(() => wallet.withdraw(db, db.users[0], { amount: 1, requestId: 'invalid-001' }, now), /本人/);
      recharge.ready = () => false;
      assert.throws(() => wallet.createRecharge(db, { amount: 100, requestId: 'invalid-001' }, 'admin', now), /尚未开通/);
      recharge.ready = () => true;
      assert.equal(db.shareholderTransfers.length, 0); assert.equal(db.recharges.length, 0);
    });
  } finally {
    recharge.ready = originals.ready; recharge.merchant = originals.merchant;
    recharge.apply = originals.apply; recharge.query = originals.query;
    transfer.ready = originals.transferReady; transfer.config = originals.config;
  }
});
