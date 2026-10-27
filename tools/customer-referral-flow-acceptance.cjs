// 隔离模拟：6980 VIP 经后台认证股东后分享专属码，新顾客扫码登录并购买 3980 服务。
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const seed = require('../server/seed.cjs')
const offlineCatalogue = require('../common/offline-catalogue.json')

const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-referral-flow-'))
const file = path.join(dir, 'db.json')
const secret = crypto.randomBytes(16).toString('hex')
let server
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
  const body = await response.json()
  assert.equal(response.status, 200, `${method} ${route}: ${JSON.stringify(body)}`)
  return body
}

const admin = (route, method = 'GET', data) => request(`/admin/${route}`, method, data, '', true)

async function start() {
  const socket = net.createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  base = `http://127.0.0.1:${port}/api`
  server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), DATA_FILE: file, DB_NAME: '',
      NODE_ENV: 'test', DEMO_MODE: 'false', WECHAT_MOCK: 'true',
      WECHAT_APPID: 'wxmocktest00000000', WECHAT_APPSECRET: '',
      ADMIN_PASSWORD: secret, INTERNAL_SECRET: secret, PAYMENT_MODE: 'off'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let errors = ''
  server.stderr.on('data', chunk => { errors += chunk })
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(errors)
    try { if ((await fetch(base + '/health')).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(errors || '测试服务启动超时')
}

async function stop() {
  if (server && server.exitCode === null) {
    const finished = once(server, 'exit')
    server.kill()
    await finished
  }
  if (dir.startsWith(os.tmpdir() + path.sep) && path.basename(dir).startsWith('customer-referral-flow-')) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function login(label, invite = '') {
  return request('/auth/wechat', 'POST', {
    code: `${label}-${crypto.randomUUID()}`,
    ...(invite ? { invite } : {})
  })
}

async function pay(member, product, storeId, packageSelection) {
  const order = await request('/orders', 'POST', {
    productId: product.id, quantity: 1, spec: 'single', storeId,
    ...(packageSelection ? { packageSelection } : {})
  }, member.token)
  const unchecked = await fetch(base + `/admin/orders/${order.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-anqi-internal': secret },
    body: JSON.stringify({ action: 'confirmPayment' })
  })
  assert.equal(unchecked.status, 400, '未经后台明确确认不能把订单标记为已付款')
  await admin(`orders/${order.id}`, 'POST', { action: 'confirmPayment', confirmed: true })
  return (await admin('orders')).find(row => row.id === order.id)
}

async function main() {
  const data = seed()
  const eyeService = offlineCatalogue.products.find(product => product.name === '9D变眼术' && product.price === 3980)
  assert.ok(eyeService, '线下目录中应有 3980 元的 9D 变眼术')
  data.products.push({ ...eyeService, categoryId: data.categories[0].id })
  fs.writeFileSync(file, JSON.stringify(data))
  await start()
  const { captureInvite } = await import('../common/invite.js')
  const bootstrap = await request('/bootstrap')
  const storeId = bootstrap.stores[0].id
  const vip = bootstrap.products.find(product => product.id === 'jimeili-vip-6980')
  const service = bootstrap.products.find(product => product.name === '9D变眼术' && product.price === 3980)
  assert.ok(vip && service, '隔离目录中应有 6980 套餐和 3980 服务')

  const zhang = await login('zhang')
  await request('/me', 'PUT', { name: '张丽娟' }, zhang.token)
  const plan = vip.packagePlans[0]
  const packageSelection = {
    planId: plan.id,
    groups: Object.fromEntries(plan.groups.map(group => [group.id,
      group.services.slice(0, group.pick).map(item => ({
        serviceId: item.id,
        ...(item.options?.length ? { option: item.options[0] } : {})
      }))
    ]))
  }
  const vipOrder = await pay(zhang, vip, storeId, packageSelection)
  assert.equal(vipOrder.total, 6980)
  assert.equal((await request('/share-code', 'GET', undefined, zhang.token)).locked, true, '购卡本身不产生分享资格')
  await admin('shareholders/program', 'POST', {
    enabled: false, revision: 0, settleTime: '23:00',
    plans: (await admin('shareholders')).rule.plans
  })
  await admin('shareholders/member', 'POST', {
    userId: zhang.user.id, approved: true, planId: 'package-6980',
    orderId: vipOrder.id, revision: 0
  })
  const incomeRules = await admin('incomeRules')
  await admin('incomeRules/referral', 'PUT', { ...incomeRules.referral, enabled: true, requireCard: true })
  const share = await request('/share-code', 'GET', undefined, zhang.token)
  assert.ok(share.image && share.code, '已付款且认证股东应取得专属码')
  assert.equal(share.code, zhang.user.id.slice(0, 8).toUpperCase())
  assert.equal(share.mode, 'web', '隔离环境不调用微信生成正式小程序码')

  const storage = new Map()
  global.uni = {
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key)
  }
  assert.equal(captureInvite({ query: { scene: share.code.toLowerCase() } }), share.code)
  const customer = await login('customer', storage.get('invite'))
  assert.equal(customer.inviteStatus, 'bound')
  assert.equal(customer.user.inviterId, zhang.user.id)
  await request('/me', 'PUT', { name: '李四' }, customer.token)
  const order = await pay(customer, service, storeId)
  assert.equal(order.total, 3980)
  assert.equal(order.referrerIdAtOrder, zhang.user.id)
  const referralPlan = (await admin('incomePlans')).find(plan =>
    plan.orderId === order.id && plan.userId === zhang.user.id && plan.source === 'referral')
  assert.equal(referralPlan?.tier, 'first')
  assert.equal(referralPlan?.amountCents, 199000)

  const members = await admin('users')
  const shares = await admin('shares')
  assert.equal(members.find(member => member.id === zhang.user.id).name, '张丽娟')
  assert.equal(members.find(member => member.id === customer.user.id).name, '李四')
  assert.equal(members.find(member => member.id === customer.user.id).inviterId, zhang.user.id)
  assert.equal(shares.filter(row => row.userId === zhang.user.id && row.memberId === customer.user.id).length, 1)
  assert.equal((await admin('orders')).filter(row => row.userId === customer.user.id && row.referrerIdAtOrder === zhang.user.id).length, 1)
  console.log(JSON.stringify({ ok: true, vip: vipOrder.total, customerOrder: order.total,
    plannedReferralReward: referralPlan.amountCents / 100,
    customerProduct: order.product.name, inviter: '张丽娟', customer: '李四',
    checks: ['专属码生成', '扫码场景参数保留', '登录绑定推荐人', '3980 订单记录推荐人', '后台顾客和订单可关联', '首单奖励计划 1990 元'] }, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(stop)
