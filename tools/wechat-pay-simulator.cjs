// 测试专用的微信支付 API v3 模拟服务：校验商户请求签名，对每个应答签名，加密并推送支付/退款回调。
// 支持“微信支付公钥”和“平台证书”两种验签方式。仅供验收测试使用，不连接真实微信支付。
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function createSimulator({ mchid, appid, apiV3Key, merchantPublicKey, merchantSerial, mode = 'publicKey' }) {
  const publicKeyId = 'PUB_KEY_ID_0114232806062025041400111200000000';
  let platformKey, platformPublicPem, certPem = '', certSerial = '';
  if (mode === 'certificate') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxpay-cert-'));
    const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=Tenpay.com Root CA'], { stdio: 'ignore' });
    if (r.status !== 0) throw Error('openssl 生成测试平台证书失败');
    platformKey = crypto.createPrivateKey(fs.readFileSync(path.join(dir, 'k.pem')));
    certPem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
    certSerial = new crypto.X509Certificate(certPem).serialNumber.toUpperCase();
    fs.rmSync(dir, { recursive: true, force: true });
  } else {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    platformKey = pair.privateKey;
  }
  platformPublicPem = crypto.createPublicKey(platformKey).export({ type: 'spki', format: 'pem' });
  const serial = mode === 'certificate' ? certSerial : publicKeyId;
  const sim = { mode, publicKeyId, platformPublicPem, orders: new Map(), refunds: new Map(), calls: [], clockOffset: 0, rejected: 0, server: null, port: 0 };
  const now = () => Date.now() + sim.clockOffset;

  function encrypt(plain, aad) {
    const iv = crypto.randomBytes(6).toString('hex');
    const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(iv)); c.setAAD(Buffer.from(aad));
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);
    return { algorithm: 'AEAD_AES_256_GCM', ciphertext: data.toString('base64'), associated_data: aad, nonce: iv };
  }
  function signedHeaders(body, { stale = false, badSignature = false, wrongSerial = false } = {}) {
    const ts = String(Math.floor(now() / 1000) - (stale ? 600 : 0)), nonce = crypto.randomBytes(16).toString('hex');
    let signature = crypto.createSign('RSA-SHA256').update(`${ts}\n${nonce}\n${body}\n`).sign(platformKey, 'base64');
    if (badSignature) signature = crypto.createSign('RSA-SHA256').update(`${ts}\n${nonce}\n${body}tampered\n`).sign(platformKey, 'base64');
    return { 'Wechatpay-Timestamp': ts, 'Wechatpay-Nonce': nonce, 'Wechatpay-Signature': signature, 'Wechatpay-Serial': wrongSerial ? 'PUB_KEY_ID_UNKNOWN' : serial, 'Wechatpay-Signature-Type': 'WECHATPAY2-SHA256-RSA2048' };
  }
  function reply(res, status, data) {
    const body = data === undefined ? '' : JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json', ...signedHeaders(body) }); res.end(body);
  }
  function authorized(req, raw) {
    const m = String(req.headers.authorization || '').match(/^WECHATPAY2-SHA256-RSA2048 (.*)$/);
    if (!m) return false;
    const f = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    if (f.mchid !== mchid || f.serial_no !== merchantSerial || Math.abs(now() / 1000 - Number(f.timestamp)) > 300) return false;
    try { return crypto.createVerify('RSA-SHA256').update(`${req.method}\n${req.url}\n${f.timestamp}\n${f.nonce_str}\n${raw}\n`).verify(merchantPublicKey, f.signature, 'base64'); } catch { return false; }
  }
  const tx = o => ({ appid: o.appid, mchid: o.mchid, out_trade_no: o.out_trade_no, transaction_id: o.transaction_id || '', trade_type: 'JSAPI', trade_state: o.state, trade_state_desc: o.state, bank_type: o.state === 'SUCCESS' ? 'OTHERS' : '', success_time: o.success_time || '', payer: { openid: o.payer.openid }, amount: { total: o.amount.total, payer_total: o.amount.total, currency: 'CNY', payer_currency: 'CNY' } });

  sim.server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const url = new URL(req.url, 'http://x');
    sim.calls.push({ method: req.method, path: url.pathname, body: raw ? JSON.parse(raw) : null });
    if (!authorized(req, raw)) { sim.rejected++; res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ code: 'SIGN_ERROR', message: '签名错误' })); }
    const b = raw ? JSON.parse(raw) : {};
    let m;
    if (req.method === 'GET' && url.pathname === '/v3/certificates') {
      if (mode !== 'certificate') return reply(res, 404, { code: 'RESOURCE_NOT_EXISTS', message: '无可用的平台证书' });
      return reply(res, 200, { data: [{ serial_no: certSerial, effective_time: new Date().toISOString(), expire_time: new Date(Date.now() + 86400000).toISOString(), encrypt_certificate: encrypt(certPem, 'certificate') }] });
    }
    if (req.method === 'POST' && url.pathname === '/v3/pay/transactions/jsapi') {
      if (b.appid !== appid || b.mchid !== mchid || !b.out_trade_no || !b.description || !b.notify_url || !b.time_expire || !b.payer?.openid || !Number.isInteger(b.amount?.total) || b.amount.total < 1 || b.amount.currency !== 'CNY') return reply(res, 400, { code: 'PARAM_ERROR', message: '参数错误' });
      const old = sim.orders.get(b.out_trade_no);
      if (old) {
        if (old.state === 'SUCCESS') return reply(res, 400, { code: 'ORDERPAID', message: '该订单已支付' });
        if (old.state === 'CLOSED') return reply(res, 400, { code: 'ORDER_CLOSED', message: '订单已关闭' });
        if (JSON.stringify(old.request) !== JSON.stringify(b)) return reply(res, 400, { code: 'INVALID_REQUEST', message: '201 商户订单号重复' });
        return reply(res, 200, { prepay_id: old.prepay_id });
      }
      const o = { ...b, request: b, state: 'NOTPAY', prepay_id: 'wx' + crypto.randomBytes(14).toString('hex') };
      sim.orders.set(b.out_trade_no, o); return reply(res, 200, { prepay_id: o.prepay_id });
    }
    if ((m = url.pathname.match(/^\/v3\/pay\/transactions\/out-trade-no\/([^/]+)$/)) && req.method === 'GET') {
      const o = sim.orders.get(decodeURIComponent(m[1])); if (!o) return reply(res, 404, { code: 'ORDER_NOT_EXIST', message: '订单不存在' });
      return reply(res, 200, tx(o));
    }
    if ((m = url.pathname.match(/^\/v3\/pay\/transactions\/out-trade-no\/([^/]+)\/close$/)) && req.method === 'POST') {
      const o = sim.orders.get(decodeURIComponent(m[1])); if (!o) return reply(res, 404, { code: 'ORDER_NOT_EXIST', message: '订单不存在' });
      if (o.state === 'SUCCESS') return reply(res, 400, { code: 'ORDERPAID', message: '订单已支付' });
      o.state = 'CLOSED'; return reply(res, 204);
    }
    if (req.method === 'POST' && url.pathname === '/v3/refund/domestic/refunds') {
      const o = [...sim.orders.values()].find(x => x.transaction_id && x.transaction_id === b.transaction_id);
      if (!o || o.state !== 'SUCCESS') return reply(res, 404, { code: 'RESOURCE_NOT_EXISTS', message: '订单不存在' });
      if (b.amount?.total !== o.amount.total || b.amount.refund < 1 || b.amount.refund > o.amount.total || b.amount.currency !== 'CNY' || !b.out_refund_no || !b.notify_url) return reply(res, 400, { code: 'PARAM_ERROR', message: '退款参数错误' });
      const old = sim.refunds.get(b.out_refund_no); if (old) return reply(res, 200, old.view());
      const r = { request: b, out_trade_no: o.out_trade_no, refund_id: '50' + crypto.randomBytes(12).toString('hex'), status: 'PROCESSING' };
      r.view = () => ({ refund_id: r.refund_id, out_refund_no: b.out_refund_no, transaction_id: b.transaction_id, out_trade_no: o.out_trade_no, channel: 'ORIGINAL', status: r.status, success_time: r.success_time || '', create_time: new Date().toISOString(), amount: { total: o.amount.total, refund: b.amount.refund, payer_total: o.amount.total, payer_refund: b.amount.refund, currency: 'CNY' } });
      sim.refunds.set(b.out_refund_no, r); return reply(res, 200, r.view());
    }
    if ((m = url.pathname.match(/^\/v3\/refund\/domestic\/refunds\/([^/]+)$/)) && req.method === 'GET') {
      const r = sim.refunds.get(decodeURIComponent(m[1])); if (!r) return reply(res, 404, { code: 'RESOURCE_NOT_EXISTS', message: '退款单不存在' });
      return reply(res, 200, r.view());
    }
    reply(res, 404, { code: 'NOT_FOUND', message: '接口不存在' });
  });

  sim.start = () => new Promise(r => sim.server.listen(0, '127.0.0.1', () => { sim.port = sim.server.address().port; sim.base = 'http://127.0.0.1:' + sim.port; r(sim); }));
  sim.stop = () => new Promise(r => sim.server.close(() => r()));
  sim.count = (method, prefix) => sim.calls.filter(c => c.method === method && c.path.startsWith(prefix)).length;
  // 推送回调；可选：篡改签名、过期时间戳、未知公钥、交易内容覆盖
  sim.sendNotify = async (url, eventType, original, data, opts = {}) => {
    const body = JSON.stringify({ id: crypto.randomUUID(), create_time: new Date().toISOString(), resource_type: 'encrypt-resource', event_type: eventType, summary: eventType, resource: { original_type: original, ...encrypt(JSON.stringify(data), original) } });
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedHeaders(body, opts) }, body });
    return r.status;
  };
  sim.pay = async (outTradeNo, { notify = true, override = {}, opts = {} } = {}) => {
    const o = sim.orders.get(outTradeNo); if (!o) throw Error('模拟器中没有该订单 ' + outTradeNo);
    if (o.state === 'CLOSED') return { closed: true };
    if (o.state !== 'SUCCESS') { o.state = 'SUCCESS'; o.transaction_id = '42' + crypto.randomBytes(13).toString('hex').slice(0, 26); o.success_time = new Date(now()).toISOString().slice(0, 19) + '+00:00'; }
    return notify ? { status: await sim.sendNotify(o.notify_url, 'TRANSACTION.SUCCESS', 'transaction', { ...tx(o), ...override }, opts), tx: tx(o) } : { tx: tx(o) };
  };
  sim.notifyAgain = (outTradeNo, opts = {}) => { const o = sim.orders.get(outTradeNo); return sim.sendNotify(o.notify_url, 'TRANSACTION.SUCCESS', 'transaction', tx(o), opts); };
  sim.finishRefund = async (outRefundNo, status = 'SUCCESS', notify = true) => {
    const r = sim.refunds.get(outRefundNo); r.status = status; r.success_time = status === 'SUCCESS' ? new Date().toISOString() : '';
    if (!notify) return 0;
    const v = r.view();
    return sim.sendNotify(r.request.notify_url, 'REFUND.' + status, 'refund', { mchid, out_trade_no: v.out_trade_no, transaction_id: v.transaction_id, out_refund_no: v.out_refund_no, refund_id: v.refund_id, refund_status: status, success_time: v.success_time, user_received_account: '支付用户零钱', amount: { total: v.amount.total, refund: v.amount.refund, payer_total: v.amount.total, payer_refund: v.amount.refund } });
  };
  return sim;
}
module.exports = { createSimulator };
