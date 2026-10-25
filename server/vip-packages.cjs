const catalogue = require('../common/vip-catalogue.json');
const clone = value => JSON.parse(JSON.stringify(value));
function reject(message) { const error = new Error(message); error.status = 400; throw error; }
function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) reject(label + '不能为空且不能超过120字');
  return value.trim();
}
function identifier(value, label) {
  const id = requiredText(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) || ['__proto__', 'constructor', 'prototype', 'fixed'].includes(id)) reject(label + '格式无效');
  return id;
}
function unique(rows, label) { if (new Set(rows.map(row => row.id)).size !== rows.length) reject(label + '编号不能重复'); }
function service(value) {
  const row = { id: identifier(value?.id, '项目编号'), name: requiredText(value?.name, '项目名称'), total: value?.total };
  if (!Number.isInteger(row.total) || row.total < 1 || row.total > 999) reject('项目次数须为1至999的整数');
  if(value.productId!=null)row.productId=identifier(value.productId,'关联商品');
  if(value.kind!=null){if(!['goods','service'].includes(value.kind))reject('项目类型无效');row.kind=value.kind;}
  if (value.referencePrice != null) {
    if (!Number.isFinite(value.referencePrice) || value.referencePrice < 0) reject('项目参考价值无效');
    row.referencePrice = value.referencePrice;
  }
  if (value.options != null) {
    if (!Array.isArray(value.options) || value.options.length > 20) reject('项目可选类型无效');
    row.options = value.options.map(option => requiredText(option, '项目可选类型'));
    if (new Set(row.options).size !== row.options.length) reject('项目可选类型不能重复');
  }
  return row;
}
function validatePlans(value) {
  if (!Array.isArray(value) || value.length > 10) reject('套餐方案格式无效');
  const plans = value.map(item => {
    if (!item || typeof item !== 'object' || !Array.isArray(item.services) || item.services.length > 50 || !Array.isArray(item.groups) || item.groups.length > 10) reject('套餐项目格式无效');
    const plan = { id: identifier(item.id, '方案编号'), name: requiredText(item.name, '方案名称'), services: item.services.map(service), groups: item.groups.map(group => {
      if (!group || typeof group !== 'object' || !Array.isArray(group.services) || !group.services.length || group.services.length > 30) reject('自选组需要1至30个项目');
      const services = group.services.map(service);
      if (!Number.isInteger(group.pick) || group.pick < 1 || group.pick > services.length) reject('自选数量不能超过项目数量');
      unique(services, '自选项目');
      return { id: identifier(group.id, '自选组编号'), name: requiredText(group.name, '自选组名称'), pick: group.pick, services };
    }) };
    if (!plan.services.length && !plan.groups.length) reject('套餐至少需要一个项目');
    if (plan.services.some(row => row.options?.length)) reject('带可选类型的项目请放入自选组');
    unique(plan.services, '固定项目'); unique(plan.groups, '自选组');
    return plan;
  });
  unique(plans, '方案');
  return plans;
}
function seedCatalogue(db) {
  if (db.config._vipPackagesV1) return false;
  db.categories ||= [];
  if (!db.categories.some(row => row.id === catalogue.category.id)) db.categories.push(clone(catalogue.category));
  const kit = db.products.find(row => row.id === 'jimeili-rejuvenation-set');
  const kitWasLast = kit && db.products.every(row => row.id === kit.id || (row.sort || 0) <= (kit.sort || 0));
  for (const product of catalogue.products) if (!db.products.some(row => row.id === product.id)) db.products.push(clone(product));
  if (kitWasLast) kit.sort = Math.max(...db.products.map(row => Number(row.sort) || 0)) + 1;
  db.config._vipPackagesV1 = true;
  return true;
}
function selectPackage(product, selection) {
  const plans = validatePlans(product.packagePlans);
  const plan = plans.find(row => row.id === selection?.planId);
  if (!plan) reject('请选择有效的套餐方案');
  const groups = selection.groups;
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) reject('请完成套餐自选项目');
  if (Object.keys(groups).some(key => !plan.groups.some(group => group.id === key))) reject('套餐自选组无效');
  const services = plan.services.map(row => ({ ...row, id: 'fixed:' + row.id, used: 0 }));
  const selectedGroups = {};
  for (const group of plan.groups) {
    const choices = groups[group.id];
    if (!Array.isArray(choices) || choices.length !== group.pick || new Set(choices.map(row => row?.serviceId)).size !== group.pick) reject(group.name + '请选择' + group.pick + '个不同项目');
    selectedGroups[group.id] = choices.map(choice => {
      const source = group.services.find(row => row.id === choice?.serviceId);
      if (!source) reject('自选项目不属于当前套餐方案');
      if (source.options?.length && !source.options.includes(choice.option)) reject('请选择' + source.name + '的具体类型');
      if (!source.options?.length && choice.option) reject('该项目没有可选类型');
      const option = choice.option || '';
      services.push({ ...source, id: group.id + ':' + source.id, name: source.name + (option ? '（' + option + '）' : ''), option, used: 0 });
      return { serviceId: source.id, ...(option ? { option } : {}) };
    });
  }
  return { planId: plan.id, planName: plan.name, selections: selectedGroups, services };
}
function remaining(order, entitlementId, appointments) {
  const service = order.package?.services.find(row => row.id === entitlementId);
  if (!service || service.kind==='goods') return 0;
  const booked = appointments.filter(row => row.orderId === order.id && row.entitlementId === entitlementId && row.status === 'booked').length;
  return Math.max(0, service.total - service.used - booked);
}
function complete(order, appointment) {
  if (order.status !== 'ready') reject('套餐订单当前不可核销');
  const service = order.package.services.find(row => row.id === appointment.entitlementId);
  if (!service || service.kind==='goods' || service.used >= service.total) reject('套餐项目次数已用完');
  service.used++;
  if (order.package.services.every(row => row.used >= row.total)) { order.status = 'completed'; order.completedAt = new Date().toISOString(); }
}
function pickup(order, entitlementId, expectedUsed, actor) {
 const item=order.package?.services.find(s=>s.id===entitlementId);
 if(order.status!=='ready'||order.paymentStatus!=='paid'||order.refundStatus==='refunded'||!item||item.kind!=='goods')reject('当前项目不可领取');
 if(!Number.isInteger(expectedUsed)||expectedUsed!==item.used||item.used>=item.total)reject('领取记录已更新，请刷新后核对');
 item.used++;order.pickups||=[];order.pickups.push({entitlementId,quantity:1,actor,createdAt:new Date().toISOString()});
 if(order.package.services.every(s=>s.used>=s.total)){order.status='completed';order.completedAt=new Date().toISOString();}
}
module.exports = { pickup, validatePlans, seedCatalogue, selectPackage, remaining, complete };
