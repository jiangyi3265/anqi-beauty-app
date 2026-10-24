// 线上数据修正（店主确认）：1. 删除隐私政策末尾的占位话；可选补充运营主体（环境变量 COMPANY、COMPANY_PHONE）；
// 2. 停用地址为“晋安路集英花园北门吕庄一组集资楼3号楼第4套”的门店（只改“是否上架”，不删除，历史订单和预约照常保留）。
// 只改这两处，可重复执行；默认先预览，加 APPLY=1 才真正修改。
// 运行：APPLY=1 /opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env fix-live-data.cjs
const assert = require('assert/strict'), fs = require('fs');
const base = (process.env.ANQI_API || 'http://127.0.0.1:' + (process.env.PORT || 3016) + '/api').replace(/\/$/, ''), secret = process.env.INTERNAL_SECRET, apply = process.env.APPLY === '1';
if (!secret) throw Error('缺少 INTERNAL_SECRET，请用 --env-file=/opt/anqi/shared/business.env 运行');
const call = async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-anqi-internal': secret, 'x-anqi-actor': 'data-fix-20261023' }, body: body === undefined ? undefined : JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(method + ' ' + p + ' → ' + r.status + ' ' + (d.error || '')); return d; };
const PLACEHOLDER = '正式上线前请经营方根据实际主体和业务完成审核。', ADDRESS = '晋安路集英花园北门吕庄一组集资楼3号楼第4套';
(async () => {
  const config = await call('/admin/config'), stores = await call('/admin/stores');
  let privacy = String(config.privacy || '').replace(PLACEHOLDER, '').trim();
  if (process.env.COMPANY && !privacy.includes(process.env.COMPANY)) privacy += '运营主体：' + process.env.COMPANY + (process.env.COMPANY_PHONE ? '，联系电话：' + process.env.COMPANY_PHONE : '') + '。';
  const target = stores.filter(s => String(s.address || '').includes(ADDRESS) && s.enabled !== false), others = stores.filter(s => s.enabled !== false && !target.includes(s));
  assert.ok(target.length <= 1, '匹配到多家门店，请人工核对');
  assert.ok(others.length >= 1, '停用后没有其他上架门店，停止');
  console.log((apply ? '执行' : '预览') + '：隐私政策' + (privacy !== config.privacy ? '将去掉占位话' + (process.env.COMPANY ? '并补充运营主体' : '') : '无需修改') + '；门店' + (target.length ? '将停用：' + target[0].name + '（' + target[0].phone + '）' : '无需修改') + '；保留上架门店：' + others.map(s => s.name).join('、'));
  if (!apply) return;
  if (privacy !== config.privacy) await call('/admin/config', 'PUT', { privacy });
  for (const s of target) await call('/admin/stores/' + s.id, 'PUT', { enabled: false });
  const boot = await call('/bootstrap');
  assert.ok(!boot.config.privacy.includes(PLACEHOLDER), '隐私政策仍有占位话');
  assert.ok(!boot.stores.some(s => String(s.address || '').includes(ADDRESS)), '晋安路门店仍在用户端显示');
  const report = { checkedAt: new Date().toISOString(), privacy: boot.config.privacy, stores: boot.stores.map(s => ({ name: s.name, phone: s.phone, address: s.address })), disabled: target.map(s => ({ id: s.id, name: s.name, address: s.address })) };
  fs.writeFileSync('fix-live-data-result.json', JSON.stringify(report, null, 2));
  console.log('已完成：隐私政策已去掉占位话；用户端门店：' + report.stores.map(s => s.name).join('、') + '。');
})().catch(e => { console.error(e.message); process.exit(1); });
