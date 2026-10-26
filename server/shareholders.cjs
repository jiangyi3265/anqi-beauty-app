const crypto = require('node:crypto');
const transfers = require('./shareholder-transfers.cjs');

const DAY = 86400000;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const dateOf = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const dayStart = date => Date.parse(date + 'T00:00:00+08:00');
const stamp = now => new Date(now).toISOString();
const defaults = { enabled: false, revision: 0, settleTime: '23:00', plans: [] };
function init(db) { db.shareholderPools ||= []; db.shareholderTransfers ||= []; }
const rule = db => ({ ...defaults, ...db.config?.shareholderProgram });
const enabled = db => rule(db).enabled;
function paidOrder(order, at) {
  return order?.paymentStatus === 'paid' && Date.parse(order.paidAt) <= at &&
    !['pending', 'cancelled', 'aftersale'].includes(order.status) && order.refundStatus !== 'refunded';
}
function eligible(db, user, at = Date.now()) {
  const s = user?.shareholder;
  return !!(user && !user.disabled && !user.mergedInto && s?.approved && Date.parse(s.approvedAt) <= at &&
    rule(db).plans.some(p => p.id === s.planId) &&
    db.orders.some(o => o.id === s.orderId && o.userId === user.id && paidOrder(o, at)));
}
function holders(db, now = Date.now()) {
  const plans = rule(db).plans;
  return db.users.filter(u => eligible(db, u, now) && u.incomeAccess?.static !== false).map(u => {
    const p = plans.find(p => p.id === u.shareholder.planId);
    return { userId: u.id, name: u.name, planId: p.id, planName: p.name, units: p.units };
  });
}
function allocate(cents, members) {
  const total = members.reduce((n, m) => n + m.units, 0);
  if (!total) return [];
  const rows = members.map(m => {
    const exact = BigInt(cents) * BigInt(m.units);
    return { ...m, amountCents: Number(exact / BigInt(total)), remainder: exact % BigInt(total) };
  });
  let left = cents - rows.reduce((n, r) => n + r.amountCents, 0);
  [...rows].sort((a, b) => a.remainder === b.remainder ? a.userId.localeCompare(b.userId) : a.remainder > b.remainder ? -1 : 1)
    .forEach(r => { if (left > 0) { r.amountCents++; left--; } });
  return rows.map(({ remainder, ...row }) => row);
}
function audit(db, actor, action, target, details, now) {
  db.audit ||= [];
  db.audit.unshift({ id: crypto.randomUUID(), actor, resource: 'shareholders', method: action, target, details, createdAt: stamp(now) });
}
function assertRevision(expected, actual) { if (expected !== actual) fail('资料已更新，请刷新后再保存'); }
function configure(db, body, actor, now = Date.now()) {
  init(db);
  const previous = rule(db);
  assertRevision(body.revision, previous.revision);
  if (typeof body.enabled !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.settleTime)) fail('请填写有效的启用状态和结算时间');
  if (!Array.isArray(body.plans) || body.plans.length > 50) fail('分配方案格式无效');
  const ids = new Set();
  const plans = body.plans.map(p => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(p.id) || ids.has(p.id)) fail('方案编号无效或重复');
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 40) fail('请填写方案名称');
    if (!Number.isSafeInteger(p.units) || p.units < 1 || p.units > 100000 || typeof p.enabled !== 'boolean') fail('方案份数须为正整数');
    return { id: p.id, name: p.name.trim(), units: p.units, enabled: p.enabled };
  });
  if (body.enabled && !plans.some(p => p.enabled)) fail('请先配置至少一个启用的方案');
  if (db.users.some(u => u.shareholder?.approved && !ids.has(u.shareholder.planId))) fail('已有股东使用的方案不能删除，可停止新选');
  const unfinishedStaticPlan = db.incomePlans?.some(p => p.type === 'static' && p.status === 'active' && p.posted < p.periods);
  const unactivatedStaticOrder = db.orders.some(o => o.incomeSnapshot?.rule?.static?.enabled &&
    o.refundStatus !== 'refunded' && !['cancelled', 'aftersale'].includes(o.status) &&
    !db.incomePlans?.some(p => p.orderId === o.id && p.type === 'static'));
  if (!previous.activatedAt && body.enabled && (unfinishedStaticPlan || unactivatedStaticOrder)) {
    fail('存在尚未结清的旧静态收益计划，请先核对处理，避免重复分配');
  }
  if(previous.enabled&&!body.enabled&&db.shareholderPools.some(p=>p.status==='pending'&&p.amountCents>0))fail('存在待结算积分池，请结算后再暂停');
  if(db.shareholderPools.some(p=>p.date===dateOf(now)&&p.status==='pending')&&Date.parse(dateOf(now)+'T'+body.settleTime+':00+08:00')<=now)fail('当天结算时间须晚于现在');
  const next = { ...previous, enabled: body.enabled, plans, settleTime: body.settleTime, revision: previous.revision + 1, updatedAt: stamp(now) };
  if (body.enabled && !previous.activatedAt) next.activatedAt = stamp(now);
  db.config.shareholderProgram = next;
  // 已录入但未结算的当日池随配置立即更新；昨天的截止时间不受影响。
  for (const pool of db.shareholderPools) if (pool.date === dateOf(now) && pool.status === 'pending') pool.dueAt = pool.date + 'T' + next.settleTime + ':00+08:00';
  audit(db, actor, 'CONFIGURE', 'program', { previous, next }, now);
  return next;
}
function certify(db, body, actor, now = Date.now()) {
  const user = db.users.find(u => u.id === body.userId && !u.mergedInto);
  if (!user) fail('会员不存在');
  assertRevision(body.revision, user.memberRevision || 0);
  if (typeof body.approved !== 'boolean') fail('股东认证状态无效');
  const previous = user.shareholder || null;
  if (body.approved) {
    if (user.disabled) fail('请先启用该会员');
    if (!rule(db).plans.some(p => p.id === body.planId && (p.enabled || previous?.planId === p.id))) fail('请选择有效的分配方案');
    if (!db.orders.some(o => o.id === body.orderId && o.userId === user.id && paidOrder(o, now))) fail('请选择该会员已付款且未退款的订单');
  }
  user.shareholder = { approved: body.approved, planId: body.planId || previous?.planId || '', orderId: body.orderId || previous?.orderId || '', approvedAt: previous?.approved ? previous.approvedAt : stamp(now), updatedAt: stamp(now) };
  user.memberRevision = (user.memberRevision || 0) + 1;
  audit(db, actor, 'CERTIFY', user.id, { previous, next: user.shareholder }, now);
  return user.shareholder;
}
function savePool(db, body, actor, now = Date.now()) {
  init(db);
  const config = rule(db), today = dateOf(now);
  if (!config.enabled) fail('请先启用股东分配');
  if (body.date !== today) fail('只能录入北京时间今天的积分池');
  const dueAt = today + 'T' + config.settleTime + ':00+08:00';
  if (now >= Date.parse(dueAt)) fail('今天已到结算时间，不能再修改当天积分池');
  const amountCents = Math.round(body.amount * 100);
  if (typeof body.amount !== 'number' || !Number.isSafeInteger(amountCents) || body.amount < 0 || body.amount > 10000000 || Math.abs(body.amount * 100 - amountCents) > 0.00001) fail('请输入有效金额，最多两位小数');
  if (db.poolSettlements?.some(s => Date.parse(s.end) > dayStart(today) && Date.parse(s.start) < dayStart(today) + DAY)) fail('今天已有旧规则结算，不能重复分配');
  let row = db.shareholderPools.find(p => p.date === today);
  assertRevision(body.revision, row?.revision || 0);
  if (row && row.status !== 'pending') fail('当天积分池已结算，不能修改旧账');
  if (!row) { row = { id: 'shareholder:' + today, date: today, status: 'pending', revision: 0 }; db.shareholderPools.push(row); }
  Object.assign(row, { amountCents, dueAt, revision: row.revision + 1, updatedAt: stamp(now) });
  audit(db, actor, 'POOL', row.id, { amountCents, revision: row.revision }, now);
  return row;
}
function settle(db, now = Date.now()) {
  init(db);
  if (!enabled(db)) return 0;
  let count = 0;
  for (const pool of db.shareholderPools.filter(p => p.status === 'pending' && Date.parse(p.dueAt) <= now).sort((a, b) => a.date.localeCompare(b.date))) {
    const members = holders(db, Date.parse(pool.dueAt));
    pool.allocations = allocate(pool.amountCents, members);
    pool.totalUnits = members.reduce((n, m) => n + m.units, 0);
    pool.distributedCents = pool.allocations.reduce((n, m) => n + m.amountCents, 0);
    pool.status = pool.totalUnits ? 'settled' : 'noMembers';
    pool.settledAt = stamp(now);
    for (const item of pool.allocations.filter(m => m.amountCents > 0)) {
      const key = pool.id + ':' + item.userId;
      if (!db.earnings.some(e => e.accrualKey === key)) db.earnings.push({ id: crypto.randomUUID(), accrualKey: key, poolSettlementId: pool.id, userId: item.userId, type: 'static', source: 'shareholder', kind: 'credit', amountCents: item.amountCents, amount: item.amountCents / 100, name: '每日分配 ' + pool.date, dueAt: pool.dueAt, createdAt: stamp(now) });
    }
    transfers.queue(db,pool);
    count++;
  }
  return count;
}
function today(db, userId, now = Date.now()) {
  init(db);
  const row = db.shareholderPools.find(p => p.date === dateOf(now));
  const members = holders(db, now), allocations = row?.allocations || allocate(row?.amountCents || 0, members);
  return { enabled: enabled(db), date: dateOf(now), amount: (row?.amountCents || 0) / 100, personalAmount: (allocations.find(m => m.userId === userId)?.amountCents || 0) / 100, status: row?.status || 'empty', revision: row?.revision || 0 };
}
function overview(db, now = Date.now()) {
  init(db);
  const members = holders(db, now);
  return { rule: rule(db), today: today(db, '', now), members, totalUnits: members.reduce((n, m) => n + m.units, 0), transfers:transfers.view(db), transferReady:require('./wechat-transfer.cjs').ready(), pools: [...db.shareholderPools].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90) };
}
module.exports = { init, rule, enabled, eligible, holders, configure, certify, savePool, settle, today, overview, allocate, dateOf };
