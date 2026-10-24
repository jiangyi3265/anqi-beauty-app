// 只读核对：停用的门店上是否还挂着未完成的订单或预约（这些订单停用门店后无法再预约）。不修改任何数据。
// 运行：/opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env check-disabled-store.cjs
const fs = require('fs');
const base = (process.env.ANQI_API || 'http://127.0.0.1:' + (process.env.PORT || 3016) + '/api').replace(/\/$/, ''), secret = process.env.INTERNAL_SECRET;
if (!secret) throw Error('缺少 INTERNAL_SECRET，请用 --env-file=/opt/anqi/shared/business.env 运行');
const call = async p => { const r = await fetch(base + p, { headers: { 'x-anqi-internal': secret, 'x-anqi-actor': 'check-disabled-store' } }); const d = await r.json().catch(() => ({})); if (!r.ok) throw Error('GET ' + p + ' → ' + r.status + ' ' + (d.error || '')); return d; };
(async () => {
  const [stores, orders, appointments, users] = await Promise.all([call('/admin/stores'), call('/admin/orders'), call('/admin/appointments'), call('/admin/users')]);
  const off = new Set(stores.filter(s => s.enabled === false).map(s => s.id)), name = id => users.find(u => u.id === id)?.name || '未填写姓名';
  const remaining = o => o.package ? o.package.services.reduce((n, s) => n + Math.max(0, (s.total || 0) - (s.used || 0)), 0) : null;
  const openOrders = orders.filter(o => off.has(o.storeId) && ['pending', 'ready', 'shipping'].includes(o.status)).map(o => ({ number: o.number, member: name(o.userId), product: o.product?.name, total: o.total, status: o.status, packageRemaining: remaining(o) }));
  const booked = appointments.filter(a => off.has(a.storeId) && a.status === 'booked').map(a => ({ member: name(a.userId), name: a.name, date: a.date, time: a.time }));
  const report = { checkedAt: new Date().toISOString(), disabledStores: stores.filter(s => s.enabled === false).map(s => ({ id: s.id, name: s.name, address: s.address })), openOrders, bookedAppointments: booked, allOrdersOnDisabledStores: orders.filter(o => off.has(o.storeId)).length };
  fs.writeFileSync('check-disabled-store.json', JSON.stringify(report, null, 2));
  console.log(openOrders.length || booked.length ? '有 ' + openOrders.length + ' 笔未完成订单、' + booked.length + ' 条预约挂在停用门店上，需要处理' : '停用门店上没有未完成的订单和预约，可以放心停用');
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e.message); process.exit(1); });
