const BRAND = '秀荣科技美肤';
const defaults = {
  name:BRAND, brandTagline:'科技美肤 · 私享护理', brandLogo:'/static/xiurong/wordmark.svg',
  homeImage:'/static/xiurong/arch-room.jpg', themeImage:'/static/xiurong/silk-banner.jpg', mallBanner:'/static/xiurong/skincare-banner.jpg',
  bookingImage:'/static/xiurong/arch-room.jpg', allianceImage:'/static/xiurong/silk-banner.jpg', storeDefaultImage:'/static/xiurong/arch-room.jpg', pointsBanner:'/static/xiurong/silk-banner.jpg',
  homeTitle:'美好，从照顾自己开始', homeSubtitle:'科技美肤 · 私享护理', bookingTitle:'在线预约', bookingSubtitle:'专业护理 · 按需安排',
  vipTitle:'VIP通道', vipSubtitle:'专属服务 · 按次预约', storesTitle:'查看门店', storesSubtitle:'多店选择 · 就近服务',
  allianceTitle:'百业联盟', allianceSubtitle:'发现生活里的更多美好', featuredTitle:'特色项目', goodsTitle:'优选单品',
  shortcutAppointmentLabel:'立即预约', homeFeaturedLimit:0,
  notificationTemplates:{}, subscriptionEnabled:false, messageReminderEnabled:false
};
const imageKeys=['brandLogo','homeImage','themeImage','mallBanner','bookingImage','allianceImage','storeDefaultImage','pointsBanner'];
const textKeys=Object.keys(defaults).filter(k=>typeof defaults[k]==='string'&&!imageKeys.includes(k));
function migrate(db) {
  if(db.config._xiurongLinkedUiV1)return false;
  const oldNames=['暨美丽','纪美丽','秀容美容','安棋美容','安琪美容','玥色塑美','月色塑美'];
  if(!db.config.name||oldNames.includes(db.config.name))db.config.name=BRAND;
  for(const [key,value]of Object.entries(defaults)){
    if(db.config[key]===undefined||(imageKeys.includes(key)&&/^\/static\/(brand|assets)\//.test(db.config[key]||'')))db.config[key]=JSON.parse(JSON.stringify(value));
  }
  // Empty switches did not send messages in older releases. Real subscriptions
  // are opt-in and remain disabled until the operator configures a template.
  if(!Object.keys(db.config.notificationTemplates||{}).length){db.config.subscriptionEnabled=false;db.config.messageReminderEnabled=false}
  for(const key of ['agreement','privacy'])if(typeof db.config[key]==='string')db.config[key]=db.config[key].replace(/暨美丽/g,BRAND);
  for(const store of db.stores||[]){if(store.name==='暨美丽')store.name=BRAND;else if(/^秀容美容[·・]/.test(store.name||''))store.name=store.name.replace(/^秀容美容/,BRAND)}
  for(const product of db.products||[])if(product.visualMode===undefined&&/9D|10D|金钻|超玛吉|AI大师/.test(product.code+' '+product.name))product.visualMode='studio';
  db.config._xiurongLinkedUiV1=true;return true;
}
function validate(config){
  for(const key of imageKeys)if(config[key]!==undefined&&(typeof config[key]!=='string'||config[key]!==''&&!/^(\/static\/|https:\/\/)/.test(config[key])))throw new Error('图片地址无效');
  for(const key of textKeys)if(config[key]!==undefined&&(typeof config[key]!=='string'||!config[key].trim()||config[key].length>120))throw new Error('品牌及页面文案须为1至120个字符');
  if(config.homeFeaturedLimit!==undefined&&(!Number.isInteger(config.homeFeaturedLimit)||config.homeFeaturedLimit<0||config.homeFeaturedLimit>100))throw new Error('首页推荐数量须为0至100，0表示全部');
}
module.exports={BRAND,defaults,imageKeys,textKeys,migrate,validate};
