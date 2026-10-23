// 微信小程序右上角菜单“转发给朋友 / 分享到朋友圈 / 复制链接”。
// 以全局 mixin 注册到每个页面（见 main.js），页面未定义这些钩子时菜单项会置灰、无法转发。
const storeTitle = '秀荣科技美肤 · 美容用品商城'
// 可以原样分享的公开页面；订单、预约、资料等私有页面转发为首页。
const publicPages = ['home', 'mall', 'discover', 'activities', 'alliances', 'stores', 'product', 'gifts']

function params(query) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
    .join('&')
}

function isPublic(page, screen) {
  if (page === 'product') return !!screen?.product?.id
  // 贵宾卡仅限受邀会员，转发出去的只有体验卡
  if (page === 'gifts') return screen?.giftType === 'trial'
  return publicPages.includes(page)
}

function shareDetails(screen) {
  const name=screen?.config?.name||'秀荣科技美肤'
  const storeTitle=name+' · 美容用品商城'
  const page = screen?.page || 'home'
  // 只有超级VIP会员（有会员等级）转发出去的链接才带邀请码；其他会员转发不建立推荐关系
  const invite = screen?.config?.marketingEnabled===false||!screen?.me?.vipLevel?'':screen?.inviteCode || ''
  if (page === 'share') return { title: '邀请你来'+name, page: 'home', query: { invite } }
  if (!isPublic(page, screen)) return { title: storeTitle, page: 'home', query: { invite } }
  if (page === 'product') {
    const image = screen.product.image || ''
    return { title: screen.product.name || storeTitle, page, query: { id: screen.product.id, invite }, imageUrl: image.startsWith('https://') ? image : '' }
  }
  if (page === 'gifts') return { title:name+' · 免费领取体验卡', page, query: { type: 'trial', invite } }
  return { title: storeTitle, page, query: { invite } }
}

function withImage(result, details) {
  return details.imageUrl ? { ...result, imageUrl: details.imageUrl } : result
}

export function shareToFriend(screen) {
  const details = shareDetails(screen)
  const query = params(details.query)
  return withImage({ title: details.title, path: '/pages/' + details.page + '/index' + (query ? '?' + query : '') }, details)
}

// 朋友圈和复制链接只能打开当前页面，只能自定义参数
export function shareToTimeline(screen) {
  const details = shareDetails(screen)
  return withImage({ title: details.title, query: params(details.query) }, details)
}

export function copyUrl(screen) {
  return { query: params(shareDetails(screen).query) }
}

export const shareMixin = {
  onLoad() {
    // 朋友圈以单页模式打开、无法登录，私有页面不开放朋友圈分享
    const page = String(this.$scope?.route || '').split('/')[1]
    if (page && !publicPages.includes(page)) uni.hideShareMenu({ menus: ['shareTimeline'], fail() {} })
  },
  onShareAppMessage() { return shareToFriend(this.$refs?.screen) },
  onShareTimeline() { return shareToTimeline(this.$refs?.screen) },
  onCopyUrl() { return copyUrl(this.$refs?.screen) }
}
