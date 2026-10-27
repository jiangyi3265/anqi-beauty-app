// 测试辅助：补录已付款 VIP 套餐，再由后台认证股东。历史补录不发收益。
// admin(route, method, data) 是各测试自己的后台请求函数，返回解析后的 JSON。
async function makeSuperVip(admin, userId, tag = 'sv') {
  const list = await admin('legacyMembers');
  const program = await admin('shareholders');
  const gold = list.products.filter(p => program.rule.plans.some(plan => !plan.legacy && plan.price === p.price)).sort((a, b) => a.price - b.price)[0];
  const plan = gold.packagePlans[0];
  const packageSelection = { planId: plan.id, groups: Object.fromEntries(plan.groups.map(g => [g.id, g.services.slice(0, g.pick).map(s => ({ serviceId: s.id, ...(s.options?.length ? { option: s.options[0] } : {}) }))])) };
  const member = list.members.find(m => m.id === userId);
  const order = await admin('legacyMembers/' + userId, 'POST', { action: 'grant', requestId: tag + '-' + userId, revision: member?.memberRevision || 0, confirmed: true, note: '测试：开通超级VIP', reference: (tag + '-' + userId.slice(0, 8)).toUpperCase(), productId: gold.id, storeId: list.stores[0].id, total: gold.memberPrice ?? gold.price, paidAt: new Date(Date.now() - 3600000).toISOString(), incomeTreatment: 'historical', packageSelection });
  const updated = await admin('legacyMembers');
  await admin('shareholders/member', 'POST', { userId, approved: true, planId: 'package-' + gold.price, orderId: order.id, revision: updated.members.find(m => m.id === userId).memberRevision || 0 });
  return order;
}
module.exports = { makeSuperVip };
