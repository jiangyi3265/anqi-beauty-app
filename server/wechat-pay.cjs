// 微信支付 API v3（小程序 JSAPI 支付）：下单、调起参数签名、回调验签解密、查单、关单、退款。
// 仅在 PAYMENT_MODE=wechat 且商户资料齐全时启用。商户私钥、APIv3 密钥只从服务器环境变量（或其指向的文件）读取，
// 不写入数据库、接口响应或日志。微信侧的应答和回调都用微信支付公钥或平台证书验签，验签失败一律拒绝。
const crypto = require('node:crypto');
const fs = require('node:fs');

const TEST = process.env.NODE_ENV === 'test';
const LOCAL = /^http:\/\/127\.0\.0\.1:\d+(\/|$)/;
function readFile(file) { try { return file ? fs.readFileSync(file, 'utf8') : ''; } catch { return ''; } }
let cached;
function config() {
  if (cached) return cached;
  const e = process.env;
  cached = {
    appid: e.WECHAT_APPID || '', mchid: e.WECHAT_PAY_MCHID || '', serial: e.WECHAT_PAY_SERIAL_NO || '',
    privateKey: readFile(e.WECHAT_PAY_PRIVATE_KEY_FILE), apiV3Key: e.WECHAT_PAY_API_V3_KEY || '',
    publicKey: readFile(e.WECHAT_PAY_PUBLIC_KEY_FILE), publicKeyId: e.WECHAT_PAY_PUBLIC_KEY_ID || '',
    notifyUrl: e.WECHAT_PAY_NOTIFY_URL || '',
    base: (e.WECHAT_PAY_BASE_URL || 'https://api.mch.weixin.qq.com').replace(/\/$/, ''),
  };
  return cached;
}
// 返回缺失或无效的配置项名称（不含任何配置值），用于启动日志
function problems() {
  const c = config(), p = [];
  if (!/^wx[0-9a-zA-Z]{16}$/.test(c.appid)) p.push('WECHAT_APPID');
  if (!/^\d{8,12}$/.test(c.mchid)) p.push('WECHAT_PAY_MCHID');
  if (!/^[0-9A-Fa-f]{16,64}$/.test(c.serial)) p.push('WECHAT_PAY_SERIAL_NO');
  try { crypto.createPrivateKey(c.privateKey); } catch { p.push('WECHAT_PAY_PRIVATE_KEY_FILE'); }
  if (Buffer.byteLength(c.apiV3Key) !== 32) p.push('WECHAT_PAY_API_V3_KEY');
  if (c.publicKey || c.publicKeyId) {
    try { crypto.createPublicKey(c.publicKey); } catch { p.push('WECHAT_PAY_PUBLIC_KEY_FILE'); }
    if (!/^PUB_KEY_ID_\w+$/.test(c.publicKeyId)) p.push('WECHAT_PAY_PUBLIC_KEY_ID');
  }
  if (!/^https:\/\/[^/]+\/\S+$/.test(c.notifyUrl) && !(TEST && LOCAL.test(c.notifyUrl))) p.push('WECHAT_PAY_NOTIFY_URL');
  if (!/^https:\/\//.test(c.base) && !(TEST && LOCAL.test(c.base))) p.push('WECHAT_PAY_BASE_URL');
  return p;
}
const configured = () => problems().length === 0;

function payError(message, status = 502, code = '') { const e = new Error(message); e.status = status; e.code = code; return e; }
const nonce = () => crypto.randomBytes(16).toString('hex');
const sign = message => crypto.createSign('RSA-SHA256').update(message).sign(config().privateKey, 'base64');
const cents = yuan => Math.round(Number(yuan) * 100);
const expireAt = order => Date.parse(order.createdAt) + 2 * 3600000;
function rfc3339(ms) { return new Date(ms + 8 * 3600000).toISOString().slice(0, 19) + '+08:00'; }
function clip(text, fallback, maxBytes) { let s = String(text || '').trim() || fallback; while (Buffer.byteLength(s) > maxBytes) s = s.slice(0, -1); return s; }

// 微信支付公钥（PUB_KEY_ID_ 开头）优先；未配置时自动下载并缓存平台证书
const platformKeys = new Map(); let platformLoadedAt = 0, platformTriedAt = 0;
async function publicKeyFor(serial) {
  const c = config();
  if (c.publicKeyId && serial === c.publicKeyId) return crypto.createPublicKey(c.publicKey);
  if (/^PUB_KEY_ID_/.test(serial)) return null;
  // 未知编号最多每分钟去微信更新一次平台证书，防止伪造请求反复触发下载
  const stale = Date.now() - platformLoadedAt > 12 * 3600000;
  if ((stale || !platformKeys.has(serial)) && Date.now() - platformTriedAt > 60000) { platformTriedAt = Date.now(); await loadCertificates(); }
  return platformKeys.get(serial) || null;
}
function decrypt({ algorithm, ciphertext, associated_data = '', nonce: iv }) {
  if (algorithm !== 'AEAD_AES_256_GCM') throw payError('微信支付加密方式不支持', 400);
  const data = Buffer.from(String(ciphertext), 'base64');
  if (data.length <= 16) throw payError('微信支付密文无效', 400);
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config().apiV3Key), Buffer.from(String(iv)));
  d.setAAD(Buffer.from(String(associated_data))); d.setAuthTag(data.subarray(data.length - 16));
  try { return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8'); }
  catch { throw payError('微信支付密文解密失败', 400); }
}
async function verify(get, raw) {
  const ts = get('wechatpay-timestamp'), n = get('wechatpay-nonce'), sig = get('wechatpay-signature'), serial = get('wechatpay-serial');
  if (!ts || !n || !sig || !serial) throw payError('微信支付签名缺失', 401);
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw payError('微信支付签名已过期', 401);
  const key = await publicKeyFor(serial);
  let ok = false;
  try { ok = !!key && crypto.createVerify('RSA-SHA256').update(`${ts}\n${n}\n${raw}\n`).verify(key, sig, 'base64'); } catch { ok = false; }
  if (!ok) throw payError('微信支付签名无效', 401);
}

async function request(method, path, body) {
  const c = config(), ts = String(Math.floor(Date.now() / 1000)), n = nonce(), text = body === undefined ? '' : JSON.stringify(body);
  const auth = `WECHATPAY2-SHA256-RSA2048 mchid="${c.mchid}",nonce_str="${n}",signature="${sign(`${method}\n${path}\n${ts}\n${n}\n${text}\n`)}",timestamp="${ts}",serial_no="${c.serial}"`;
  let res, raw;
  try {
    res = await fetch(c.base + path, { method, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'xiurong-beauty-business/1.0' }, body: body === undefined ? undefined : text, signal: AbortSignal.timeout(10000), redirect: 'error' });
    raw = await res.text();
  } catch { throw payError('微信支付服务暂时无法连接，请稍后重试', 503); }
  return { status: res.status, get: name => res.headers.get(name), raw };
}
async function loadCertificates() {
  const r = await request('GET', '/v3/certificates');
  if (r.status !== 200) throw payError('微信支付平台证书获取失败', 502);
  const keys = new Map();
  for (const item of JSON.parse(r.raw).data || []) keys.set(item.serial_no, new crypto.X509Certificate(decrypt(item.encrypt_certificate)).publicKey);
  // 平台证书由 APIv3 密钥解密得到，再用它验证本次应答签名，防止中间人替换
  const serial = r.get('wechatpay-serial');
  if (!keys.has(serial) || !crypto.createVerify('RSA-SHA256').update(`${r.get('wechatpay-timestamp')}\n${r.get('wechatpay-nonce')}\n${r.raw}\n`).verify(keys.get(serial), r.get('wechatpay-signature') || '', 'base64')) throw payError('微信支付平台证书验签失败', 502);
  platformKeys.clear(); for (const [k, v] of keys) platformKeys.set(k, v); platformLoadedAt = Date.now();
}
const MESSAGES = { ORDERPAID: '订单已支付', ORDER_CLOSED: '微信支付订单已关闭', ORDER_NOT_EXIST: '微信支付订单不存在', NOT_ENOUGH: '商户可用退款余额不足，请充值后重试', FREQUENCY_LIMITED: '操作太频繁，请稍后重试', SYSTEM_ERROR: '微信支付系统繁忙，请稍后重试' };
async function call(method, path, body) {
  const r = await request(method, path, body);
  // 成功应答必须验签；错误应答若带签名也验签。错误本身不会让订单变为已支付，付款只认验签通过的查单结果或回调
  if (r.status < 300 || r.get('wechatpay-signature')) await verify(r.get, r.raw);
  let data = {};
  if (r.raw) { try { data = JSON.parse(r.raw); } catch { throw payError('微信支付返回了无效内容', 502); } }
  if (r.status >= 400) throw payError(MESSAGES[data.code] || ('微信支付处理失败：' + (data.message || r.status)), r.status >= 500 ? 502 : 400, data.code || '');
  return data;
}

async function prepay(order, openid) {
  const c = config();
  const data = await call('POST', '/v3/pay/transactions/jsapi', { appid: c.appid, mchid: c.mchid, description: clip(order.product?.name, '门店订单', 127), out_trade_no: order.number, time_expire: rfc3339(expireAt(order)), notify_url: c.notifyUrl, amount: { total: cents(order.total), currency: 'CNY' }, payer: { openid } });
  if (!data.prepay_id) throw payError('微信支付下单失败，请稍后重试', 502);
  return data.prepay_id;
}
function payParams(prepayId) {
  const c = config(), timeStamp = String(Math.floor(Date.now() / 1000)), nonceStr = nonce(), pkg = 'prepay_id=' + prepayId;
  return { appId: c.appid, timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign: sign(`${c.appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`) };
}
const query = number => call('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(number)}?mchid=${config().mchid}`);
const close = number => call('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(number)}/close`, { mchid: config().mchid });
const refundNo = order => 'R' + order.number;
const refund = (order, reason) => call('POST', '/v3/refund/domestic/refunds', { transaction_id: order.paymentTransactionId, out_refund_no: refundNo(order), reason: [...clip(reason, '订单退款', 240)].slice(0, 80).join(''), notify_url: config().notifyUrl, amount: { refund: cents(order.total), total: cents(order.total), currency: 'CNY' } });
const queryRefund = outRefundNo => call('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`);

// 回调：先验签，再解密；返回 { eventType, data }
async function parseNotify(headers, raw) {
  await verify(name => headers[name], raw);
  let body; try { body = JSON.parse(raw); } catch { throw payError('回调内容无效', 400); }
  if (!body?.resource) throw payError('回调内容无效', 400);
  return { eventType: String(body.event_type || ''), data: JSON.parse(decrypt(body.resource)) };
}
// 校验微信交易与本地订单一致，返回不一致原因（一致返回空串）
function mismatch(tx, order) {
  const c = config();
  if (tx.mchid !== c.mchid) return '商户号不一致';
  if (tx.appid !== c.appid) return '小程序不一致';
  if (tx.out_trade_no !== order.number) return '订单号不一致';
  if (Number(tx.amount?.total) !== cents(order.total)) return '金额不一致';
  return '';
}

module.exports = { configured, problems, prepay, payParams, query, close, refund, refundNo, queryRefund, parseNotify, mismatch, cents, expireAt };
