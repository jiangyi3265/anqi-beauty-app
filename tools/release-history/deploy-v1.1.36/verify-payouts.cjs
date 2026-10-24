// 1.1.36 发布后只读核对：业务服务版本、收益兑现接口可用、兑现表已建（不写入任何数据）
// 运行：/opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env verify-payouts.cjs
const assert = require('assert/strict'), fs = require('fs');
const base = (process.env.ANQI_API || 'http://127.0.0.1:' + (process.env.PORT || 3016) + '/api').replace(/\/$/, ''), secret = process.env.INTERNAL_SECRET;
if (!secret) throw Error('缺少 INTERNAL_SECRET，请用 --env-file=/opt/anqi/shared/business.env 运行');
const call = async p => { const r = await fetch(base + p, { headers: { 'x-anqi-internal': secret, 'x-anqi-actor': 'release-1.1.36' } }); const d = await r.json().catch(() => ({})); if (!r.ok) throw Error('GET ' + p + ' → ' + r.status + ' ' + (d.error || '')); return d; };
(async () => {
  const boot = await call('/bootstrap');
  assert.equal(boot.config.version, '1.1.36', '业务服务不是 1.1.36');
  const o = await call('/admin/earnings/payouts');
  assert.ok(Array.isArray(o.members) && Array.isArray(o.payouts) && o.totals && o.methods?.wechat, '收益兑现接口返回格式不对');
  const report = { version: '1.1.36', checkedAt: new Date().toISOString(), membersWithIncome: o.members.length, payouts: o.payouts.length, totals: o.totals };
  fs.writeFileSync('verify-payouts.json', JSON.stringify(report, null, 2));
  console.log('收益兑现接口正常：有收益会员 ' + report.membersWithIncome + ' 位，累计 ¥' + o.totals.earned.toFixed(2) + '，已兑现 ¥' + o.totals.paidOut.toFixed(2) + '，待兑现 ¥' + o.totals.available.toFixed(2) + '。');
})().catch(e => { console.error(e.message); process.exit(1); });
