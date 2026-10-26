export function captureInvite(options = {}) {
  const source = options && typeof options === 'object' ? options : {}
  const query = source.query && typeof source.query === 'object' ? source.query : source
  const hasInvite = Object.prototype.hasOwnProperty.call(query, 'invite') || Object.prototype.hasOwnProperty.call(query, 'scene')
  let value = query.invite || query.scene || ''
  try { value = decodeURIComponent(value) } catch { value = '' }
  const code = String(value).trim().toUpperCase()
  if (!/^[0-9A-F]{8}$/.test(code)) {
    if (hasInvite) uni.removeStorageSync('invite')
    return ''
  }
  uni.setStorageSync('invite', code)
  return code
}

export const inviteBound = status => status === 'bound' || status === 'alreadyBound'

export function inviteFailureMessage(status) {
  return {
    hasInviter: '已有推荐人，不能更换',
    invalid: '邀请码未生效，请联系门店核对'
  }[status] || '推荐人绑定失败，请联系门店核对'
}

export function requireInviteBinding(status) {
  if (inviteBound(status)) return
  const error = new Error(inviteFailureMessage(status))
  error.inviteStatus = status || 'invalid'
  throw error
}
