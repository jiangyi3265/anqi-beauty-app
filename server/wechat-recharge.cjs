// 商户银行转账充值：资金进入运营账户，只有验签通过的查单结果可以触发余额分配。
const pay = require('./wechat-pay.cjs');
const base = '/v3/recharge/bank-transfer-recharges';
function problems() {
  return pay.problems().filter(key => !['WECHAT_APPID', 'WECHAT_PAY_NOTIFY_URL'].includes(key));
}
const ready = () => process.env.WECHAT_RECHARGE_ENABLED === 'true' && problems().length === 0;
const merchant = () => process.env.WECHAT_PAY_MCHID || '';
function apply(row) {
  if (!ready() || row.mchid !== merchant()) throw new Error('充值通道尚未配置或商户已变化');
  return pay.call('POST', base + '/apply', {
    out_recharge_no: row.number, account_type: 'OPERATION', recharge_scene: 'NORMAL_BANK_TRANSFER',
    recharge_amount: { amount: row.amountCents, currency: 'CNY' }
  });
}
const query = number => pay.call('GET', base + '/out-recharge-no/' + encodeURIComponent(number));
module.exports = { ready, problems, merchant, apply, query };
