const crypto = require('node:crypto');
const shareholders = require('./shareholders.cjs');
const income = require('./income.cjs');
const transfers = require('./shareholder-transfers.cjs');
const recharge = require('./wechat-recharge.cjs');
const transfer = require('./wechat-transfer.cjs');

const stamp = now => new Date(now).toISOString();
const enabled = db => shareholders.rule(db).fundingMode === 'recharge';
function withdrawalLimits() {
  const configured = Number(process.env.WECHAT_WITHDRAWAL_MAX_AMOUNT || 200);
  const max = Number.isFinite(configured) && configured >= 0.1 && configured <= 20000000 ? Math.floor(configured * 100) / 100 : 200;
  return { min: 0.1, max };
}
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const requestKey = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value)) fail('提交编号无效，请刷新后重试');
  return value;
};
function cents(value) {
  const result = Math.round(value * 100);
  if (typeof value !== 'number' || !Number.isSafeInteger(result) || result <= 0 || result > 2000000000 || Math.abs(value * 100 - result) > 0.000001) {
    fail('请输入大于0的有效金额，最多两位小数');
  }
  return result;
}
function init(db) { income.init(db); db.recharges ||= []; }
function audit(db, actor, action, target, now) {
  db.audit ||= [];
  db.audit.unshift({ id: crypto.randomUUID(), actor, resource: 'wallet', action, target, createdAt: stamp(now) });
}
function pendingLegacy(db) {
  return (db.shareholderPools || []).filter(p => p.status === 'pending').map(p => ({ id: p.id, date: p.date, amount: p.amountCents / 100, revision: p.revision }));
}
function activate(db, body, actor, now = Date.now()) {
  init(db);
  if (enabled(db)) return overview(db);
  const rule = shareholders.rule(db);
  if (body.revision !== rule.revision || body.confirmed !== true) fail('请刷新并确认切换充值分配');
  const expected = pendingLegacy(db).map(p => [p.id, p.revision]).sort();
  const supplied = (Array.isArray(body.pending) ? body.pending : []).map(p => [p.id, p.revision]).sort();
  if (JSON.stringify(expected) !== JSON.stringify(supplied)) fail('旧待分配记录已变化，请刷新后核对');
  shareholders.validateActivation(db);
  // 手填金额没有充值凭证：保留待核对记录，不转换成充值、不自动发钱。
  for (const pool of db.shareholderPools.filter(p => p.status === 'pending')) {
    pool.status = 'held'; pool.heldAt = stamp(now); pool.holdReason = '切换充值分配，原手填金额待核对';
  }
  db.config.shareholderProgram = { ...rule, enabled: true, fundingMode: 'recharge',
    activatedAt: rule.activatedAt || stamp(now), walletActivatedAt: stamp(now), revision: rule.revision + 1 };
  audit(db, actor, 'ACTIVATE', 'program', now);
  return overview(db);
}
function createRecharge(db, body, actor, now = Date.now()) {
  init(db);
  const requestId = requestKey(body.requestId), amountCents = cents(body.amount);
  const existing = db.recharges.find(r => r.requestId === requestId);
  if (existing) {
    if (existing.amountCents !== amountCents || existing.actor !== actor) fail('此充值编号已被使用', 409);
    return viewRecharge(existing);
  }
  if (!enabled(db) || !shareholders.enabled(db)) fail('请先启用充值分配');
  if (!recharge.ready()) fail('充值通道尚未开通，请联系门店管理员', 503);
  if (!shareholders.holders(db, now).length) fail('暂无可参与分配的认证会员，请先核对会员资格');
  const id = crypto.randomUUID();
  const row = { id, number: 'C' + id.replaceAll('-', ''), requestId, amountCents, mchid: recharge.merchant(),
    actor, status: 'created', createdAt: stamp(now), attempts: 0 };
  db.recharges.unshift(row);
  audit(db, actor, 'RECHARGE', id, now);
  return viewRecharge(row);
}
function distribute(db, row, actor, now = Date.now(), retry = false) {
  if (row.status === 'distributed') return;
  if (row.status !== 'funded') fail('只有核实到账的充值可以分配');
  if (retry && !row.members?.length) {
    row.members = shareholders.holders(db, now); row.membersCheckedAt = stamp(now);
  }
  if (!row.members?.length) { row.error = '已到账，但没有符合条件的会员；资金保留待分配'; return; }
  const allocations = shareholders.allocate(row.amountCents, row.members);
  for (const allocation of allocations.filter(a => a.amountCents > 0)) {
    const accrualKey = 'recharge:' + row.id + ':' + allocation.userId;
    if (!db.earnings.some(e => e.accrualKey === accrualKey)) {
      db.earnings.push({ id: crypto.randomUUID(), accrualKey, rechargeId: row.id, userId: allocation.userId,
        type: 'static', source: 'recharge', kind: 'credit', amountCents: allocation.amountCents,
        amount: allocation.amountCents / 100, name: '充值分红', dueAt: row.confirmedAt, createdAt: stamp(now) });
    }
  }
  Object.assign(row, { allocations, status: 'distributed', distributedAt: stamp(now), error: '' });
  audit(db, actor, 'DISTRIBUTE', row.id, now);
}
function applyRecharge(db, id, result, now = Date.now()) {
  init(db);
  const row = db.recharges.find(r => r.id === id);
  if (!row || ['distributed', 'funded', 'closed'].includes(row.status)) return;
  if (result.out_recharge_no !== row.number || result.mchid !== row.mchid || result.account_type !== 'OPERATION' ||
      result.recharge_scene !== 'NORMAL_BANK_TRANSFER' || result.recharge_amount?.amount !== row.amountCents ||
      (result.recharge_amount.currency !== undefined && result.recharge_amount.currency !== 'CNY') || !result.recharge_id || (row.rechargeId && row.rechargeId !== result.recharge_id)) {
    throw new Error('充值回执与本地充值单不一致，请核对商户、账户和金额');
  }
  if (db.recharges.some(r => r.id !== id && r.rechargeId === result.recharge_id)) throw new Error('充值流水已关联其他充值单');
  if (!['SUCCESS', 'RECHARGING', 'CLOSED'].includes(result.recharge_state)) throw new Error('未知充值状态');
  row.rechargeId = result.recharge_id;
  row.error = '';
  if (result.recharge_state === 'CLOSED') { row.status = 'closed'; row.error = result.recharge_state_desc || ''; return; }
  if (result.recharge_state === 'RECHARGING') { row.status = 'awaiting'; return; }
  const paidAt = Date.parse(result.success_time);
  if (!Number.isFinite(paidAt) || paidAt > now + 60000) throw new Error('充值成功时间无效，请核对充值单');
  Object.assign(row, { status: 'funded', paidAt: stamp(paidAt), confirmedAt: stamp(now),
    members: shareholders.holders(db, now), membersCheckedAt: stamp(now) });
  // 首次核实到账时固定名单与份额；后续刷新、重启或方案变化不能重分旧充值。
  distribute(db, row, 'recharge-worker', now);
}
const rechargeLabels = { created: '正在获取充值账户', awaiting: '待充值到账', unknown: '核实充值结果中',
  funded: '已到账，待分配', distributed: '已分配到会员余额', closed: '已关闭', blocked: '待核对充值配置' };
function viewRecharge(row) {
  return { id: row.id, number: row.number, amount: row.amountCents / 100, status: row.status,
    statusText: rechargeLabels[row.status], error: row.error || '', createdAt: row.createdAt,
    paidAt: row.paidAt || '', distributedAt: row.distributedAt || '', bankAccount: row.bankAccount || null,
    totalUnits: (row.members || []).reduce((n, m) => n + m.units, 0),
    allocations: (row.allocations || []).map(m => ({ userId: m.userId, name: m.name, units: m.units, amount: m.amountCents / 100 })) };
}
function overview(db) {
  init(db);
  const names = new Map(db.users.map(u => [u.id, u.name]));
  return { enabled: enabled(db), revision: shareholders.rule(db).revision, rechargeReady: recharge.ready(),
    withdrawalReady: transfer.ready(), pendingLegacy: pendingLegacy(db),
    heldLegacy: db.shareholderPools.filter(p => p.status === 'held').map(p => ({ id: p.id, date: p.date, amount: p.amountCents / 100 })),
    recharges: [...db.recharges].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(viewRecharge),
    withdrawals: transfers.view(db).filter(r => r.source === 'withdrawal').map(r => ({ ...r, name: names.get(r.userId) || '未填写姓名' })) };
}
function manage(db, key, body, actor, now = Date.now()) {
  init(db);
  if (key === 'activate') return activate(db, body, actor, now);
  if (key === 'recharge') return createRecharge(db, body, actor, now);
  const row = db.recharges.find(r => r.id === body.id);
  if (!row) fail('充值单不存在', 404);
  if (key === 'distribute') {
    if (body.confirmed !== true) fail('请先核对参与分配的会员');
    distribute(db, row, actor, now, true);
  } else if (key === 'sync') {
    if (['created', 'awaiting', 'unknown', 'blocked'].includes(row.status)) row.checkedAt = '';
  } else fail('操作不存在', 404);
  return viewRecharge(row);
}
function withdraw(db, user, body, now = Date.now()) {
  init(db);
  const requestId = requestKey(body.requestId), amountCents = cents(body.amount);
  const id = 'W' + crypto.createHash('sha256').update(user.id + ':' + requestId).digest('hex').slice(0, 31);
  const existing = db.shareholderTransfers.find(t => t.id === id);
  if (existing) {
    if (existing.amountCents !== amountCents) fail('此提现编号已被使用', 409);
    return transfers.view(db, user.id).find(t => t.id === id);
  }
  if (!enabled(db)) fail('会员提现暂未开放');
  if (!transfer.ready()) fail('微信提现通道尚未开通，请联系门店', 503);
  const limits = withdrawalLimits();
  if (amountCents < limits.min * 100 || amountCents > Math.round(limits.max * 100)) fail(`单笔提现金额为${limits.min}至${limits.max}元，请按通道限额填写`);
  if (!user.openid || user.disabled || user.mergedInto || (user.wechatAppId && user.wechatAppId !== transfer.config().appid)) fail('请使用本人绑定的微信账号登录');
  if (amountCents >= 200000 && (!user.name || /^微信用户/.test(user.name))) fail('本笔提现请先完善与微信实名一致的姓名');
  if (amountCents > income.balanceOf(db, user.id).availableCents) fail('提现金额不能超过可提现余额');
  db.shareholderTransfers.push({ id, billNo: id, requestId, userId: user.id, openid: user.openid,
    source: 'withdrawal', transferMode: 'confirm', date: shareholders.dateOf(now), amountCents,
    status: 'pending', attempts: 0, createdAt: stamp(now) });
  audit(db, user.id, 'WITHDRAW', id, now);
  return transfers.view(db, user.id).find(t => t.id === id);
}
async function drain(transaction, now = Date.now()) {
  if (!recharge.ready()) return;
  const job = await transaction(db => {
    init(db);
    const row = [...db.recharges].filter(r => ['created', 'awaiting', 'unknown', 'blocked'].includes(r.status) &&
      (!r.checkedAt || now - Date.parse(r.checkedAt) >= 60000)).sort((a, b) => (a.checkedAt || '').localeCompare(b.checkedAt || ''))[0];
    if (!row) return null;
    row.checkedAt = stamp(now);
    if (row.mchid !== recharge.merchant()) { row.status = 'blocked'; row.error = '商户配置已变化，请先核对原商户充值结果'; return null; }
    row.attempts++;
    return structuredClone(row);
  });
  if (!job) return;
  try {
    // 申请响应丢失时先查原单；即使取不到付款账户，也不能漏掉已经到账的充值。
    if (!job.bankAccount && job.attempts > 1) {
      try {
        const result = await recharge.query(job.number);
        await transaction(db => applyRecharge(db, job.id, result, now));
        if (result.recharge_state !== 'RECHARGING') return;
      } catch (error) {
        const missing = ['NOT_FOUND', 'INVALID_REQUEST'].includes(error.code);
        if (!missing) throw error;
      }
    }
    if (!job.bankAccount) {
      const result = await recharge.apply(job);
      const account = result.transfer_in_account;
      if (result.out_recharge_no !== job.number || !result.recharge_id || !account?.bank_account_no || !account.bank_account_name) throw new Error('充值账户回执不完整或单号不一致');
      await transaction(db => {
        const row = db.recharges.find(r => r.id === job.id);
        if (!row || ['distributed', 'funded', 'closed'].includes(row.status)) return;
        if (row.rechargeId && row.rechargeId !== result.recharge_id) throw new Error('充值流水编号不一致');
        row.rechargeId = result.recharge_id; row.bankAccount = account; row.status = 'awaiting'; row.error = '';
      });
    }
    const result = await recharge.query(job.number);
    await transaction(db => applyRecharge(db, job.id, result, now));
  } catch (error) {
    await transaction(db => {
      const row = db.recharges.find(r => r.id === job.id);
      if (row && !['distributed', 'funded', 'closed'].includes(row.status)) { row.status = 'unknown'; row.error = error.message; }
    });
  }
}
module.exports = { init, enabled, withdrawalLimits, activate, createRecharge, applyRecharge, distribute, manage, overview, withdraw, drain };
