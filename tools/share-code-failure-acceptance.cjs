// 生产二维码接口失败时不得回退到已停用的网页版。
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const seed = require('../server/seed.cjs')
const { makeSuperVip } = require('./test-super-vip.cjs')

const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-code-failure-'))
const file = path.join(dir, 'db.json')
const preload = path.join(dir, 'mock-wechat.cjs')
const secret = crypto.randomBytes(16).toString('hex')
let child
let base

async function request(route, method = 'GET', data, token, internal = false) {
  const response = await fetch(base + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(internal ? { 'x-anqi-internal': secret } : {})
    },
    body: data === undefined ? undefined : JSON.stringify(data)
  })
  return { status: response.status, body: await response.json() }
}

async function main() {
  fs.writeFileSync(file, JSON.stringify(seed()))
  fs.writeFileSync(preload, `
const wechat = require(${JSON.stringify(path.join(root, 'server/wechat-login.cjs'))})
wechat.configured = () => true
wechat.exchangeCode = async code => ({ openid: code, appid: process.env.WECHAT_APPID })
const originalFetch = global.fetch
global.fetch = (url, options) => String(url).startsWith('https://api.weixin.qq.com/')
  ? Promise.resolve(new Response(JSON.stringify({ errcode: 40013 }), { headers: { 'Content-Type': 'application/json' } }))
  : originalFetch(url, options)
`)
  const socket = net.createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  base = `http://127.0.0.1:${port}/api`
  child = spawn(process.execPath, ['-r', preload, 'server/index.cjs'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), DATA_FILE: file, DB_NAME: '',
      NODE_ENV: 'production', DEMO_MODE: 'false', WECHAT_MOCK: 'false',
      WECHAT_APPID: 'wx1e9453a0ddc8385d', WECHAT_APPSECRET: 'isolated-test',
      ADMIN_PASSWORD: secret, INTERNAL_SECRET: secret, PAYMENT_MODE: 'off'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(errors)
    try { if ((await fetch(base + '/health')).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const login = await request('/auth/wechat', 'POST', { code: crypto.randomUUID() })
  assert.equal(login.status, 200)
  const admin = async (route, method = 'GET', data) => {
    const result = await request('/admin/' + route, method, data, '', true)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    return result.body
  }
  await makeSuperVip(admin, login.body.user.id, 'qr-failure')
  const result = await request('/share-code', 'GET', undefined, login.body.token)
  assert.equal(result.status, 503)
  assert.match(result.body.error, /小程序码生成失败/)
  assert.equal(fs.existsSync(path.join(root, 'static/uploads/share-' + login.body.user.id + '.png')), false)
  console.log(JSON.stringify({ ok: true, status: result.status, noWebQr: true }))
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  if (child && child.exitCode === null) {
    const finished = once(child, 'exit')
    child.kill()
    await finished
  }
  if (dir.startsWith(os.tmpdir() + path.sep) && path.basename(dir).startsWith('share-code-failure-')) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
