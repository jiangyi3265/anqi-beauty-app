// 在服务器上核对微信支付商户配置（不下单、不扣款）：
//   /opt/anqi/node/bin/node --env-file=/opt/anqi/shared/business.env tools/wechat-pay-check.cjs
// 1. 列出缺少或无效的配置项名称（不打印任何密钥）；
// 2. 用商户证书签名查询一个不存在的订单。微信返回“订单不存在”且应答验签通过，
//    说明商户号、API 证书序列号、商户私钥、APIv3 密钥与微信支付公钥/平台证书均已配对。
const wechatPay = require('../server/wechat-pay.cjs');
(async () => {
  const problems = wechatPay.problems();
  if (process.env.PAYMENT_MODE !== 'wechat') console.log('提示：PAYMENT_MODE 不是 wechat，业务服务仍按门店收款运行。');
  if (problems.length) { console.log('配置不完整：' + problems.join('、')); process.exit(1); }
  const probe = 'CHECK' + Date.now();
  try {
    await wechatPay.query(probe);
    console.log('异常：查询到了不应存在的订单 ' + probe); process.exit(1);
  } catch (e) {
    if (e.code === 'ORDER_NOT_EXIST') { console.log('微信支付配置核对通过：商户签名被微信接受，微信应答验签通过。'); return; }
    console.log('微信支付配置核对失败：' + e.message + (e.code ? '（' + e.code + '）' : '')); process.exit(1);
  }
})();
