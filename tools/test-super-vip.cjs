// 测试辅助：让某个会员成为超级VIP会员（门店在“会员权益办理”给他补录一张已付款的 VIP 套餐卡，历史补录、不发收益）。
// 只有超级VIP会员的邀请码才能建立推荐关系，所以测试里的推荐人要先调用这个。
// admin(route, method, data) 是各测试自己的后台请求函数，返回解析后的 JSON。
async function makeSuperVip(admin, userId, tag = 'sv') {
  const list = await admin('legacyMembers');
  const gold = list.products.slice().sort((a, b) => (a.memberPrice ?? a.price) - (b.memberPrice ?? b.price))[0];
  const plan = gold.packagePlans[0];
  const packageSelection = { planId: plan.id, groups: Object.fromEntries(plan.groups.map(g => [g.id, g.services.slice(0, g.pick).map(s => ({ serviceId: s.id, ...(s.options?.length ? { option: s.options[0] } : {}) }))])) };
  const member = list.members.find(m => m.id === userId);
  return admin('legacyMembers/' + userId, 'POST', { action: 'grant', requestId: tag + '-' + userId, revision: member?.memberRevision || 0, confirmed: true, note: '测试：开通超级VIP', reference: (tag + '-' + userId.slice(0, 8)).toUpperCase(), productId: gold.id, storeId: list.stores[0].id, total: gold.memberPrice ?? gold.price, paidAt: new Date(Date.now() - 3600000).toISOString(), incomeTreatment: 'historical', packageSelection });
}
module.exports = { makeSuperVip };
