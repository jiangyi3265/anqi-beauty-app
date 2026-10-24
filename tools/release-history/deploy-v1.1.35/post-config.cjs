// 1.1.35 发布后的四项设置（店主要求），可重复执行：
// 1. 签到每次 1 积分（原 100），积分规则文字同步改为 1 积分；
// 2. 分红池（静态收益）不再分轮次：活动天数改为 0，每天所有持卡会员按套餐权重一起分；
// 3. 体验卡加入商城“特色项目”分类里的 10 个付费项目；原来 3 个仅供卡券领取的体验项目（与商城项目重名）移出体验卡，
//    商品本身保留，已领取的体验卡按领取时的快照照常预约。后台“商品管理 → 体验礼品”开关可随时调整；
// 4. 推荐奖励（动态收益）打开“推荐人须办卡”：好友付款时推荐人本人已办 VIP 卡才计奖励，办卡前的订单不补发。
// 推荐奖励的比例、范围等其他设置不动；分红池的开关、来源、比例、结算周期保持原值。
// 运行：/opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env post-config.cjs
const assert = require('assert/strict'), fs = require('fs');
const base = (process.env.ANQI_API || 'http://127.0.0.1:8097/api').replace(/\/$/, ''), secret = process.env.INTERNAL_SECRET;
if (!secret) throw Error('缺少 INTERNAL_SECRET，请用 --env-file=/opt/anqi/shared/business.env 运行');
const call = async (p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-anqi-internal': secret, 'x-anqi-actor': 'release-1.1.35' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(method + ' ' + p + ' → ' + r.status + ' ' + (d.error || ''));
  return d;
};
(async () => {
  const boot = await call('/bootstrap');
  assert.equal(boot.config.version, '1.1.35', '业务服务不是 1.1.35，先运行 publish.sh');
  const before = await call('/admin/incomeRules');
  const rulesText = String(boot.config.pointsRules || '').replace(/签到获得\s*\d+\s*积分/, '签到获得1积分') || '每日可签到一次，签到获得1积分。积分可用于兑换后台已上架的积分商品。';
  await call('/admin/config', 'PUT', { signPoints: 1, pointsRules: rulesText });
  if (before.pool.activityDays !== 0) await call('/admin/incomeRules/pool', 'PUT', { ...before.pool, activityDays: 0 });
  if (before.referral.requireCard !== true) await call('/admin/incomeRules/referral', 'PUT', { ...before.referral, requireCard: true });
  const products = await call('/admin/products'), featured = boot.categories.find(c => c.name === '特色项目');
  assert.ok(featured, '找不到“特色项目”分类');
  const mallItems = products.filter(p => p.categoryId === featured.id && p.kind === 'service' && p.enabled !== false && !p.trialOnly && !p.gift && !p.packagePlans?.length && Number(p.memberPrice ?? p.price) > 0);
  assert.equal(mallItems.length, 10, '特色项目里的付费项目不是 10 个：' + mallItems.map(p => p.name).join('、'));
  const oldTrial = products.filter(p => p.trial && p.trialOnly && !p.gift);
  for (const p of mallItems) if (!p.trial) await call('/admin/products/' + p.id, 'PUT', { trial: true });
  for (const p of oldTrial) await call('/admin/products/' + p.id, 'PUT', { trial: false });
  const after = await call('/admin/incomeRules'), boot2 = await call('/bootstrap');
  const keep = r => { const { revision, updatedAt, requireCard, ...rest } = r; return rest; };
  assert.deepEqual(keep(after.referral), keep(before.referral), '推荐奖励的比例和范围不应改变');
  assert.equal(after.referral.requireCard, true);
  assert.equal(boot2.config.referralReward.requireCard, true);
  for (const k of ['enabled', 'source', 'percent', 'baseAmount', 'cycle']) assert.deepEqual(after.pool[k], before.pool[k], '分红池 ' + k + ' 不应改变');
  // 保存规则时开始日期会顺延到最后一次结算之后（系统既有规则），已结算记录不受影响
  assert.ok(!before.pool.startDate || after.pool.startDate >= before.pool.startDate, '分红池开始日期不应提前');
  assert.equal(after.pool.activityDays, 0);
  assert.equal(boot2.config.signPoints, 1);
  const trialNow = boot2.products.filter(p => p.trial && p.stock > 0).map(p => p.name);
  assert.equal(trialNow.length, 10, '体验卡项目应为 10 个：' + trialNow.join('、'));
  const report = {
    version: '1.1.35', checkedAt: new Date().toISOString(),
    signPoints: { before: boot.config.signPoints, after: boot2.config.signPoints }, pointsRules: boot2.config.pointsRules,
    pool: { before: { activityDays: before.pool.activityDays, revision: before.pool.revision }, after: { activityDays: after.pool.activityDays, revision: after.pool.revision }, enabled: after.pool.enabled, source: after.pool.source, percent: after.pool.percent, cycle: after.pool.cycle, startDate: { before: before.pool.startDate, after: after.pool.startDate } },
    referral: { requireCard: { before: !!before.referral.requireCard, after: after.referral.requireCard }, enabled: after.referral.enabled, firstPercent: after.referral.firstPercent, laterPercent: after.referral.laterPercent, scope: after.referral.scope, revision: { before: before.referral.revision, after: after.referral.revision } }, poolHolders: after.poolOverview?.members,
    trialCard: { items: trialNow, removedOldTrialOnly: oldTrial.map(p => ({ id: p.id, name: p.name })), pick: boot2.config.trialPick, usesPerItem: boot2.config.trialUses },
  };
  fs.writeFileSync(fs.existsSync('post-config-result.json') ? 'post-config-result-rerun.json' : 'post-config-result.json', JSON.stringify(report, null, 2));
  console.log('签到积分 ' + report.signPoints.before + ' → 1；分红池活动天数 ' + report.pool.before.activityDays + ' → 0（不分轮次）；推荐人须办卡已开启（比例不变）；体验卡项目：' + trialNow.join('、') + '。');
})().catch(e => { console.error(e.message); process.exit(1); });
