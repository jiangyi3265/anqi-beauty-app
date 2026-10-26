// 隔离验证：正常绑定与只展示的历史邀请均可由本人查看，其他人的记录不可见。
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const seed = require('../server/seed.cjs')

const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shares-display-'))
const file = path.join(dir, 'db.json')
const appid = 'wxmocktest00000000'
const inviterId = '11111111-1111-4111-8111-111111111111'
const historicalId = '22222222-2222-4222-8222-222222222222'
const boundId = '33333333-3333-4333-8333-333333333333'
const strangerId = '44444444-4444-4444-8444-444444444444'
const loginCode = 'shares-display-inviter'
const data = seed()
data.users.push(
  { id: inviterId, name: '邀请人', openid: 'mock_' + crypto.createHash('sha256').update(loginCode).digest('hex'), wechatAppId: appid },
  { id: historicalId, name: '历史顾客' },
  { id: boundId, name: '正常顾客', inviterId },
  { id: strangerId, name: '其他顾客' }
)
data.shares.push(
  { id: crypto.randomUUID(), userId: inviterId, memberId: historicalId, source: 'historicalDisplay', createdAt: '2026-10-25T00:00:00.000Z' },
  { id: crypto.randomUUID(), userId: inviterId, memberId: boundId, source: 'invite', createdAt: '2026-10-25T00:00:00.000Z' },
  { id: crypto.randomUUID(), userId: strangerId, memberId: strangerId, source: 'historicalDisplay', createdAt: '2026-10-25T00:00:00.000Z' }
)
fs.writeFileSync(file, JSON.stringify(data))

let server
async function main() {
  const socket = net.createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const base = `http://127.0.0.1:${port}/api`
  server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_FILE: file, DB_NAME: '', NODE_ENV: 'test', DEMO_MODE: 'false', WECHAT_MOCK: 'true', WECHAT_APPID: appid, ADMIN_PASSWORD: 'test-secret', PAYMENT_MODE: 'off' },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let errors = ''
  server.stderr.on('data', chunk => { errors += chunk })
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(errors)
    try { if ((await fetch(base + '/health')).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const login = await fetch(base + '/auth/wechat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: loginCode }) })
  assert.equal(login.status, 200)
  const { token } = await login.json()
  const response = await fetch(base + '/shares', { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(response.status, 200)
  const shares = await response.json()
  assert.equal(shares.length, 2)
  assert.equal(shares.find(row => row.memberId === historicalId)?.displayOnly, true)
  assert.equal(shares.find(row => row.memberId === boundId)?.displayOnly, undefined)
  assert.ok(!shares.some(row => row.memberId === strangerId))
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.users.find(user => user.id === historicalId).inviterId, undefined)
  assert.equal(saved.earnings.length, data.earnings.length)
  console.log('邀请列表隔离验证通过：正常绑定、历史仅展示、数据隔离、旧收益不变')
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill(); await stopped }
  fs.rmSync(dir, { recursive: true, force: true })
})
