// 全部请求在进程内模拟，使用临时 RSA 密钥验签；不连接微信或线上数据。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('微信每日转账：签名、到账确认、防重、失败重试和人工兑现互斥', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shareholder-transfer-test-'));
  const merchant = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateFile = path.join(dir, 'merchant.pem'), publicFile = path.join(dir, 'platform.pem');
  fs.writeFileSync(privateFile, merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(publicFile, platform.publicKey.export({ type: 'spki', format: 'pem' }));
  const env = {
    NODE_ENV: 'test', WECHAT_APPID: 'wx1234567890abcdef', WECHAT_PAY_MCHID: '1900000109',
    WECHAT_PAY_SERIAL_NO: '1234567890ABCDEF', WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
    WECHAT_PAY_PRIVATE_KEY_FILE: privateFile, WECHAT_PAY_PUBLIC_KEY_FILE: publicFile,
    WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_TEST', WECHAT_PAY_NOTIFY_URL: 'https://example.test/api/pay/notify',
    WECHAT_PAY_BASE_URL: 'https://example.test', WECHAT_TRANSFER_ENABLED: 'false',
    WECHAT_TRANSFER_MODE: 'confirm', WECHAT_TRANSFER_SCENE_ID: '1000',
    WECHAT_TRANSFER_SCENE_REPORTS: JSON.stringify([{ info_type: '活动名称', info_content: '本地测试' }]),
    WECHAT_TRANSFER_NOTIFY_URL: 'https://example.test/api/transfer-notify'
  };
  const savedEnv = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const originalFetch = global.fetch;
  const provider = require('../server/wechat-transfer.cjs');
  const transfers = require('../server/shareholder-transfers.cjs');
  const income = require('../server/income.cjs');
  let bills, calls, queryState, badSignature, wrongAmount, missing, authorized;
  function reset() {
    bills = new Map(); calls = []; queryState = 'WAIT_USER_CONFIRM';
    badSignature = false; wrongAmount = false; missing = false; authorized = false;
    process.env.WECHAT_TRANSFER_MODE = 'confirm';
  }
  reset();
  global.fetch = async (url, options) => {
    const pathname = new URL(url).pathname, raw = options.body || '';
    const auth = Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]+)"/g)].map(m => [m[1], m[2]]));
    assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${options.method}\n${pathname}\n${auth.timestamp}\n${auth.nonce_str}\n${raw}\n`), merchant.publicKey, Buffer.from(auth.signature, 'base64')));
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ pathname, method: options.method, body });
    let data, status = 200;
    if (pathname.includes('/user-confirm-authorization/')) {
      if (authorized) data = { state: 'TAKING_EFFECT', appid: env.WECHAT_APPID, openid: 'openid-test', authorization_id: 'auth-test' };
      else { data = { code: 'NOT_FOUND', message: '测试授权未建立' }; status = 404; }
    } else if (options.method === 'POST') {
      assert.equal(options.headers['Wechatpay-Serial'], env.WECHAT_PAY_PUBLIC_KEY_ID);
      bills.set(body.out_bill_no, body);
      data = { out_bill_no: body.out_bill_no, state: 'WAIT_USER_CONFIRM', package_info: 'test-package' };
    } else {
      const billNo = pathname.split('/').pop(), bill = bills.get(billNo);
      if (missing || !bill) { data = { code: 'NOT_FOUND', message: '测试转账单不存在' }; status = 404; }
      else data = { out_bill_no: billNo, appid: env.WECHAT_APPID, mch_id: env.WECHAT_PAY_MCHID, openid: 'openid-test', transfer_amount: bill.transfer_amount + (wrongAmount ? 1 : 0), state: queryState };
    }
    const response = JSON.stringify(data), timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'test-nonce';
    return new Response(response, { status, headers: {
      'Wechatpay-Serial': env.WECHAT_PAY_PUBLIC_KEY_ID, 'Wechatpay-Timestamp': timestamp, 'Wechatpay-Nonce': nonce,
      'Wechatpay-Signature': badSignature && options.method === 'GET' ? 'invalid' : crypto.sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${response}\n`), platform.privateKey).toString('base64')
    } });
  };
  function fixture(cents = 10000) {
    const db = { config: {}, users: [{ id: 'user-test', name: '测试姓名', openid: 'openid-test', wechatAppId: env.WECHAT_APPID }], earnings: [{ userId: 'user-test', amountCents: cents }] };
    income.init(db);
    const pool = { id: 'pool-test', date: '2026-10-26', settledAt: new Date().toISOString(), allocations: [{ userId: 'user-test', amountCents: cents }] };
    transfers.queue(db, pool); transfers.queue(db, pool);
    return db;
  }
  const payout = db => income.managePayout(db, { action: 'payout', userId: 'user-test', amount: 100, method: 'cash', note: '隔离测试', confirmed: true, requestId: 'test-payout-0001' }, 'test');
  const drain = db => transfers.drain(async fn => fn(db));
  const pollAgain = db => { db.shareholderTransfers[0].checkedAt = ''; };
  try {
    await t.test('默认关闭；不自动转账旧收益', () => {
      assert.equal(provider.ready(), false);
      assert.equal(fixture().shareholderTransfers.length, 0);
      process.env.WECHAT_TRANSFER_ENABLED = 'true';
      assert.deepEqual(provider.problems(), []);
      assert.equal(provider.ready(), true);
    });
    await t.test('处理中占用余额；微信成功后只记一次兑现；不能撤销真实转账', async () => {
      reset(); const db = fixture(); assert.equal(db.shareholderTransfers.length, 1);
      assert.equal(income.balanceOf(db, 'user-test').availableCents, 0);
      assert.throws(() => payout(db), /不能超过待兑现/);
      await drain(db); assert.equal(db.shareholderTransfers[0].status, 'waiting'); assert.equal(db.payouts.length, 0);
      assert.equal(transfers.view(db, 'user-test')[0].confirmation.package, 'test-package');
      assert.equal(transfers.view(db)[0].confirmation, undefined);
      pollAgain(db); queryState = 'SUCCESS'; await drain(db); await drain(db);
      assert.equal(calls.filter(c => c.method === 'POST').length, 1);
      assert.equal(db.payouts.length, 1); assert.equal(income.balanceOf(db, 'user-test').reservedCents, 0);
      assert.throws(() => income.managePayout(db, { action: 'cancel', id: db.payouts[0].id, reason: '测试' }, 'test'), /实际到账.*不能撤销/);
    });
    await t.test('伪造签名和错误金额不记到账；结果未知只查原单', async () => {
      reset(); const db = fixture(); badSignature = true; await drain(db);
      assert.equal(db.shareholderTransfers[0].status, 'unknown'); assert.equal(db.payouts.length, 0);
      assert.throws(() => transfers.manage(db, { id: db.shareholderTransfers[0].id, action: 'retry' }, 'test'), /只能重试/);
      badSignature = false; wrongAmount = true; queryState = 'SUCCESS'; pollAgain(db); await drain(db);
      assert.equal(db.payouts.length, 0); wrongAmount = false;
      db.users[0].disabled = true; pollAgain(db); await drain(db);
      assert.equal(db.payouts.length, 1); assert.equal(calls.filter(c => c.method === 'POST').length, 1);
    });
    await t.test('确定失败才释放金额；人工兑现后禁止再次转账', async () => {
      reset(); const db = fixture(); queryState = 'FAIL'; await drain(db);
      assert.equal(income.balanceOf(db, 'user-test').availableCents, 10000); payout(db);
      assert.throws(() => transfers.manage(db, { id: db.shareholderTransfers[0].id, action: 'retry' }, 'test'), /可兑现金额不足/);
      const retryDb = fixture(); await drain(retryDb); const previous = retryDb.shareholderTransfers[0].billNo;
      transfers.manage(retryDb, { id: retryDb.shareholderTransfers[0].id, action: 'retry' }, 'test');
      assert.notEqual(retryDb.shareholderTransfers[0].billNo, previous);
      assert.equal(income.balanceOf(retryDb, 'user-test').availableCents, 0);
    });
    await t.test('查无原单沿用同一商户单号重试；缺微信账号不发起', async () => {
      reset(); const db = fixture(), billNo = db.shareholderTransfers[0].billNo;
      missing = true; await drain(db); missing = false; pollAgain(db); await drain(db);
      assert.equal(db.shareholderTransfers[0].billNo, billNo);
      assert.deepEqual(calls.filter(c => c.method === 'POST').map(c => c.body.out_bill_no), [billNo, billNo]);
      reset(); const unbound = fixture(); delete unbound.users[0].openid; await drain(unbound);
      assert.equal(unbound.shareholderTransfers[0].status, 'blocked'); assert.equal(calls.length, 0);
      const switched=fixture();const row=switched.shareholderTransfers[0];
      Object.assign(row,{attempts:1,retrySameBill:true,appid:'another-app',mchid:env.WECHAT_PAY_MCHID});
      await drain(switched);assert.equal(row.status,'blocked');assert.equal(calls.length,0);
    });
    await t.test('授权前先确认，已有有效授权复用；大额真实姓名加密', async () => {
      reset(); process.env.WECHAT_TRANSFER_MODE = 'authorized';
      const db = fixture(200000); await drain(db);
      const first = calls.find(c => c.method === 'POST');
      assert.match(first.pathname, /pre-transfer-with-authorization$/);
      const name = crypto.privateDecrypt({ key: platform.privateKey, oaepHash: 'sha1', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(first.body.user_name, 'base64')).toString();
      assert.equal(name, '测试姓名');
      reset(); process.env.WECHAT_TRANSFER_MODE = 'authorized'; authorized = true;
      await drain(fixture()); const next = calls.find(c => c.method === 'POST');
      assert.match(next.pathname, /transfer-bills\/transfer$/);
      assert.equal(next.body.authorization_id, 'auth-test'); assert.equal(next.body.openid, undefined);
    });
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
