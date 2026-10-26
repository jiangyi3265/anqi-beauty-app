const crypto = require('node:crypto');
const LIMIT = 3;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const claimsOf = (db, userId) => db.claims.filter(c => c.userId === userId && (c.type || 'trial') === 'trial');
function summary(db, userId) {
  const claims = claimsOf(db, userId), ids = new Set(claims.map(c => c.id));
  const bookings = db.appointments.filter(a => ids.has(a.claimId));
  const used = bookings.filter(a => a.status === 'completed').length;
  const booked = bookings.filter(a => a.status === 'booked').length;
  return { legacy: claims.some(c => !c.flexibleTrial), limit: LIMIT, used, booked, remaining: Math.max(0, LIMIT - used - booked) };
}
function select(db, userId, productIds) {
  const quota = summary(db, userId);
  if (quota.legacy) fail('您已有体验卡，请继续使用原卡中的权益');
  if (!quota.remaining) fail('体验权益已用完或已预约，请先查看我的预约');
  if (!Array.isArray(productIds) || productIds.length !== 1) fail('请选择一个体验项目');
  const product = db.products.find(p => p.id === productIds[0] && p.trial && p.kind === 'service' && p.enabled && p.status === 'published');
  if (!product || product.stock < 1) fail('该体验项目已下架或暂无名额');
  let claim = claimsOf(db, userId)[0];
  if (!claim) {
    claim = { id: crypto.randomUUID(), userId, type: 'trial', flexibleTrial: true, productIds: [], products: [], uses: LIMIT, createdAt: new Date().toISOString() };
    db.claims.push(claim);
  }
  if (!claim.productIds.includes(product.id)) {
    claim.productIds.push(product.id);
    claim.products.push(JSON.parse(JSON.stringify(product)));
  }
  return claim;
}
function assertAvailable(db, claim) {
  if (claim.flexibleTrial && summary(db, claim.userId).remaining < 1) fail('每人共3次体验权益，当前已用完或已预约');
}
function reserve(db, claim, productId, appointment) {
  if (!claim.flexibleTrial) return;
  assertAvailable(db, claim);
  const product = db.products.find(p => p.id === productId && p.enabled && p.status === 'published');
  if (!product || product.stock < 1) fail('该体验项目暂无名额');
  const sku = product.skus?.find(s => s.enabled !== false && s.stock > 0);
  if (product.skus?.length && !sku) fail('该体验项目暂无名额');
  if (sku) { sku.stock--; product.stock = product.skus.filter(s => s.enabled !== false).reduce((n, s) => n + s.stock, 0); }
  else product.stock--;
  appointment.trialInventory = { productId, skuId: sku?.id || '' };
}
function release(db, appointment) {
  const reservation = appointment.trialInventory;
  if (!reservation || reservation.released) return;
  const product = db.products.find(p => p.id === reservation.productId);
  if (product) {
    const sku = product.skus?.find(s => s.id === reservation.skuId);
    if (sku) { sku.stock++; product.stock = product.skus.filter(s => s.enabled !== false).reduce((n, s) => n + s.stock, 0); }
    else product.stock++;
  }
  reservation.released = true;
}
module.exports = { summary, select, assertAvailable, reserve, release };
