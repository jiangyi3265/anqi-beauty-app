const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const seed = require('./seed.cjs');
const migrateTrialDevices = require('./trial-device-migration.cjs');
const wechat = require('./wechat-login.cjs');
const vipPackages = require('./vip-packages.cjs');
const staffScheduling = require('./staff-scheduling.cjs');
const income = require('./income.cjs');
const legacyMembers = require('./legacy-members.cjs');
const presentation = require('./presentation-config.cjs');
const notifications = require('./notifications.cjs');
const APP_VERSION = require('../package.json').version;
const ROOT = path.resolve(__dirname, '..');
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data/db.json');
const DEMO = process.env.DEMO_MODE === 'true';
const PAYMENT_MODE = process.env.PAYMENT_MODE || 'off';
const MOCK_PAYMENT = PAYMENT_MODE === 'mock' && ['test','staging','development'].includes(process.env.NODE_ENV);
const wechatPay = require('./wechat-pay.cjs');
// 微信支付只在配置齐全时启用；配置不全时保持“门店收款”，并在启动日志列出缺少的配置项名称
const WECHAT_PAY = PAYMENT_MODE === 'wechat' && wechatPay.configured();
if (PAYMENT_MODE === 'wechat' && !WECHAT_PAY) console.error('微信支付未启用，缺少或无效的配置：' + wechatPay.problems().join('、'));
const paymentModeName = () => MOCK_PAYMENT ? 'mock' : WECHAT_PAY ? 'wechat' : 'off';
const HOST = process.env.HOST || '127.0.0.1';
const sessions = new Map();
let mysqlStore;
// 会员等级：本人已付款、未退款、未取消的 VIP 套餐中价格最高的一档；没有则为空。有等级即“超级VIP会员”：才有专属二维码、才能推荐别人
function vipLevel(u){const held=db.orders.filter(o=>o.userId===u.id&&o.product?.packagePlans?.length&&o.paymentStatus==='paid'&&o.refundStatus!=='refunded'&&!['cancelled','pending','aftersale'].includes(o.status));if(!held.length)return null;const top=held.reduce((a,o)=>Number(o.product.memberPrice??o.product.price)>Number(a.product.memberPrice??a.product.price)?o:a);const name=String(top.product.name||'VIP').replace(/套餐$/,'');return {name:name.endsWith('会员')?name:name+'会员',productId:top.productId,orderId:top.id}}
const publicUser=u=>({...Object.fromEntries(Object.entries(u).filter(([k])=>!['openid','unionid','session_key','wechatAppId','wechatLoginCodes','password','salt','hash','subscriptionCredits','adminNote','offlineRequestId','offlineFingerprint'].includes(k))),wechatBound:!!u.openid});
const internal=req=>process.env.INTERNAL_SECRET && req.headers['x-anqi-internal']===process.env.INTERNAL_SECRET;
const attempts = new Map();
const configDefaults = { name: '暨美丽', version: '1.0.9', appointmentCapacity: 1, appointmentTimes: '09:00,10:00,11:00,14:00,15:00,16:00,17:00,18:00', shortcutTrialLabel: '体验卡', shortcutVipLabel: '贵宾卡', shortcutShareLabel: '邀请码', homeImage: '/static/brand/hero-middle.jpg', heroTop: '/static/brand/hero-top-jimeili-v2.jpg', heroBottom: '/static/brand/hero-bottom-v2.jpg', storeDefaultImage: '/static/brand/store-cover-jimeili-v2.jpg', brandLogo: '/static/brand/logo-jimeili.png', welcome: '/static/assets/service-heading.jpg', hero: '/static/brand/jimeili-1-steamed-face.jpg', brand: '/static/brand/brand-jimeili.png', projectPromo: '/static/assets/service-heading.jpg', storePromo: '/static/brand/store-cover-jimeili-v2.jpg', customerQr: '', pointsBanner: '/static/assets/points-banner.jpg', serviceHeading: '/static/assets/service-heading.jpg', productHeading: '/static/assets/product-heading.jpg', signPoints: 1, maxGifts: 3, trialPick: 3, trialUses: 1, pointsRules: '每日可签到一次，签到获得1积分。积分可用于兑换后台已上架的积分商品。', subscriptionEnabled: true, messageReminderEnabled: true, marketingEnabled: true, agreement: '本协议说明您使用暨美丽小程序时的服务规则。您在注册、登录、下单、预约、领取礼品前，请核对商品、价格、库存、门店、数量和联系方式。您应遵守法律法规及平台规则，不得从事违法、欺诈、骚扰或损害他人权益的行为。订单、预约、礼品和售后以小程序及后台实时记录为准。如有疑问，请通过客服或门店渠道咨询。经营方会在法律允许范围内调整服务规则，并在小程序内公布调整内容。', privacy: '本隐私政策说明暨美丽在提供微信登录、商品购买、门店预约、订单履约、礼品领取和客服服务时的信息处理方式。我们仅在实现相应功能所必需的范围内处理微信身份标识、昵称头像、联系方式、收货地址、订单、预约和设备运行信息，不会向前端展示微信密钥或会话密钥。您可以通过个人中心、客服或门店渠道咨询、更正或删除相关信息。政策发生重大变化时，我们会在小程序内提示。正式上线前请经营方根据实际主体和业务完成审核。' };
Object.assign(configDefaults,presentation.defaults,{version:APP_VERSION});
const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('hex');
if (!DEMO && !process.env.ADMIN_PASSWORD) throw new Error('正式环境必须设置 ADMIN_PASSWORD');
if (DEMO && !['127.0.0.1', 'localhost', '::1'].includes(HOST)) throw new Error('演示接口仅允许监听本机');
let db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : seed();
db.paymentAudits ||= [];
db.assets ||= [];
db.homeModules ||= [];
db.inventory ||= [];
db.rewards ||= [];
db.ledger ||= [];
db.redemptions ||= [];
staffScheduling.initialize(db);
income.init(db);
notifications.init(db);
for(const r of db.sessions||[])if(r.expires>Date.now())sessions.set(r.id,r);
let fileQueue=Promise.resolve();
function runFile(fn){const task=fileQueue.then(async()=>{const previous=JSON.stringify(db);const previousSessions=new Map([...sessions].map(([k,v])=>[k,{...v}]));try{const result=await fn();db.sessions=[...sessions].filter(([,r])=>r.expires>Date.now()).map(([id,r])=>({id,...r}));save();return result}catch(e){db=JSON.parse(previous);sessions.clear();for(const [k,v]of previousSessions)sessions.set(k,v);save();throw e}});fileQueue=task.catch(()=>{});return task;}
function save() { if(mysqlStore)return; fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 2)); fs.renameSync(FILE + '.tmp', FILE); }
function fail(message, code = 400) { const e = new Error(message); e.status = code; throw e; }
function id() { return crypto.randomUUID(); }
function validDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(value + 'T00:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value; }
function day() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function text(v, max = 200) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function storeSnapshot(store) { return Object.fromEntries(['id','name','address','contact','phone','hours'].map(key => [key, store[key] || ''])); }
function preserveStoreRecords(store) { let changed = false; for (const records of [db.orders, db.appointments]) for (const record of records) if (record.storeId === store.id && record.store?.id !== store.id) { record.store = storeSnapshot(store); changed = true; } return changed; }
function token(userId, role = 'user') { const t = crypto.randomBytes(32).toString('hex'); sessions.set(t, { userId, role, expires: Date.now() + 86400000 }); return t; }
function session(req, admin = false) { if(admin && internal(req))return {role:"admin",userId:"admin"}; const s = sessions.get((req.headers.authorization || '').replace(/^Bearer /, '')); if (!s || s.expires < Date.now()) fail('请先登录', 401); if (admin && s.role !== 'admin') fail('无管理权限', 403); return s; }
function user(req) { const s = session(req); const u = db.users.find(u => u.id === s.userId && !u.disabled); if (!u) fail('用户不存在', 401); return u; }
function own(collection, key, u) { const item = db[collection].find(x => x.id === key && x.userId === u.id); if (!item) fail('记录不存在', 404); return item; }
function expire() { let changed = false; for (const o of db.orders) if (o.status === 'pending' && !o.wechatPay?.prepayId && Date.now() - Date.parse(o.createdAt) >= 7200000) { o.status = 'cancelled'; restore(o); changed = true; } if (changed) save(); }
function take(o) { if(o.inventoryReserved===false)return; const p = db.products.find(p => p.id === o.productId); if (!p) return; const sku=p.skus?.find(s => s.id===o.skuId); if (sku) sku.stock -= o.quantity; p.stock = p.skus?.length ? p.skus.filter(s=>s.enabled!==false).reduce((n,s)=>n+s.stock,0) : p.stock - o.quantity; }
function restore(o) { if(o.inventoryReserved===false)return; const p = db.products.find(p => p.id === o.productId); if (!p) return; const sku=p.skus?.find(s => s.id===o.skuId); if (sku) sku.stock += o.quantity; p.stock = p.skus?.length ? p.skus.filter(s=>s.enabled!==false).reduce((n,s)=>n+s.stock,0) : p.stock + o.quantity; }
async function body(req) { let buffer = ''; for await (const b of req) { buffer += b; if (buffer.length > 8 * 1024 * 1024) fail('内容过大', 413); } if (!buffer) return {}; let parsed; try { parsed = JSON.parse(buffer); } catch { fail('请求内容格式不正确'); } if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('请求内容必须为对象'); return parsed; }
const editable = ['products', 'categories', 'stores', 'activities', 'alliances', 'rewards', 'homeModules'];
function normalizeSku(value) {
  const rawAttributes = value?.attributes && typeof value.attributes === 'object' ? value.attributes : Object.fromEntries(String(value?.attributesText || '').split(/[,，]/).map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf(':');return i>0?[v.slice(0,i).trim(),v.slice(i+1).trim()]:['','']}).filter(([k,v])=>k&&v));
  const attributes = Object.fromEntries(Object.entries(rawAttributes).map(([k,v])=>[text(k,40),text(v,80)]).filter(([k,v])=>k&&v));
  const sku = { id: text(value?.id, 80) || id(), name: text(value?.name || value?.spec || '默认规格', 80), code: text(value?.code, 80), attributes, price: Number(value?.price), stock: Number(value?.stock), image: text(value?.image, 1000), enabled: value?.enabled !== false };
  if (!Number.isFinite(sku.price) || sku.price < 0) sku.price = 0;
  if (!Number.isInteger(sku.stock) || sku.stock < 0) sku.stock = 0;
  if (value?.serviceSessions != null) sku.serviceSessions = Number(value.serviceSessions);
  return sku;
}
function normalizeProduct(product) {
  if (!product || typeof product !== 'object') return product;
  product.code = text(product.code, 80);
  product.groupIds = text(product.groupIds, 500);
  product.memberPrice = product.memberPrice === undefined || product.memberPrice === null || product.memberPrice === '' ? null : Number(product.memberPrice);
  if (!Number.isFinite(product.memberPrice) || product.memberPrice < 0) product.memberPrice = null;
  product.freeShipping = product.freeShipping === true;
  product.subtitle = text(product.subtitle, 200);
  product.brand = text(product.brand, 80);
  product.referencePrice = product.referencePrice == null || product.referencePrice === '' ? null : Number(product.referencePrice);
  if (!Number.isFinite(product.referencePrice) || product.referencePrice < 0) product.referencePrice = null;
  product.keywords = Array.isArray(product.keywords) ? product.keywords.map(v => text(v, 40)).filter(Boolean) : text(product.keywords, 300).split(/[,，\s]+/).map(v => text(v, 40)).filter(Boolean);
  product.gallery = Array.isArray(product.gallery) ? product.gallery.filter(v => typeof v === 'string' && /^(\/static\/|https:\/\/)/.test(v)) : [];
  product.sort = Number.isInteger(product.sort) ? product.sort : 0;
  product.status = ['draft', 'published', 'offline'].includes(product.status) ? product.status : (product.enabled === false ? 'offline' : 'published');
  product.recommended = typeof product.recommended === 'boolean' ? product.recommended : product.home === true;
  product.hot = product.hot === true;
  product.isNew = product.isNew === true;
  product.home = product.recommended;
  product.enabled = product.status === 'published';
  product.skus = Array.isArray(product.skus) ? product.skus.map(normalizeSku) : [];
  if (product.skus.length) {
    const active = product.skus.filter(s => s.enabled !== false);
    product.stock = active.reduce((sum, sku) => sum + sku.stock, 0);
    product.price = active[0]?.price ?? product.price;
    if(!product.image)product.image = active[0]?.image || '';
  }
  return product;
}
function validate(collection, b) {
  const fields = { products: ['name','code','subtitle','brand','groupIds','keywords','gallery','image','detailImage','price','memberPrice','referencePrice','coursePrice','kind','categoryId','stock','sold','sort','status','home','recommended','hot','isNew','gift','trial','trialOnly','freeShipping','enabled','description','skus','packagePlans','visualMode'], categories: ['name','sort','enabled'], stores: ['name','contact','phone','address','image','imageCaption','gallery','hours','enabled','schedulingEnabled','appointmentDurationMinutes'], activities: ['name','image','description','productId','startAt','endAt','enabled'], alliances: ['name','image','description','phone','enabled'], rewards: ['name','image','points','stock','enabled'], homeModules: ['type','title','subtitle','image','sort','enabled','publishStatus','targetType','targetId','description'] }[collection];
  const out = Object.fromEntries(fields.filter(k => b[k] !== undefined).map(k => [k,b[k]]));
  if(collection==='products'&&out.visualMode!==undefined&&!['image','studio'].includes(out.visualMode))fail('图片展示方式无效');
  if (collection === 'products' && b.recommended === undefined && b.home !== undefined) out.recommended = b.home === true;
  if(out.coursePrice===null)delete out.coursePrice;
  if (collection !== 'homeModules' && !text(out.name)) fail('名称不能为空');
  if (collection === 'homeModules' && (!text(out.title) || !text(out.image))) fail('首页模块标题和图片不能为空');
  if (collection === 'stores') {
    if (out.schedulingEnabled !== undefined && typeof out.schedulingEnabled !== 'boolean') fail('员工排班开关无效');
    if (out.appointmentDurationMinutes !== undefined && (!Number.isInteger(out.appointmentDurationMinutes) || out.appointmentDurationMinutes < 15 || out.appointmentDurationMinutes > 480)) fail('预约占用时长须为15至480分钟的整数');
  }
  if (collection === 'categories' && (out.sort !== undefined && (!Number.isInteger(out.sort) || out.sort < 0))) fail('分类排序必须为非负整数');
  for (const k of ['price', 'memberPrice', 'referencePrice', 'coursePrice', 'stock', 'sold', 'points']) if (out[k] !== undefined && !(['memberPrice','referencePrice'].includes(k) && out[k] === null) && (typeof out[k] !== 'number' || !Number.isFinite(out[k]) || out[k] < 0 || (['stock','sold','points'].includes(k) && !Number.isInteger(out[k])))) fail(({price:'价格',memberPrice:'会员价',referencePrice:'项目价值',coursePrice:'疗程价格',stock:'库存',sold:'已售数量',points:'积分'}[k]||'数量') + '必须为有效非负数字');
  if (collection === 'products' && !['goods','service'].includes(out.kind)) fail('商品类型必填'); if (collection === 'products' && (!Array.isArray(out.skus) || !out.skus.length) && (out.price === undefined || out.stock === undefined)) fail('无SKU商品必须填写价格和库存');
  if (collection === 'products' && out.status !== undefined && !['draft','published','offline'].includes(out.status)) fail('商品状态无效');
  if (collection === 'products' && out.sort !== undefined && (!Number.isInteger(out.sort) || out.sort < 0)) fail('商品排序必须为非负整数');
  if (collection === 'products' && out.skus !== undefined) {
    if (!Array.isArray(out.skus)) fail('SKU 格式无效');
    if (out.skus.some(s => s?.serviceSessions != null && (out.kind !== 'service' || !Number.isInteger(s.serviceSessions) || s.serviceSessions < 1 || s.serviceSessions > 999))) fail('服务规格次数须为1至999的整数，实物商品不能设置服务次数'); if (out.skus.some(s => !text(s?.name || s?.spec) || !Number.isFinite(Number(s?.price)) || Number(s?.price) < 0 || !Number.isInteger(Number(s?.stock)) || Number(s?.stock) < 0)) fail('每个SKU都必须填写规格名称、有效价格和库存'); out.skus = out.skus.map(normalizeSku);
    if (new Set(out.skus.map(s => s.code).filter(Boolean)).size !== out.skus.filter(s => s.code).length) fail('SKU 编码不能重复');
  }
  if (collection === 'rewards' && (out.points === undefined || out.stock === undefined)) fail('积分和库存必填');
  if (collection === 'homeModules' && (!['banner','category','product','activity','store','notice'].includes(out.type) || !['','product','category','activity','store'].includes(out.targetType || ''))) fail('首页模块类型无效'); if (collection === 'homeModules' && out.targetType && out.targetId) { const targetCollection={product:'products',category:'categories',activity:'activities',store:'stores'}[out.targetType]; if (targetCollection && !db[targetCollection].some(item=>item.id===out.targetId)) fail('首页跳转目标不存在'); }
  for (const key of ['image','detailImage']) if (out[key] && !/^(\/static\/|https:\/\/)/.test(out[key])) fail('图片使用 /static/ 路径或 HTTPS 地址');
  if (['products','stores'].includes(collection) && out.gallery && (!Array.isArray(out.gallery) || out.gallery.length > 20 || out.gallery.some(v => typeof v !== 'string' || !/^(\/static\/|https:\/\/)/.test(v)))) fail('轮播图地址无效');
  if (collection === 'homeModules' && out.image && !/^(\/static\/|https:\/\/)/.test(out.image)) fail('首页模块图片地址无效');
  if (['stores','alliances'].includes(collection) && out.phone && !/^1\d{10}$/.test(out.phone)) fail('请输入有效的11位手机号');
  if (collection === 'stores') { if (!text(out.address,500)) fail('请填写门店详细地址'); out.address = text(out.address,500); }
  if (collection === 'stores' && out.enabled !== undefined && typeof out.enabled !== 'boolean') fail('门店状态无效');
  if (collection === 'activities') {
    if ((out.startAt && !validDate(out.startAt)) || (out.endAt && !validDate(out.endAt))) fail('活动日期格式无效');
    if (out.startAt && out.endAt && out.startAt > out.endAt) fail('活动结束日期不能早于开始日期');
  }
  if (collection === 'products' && out.packagePlans !== undefined) {
    out.packagePlans = vipPackages.validatePlans(out.packagePlans);
    if (out.packagePlans.length && (out.kind !== 'service' || out.skus?.length || out.coursePrice != null || out.trial || out.trialOnly || out.gift)) fail('套餐须为服务商品，不能同时设置SKU、疗程价或免费礼品');
  }
  return out;
}
async function route(req, url, b) {
  const p = url.pathname.replace(/^\/api/, ''); const method = req.method;
  expire();
  if (p === '/health') return { ok: true, demoMode: DEMO, accountLogin: false, loginMode: 'wechat', wechatReady: wechat.configured(), paymentMode: paymentModeName() };
  if (p === '/bootstrap') {
    let migrated=false; for (const [k,v] of Object.entries(configDefaults)) if (db.config[k] === undefined) { db.config[k]=v; migrated=true; }
    for (const u of db.users) { if (!Number.isInteger(u.points) || u.points < 0) { u.points=0; migrated=true; } if (!Number.isInteger(u.streak) || u.streak < 0) { u.streak=0; migrated=true; } if (typeof u.lastSign !== 'string') { u.lastSign=''; migrated=true; } if (typeof u.lastSignAt !== 'string') { u.lastSignAt=''; migrated=true; } }
    if (presentation.migrate(db)) migrated=true;
    if(db.config.version!==APP_VERSION){db.config.version=APP_VERSION;migrated=true;}
    if (typeof db.config.agreement !== 'string' || !db.config.agreement.trim()) { db.config.agreement=configDefaults.agreement; migrated=true; }
    if (typeof db.config.privacy !== 'string' || !db.config.privacy.trim()) { db.config.privacy=configDefaults.privacy; migrated=true; }
    const imageDefaults={homeImage:configDefaults.homeImage,heroTop:configDefaults.heroTop,heroBottom:configDefaults.heroBottom,storeDefaultImage:configDefaults.storeDefaultImage,brandLogo:configDefaults.brandLogo,welcome:configDefaults.welcome,hero:configDefaults.hero,brand:configDefaults.brand,projectPromo:configDefaults.projectPromo,storePromo:configDefaults.storePromo,customerQr:configDefaults.customerQr,pointsBanner:configDefaults.pointsBanner,serviceHeading:configDefaults.serviceHeading,productHeading:configDefaults.productHeading};
    for (const [k,v] of Object.entries(imageDefaults)) { const oldAsset = k === 'brandLogo' && ['/static/assets/brand-logo.png','/static/brand/logo.png','/static/logo.png'].includes(db.config[k]); const oldHome = k === 'homeImage' && db.config[k] === '/static/brand/jimeili-1-steamed-face.jpg'; const oldPromo = k === 'welcome' && ['/static/brand/jimeili-rejuvenation-info.jpg','/static/brand/jimeili-3-anti-wrinkle.jpg','/static/brand/jimeili-5-active-collagen.jpg'].includes(db.config[k]); const oldBrand = k === 'brand' && ['/static/brand/jimeili-rejuvenation-info.jpg','/static/assets/brand.jpg','/static/brand/store-cover-jimeili-v2.jpg','/static/brand/store-cover-jimeili.jpg'].includes(db.config[k]); const oldPoints = k === 'pointsBanner' && db.config[k] === '/static/brand/jimeili-nano-energy.jpg'; const oldProduct = k === 'productHeading' && db.config[k] === '/static/brand/jimeili-5-active-collagen.jpg'; const oldService = k === 'serviceHeading' && db.config[k] === '/static/brand/jimeili-3-anti-wrinkle.jpg'; const oldStore = k === 'storePromo' && ['/static/assets/store.jpg','/static/brand/store-cover.jpg','/static/brand/store-cover-jimeili.jpg'].includes(db.config[k]); if (typeof db.config[k] !== 'string' || oldAsset || oldHome || oldPromo || oldBrand || oldPoints || oldProduct || oldService || oldStore) { db.config[k]=v; migrated=true; } }
    for (const store of db.stores) {
      if (['玥色塑美','月色塑美','安棋美容','安琪美容'].includes(store.name)) { store.name=presentation.BRAND; migrated=true; }
      if (!store.image || store.image === '/static/brand/jimeili-rejuvenation-kit.jpg' || store.image === '/static/brand/store-cover.jpg' || store.image === '/static/brand/store-cover-jimeili.jpg' || store.image.includes('/static/assets/')) { store.image='/static/brand/store-cover-jimeili-v2.jpg'; migrated=true; }
      if (store.enabled === undefined) { store.enabled=true; migrated=true; }
      if (preserveStoreRecords(store)) migrated=true;
    }
    if (db.config._giftFlagsReworkedV2 !== true) { const vip=db.products.find(x=>x.id==='jimeili-rejuvenation-set'||x.name==='逆龄肽奢护焕颜套'); if(vip){vip.gift=true;vip.trial=false;} const trialNames=['暨美丽胶原蛋水光（三文鱼）','暨美丽胶原蛋水光（VC）','暨美丽胶原蛋水光（复合性）']; db.products.forEach(p=>{if(trialNames.includes(p.name)){p.gift=false;p.trial=true;}}); db.config._giftFlagsReworkedV2=true; migrated=true; }
    if (db.config._giftFlagsClearedV3 !== true) { const managedGiftIds=['jimeili-rejuvenation-set','jimeili-collagen-salmon','jimeili-collagen-vitamin-c','jimeili-collagen-composite','jimeili-collagen-type-iii','jimeili-ai-light-restart']; db.products.forEach(p=>{if(managedGiftIds.includes(p.id)){p.gift=false;p.trial=false;}}); db.config._giftFlagsClearedV3=true; migrated=true; }
    if (db.config._giftFlagsClearedV4 !== true) { const managedGiftNames=['逆龄肽奢护焕颜套','暨美丽胶原蛋水光（三文鱼）','暨美丽胶原蛋水光（VC）','暨美丽胶原蛋水光（复合性）','暨美丽胶原蛋水光（三型胶原蛋白）','暨美丽AI光屿重启']; db.products.forEach(p=>{if(managedGiftNames.includes(p.name)){p.gift=false;p.trial=false;}}); db.config._giftFlagsClearedV4=true; migrated=true; }
    if (db.config._vipCatalogSeedV1 !== true) { const vipIds=['jimeili-rejuvenation-set','jimeili-collagen-salmon','jimeili-collagen-vitamin-c','jimeili-collagen-composite','jimeili-collagen-type-iii','jimeili-ai-light-restart']; db.products.forEach(p=>{if(vipIds.includes(p.id)){p.gift=true;p.trial=false;}}); db.config._vipCatalogSeedV1=true; migrated=true; }
    if (db.config._trialCatalogSeedV2 !== true) {
      const trialCatalog = seed().products.filter(product => product.trialOnly === true);
      for (const source of trialCatalog) {
        const product = migrateTrialDevices.findExisting(db.products, source);
        if (!product) db.products.push(source);
        else for (const [key, value] of Object.entries(source)) if (product[key] === undefined) product[key] = value;
      }
      db.config._trialCatalogSeedV1 = true;
      db.config._trialCatalogSeedV2 = true;
      migrated = true;
    }
    if (migrateTrialDevices(db, seed().products)) migrated = true;
    if (db.config._legacySeedActivityRemoved !== true) { const before = db.activities.length; db.activities = db.activities.filter(x => x.id !== 'jimeili-rejuvenation-activity'); if (db.activities.length !== before) migrated = true; db.config._legacySeedActivityRemoved = true; migrated = true; }
    if (db.config._brandVisualAndPricingV3 !== true) {
      const seededProducts = seed().products || [];
      for (const source of seededProducts) {
        let product = db.products.find(x => x.id === source.id);
        if (!product) { product = JSON.parse(JSON.stringify(source)); db.products.push(product); migrated = true; }
      }
      const homeOrder = {'jimeili-collagen-type-iii':1,'jimeili-rejuvenation-set':7,'jimeili-collagen-salmon':3,'jimeili-collagen-vitamin-c':4,'jimeili-collagen-composite':5,'jimeili-ai-light-restart':6};
      for (const product of db.products) if (homeOrder[product.id] !== undefined) { product.sort = homeOrder[product.id]; product.home = true; product.recommended = true; migrated = true; }
      const water = db.products.find(x => x.id === 'jimeili-collagen-type-iii');
      if (water) { water.price = 498; water.coursePrice = 1980; water.description = '单瓶：498元/瓶；十瓶疗程：1980元。促进胶原蛋白再生，修护老化肌肤。'; water.sort = 1; water.home = true; water.recommended = true; migrated = true; }
      const kit = db.products.find(x => x.id === 'jimeili-rejuvenation-set');
      if (kit) { kit.price = 1980; kit.coursePrice = null; kit.image = '/static/brand/product-rejuvenation-set-generated.png'; kit.sort = 7; kit.home = true; kit.recommended = true; migrated = true; }
      db.config._brandVisualAndPricingV3 = true; migrated = true;
    }
    if (db.config._collagenTypeIIIPrice498V1 !== true) {
      const water = db.products.find(x => x.id === 'jimeili-collagen-type-iii');
      if (water && water.price === 198) {
        water.price = 498;
        water.description = String(water.description || '').replace('单瓶：198元/瓶', '单瓶：498元/瓶');
        migrated = true;
      }
      db.config._collagenTypeIIIPrice498V1 = true;
      migrated = true;
    }
    if (db.config._duplicateCatalogPrunedV1 !== true) {
      const canonical = new Map([
        ['暨美丽胶原蛋水光（三型胶原蛋白）', 'jimeili-collagen-type-iii'],
        ['逆龄肽奢护焕颜套', 'jimeili-rejuvenation-set'],
        ['暨美丽胶原蛋水光（三文鱼）', 'jimeili-collagen-salmon'],
        ['暨美丽胶原蛋水光（VC）', 'jimeili-collagen-vitamin-c'],
        ['暨美丽胶原蛋水光（复合性）', 'jimeili-collagen-composite'],
        ['暨美丽AI光屿重启', 'jimeili-ai-light-restart']
      ]);
      for (const product of db.products) {
        const keepId = canonical.get(product.name);
        if (keepId && product.id !== keepId && product.enabled !== false) {
          product.enabled = false;
          product.status = 'offline';
          migrated = true;
        }
      }
      db.config._duplicateCatalogPrunedV1 = true;
      migrated = true;
    }
    if (db.config._rejuvenationSetLastV1 !== true) {
      const kit = db.products.find(x => x.id === 'jimeili-rejuvenation-set');
      if (kit) {
        const lastSort = db.products.filter(p => p.id !== kit.id).reduce((max, p) => Math.max(max, Number.isInteger(p.sort) ? p.sort : 0), 0);
        kit.sort = lastSort + 1;
      }
      db.config._rejuvenationSetLastV1 = true;
      migrated = true;
    }
    if (db.config._aiLightCoverV2 !== true) {
      const product = db.products.find(x => x.id === 'jimeili-ai-light-restart');
      if (product && product.image === '/static/brand/product-ai-light-restart.jpg') {
        product.image = '/static/brand/product-ai-light-restart-v2.jpg';
      }
      db.config._aiLightCoverV2 = true;
      migrated = true;
    }
    if (vipPackages.seedCatalogue(db)) migrated = true;
    if (migrated) { db.audit ||= []; db.audit.unshift({id:id(),actor:'brand-migration',resource:'config',target:'brand',method:'MIGRATE',createdAt:new Date().toISOString()}); save(); }
    if (!Array.isArray(db.categories)) { db.categories = [{id:'category-featured',name:'特色项目',sort:1,enabled:true},{id:'category-goods',name:'优选单品',sort:2,enabled:true}]; migrated=true; }
    if (db.config._categoryIdsNormalizedV1 !== true) { const featuredId = db.categories.find(c=>String(c.name||'').includes('特色'))?.id || 'category-featured'; const goodsId = db.categories.find(c=>String(c.name||'').includes('优选'))?.id || 'category-goods'; for (const product of db.products) { if (product.categoryId === 'category-featured') { product.categoryId=featuredId; migrated=true; } else if (product.categoryId === 'category-goods') { product.categoryId=goodsId; migrated=true; } else if (!product.categoryId) { product.categoryId = product.kind === 'goods' ? goodsId : featuredId; migrated=true; } } db.config._categoryIdsNormalizedV1=true; migrated=true; }
    for (const p of db.products) { normalizeProduct(p); if (!p.categoryId) { p.categoryId = p.kind === 'goods' ? 'category-goods' : 'category-featured'; migrated=true; } }
    if (migrated) save();
    return { build:{businessVersion:APP_VERSION}, incomeRules: income.publicRules(db), config: db.config, products: db.products.filter(p => p.enabled && p.status === 'published').sort((a,b)=>(a.sort||0)-(b.sort||0)), categories: db.categories.filter(c => c.enabled !== false).sort((a,b)=>(a.sort||0)-(b.sort||0)), stores: db.stores.filter(s => s.enabled !== false), homeModules: db.homeModules.filter(m => m.enabled !== false && (m.publishStatus || 'published') === 'published').sort((a,b)=>(a.sort||0)-(b.sort||0)), demoMode: DEMO, paymentMode: paymentModeName() };
  }

  if (['/auth/register','/auth/account','/auth/demo'].includes(p)) fail('仅支持微信一键登录',403);
  if (p === '/auth/wechat') {
    if(method!=='POST')fail('方法不允许',405);
    const key='wechat:'+(req.headers['x-real-ip']||req.socket.remoteAddress);
    const now=Date.now();
    for(const [k,v] of attempts)if(now-v.since>60000)attempts.delete(k);
    const attempt=attempts.get(key)||{count:0,since:now};attempt.count++;attempts.set(key,attempt);
    if(attempt.count>20)fail('操作频繁，请稍后重试',429);
    if(typeof b.code!=='string'||!b.code.trim()||b.code.length>256)fail('微信登录凭证无效，请重试');
    const codeHash=crypto.createHash('sha256').update(b.code).digest('hex');
    if(db.users.some(u=>(u.wechatLoginCodes||[]).some(c=>c.hash===codeHash&&c.expires>now)))fail('微信登录凭证已使用，请重试',401);
    const identity=await wechat.exchangeCode(b.code);
    let u=db.users.find(u=>u.openid===identity.openid&&u.wechatAppId===identity.appid);
    if(u?.disabled)fail('账号已停用',403);
    if(!u){
      u={id:id(),openid:identity.openid,wechatAppId:identity.appid,name:'微信用户',phone:'',avatar:'/static/assets/avatar.png',gender:'',invited:false,points:0,streak:0,lastSign:'',lastSignAt:'',createdAt:new Date().toISOString()};
      if(typeof b.invite==='string'&&/^[a-fA-F0-9]{8}$/.test(b.invite)){
        // 只有超级VIP会员（持有未退款的 VIP 套餐卡）的码才建立推荐关系；其他人的旧链接或码不算
        const inviter=db.users.find(x=>!x.disabled&&!x.mergedInto&&x.id.slice(0,8).toUpperCase()===b.invite.toUpperCase());
        if(inviter&&vipLevel(inviter)){u.invited=true;u.inviterId=inviter.id;db.shares.push({id:id(),userId:inviter.id,name:u.name,memberId:u.id,createdAt:u.createdAt})}
      }
      db.users.push(u);
    }
    u.wechatLoginCodes=(u.wechatLoginCodes||[]).filter(c=>c.expires>now);
    u.wechatLoginCodes.push({hash:codeHash,expires:now+600000});
    save();return {token:token(u.id),user:publicUser(u)};
  }
  if (p === '/admin/login' && method === 'POST') {
    if(!DEMO)fail('请通过若依后台登录',403);
    const key = req.socket.remoteAddress; const a = attempts.get(key) || { count: 0, since: Date.now() };
    if (Date.now() - a.since > 60000) { a.count = 0; a.since = Date.now(); }
    a.count++; attempts.set(key,a); if (a.count > 10) fail('请一分钟后重试',429);
    const entered = Buffer.from(String(b.password || '')); const expected = Buffer.from(adminPassword);
    if (entered.length !== expected.length || !crypto.timingSafeEqual(entered, expected)) fail('管理密码错误',401);
    return { token: token('admin', 'admin') };
  }
  if (p.startsWith('/admin/')) {
    session(req, true); const [, , collection, key] = p.split('/');
    if (collection === 'upload' && method === 'POST') {
      const match = String(b.data || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/); if (!match) fail('请上传 PNG、JPEG 或 WebP 图片');
      const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 5 * 1024 * 1024) fail('图片不能超过5MB');
      const valid = match[1] === 'png' ? bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' : match[1] === 'jpeg' ? bytes.subarray(0,3).toString('hex') === 'ffd8ff' : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
      if (!valid) fail('图片格式不正确'); const filename = id() + '.' + (match[1] === 'jpeg' ? 'jpg' : match[1]); const dir = path.join(ROOT,'static/uploads'); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,filename),bytes); const asset={id:id(),url:'/static/uploads/'+filename,originalName:text(b.name,120),mime:'image/'+match[1],size:bytes.length,createdAt:new Date().toISOString()}; db.assets.unshift(asset); save(); return asset;
    }
    if (collection === 'dashboard') { const dayStart=Date.parse(day()+'T00:00:00+08:00'),todayPaid=db.orders.filter(o=>o.paymentStatus==='paid'&&o.refundStatus!=='refunded'&&!['cancelled','pending'].includes(o.status)&&Date.parse(o.paidAt)>=dayStart&&(!o.offlineRequestId||Date.parse(o.createdAt)>=dayStart)); return { todayRevenue: Math.round(todayPaid.reduce((s,o)=>s+Math.round(Number(o.total)*100),0))/100, todayPaidOrders: todayPaid.length, users: db.users.length, orders: db.orders.length, revenue: db.orders.filter(o => ['ready','completed','shipping'].includes(o.status)).reduce((s,o) => s + o.total, 0), appointments: db.appointments.length, products: db.products.filter(p => p.enabled).length, lowStock: db.products.filter(p => p.enabled && p.stock < 10).length, demoMode: DEMO }; }
    if (collection === 'assets') {
      if (method === 'GET') return db.assets;
      if (method !== 'DELETE') fail('方法不允许',405);
      const asset=db.assets.find(a=>a.id===key||a.url===key); if(!asset)fail('图片不存在',404);
      const hasReference=(value)=>(typeof value==='string'&&value.split('?')[0]===asset.url)||(Array.isArray(value)?value.some(hasReference):(value&&typeof value==='object'?Object.values(value).some(hasReference):false));
      const refs=[db.config,...['products','stores','activities','alliances','homeModules','rewards','users','orders','claims'].flatMap(key=>db[key]||[])].some(hasReference);
      if(refs)fail('图片正在被使用，请先替换引用后再删除',409);
      db.assets=db.assets.filter(a=>a.id!==asset.id); if(asset.url.startsWith('/static/uploads/')){try{fs.unlinkSync(path.join(ROOT,asset.url.slice(1)))}catch{}} save(); return {ok:true};
    }
    if (collection === 'config') {
      for (const [k,v] of Object.entries(configDefaults)) if (db.config[k] === undefined) db.config[k] = v;
      if (method === 'GET') return db.config;
      if (method === 'PUT') {
        try{presentation.validate(b);if(b.notificationTemplates!==undefined)b.notificationTemplates=notifications.validateTemplates(b.notificationTemplates)}catch(e){fail(e.message)}
        const bools=['subscriptionEnabled','messageReminderEnabled','marketingEnabled'];
        const images=[...presentation.imageKeys,'homeImage','heroTop','heroBottom','storeDefaultImage','brandLogo','welcome','hero','brand','projectPromo','storePromo','customerQr','pointsBanner','serviceHeading','productHeading'];
        const textKeys=[...presentation.textKeys,'name','version','pointsRules','agreement','privacy','appointmentTimes','shortcutTrialLabel','shortcutVipLabel','shortcutShareLabel'];
        const allowed=[...Object.keys(configDefaults)];
        for (const k of Object.keys(b)) {
          if (!allowed.includes(k)) continue;
          const v=b[k];
          if (bools.includes(k) && typeof v!=='boolean') fail('配置开关无效');
          if (['maxGifts','appointmentCapacity','signPoints'].includes(k) && (!Number.isInteger(v)||v<1||v>10000)) fail('配置数值必须为1至10000的整数');
          if (['trialPick','trialUses'].includes(k) && (!Number.isInteger(v)||v<1||v>50)) fail('体验卡可选项目数和每项次数须为1至50的整数');
          if (k === 'appointmentTimes') {
            const slots = typeof v === 'string' ? v.split(',').map(x=>x.trim()) : [];
            if (!slots.length || slots.some(x=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) || new Set(slots).size !== slots.length) fail('预约时间须为不重复的24小时制 HH:MM，并用逗号分隔');
          }
          if (images.includes(k) && (typeof v!=='string'||(v!==''&&!/^(\/static\/|https:\/\/)/.test(v)))) fail('图片地址无效');
          if (textKeys.includes(k) && (typeof v!=='string'||v.trim().length>20000)) fail('配置文本无效');
          db.config[k]=v;
        }
        db.config.version=APP_VERSION;
        db.audit ||= []; db.audit.unshift({id:id(),actor:req.headers['x-anqi-actor']||'admin',resource:'config',target:'config',method:'PUT',createdAt:new Date().toISOString()});
        save(); return db.config;
      }
    }
    if(collection==='notifications'){if(method!=='GET')fail('方法不允许',405);notifications.init(db);return db.notifications.slice().reverse()}
    if(collection==='notificationTemplates'){if(method!=='GET')fail('方法不允许',405);return notifications.templates()}
    if (collection === 'legacyMembers') {
      if(method==='GET')return {members:db.users.filter(u=>!u.mergedInto).map(u=>({...publicUser(u),adminNote:u.adminNote||'',superVip:!!vipLevel(u)})),products:db.products.filter(p=>p.enabled&&p.status==='published'&&p.packagePlans?.length),stores:db.stores.filter(s=>s.enabled!==false),referral:income.referralRule(db),pool:income.poolRule(db)};
      const result=legacyMembers.manage(db,method,key,b,req.headers['x-anqi-actor']||'admin');
      if(result.revokeUserId){for(const [key,value]of sessions)if(value.userId===result.revokeUserId)sessions.delete(key);save();return publicUser(result.member);}
      save();return result.productId?{id:result.id,number:result.number,package:result.package,total:result.total,incomeTreatment:result.incomeTreatment}:publicUser(result);
    }
    if (collection === 'incomeRules') return income.manage(db,method,key,b,req.headers['x-anqi-actor']||'admin');
    if (collection === 'incomePlans') { if(method!=='GET')fail('方法不允许',405);income.settle(db);return db.incomePlans; }
    if (collection === 'earnings' && key === 'payouts') {
      income.settle(db);if(method==='GET')return income.payoutOverview(db);if(method!=='POST')fail('方法不允许',405);
      const result=income.managePayout(db,b,req.headers['x-anqi-actor']||'admin');save();return result;
    }
    if (collection === 'earnings' && method === 'GET') income.settle(db);
    if (['staff','shifts'].includes(collection)) {
      const result = staffScheduling.manage(db, collection, key, method, b);
      if (method !== 'GET') { db.audit ||= []; db.audit.unshift({id:id(),actor:req.headers['x-anqi-actor']||'admin',resource:collection,target:key||result.id||'',method,createdAt:new Date().toISOString()}); save(); }
      return result;
    }
    if (!editable.includes(collection) && !['orders','appointments','users','claims','addresses','shares','earnings','ledger','redemptions','audit','paymentAudits','assets'].includes(collection)) fail('资源不存在',404);
    if (collection === 'products' && key === 'batch' && method === 'POST') {
      const ids = Array.isArray(b.ids) ? b.ids.map(v => text(v, 80)).filter(Boolean) : [];
      if (!ids.length) fail('请先选择商品');
      const selected = db.products.filter(p => ids.includes(p.id)); if (selected.length !== ids.length) fail('部分商品不存在，请刷新后重试');
      const action = text(b.action, 40);
      if (['publish','offline'].includes(action)) selected.forEach(p => { p.status = action === 'publish' ? 'published' : 'offline'; p.enabled = action === 'publish'; });
      else if (action === 'addGroup' || action === 'removeGroup') { const group = text(b.group, 80); if (!group) fail('请填写分组名称'); selected.forEach(p => { const groups = String(p.groupIds || '').split(/[,，]/).map(x => x.trim()).filter(Boolean); const next = action === 'addGroup' ? [...new Set([...groups, group])] : groups.filter(x => x !== group); p.groupIds = next.join(','); }); }
      else if (action === 'memberPrice') { const price = Number(b.memberPrice); if (!Number.isFinite(price) || price < 0) fail('会员价必须是有效非负数字'); selected.forEach(p => { p.memberPrice = price; }); }
      else if (action === 'freeShipping') { if (typeof b.value !== 'boolean') fail('包邮状态无效'); selected.forEach(p => { p.freeShipping = b.value; }); }
      else fail('不支持的批量操作');
      selected.forEach(normalizeProduct); save(); return { ok: true, count: selected.length, products: selected };
    }
    if (method === 'GET') return collection==='users'?db.users.filter(u=>!u.mergedInto).map(publicUser):collection==='products'?db.products.map(normalizeProduct):collection==='homeModules'?db.homeModules.slice().sort((a,b)=>(a.sort||0)-(b.sort||0)):collection==='orders'?db.orders.map(o=>o.incomeSnapshot?.referral?.skipped?{...o,referralNote:o.incomeSnapshot.referral.skipped}:o):db[collection];
    db.audit ||= []; if(method!=='GET')db.audit.unshift({id:id(),actor:req.headers['x-anqi-actor']||'admin',resource:collection,target:key||'',method,createdAt:new Date().toISOString()});

    if(method==='POST'&&collection==='products'&&key){
      const product=db.products.find(x=>x.id===key); if(!product)fail('商品不存在',404);
      if(b.action==='adjustStock'){
        const delta=Number(b.delta); if(!Number.isInteger(delta)||delta===0||Math.abs(delta)>1000000)fail('库存变动必须为非零整数');
        if(!text(b.reason))fail('请填写库存调整原因');
        normalizeProduct(product); const skuId=text(b.skuId,80); const sku=skuId?product.skus?.find(x=>x.id===skuId):null;
        if(product.skus?.length&&!sku)fail('请选择要调整的 SKU');
        const target=sku||product; const before=Number(target.stock)||0; const after=before+delta; if(after<0)fail('调整后库存不能小于0');
        target.stock=after; product.stock=product.skus?.length?product.skus.filter(x=>x.enabled!==false).reduce((n,x)=>n+x.stock,0):after;
        db.inventory.unshift({id:id(),productId:product.id,skuId:sku?.id||'',delta,before,after,reason:text(b.reason,200),actor:req.headers['x-anqi-actor']||'admin',createdAt:new Date().toISOString()}); save(); return {product,record:db.inventory[0]};
      }
      fail('不支持的商品操作');
    }
    if(method==='POST'&&collection==='orders'){
      const o=db.orders.find(x=>x.id===key);if(!o)fail('订单不存在',404);
      if(['confirmPayment','cancel'].includes(b.action)&&o.status==='pending'&&o.wechatPay?.prepayId&&!req.wechatClosed)fail('订单支付状态确认中，请稍后重试',409);
      if(b.action==='refund'&&o.paymentMode==='wechat'&&!req.wechatRefund)fail('微信支付订单需原路退款，请稍后重试',409);
      if(b.action==='confirmPayment'){if(o.status!=='pending')fail('只有待付款订单可确认收款');if(!text(b.note))fail('请填写线下收款凭证说明');o.status=o.product.kind==='goods'?'shipping':'ready';o.paymentStatus='paid';o.paymentMode='offline';o.paymentNote=text(b.note);o.paidAt=new Date().toISOString();notifications.enqueue(db,'orderPaid',o);const p=db.products.find(x=>x.id===o.productId);if(p)p.sold+=o.quantity;}
      else if(b.action==='cancel'){if(o.status!=='pending')fail('只能取消未付款订单');o.status='cancelled';restore(o);}
      else if(b.action==='ship'){if(o.status!=='shipping')fail('订单不是待取货状态');if(!text(b.tracking))fail('请填写物流单号或取货说明');o.tracking=text(b.tracking);notifications.enqueue(db,'orderShipped',o);}
      else if(b.action==='refund'){if(!['ready','shipping','completed'].includes(o.status))fail('当前订单不可售后');if(o.refundStatus==='refunded')fail('订单已退款');if(o.package?.services.some(s=>s.used>0))fail('套餐已有核销记录，请联系门店处理售后，暂不支持部分退款');for(const a of db.appointments)if(a.orderId===o.id&&a.status==='booked'){a.status='cancelled';a.cancelReason='订单售后退款';notifications.enqueue(db,'appointmentCancelled',a);}o.refundStatus='refunded';o.refundNote=text(b.note);o.status='aftersale';restore(o);o.refundAt=new Date().toISOString();if(req.wechatRefund)o.wechatRefund=req.wechatRefund;}
      else fail('不支持的订单操作');if(b.action==='refund')income.refund(db,o);else income.activate(db,o);income.settle(db);save();return o;
    }
    if(method==='POST'&&collection==='users'){
      const u=db.users.find(x=>x.id===key);if(!u)fail('会员不存在',404);
      if(b.action==='resetPassword'){if(typeof b.password!=='string'||b.password.length<8||b.password.length>72)fail('密码须为8至72位');const a=db.accounts.find(x=>x.userId===u.id);if(!a)fail('该会员使用微信登录');a.salt=crypto.randomBytes(16).toString('hex');a.hash=crypto.scryptSync(b.password,a.salt,64).toString('hex');for(const [k,v]of sessions)if(v.userId===u.id)sessions.delete(k)}
      else if(b.action==='points'){const current=Number.isInteger(u.points)&&u.points>=0?u.points:0;if(!Number.isInteger(b.amount)||!b.amount||Math.abs(b.amount)>100000||current+b.amount<0||!text(b.note))fail('请输入有效积分变动及原因');u.points=current+b.amount;db.ledger.push({id:id(),userId:u.id,amount:b.amount,name:text(b.note),createdAt:new Date().toISOString()})}
      else fail('不支持的会员操作');save();return publicUser(u);
    }
    if(method==='PUT'&&collection==='claims'){const r=db.claims.find(x=>x.id===key);if(!r)fail('记录不存在',404);if(r.status==='completed'||b.status!=='completed')fail('不可重复核销');r.status='completed';r.completedAt=new Date().toISOString();save();return r;}
    if (editable.includes(collection)) {
      if (method === 'POST') { const row = { ...(collection === 'products' ? {sold:0,status:'draft',enabled:false,sort:0,recommended:false,hot:false,isNew:false,keywords:[],gallery:[],skus:[]} : {}), ...(collection === 'stores' ? {enabled:true} : {}), ...(collection === 'homeModules' ? {publishStatus:'draft'} : {}), ...validate(collection,b), id: id(), createdAt:new Date().toISOString() }; if(collection==='products')normalizeProduct(row); if (collection === 'categories' && db.categories.some(c=>c.name === row.name)) fail('分类名称已存在'); if (collection === 'products' && row.categoryId && !db.categories.some(c=>c.id===row.categoryId)) fail('商品分类不存在'); db[collection].push(row); save(); return row; }
      const row = db[collection].find(x => x.id === key); if (!row) fail('记录不存在',404);
      if (collection === 'stores' && ['PUT','DELETE'].includes(method)) preserveStoreRecords(row);
      if (method === 'PUT') { const patch={...b}; if(collection==='products' && b.recommended===undefined && b.home!==undefined)patch.recommended=b.home===true; const next=validate(collection,{ ...row,...patch }); if(collection==='products'&&b.image!==undefined&&b.image!==row.image)next.visualMode='image'; if(collection==='products' && b.enabled!==undefined && b.status===undefined)next.status=b.enabled?'published':'offline'; if (collection === 'categories' && db.categories.some(c=>c.id!==key && c.name===next.name)) fail('分类名称已存在'); if (collection === 'products' && next.categoryId && !db.categories.some(c=>c.id===next.categoryId)) fail('商品分类不存在'); Object.assign(row,next); if(b.coursePrice===null)delete row.coursePrice; if (b.image && collection === 'products') row.needsArtwork = false; }
      else if (method === 'DELETE') { if (collection === 'categories' && db.categories.length <= 1) fail('至少保留一个商城分类'); if (collection === 'categories') { const fallback = db.categories.find(c => c.id !== key && c.enabled !== false) || db.categories.find(c => c.id !== key); for (const product of db.products) if (product.categoryId === key && fallback) product.categoryId = fallback.id; } db[collection] = db[collection].filter(x => x.id !== key); }
      else fail('方法不允许',405);
      if(collection==='products')normalizeProduct(row); save(); return { ok: true };
    }
    if (method === 'PUT' && collection === 'appointments') { const row = db.appointments.find(x => x.id === key); if (!row) fail('记录不存在',404); if (row.status !== 'booked' || !['completed','cancelled'].includes(b.status)) fail('只有已预约记录可完成或取消，已结束预约不可再次修改'); if(b.status==='completed'){const order=db.orders.find(x=>x.id===row.orderId);if(order?.package)vipPackages.complete(order,row);else if(order?.status==='ready')order.status='completed';row.completedAt=new Date().toISOString()}row.status = b.status; const incomeOrder=db.orders.find(o=>o.id===row.orderId);if(incomeOrder)income.activate(db,incomeOrder);income.settle(db);notifications.enqueue(db,row.status==='completed'?'appointmentCompleted':'appointmentCancelled',row);save(); return row; }
    if (method === 'PUT' && collection === 'orders') { const row = db.orders.find(x => x.id === key); if (!row) fail('记录不存在',404); if(row.package)fail('套餐请在预约管理中按项目逐次核销'); if (!['ready','shipping'].includes(row.status) || b.status !== 'completed') fail('只有已支付订单可核销完成'); row.status = 'completed'; row.completedAt=new Date().toISOString(); for (const a of db.appointments) if (a.orderId === row.id && a.status === 'booked') a.status = 'completed'; income.activate(db,row);income.settle(db);save(); return row; }
    if (method === 'PUT' && collection === 'users') { const row = db.users.find(x => x.id === key); if (!row) fail('记录不存在',404); if(b.invited!==undefined)row.invited=b.invited===true;if(b.disabled!==undefined)row.disabled=b.disabled===true;row.memberRevision=(row.memberRevision||0)+1;save();return publicUser(row); }
    fail('操作不支持',405);
  }
  if (['/activities','/alliances','/rewards'].includes(p) && method === 'GET') return db[p.slice(1)].filter(x => x.enabled !== false);
  const u = user(req);
  if (p === '/auth/logout' && method === 'POST') { sessions.delete((req.headers.authorization||'').replace(/^Bearer /,'')); return {ok:true}; }
  if (p === '/auth/refresh' && method === 'POST') { const current=session(req); current.expires=Date.now()+86400000; return {expiresAt:current.expires}; }
  if (p === '/me/avatar') {
    if(method === 'DELETE'){u.avatar='/static/assets/avatar.png';save();return {avatar:u.avatar}}
    if(method !== 'POST') fail('方法不允许',405);
    const match=String(b.data||'').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);if(!match)fail('请上传图片');
    const bytes=Buffer.from(match[2],'base64');if(bytes.length>5*1024*1024)fail('头像不能超过5MB');
    const valid=match[1]==='png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':match[1]==='jpeg'?bytes.subarray(0,3).toString('hex')==='ffd8ff':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';if(!valid)fail('图片格式无效');
    const dir=path.join(ROOT,'static/uploads');fs.mkdirSync(dir,{recursive:true});const filename=id()+'.'+(match[1]==='jpeg'?'jpg':match[1]);fs.writeFileSync(path.join(dir,filename),bytes);u.avatar='/static/uploads/'+filename;save();return {avatar:u.avatar};
  }
  if (p === '/share-code' && method === 'GET') {
    // 只有超级VIP会员才有专属二维码；其他会员只看到自己的会员编号（门店核对身份用）
    if(!vipLevel(u))return {locked:true,memberCode:u.id.slice(0,8).toUpperCase()};
    const code=u.id.slice(0,8).toUpperCase();const dir=path.join(ROOT,'static/uploads');fs.mkdirSync(dir,{recursive:true});
    const filename='share-'+u.id+'.png';const dest=path.join(dir,filename);
    let mode='web';
    // In production prefer a real WeChat mini-program code. It opens the
    // native home page after scanning and can be recognized directly from the
    // long-press menu. The H5 QR remains the safe local/test fallback.
    if(!DEMO && wechat.configured()){
      try {
        const accessResponse=await fetch('https://api.weixin.qq.com/cgi-bin/token?'+new URLSearchParams({grant_type:'client_credential',appid:process.env.WECHAT_APPID,secret:process.env.WECHAT_APPSECRET}));
        const access=await accessResponse.json();
        if(!access.access_token) throw new Error('wechat token');
        const result=await fetch('https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token='+encodeURIComponent(access.access_token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:code,page:'pages/home/index',width:430,check_path:false,env_version:process.env.WECHAT_ENV_VERSION||'trial'})});
        const contentType=result.headers.get('content-type')||'';
        if(!result.ok||!contentType.includes('image')) throw new Error('wechat code');
        fs.writeFileSync(dest,Buffer.from(await result.arrayBuffer()));
        mode='weixin';
      } catch {
        const QRCode=require('qrcode');
        await QRCode.toFile(dest,(process.env.PUBLIC_ORIGIN||'https://anqi.okam.top')+'/#/pages/home/index?invite='+code,{width:430,margin:4,errorCorrectionLevel:'H',color:{dark:'#173b30',light:'#ffffff'}});
        mode='web';
      }
    } else {
      const QRCode=require('qrcode');await QRCode.toFile(dest,(process.env.PUBLIC_ORIGIN||'https://anqi.okam.top')+'/#/pages/home/index?invite='+code,{width:430,margin:4,errorCorrectionLevel:'H',color:{dark:'#173b30',light:'#ffffff'}});
    }
    return {code,image:'/static/uploads/'+filename+'?v='+Date.now(),mode};
  }

  if(p==='/subscriptions'){if(method==='GET')return {templates:notifications.options(db)};if(method==='POST'){let result;try{result=notifications.consent(db,u,b.acceptedTemplateIds)}catch(e){fail(e.message)}save();return result}fail('方法不允许',405)}

  if (p === '/me') { if (method === 'PUT') { if (!text(b.name,40)) fail('请输入姓名'); u.name = text(b.name,40); u.gender = ['male','female'].includes(b.gender) ? b.gender : ''; save(); } return { ...publicUser(u), vipLevel: vipLevel(u) }; }
  if (p === '/sign' && method === 'POST') {
    if (u.lastSign === day()) fail('今日已签到');
    const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 86400000));
    u.streak = u.lastSign === yesterday ? (u.streak || 0) + 1 : 1; u.lastSign = day(); u.lastSignAt = new Date().toISOString(); u.points = (u.points || 0) + Number(db.config.signPoints || 1);
    db.ledger.push({ id: id(), userId: u.id, amount: Number(db.config.signPoints || 1), name: '签到获得积分', createdAt: new Date().toISOString() }); save(); return publicUser(u);
  }
  if (p === '/orders' && method === 'POST') {
    const idempotencyKey = text(req.headers['idempotency-key'], 128);
    if (idempotencyKey) {
      const previous = db.orders.find(x => x.userId === u.id && x.idempotencyKey === idempotencyKey);
      if (previous) return previous;
    }
    const product = db.products.find(p => p.id === b.productId && p.enabled && p.status === 'published'); if (!product) fail('商品已下架');
    if (product.trialOnly === true) fail('卡券项目请领取后预约');
    if (!Number.isInteger(b.quantity) || b.quantity < 1 || b.quantity > 99) fail('数量须在1至99之间');
    const packageOrder = product.packagePlans?.length ? vipPackages.selectPackage(product, b.packageSelection) : null;
    if (packageOrder && (b.quantity !== 1 || b.spec !== 'single' || b.skuId)) fail('每笔套餐订单限购一套，请选择套餐方案');
    const sku = b.skuId ? product.skus?.find(s => s.id === b.skuId && s.enabled !== false) : (product.skus?.length ? product.skus.find(s => s.enabled !== false) : null);
    if ((b.skuId||product.skus?.length) && !sku) fail('商品规格不存在或已下架');
    const serviceCount = product.kind === 'service' && sku?.serviceSessions != null ? sku.serviceSessions * b.quantity : 0;
    if (serviceCount && (!Number.isInteger(serviceCount) || serviceCount < 1 || serviceCount > 999)) fail('每笔订单的服务次数须在1至999之间');
    const courseOrder = serviceCount > 0 ? { planId: 'service-course', planName: sku.name, selections: {}, services: [{ id: 'fixed:service', name: product.name + ' · ' + sku.name, total: serviceCount, used: 0 }] } : null;
    const available = sku ? sku.stock : product.stock; if (available < b.quantity) fail('库存不足'); const store = db.stores.find(s => s.id === b.storeId && s.enabled !== false); if (!store) fail('请选择有效门店');
    if (!['single','course'].includes(b.spec)) fail('规格无效');
    const price = sku ? sku.price : (b.spec === 'course' ? product.coursePrice : (product.memberPrice??product.price)); if (!Number.isFinite(price)) fail('商品没有此规格');
    let address = null; if (product.kind === 'goods') address = { ...own('addresses',b.addressId,u) };
    const snapshot=JSON.parse(JSON.stringify(product)); if(sku) snapshot.selectedSku=JSON.parse(JSON.stringify(sku));
    const o = { id: id(), number: Date.now().toString() + crypto.randomInt(100,999), userId: u.id, ...(idempotencyKey ? { idempotencyKey } : {}), productId: product.id, skuId: sku?.id || '', product: snapshot, ...((packageOrder || courseOrder) ? { package: packageOrder || courseOrder } : {}), quantity: b.quantity, spec: b.spec, price, total: Math.round(price * b.quantity * 100) / 100, storeId: store.id, store: storeSnapshot(store), address, message: text(b.message), status: 'pending', refundStatus: '', createdAt: new Date().toISOString() };
    if (sku) { sku.stock -= b.quantity; product.stock = product.skus.filter(s=>s.enabled!==false).reduce((n,s)=>n+s.stock,0); } else product.stock -= b.quantity;
    income.snapshot(db,o);db.orders.unshift(o); save(); return o;
  }
  const orderMatch = p.match(/^\/orders\/([^/]+)(?:\/(cancel|pay))?$/);
  if (orderMatch) {
    const o = own('orders',orderMatch[1],u); if (method === 'GET') return o;
    if (method !== 'POST') fail('方法不允许',405);
    if (orderMatch[2] === 'pay') {
      if (!MOCK_PAYMENT) fail('当前未开通在线支付，请联系门店付款',503);
      if (!['success','failure','cancel'].includes(b.outcome)) fail('请选择有效模拟支付结果');
      if (!text(req.headers['idempotency-key'],128)) fail('支付请求缺少幂等标识');
      if (o.paymentStatus === 'paid') return o;
    }
    if (o.status !== 'pending') fail('订单状态已变化');
    if (orderMatch[2] === 'cancel' && o.wechatPay?.prepayId && !req.wechatClosed) fail('订单支付状态确认中，请稍后重试',409);
    if (orderMatch[2] === 'cancel') { o.status = 'cancelled'; restore(o); }
    else if (orderMatch[2] === 'pay') {
      if (!MOCK_PAYMENT) fail('当前未开通在线支付，请联系门店付款',503);
      const outcome = b.outcome;
      const idempotencyKey = text(req.headers['idempotency-key'],128);
      db.paymentAudits ||= [];
      const existing = idempotencyKey && db.paymentAudits.find(x => x.userId === u.id && x.orderId === o.id && x.idempotencyKey === idempotencyKey);
      if (existing) {
        if(existing.outcome !== outcome) fail('幂等标识已用于其他支付结果',409);
        if (existing.outcome === 'success') return o;
        if (existing.outcome === 'cancel') return { ...o, paymentAttempt: 'cancelled' };
        return {httpStatus:402,error:'模拟支付失败，请重试'};
      }
      const audit = { id:id(), orderId:o.id, userId:u.id, idempotencyKey:idempotencyKey||'', outcome, mode:'mock', amount:o.total, createdAt:new Date().toISOString() };
      db.paymentAudits.push(audit);
      if (outcome === 'cancel') { save(); return { ...o, paymentAttempt:'cancelled' }; }
      if (outcome === 'failure') { save(); return {httpStatus:402,error:'模拟支付失败，请重试'}; }
      o.paymentStatus = 'paid';
      o.paymentMode = 'mock';
      o.paymentTransactionId = 'mock_' + crypto.randomBytes(12).toString('hex');
      o.paidAt = audit.createdAt;
      o.status = o.product.kind === 'goods' ? 'shipping' : 'ready';
      audit.transactionId = o.paymentTransactionId;
      const product=db.products.find(x=>x.id===o.productId);if(product)product.sold+=o.quantity;
      income.activate(db,o);income.settle(db);save(); return o;
    }
    else fail('路径不存在',404);
    save(); return o;
  }
  if (p === '/addresses' && method === 'POST' || /^\/addresses\/[^/]+$/.test(p) && ['PUT','DELETE'].includes(method)) {
    let a = method === 'POST' ? { id: id(), userId: u.id } : own('addresses',p.split('/')[2],u);
    if (method === 'DELETE') { db.addresses = db.addresses.filter(x => x.id !== a.id); save(); return { ok: true }; }
    if (!text(b.name) || !/^1\d{10}$/.test(b.phone || '') || !text(b.city) || !text(b.detail)) fail('请完整填写姓名、11位手机号和地址');
    if (b.isDefault) db.addresses.filter(x => x.userId === u.id).forEach(x => x.isDefault = false);
    Object.assign(a, { name: text(b.name,40), phone: b.phone, city: text(b.city), detail: text(b.detail), isDefault: !!b.isDefault }); if (method === 'POST') db.addresses.push(a); save(); return a;
  }
  if (['/appointments','/appointment-options'].includes(p) && method === 'POST') {
    let claim = null;
    let o = null;
    if (b.claimId) {
      claim = own('claims', b.claimId, u);
      if (claim.status==='completed') fail('该礼品已经使用过');
      const giftBookings=db.appointments.filter(a=>a.claimId===claim.id&&a.productId===b.productId);
      if(giftBookings.some(a=>a.status==='booked'))fail('该项目已有预约，完成后再约下一次');
      if(giftBookings.filter(a=>a.status==='completed').length>=(claim.uses||1))fail('该项目次数已用完');
      if (!Array.isArray(claim.productIds) || !claim.productIds.includes(b.productId)) fail('礼品商品无效');
    } else {
      o = own('orders', b.orderId, u);
      if (o.status !== 'ready') fail('请先购买可预约服务');
      if (!o.package && db.appointments.some(a => a.orderId === o.id && a.status !== 'cancelled')) fail('该服务订单已预约');
    }
    const entitlement = o?.package?.services.find(row => row.id === b.entitlementId);
    if (o?.package && (!entitlement || vipPackages.remaining(o,b.entitlementId,db.appointments) < 1)) fail('该套餐项目没有可预约次数');
    const product = entitlement ? { ...entitlement, kind: 'service' } : claim ? ((claim.products||[]).find(p=>p.id===b.productId)||db.products.find(p=>p.id===b.productId)) : o.product;
    if (!product) fail('商品不存在或已下架');
    if(product.kind!=='service')fail('实物礼品请到店领取，无需预约服务');
    if (o && b.storeId && b.storeId !== o.storeId) fail('请预约订单对应的服务门店');
    const storeId = o ? o.storeId : b.storeId;
    const store = db.stores.find(s => s.id === storeId && s.enabled !== false);
    if (!store) fail('请选择有效门店');
    if (p === '/appointment-options') return staffScheduling.options(db, store, b.date);
    const assignment = staffScheduling.reserve(db, store, b);
    const a = { id: id(), userId: u.id, ...(o ? { orderId:o.id, ...(entitlement ? { entitlementId:entitlement.id, packageName:o.product.name } : {}) } : { claimId:claim.id, productId:product.id }), name: product.name, storeId, store: storeSnapshot(store), ...assignment, date: b.date, time: b.time, status: 'booked', createdAt:new Date().toISOString() };
    db.appointments.push(a);notifications.enqueue(db,'appointmentBooked',a);
    // Each gift in a claim is reserved by its own appointment, not by the whole claim.
    save(); return a;
  }
  if (p === '/claims' && method === 'GET') {
    return db.claims.filter(x => x.userId === u.id).map(c => ({ ...c, products: (c.productIds || []).map(pid => {const product=(c.products||[]).find(p=>p.id===pid)||db.products.find(p=>p.id===pid);if(!product)return null;const bookings=db.appointments.filter(a=>a.claimId===c.id&&a.productId===pid&&a.status!=='cancelled'),active=bookings.find(a=>a.status==='booked'),usesTotal=c.uses||1,usesCompleted=bookings.filter(a=>a.status==='completed').length,usesRemaining=c.status==='completed'?0:Math.max(0,usesTotal-usesCompleted);return {...product,useStatus:active?'booked':usesRemaining>0?'available':'completed',bookingId:(active||bookings[bookings.length-1])?.id||'',usesTotal,usesCompleted,usesRemaining}}).filter(Boolean) }));
  }
  if (p === '/claims' && method === 'POST') {
    if (b.type !== 'trial' && !u.invited) fail('贵宾卡仅限受邀新用户领取')
    const claimType = b.type === 'trial' ? 'trial' : 'vip';
    if (db.claims.some(x => x.userId === u.id && (x.type || 'trial') === claimType)) fail(claimType === 'vip' ? '您已领取过贵宾礼品' : '您已领取过体验礼品');
    const ids = Array.isArray(b.productIds) ? [...new Set(b.productIds)] : [];
    const pick = claimType === 'trial' ? (db.config.trialPick ?? db.config.maxGifts) : db.config.maxGifts;
    if (ids.length !== pick) fail('请选择领取' + pick + '件商品');
    const products = ids.map(key => db.products.find(p => p.id === key && p.enabled && p.status === 'published' && (claimType === 'trial' ? p.trial : p.gift) && p.stock > 0)); if (products.some(p => !p)) fail('礼品库存不足或已下架');
    const snapshots=products.map(p=>JSON.parse(JSON.stringify(p)));products.forEach(p=>{if(p.skus?.length){const sku=p.skus.find(s=>s.enabled!==false&&s.stock>0);if(!sku)fail('礼品库存不足');sku.stock--;p.stock=p.skus.filter(s=>s.enabled!==false).reduce((n,s)=>n+s.stock,0)}else p.stock--}); const row = { id: id(), userId: u.id, type: claimType, productIds: ids, products:snapshots, uses: claimType === 'trial' ? (db.config.trialUses || 1) : 1, createdAt: new Date().toISOString() }; db.claims.push(row); save(); return row;
  }
  if (p === '/redemptions' && method === 'POST') {
    const r = db.rewards.find(x => x.id === b.rewardId && x.enabled !== false); if (!r || r.stock < 1) fail('积分商品库存不足'); if ((u.points || 0) < r.points) fail('积分不足');
    u.points -= r.points; r.stock--; const row = { id: id(), userId: u.id, name: r.name, points: r.points, createdAt: new Date().toISOString() }; db.redemptions.push(row); db.ledger.push({ ...row, id: id(), amount: -r.points, name: '兑换' + r.name }); save(); return row;
  }
  if (p === '/earnings-summary' && method === 'GET') {income.settle(db);return {...income.summary(db,u.id),plans:income.customerPlans(db,u.id),payouts:income.customerPayouts(db,u.id)};}
  if (p === '/earnings' && method === 'GET') income.settle(db);
  if (['/orders','/addresses','/appointments','/ledger','/redemptions','/shares','/earnings'].includes(p) && method === 'GET') return db[p.slice(1)].filter(x => x.userId === u.id);
  fail('接口不存在',404);
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  const origin = req.headers.origin || ''; const allowedOrigins=(process.env.CORS_ORIGINS||'https://anqi.okam.top,https://anqiht.okam.top').split(','); if (allowedOrigins.includes(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); }
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, Idempotency-Key'); res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/api/pay/notify' && req.method === 'POST') { if (!WECHAT_PAY) fail('微信支付未开通',404); return wechatNotify(req,res); }
    if (url.pathname.startsWith('/api/')) { const payload=['POST','PUT'].includes(req.method)?await body(req):{};let result=WECHAT_PAY?await wechatRoute(req,url,payload):undefined;if(result===undefined)result=await txn(()=>route(req,url,payload)); if(result?.httpStatus){res.statusCode=result.httpStatus;delete result.httpStatus;} res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store'); return res.end(JSON.stringify(result,(key,value)=>key==='incomeSnapshot'?undefined:value)); }
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) fail('请使用若依管理端',404);
    const isStatic = url.pathname.startsWith('/static/');
    const base = isStatic ? path.join(ROOT,'static') : path.join(ROOT,'dist/build/h5');
    const relative = isStatic ? url.pathname.slice(7) : url.pathname;
    const file = path.resolve(base,'.' + (relative === '' || relative === '/' ? '/index.html' : decodeURIComponent(relative)));
    if (!file.startsWith(base + path.sep)) fail('路径无效',403);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail('文件不存在',404);
    if (!fs.realpathSync(file).startsWith(fs.realpathSync(base) + path.sep)) fail('路径无效',403);
    res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
  } catch (e) { res.statusCode = e.status || 500; res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify({ error: e.status ? e.message : '服务器异常' })); if (!e.status) console.error(e); }
});
// 每个请求在一个数据库事务里处理（文件库为串行队列）；调用微信接口前后各开一次事务，网络请求期间不占用事务
function txn(fn){return mysqlStore?mysqlStore.run(async state=>{db=state;sessions.clear();for(const r of db.sessions||[])if(r.expires>Date.now())sessions.set(r.id,r);const value=await fn();db.sessions=[...sessions].map(([id,r])=>({id,...r}));return value}):runFile(fn);}
const clone=v=>JSON.parse(JSON.stringify(v));
function paymentAudit(o,fields){db.paymentAudits||=[];const row={id:id(),orderId:o?.id||'',userId:o?.userId||'',mode:'wechat',amount:o?.total??0,createdAt:new Date().toISOString(),...fields};db.paymentAudits.push(row);return row;}
// 应用一笔已验签的微信交易：校验商户号、小程序、订单号和金额后标记已付款；重复通知不重复入账
function applyWechatPayment(tx,source){
  const o=db.orders.find(x=>x.number===tx.out_trade_no);
  if(!o){paymentAudit(null,{outcome:'rejected',source,transactionId:tx.transaction_id||'',reason:'订单不存在：'+String(tx.out_trade_no||'')});save();return null;}
  const reason=wechatPay.mismatch(tx,o);
  if(reason){paymentAudit(o,{outcome:'rejected',source,transactionId:tx.transaction_id||'',reason});save();return o;}
  if(tx.trade_state!=='SUCCESS')return o;
  if(o.paymentStatus==='paid'){
    if(o.paymentTransactionId!==tx.transaction_id&&!(db.paymentAudits||[]).some(a=>a.transactionId===tx.transaction_id&&a.outcome==='duplicate')){o.duplicatePayment={transactionId:tx.transaction_id,amount:o.total,at:new Date().toISOString()};paymentAudit(o,{outcome:'duplicate',source,transactionId:tx.transaction_id,reason:(o.paymentMode==='offline'?'门店已确认线下收款':'订单已付款')+'，顾客又通过微信付款，请在微信支付商户平台退还这笔款项'});save();}
    return o;
  }
  if(o.status==='cancelled'){take(o);o.paymentNote='订单取消后收到微信付款，已恢复为已付款订单';}
  else if(o.status!=='pending'){paymentAudit(o,{outcome:'rejected',source,transactionId:tx.transaction_id,reason:'订单状态为'+o.status+'，未自动入账，请人工核对'});save();return o;}
  o.paymentStatus='paid';o.paymentMode='wechat';o.paymentTransactionId=tx.transaction_id;o.paidAt=new Date().toISOString();o.wechatSuccessTime=tx.success_time||'';
  o.status=o.product.kind==='goods'?'shipping':'ready';const p=db.products.find(x=>x.id===o.productId);if(p)p.sold+=o.quantity;
  paymentAudit(o,{outcome:'success',source,transactionId:tx.transaction_id});notifications.enqueue(db,'orderPaid',o);income.activate(db,o);income.settle(db);save();return o;
}
function applyWechatRefund(r){
  const o=db.orders.find(x=>x.wechatRefund?.outRefundNo===r.out_refund_no);if(!o)return null;
  if(['SUCCESS','CLOSED','ABNORMAL'].includes(r.refund_status||r.status)){const status=r.refund_status||r.status;if(o.wechatRefund.status!==status){o.wechatRefund={...o.wechatRefund,status,successTime:r.success_time||'',checkedAt:new Date().toISOString()};paymentAudit(o,{outcome:'refund-'+status.toLowerCase(),source:'refund',transactionId:o.paymentTransactionId,refundId:r.refund_id||''});}}
  else o.wechatRefund.checkedAt=new Date().toISOString();
  save();return o;
}
// 关闭已发起的微信支付订单；若顾客其实已付款，则改为入账并返回 paid=true
async function closeWechatOrder(number){
  try{await wechatPay.close(number);return {paid:false};}
  catch(e){
    if(e.code==='ORDER_NOT_EXIST')return {paid:false};
    if(e.code!=='ORDERPAID')throw e;
    const tx=await wechatPay.query(number);await txn(()=>applyWechatPayment(tx,'query'));return {paid:true};
  }
}
async function wechatNotify(req,res){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536){res.statusCode=413;return res.end();}}
  const reply=(status,message)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(status===200?'':JSON.stringify({code:'FAIL',message}));};
  let event;try{event=await wechatPay.parseNotify(req.headers,raw);}catch(e){console.error('微信支付回调已拒绝：'+e.message);return reply(401,'签名验证失败');}
  try{
    if(event.eventType.startsWith('TRANSACTION.'))await txn(()=>applyWechatPayment(event.data,'notify'));
    else if(event.eventType.startsWith('REFUND.'))await txn(()=>applyWechatRefund(event.data));
    return reply(200);
  }catch(e){console.error('微信支付回调处理失败',e.message);return reply(500,'处理失败，请重试');}
}
// 需要调用微信接口的请求：小程序下单支付/查单、取消已发起支付的订单、后台收款/取消/退款。返回 undefined 表示交给普通流程
async function wechatRoute(req,url,b){
  const p=url.pathname.replace(/^\/api/,''),method=req.method;
  const mine=p.match(/^\/orders\/([^/]+)\/(pay|cancel)$/);
  if(mine&&method==='POST'){
    const orderId=mine[1];
    if(mine[2]==='cancel'){
      const prep=await txn(()=>{const u=user(req);const o=own('orders',orderId,u);return o.status==='pending'&&o.wechatPay?.prepayId?o.number:null;});
      if(!prep)return undefined;
      if((await closeWechatOrder(prep)).paid)fail('订单已通过微信支付，无法取消',409);
      req.wechatClosed=true;return undefined;
    }
    if(b.sync){
      const prep=await txn(()=>{const u=user(req);const o=own('orders',orderId,u);return o.status==='pending'&&o.wechatPay?.prepayId?o.number:null;});
      if(prep){const tx=await wechatPay.query(prep).catch(e=>e.code==='ORDER_NOT_EXIST'?null:Promise.reject(e));if(tx?.trade_state==='SUCCESS')await txn(()=>applyWechatPayment(tx,'query'));}
      return txn(()=>own('orders',orderId,user(req)));
    }
    const prep=await txn(()=>{
      expire();const u=user(req);const o=own('orders',orderId,u);
      if(o.paymentStatus==='paid')return {order:o};
      if(o.status!=='pending')fail('订单状态已变化');
      if(!(wechatPay.cents(o.total)>0))fail('0元订单无需在线支付，请联系门店确认');
      if(!u.openid||u.wechatAppId!==process.env.WECHAT_APPID)fail('请在小程序内使用微信登录后支付');
      if(Date.now()>wechatPay.expireAt(o)-60000)fail('订单已超过支付时间，请重新下单');
      return {order:clone(o),openid:u.openid,prepayId:o.wechatPay?.prepayId||''};
    });
    if(prep.order.paymentStatus==='paid')return {order:prep.order,paid:true};
    // 同一订单号重复下单时微信返回同一预支付单；本地已有预支付单则直接复用
    const prepayId=prep.prepayId||await wechatPay.prepay(prep.order,prep.openid);
    return txn(()=>{
      const u=user(req);const o=own('orders',orderId,u);
      if(o.paymentStatus==='paid')return {order:o,paid:true};
      if(o.status!=='pending')fail('订单状态已变化');
      if(o.wechatPay?.prepayId!==prepayId){o.wechatPay={prepayId,prepayAt:new Date().toISOString(),expireAt:new Date(wechatPay.expireAt(o)).toISOString()};paymentAudit(o,{outcome:'prepay',source:'customer'});save();}
      return {order:o,payment:wechatPay.payParams(prepayId)};
    });
  }
  const adminOrder=p.match(/^\/admin\/orders\/([^/]+)$/);
  if(adminOrder&&method==='POST'&&['confirmPayment','cancel','refund'].includes(b.action)){
    const prep=await txn(()=>{session(req,true);const o=db.orders.find(x=>x.id===adminOrder[1]);if(!o)fail('订单不存在',404);return clone(o);});
    if(b.action==='refund'){
      if(prep.paymentMode!=='wechat')return undefined;
      const blocked=!['ready','shipping','completed'].includes(prep.status)?'当前订单不可售后':prep.refundStatus==='refunded'?'订单已退款':prep.package?.services?.some(s=>s.used>0)?'套餐已有核销记录，请联系门店处理售后，暂不支持部分退款':'';
      if(blocked)fail(blocked);
      const r=await wechatPay.refund(prep,b.note);
      req.wechatRefund={outRefundNo:r.out_refund_no||wechatPay.refundNo(prep),refundId:r.refund_id||'',status:r.status||'PROCESSING',requestedAt:new Date().toISOString()};
      // 微信已受理即留痕；同一退款单号重复提交时微信按同一笔处理，后台重试不会重复退款
      await txn(()=>{const o=db.orders.find(x=>x.id===prep.id);paymentAudit(o,{outcome:'refund-requested',source:'admin',transactionId:prep.paymentTransactionId,refundId:req.wechatRefund.refundId,outRefundNo:req.wechatRefund.outRefundNo});save();});
      return undefined;
    }
    if(prep.status!=='pending'||!prep.wechatPay?.prepayId)return undefined;
    if((await closeWechatOrder(prep.number)).paid)fail('顾客已通过微信支付，订单已自动入账，无需再'+(b.action==='cancel'?'取消':'确认收款'),409);
    req.wechatClosed=true;return undefined;
  }
  return undefined;
}
// 对账：每分钟查一次已发起支付但未入账的订单；超时未付则关闭微信订单并取消；退款处理中的订单查询退款结果
let reconcileBusy=false;
async function reconcileWechat(){
  if(!WECHAT_PAY||reconcileBusy)return;reconcileBusy=true;
  try{
    const jobs=await txn(()=>{const now=Date.now();return {
      pay:db.orders.filter(o=>o.status==='pending'&&o.wechatPay?.prepayId&&now-Date.parse(o.wechatPay.checkedAt||o.wechatPay.prepayAt)>=60000).slice(0,20).map(o=>({id:o.id,number:o.number,expireAt:Date.parse(o.wechatPay.expireAt)})),
      refunds:db.orders.filter(o=>o.wechatRefund?.status==='PROCESSING'&&now-Date.parse(o.wechatRefund.checkedAt||o.wechatRefund.requestedAt)>=60000).slice(0,20).map(o=>o.wechatRefund.outRefundNo)};});
    for(const job of jobs.pay){
      try{
        const tx=await wechatPay.query(job.number).catch(e=>e.code==='ORDER_NOT_EXIST'?null:Promise.reject(e));
        if(tx?.trade_state==='SUCCESS'){await txn(()=>applyWechatPayment(tx,'query'));continue;}
        const expired=Date.now()>job.expireAt+60000;
        if(expired&&(await closeWechatOrder(job.number)).paid)continue;
        await txn(()=>{const o=db.orders.find(x=>x.id===job.id);if(!o||o.status!=='pending')return;if(expired){o.status='cancelled';o.cancelReason='超时未支付，已关闭微信支付订单';restore(o);}else o.wechatPay.checkedAt=new Date().toISOString();save();});
      }catch(e){console.error('微信支付对账失败',job.number,e.message);}
    }
    for(const no of jobs.refunds){try{const r=await wechatPay.queryRefund(no);await txn(()=>applyWechatRefund(r));}catch(e){console.error('微信退款查询失败',no,e.message);}}
  }finally{reconcileBusy=false;}
}
async function settleIncome(){return mysqlStore?mysqlStore.run(state=>income.settle(state)):runFile(()=>income.settle(db));}
// 目录和配置迁移写在 /bootstrap 中；启动时先执行一次，避免首个用户端访问前后台读到未迁移的数据。
async function migrateOnStart(){const req={method:'GET',headers:{}},url=new URL('/api/bootstrap','http://localhost');return mysqlStore?mysqlStore.run(state=>{db=state;return route(req,url,{})}):runFile(()=>route(req,url,{}));}
let notificationWorkerBusy=false;
async function drainNotifications(){
 if(notificationWorkerBusy)return;notificationWorkerBusy=true;
 const transaction=fn=>mysqlStore?mysqlStore.run(fn):runFile(()=>fn(db));
 try{const item=await transaction(state=>{notifications.init(state);for(const row of state.notifications)if(row.status==='sending'&&Date.now()-Date.parse(row.startedAt)>60000){row.status='unknown';row.error='服务重启前发送结果未确认，未自动重发'}const job=state.notifications.find(row=>row.status==='pending');if(!job)return null;const user=state.users.find(u=>u.id===job.userId&&!u.disabled);if(!state.config.messageReminderEnabled||!state.config.subscriptionEnabled||!user?.openid){job.status='skipped';return null}job.status='sending';job.startedAt=new Date().toISOString();job.attempts++;return {job:JSON.parse(JSON.stringify(job)),openid:user.openid}});
 if(item){let result;try{result=await notifications.send(item.job,item.openid)}catch{result={status:'failed',error:'微信消息服务暂不可用'}}await transaction(state=>{const row=state.notifications.find(n=>n.id===item.job.id);if(row)Object.assign(row,result,{finishedAt:new Date().toISOString()})})}
 }finally{notificationWorkerBusy=false}
}
async function start(){if(process.env.DB_NAME)mysqlStore=await require('./mysql-store.cjs')(seed());await migrateOnStart();await settleIncome();await reconcileWechat().catch(e=>console.error('微信支付对账失败',e.message));setInterval(()=>reconcileWechat().catch(e=>console.error('微信支付对账失败',e.message)),60000).unref();setInterval(()=>drainNotifications().catch(()=>{}),5000).unref();setInterval(()=>settleIncome().catch(e=>console.error('收益入账失败',e.message)),60000).unref();server.listen(Number(process.env.PORT || 3000),HOST,() => { console.log('秀荣科技美肤业务服务: http://' + HOST + ':' + (process.env.PORT || 3000) + '/api/health'); console.log('演示开关：' + DEMO); });}start().catch(e=>{console.error(e);process.exit(1)});
















