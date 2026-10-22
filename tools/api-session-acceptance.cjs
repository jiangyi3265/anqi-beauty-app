const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual mini-program bundle, including responses with empty bodies.
const build = path.resolve(process.argv[2] || 'dist/build/mp-weixin');
const source = fs.readFileSync(path.join(build, 'common/api.js'), 'utf8');

function client(response) {
  const state = { token: 'expired-test-session', navigations: [], requests: [] };
  const uni = {
    getStorageSync: key => key === 'token' ? state.token : '',
    removeStorageSync: key => { if (key === 'token') state.token = ''; },
    navigateTo: options => state.navigations.push(options.url),
    request: async options => {
      state.requests.push(options.url);
      if (response instanceof Error) throw response;
      return response;
    }
  };
  const context = {
    exports: {},
    require: name => name === './vendor.js'
      ? { index: uni }
      : { resolveUploadedAssets: value => value }
  };
  vm.runInNewContext(source, context);
  return { api: context.exports.api, state };
}

(async () => {
  let c = client({ statusCode: 401, data: '' });
  await assert.rejects(c.api('/auth/refresh', 'POST'), e => e.status === 401);
  assert.equal(c.state.token, '');
  assert.deepEqual(c.state.navigations, []);
  assert.equal(c.state.requests[0], 'https://anqiht.okam.top/api/auth/refresh');

  c = client({ statusCode: 401, data: '' });
  await assert.rejects(c.api('/me'), e => e.status === 401);
  assert.equal(c.state.token, '');
  assert.deepEqual(c.state.navigations, ['/pages/login/index']);

  c = client({ statusCode: 403, data: '' });
  await assert.rejects(c.api('/me'), e => e.status === 403);
  assert.equal(c.state.token, 'expired-test-session');
  assert.deepEqual(c.state.navigations, []);

  c = client({ statusCode: 401, data: { error: '请先登录' } });
  await assert.rejects(c.api('/auth/refresh', 'POST'), e => e.status === 401 && e.message === '请先登录');
  assert.equal(c.state.token, '');

  c = client(new Error('request:fail timeout'));
  await assert.rejects(c.api('/bootstrap'), e => e.status === undefined && /网络/.test(e.message));
  assert.equal(c.state.token, 'expired-test-session');

  c = client({ statusCode: 200, data: { products: [{ id: 'live-product' }] } });
  assert.equal((await c.api('/bootstrap')).products[0].id, 'live-product');

  console.log(JSON.stringify({ ok: true, checks: 6, empty401ClearsSession: true, protectedPagePromptsLogin: true, networkFailuresKeepSession: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
