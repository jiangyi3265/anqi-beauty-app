// Keep existing IDs so claims and appointments retain their references.
const previous = {
  'jimeili-trial-hydration': { name: '水润焕肤体验', image: '/static/brand/product-salmon-aquatic.jpg', description: '免费体验项目：深层补水与肤感提亮。领取后可选择门店、日期和时间预约使用。' },
  'jimeili-trial-repair': { name: '舒缓修护体验', image: '/static/brand/product-vitamin-c.jpg', description: '免费体验项目：舒缓肌肤、改善干燥紧绷。领取后可选择门店、日期和时间预约使用。' },
  'jimeili-trial-brightening': { name: '光感焕亮体验', image: '/static/brand/product-composite-aqueous.jpg', description: '免费体验项目：焕亮肤色、改善暗沉。领取后可选择门店、日期和时间预约使用。' }
};

function findExisting(products, source) {
  const canonical = products.find(item => item.id === source.id);
  if (canonical?.trialOnly === true) return canonical;
  const old = previous[source.id];
  if (!old) return undefined;
  // Older admin imports used generated IDs. Reuse only an unambiguous legacy trial.
  const matches = products.filter(item => item.trialOnly === true && item.name?.trim() === old.name && item.image === old.image);
  return matches.length === 1 ? matches[0] : canonical;
}

module.exports = function migrateTrialDevices(db, catalogue) {
  if (db.config._trialDeviceCatalogV1 === true) return false;
  for (const source of catalogue.filter(product => previous[product.id])) {
    const product = findExisting(db.products, source);
    const old = previous[source.id];
    if (!product || (product.name && product.name !== old.name && product.name !== source.name)) continue;
    for (const key of ['name', 'subtitle', 'referencePrice', 'image', 'detailImage', 'description']) {
      const oldValue = key === 'detailImage' ? old.image : old[key];
      if (product[key] == null || product[key] === '' || product[key] === oldValue) product[key] = source[key];
    }
  }
  // Stock, availability, existing claims and completed bookings stay intact.
  db.config._trialDeviceCatalogV1 = true;
  return true;
};
module.exports.findExisting = findExisting;
