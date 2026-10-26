const crypto = require('node:crypto');
const provider = require('./wechat-transfer.cjs');
const terminal = new Set(['paid','failed','cancelled']);
const labels = { pending:'待转账', sending:'处理中', unknown:'确认转账结果中', processing:'处理中', waiting:'待微信确认收款', paid:'已到账', failed:'转账失败', cancelled:'已取消', blocked:'待核对收款资料' };
const billNo = key => 'S' + crypto.createHash('sha256').update(key).digest('hex').slice(0,31);
function queue(db, pool, active = provider.ready()) {
  if (!active) return;
  db.shareholderTransfers ||= [];
  for (const item of pool.allocations.filter(r => r.amountCents > 0)) {
    const id = billNo(pool.id + ':' + item.userId);
    if (!db.shareholderTransfers.some(t => t.id === id)) db.shareholderTransfers.push({ id, billNo:id, userId:item.userId, poolId:pool.id, date:pool.date, amountCents:item.amountCents, status:'pending', attempts:0, createdAt:pool.settledAt });
  }
}
const reserved = (db,userId) => (db.shareholderTransfers || []).filter(t => t.userId === userId && !terminal.has(t.status)).reduce((n,t)=>n+t.amountCents,0);
function prepare(db, now = Date.now()) {
  const row = (db.shareholderTransfers || []).find(t => !terminal.has(t.status) && t.status !== 'blocked' && (!t.checkedAt || now - Date.parse(t.checkedAt) >= 60000));
  if (!row) return null;
  const user = db.users.find(u => u.id === row.userId);
  const send = row.attempts === 0 || row.retrySameBill === true;
  if(send){
    const config=provider.config();
    if(row.attempts>0&&(row.appid!==config.appid||row.mchid!==config.mchid)){
      row.status='blocked';row.error='商户或小程序配置已变化，请先核对原商户转账结果';return null;
    }
    const earned=(db.earnings||[]).filter(e=>e.userId===row.userId).reduce((n,e)=>n+(e.amountCents??Math.round(e.amount*100)),0);
    const paid=(db.payouts||[]).filter(p=>p.userId===row.userId&&p.status==='paid').reduce((n,p)=>n+p.amountCents,0);
    if(earned-paid-reserved(db,row.userId)<0){row.status='blocked';row.error='可兑现金额不足，请核对退款或线下兑现记录';return null;}
    if(!user?.openid||user.disabled||user.mergedInto||(user.wechatAppId&&user.wechatAppId!==provider.config().appid)) {row.status='blocked';row.error='请核对并绑定收款微信账号';return null;}
    if(row.openid&&row.openid!==user.openid){row.status='blocked';row.error='收款账号发生变化，请核对原转账';return null;}
    if(row.amountCents>=200000&&(!user.name||/^微信用户/.test(user.name))){row.status='blocked';row.error='请核对收款人真实姓名';return null;}
    row.openid=user.openid;row.appid=provider.config().appid;row.mchid=provider.config().mchid;row.attempts++;row.retrySameBill=false;
  }
  row.checkedAt=new Date(now).toISOString();row.status='sending';
  return {row:structuredClone(row),user:structuredClone(user||{}),send};
}
function apply(db, id, result, now = Date.now()) {
  const row=db.shareholderTransfers.find(t=>t.id===id);
  if (!row || row.status==='paid') return;
  if (result.out_bill_no!==row.billNo || result.appid!==row.appid || (result.mch_id||result.mchid)!==row.mchid || result.openid!==row.openid || result.transfer_amount!==row.amountCents) throw new Error('微信转账回执与本地记录不一致');
  const states={SUCCESS:'paid',FAIL:'failed',CANCELLED:'cancelled',WAIT_USER_CONFIRM:'waiting',ACCEPTED:'processing',PROCESSING:'processing',TRANSFERING:'processing',CANCELING:'processing'};
  if (!states[result.state]) throw new Error('未知微信转账状态');
  row.status=states[result.state];row.error=result.fail_reason||'';row.updatedAt=new Date(now).toISOString();
  if (result.package_info) row.packageInfo=result.package_info;
  if (row.status==='paid' && !db.payouts.some(p=>p.id===row.id)) {
    db.payouts.push({id:row.id,userId:row.userId,amountCents:row.amountCents,amount:row.amountCents/100,method:'wechat',status:'paid',source:'wechatTransfer',note:'每日分配 '+row.date,requestId:row.id,actor:'wechat-transfer',createdAt:row.updatedAt});
  }
}
function manage(db, body, actor) {
  const row=(db.shareholderTransfers||[]).find(t=>t.id===body.id);
  if (!row) throw Object.assign(new Error('转账记录不存在'),{status:404});
  if (body.action!=='retry' || !['failed','cancelled','blocked'].includes(row.status)) throw Object.assign(new Error('只能重试已确认失败、取消或尚未发起的记录'),{status:400});
  // 结果不明确时保留原单查账，不换单；终态失败才允许生成新商户单号。
  if (row.status==='blocked' && row.attempts>0) {row.status='unknown';row.checkedAt='';return row;}
  const earned=(db.earnings||[]).filter(e=>e.userId===row.userId).reduce((n,e)=>n+(e.amountCents??Math.round(e.amount*100)),0);
  const paid=(db.payouts||[]).filter(p=>p.userId===row.userId&&p.status==='paid').reduce((n,p)=>n+p.amountCents,0);
  const available=earned-paid-reserved(db,row.userId)+(terminal.has(row.status)?0:row.amountCents);
  if(available<row.amountCents)throw Object.assign(new Error('可兑现金额不足，请先核对人工兑现或退款'),{status:400});
  row.history ||= [];row.history.push({billNo:row.billNo,status:row.status,at:new Date().toISOString(),actor});
  row.billNo=billNo(row.id+':'+row.history.length);row.status='pending';row.attempts=0;row.checkedAt='';row.error='';delete row.packageInfo;delete row.openid;
  return row;
}
function view(db, userId) {
  return (db.shareholderTransfers||[]).filter(t=>!userId||t.userId===userId).map(t=>({id:t.id,userId:t.userId,date:t.date,amount:t.amountCents/100,status:t.status,statusText:labels[t.status],error:t.error||'',...(userId&&t.status==='waiting'&&t.packageInfo?{confirmation:{mchId:t.mchid,appId:t.appid,package:t.packageInfo}}:{})}));
}
async function drain(transaction) {
  if (!provider.ready()) return;
  const job=await transaction(db=>prepare(db));if(!job)return;
  let response;
  try {
    if (job.send) response=await provider.send(job.row,job.user);
    const result=await provider.query(job.row.billNo);
    await transaction(db=>apply(db,job.row.id,{...result,package_info:response?.package_info}));
  } catch (e) {
    await transaction(db=>{const row=db.shareholderTransfers.find(t=>t.id===job.row.id);if(!row||terminal.has(row.status))return;row.status='unknown';row.error=e.message;if(e.code==='NOT_FOUND')row.retrySameBill=true;if(response?.package_info)row.packageInfo=response.package_info;});
  }
}
module.exports = { queue, reserved, prepare, apply, manage, view, drain, labels };
