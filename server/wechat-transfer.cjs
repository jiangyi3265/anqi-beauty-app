// 商家转账独立开关；复用支付模块的签名、应答验签，不影响收款和退款。
const crypto = require('node:crypto');
const fs = require('node:fs');
const pay = require('./wechat-pay.cjs');
const base = '/v3/fund-app/mch-transfer';
function config() {
  let reports;
  try { reports = JSON.parse(process.env.WECHAT_TRANSFER_SCENE_REPORTS || 'null'); } catch { reports = null; }
  return { enabled: process.env.WECHAT_TRANSFER_ENABLED === 'true', mode: process.env.WECHAT_TRANSFER_MODE || 'confirm', scene: process.env.WECHAT_TRANSFER_SCENE_ID || '', reports,
    notifyUrl: process.env.WECHAT_TRANSFER_NOTIFY_URL || '', appid: process.env.WECHAT_APPID || '', mchid: process.env.WECHAT_PAY_MCHID || '' };
}
function problems() {
  const c = config(), errors = pay.problems();
  if (!['confirm','authorized'].includes(c.mode)) errors.push('WECHAT_TRANSFER_MODE');
  if (!/^\d{4}$/.test(c.scene)) errors.push('WECHAT_TRANSFER_SCENE_ID');
  if (!Array.isArray(c.reports) || !c.reports.length || c.reports.some(r => !r.info_type || !r.info_content || r.info_type.length > 15 || r.info_content.length > 32)) errors.push('WECHAT_TRANSFER_SCENE_REPORTS');
  if (!/^https:\/\/[^?#]+$/.test(c.notifyUrl)) errors.push('WECHAT_TRANSFER_NOTIFY_URL');
  if (!process.env.WECHAT_PAY_PUBLIC_KEY_FILE || !process.env.WECHAT_PAY_PUBLIC_KEY_ID) errors.push('WECHAT_PAY_PUBLIC_KEY_FILE / WECHAT_PAY_PUBLIC_KEY_ID');
  return errors;
}
const ready = () => config().enabled && problems().length === 0;
const query = billNo => pay.call('GET', base + '/transfer-bills/out-bill-no/' + encodeURIComponent(billNo));
async function send(job, user, saveRequest = async () => {}) {
  const c = config();
  if (!ready()) throw new Error('微信转账尚未配置完成');
  if (job.providerRequest) {
    const request = job.providerRequest;
    return pay.call('POST', request.path, request.body, request.headers);
  }
  if (!job.openid || (user.wechatAppId && user.wechatAppId !== c.appid)) throw new Error('收款微信账号尚未绑定或小程序不一致');
  const body = { appid: c.appid, out_bill_no: job.billNo, transfer_scene_id: c.scene, openid: job.openid, transfer_amount: job.amountCents,
    transfer_remark: job.source === 'withdrawal' ? '会员余额提现' : '每日分配 ' + job.date, notify_url: c.notifyUrl, transfer_scene_report_infos: c.reports };
  if (job.amountCents >= 200000) {
    if (!user.name || /^微信用户/.test(user.name)) throw new Error('本笔金额需先核对收款人真实姓名');
    body.user_name = crypto.publicEncrypt({ key: fs.readFileSync(process.env.WECHAT_PAY_PUBLIC_KEY_FILE), oaepHash: 'sha1', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(user.name)).toString('base64');
  }
  let path = base + '/transfer-bills';
  if ((job.transferMode || c.mode) === 'authorized') {
    const authorizationNo = 'A' + crypto.createHash('sha256').update(c.appid + job.userId + job.openid).digest('hex').slice(0,31);
    let authorization;
    try { authorization = await pay.call('GET', base + '/user-confirm-authorization/out-authorization-no/' + authorizationNo); }
    catch (e) { if (e.code !== 'NOT_FOUND') throw e; }
    if (authorization?.state === 'TAKING_EFFECT') {
      if (authorization.openid !== job.openid || authorization.appid !== c.appid) throw new Error('微信收款授权账号不一致');
      path += '/transfer'; delete body.openid;
      body.authorization_id = authorization.authorization_id;
    } else {
      path += '/pre-transfer-with-authorization';
      body.authorization_info = { out_authorization_no: authorizationNo, user_display_name: '会员' + job.userId.slice(0,8), authorization_notify_url: c.notifyUrl };
    }
  }
  const request = { path, body, headers: { 'Wechatpay-Serial': process.env.WECHAT_PAY_PUBLIC_KEY_ID } };
  // 在网络请求前持久化原参数；响应丢失时沿用原单恢复收款确认信息。
  await saveRequest(request);
  job.providerRequest = request;
  return pay.call('POST', path, body, request.headers);
}
module.exports = { config, ready, problems, send, query };
