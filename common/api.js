import { resolveUploadedAssets } from './assets.js'
// 开发者工具和真机不会读取开发机的 127.0.0.1。保留环境变量覆盖能力，
// 但发布包始终有一个可访问的 HTTPS 后端地址，避免页面进入离线兜底状态。
const configuredApiBase = (import.meta.env && import.meta.env.VITE_API_BASE) || ''
export const API_BASE = (configuredApiBase || 'https://anqi.okam.top/api').replace(/\/$/, '')
export async function api(path, method = 'GET', data, extraHeaders = {}) {
  let res
  try { res = await uni.request({ url: API_BASE + path, method, data, header: { Authorization: 'Bearer ' + (uni.getStorageSync('token') || ''), ...extraHeaders }, timeout: 12000 }) } catch { throw new Error('网络连接暂时不稳定，请稍后再试') }
  if (!res.data || typeof res.data !== 'object') throw new Error('网络连接暂时不稳定，请稍后再试')
  if (res.statusCode === 401) { uni.removeStorageSync('token'); if(!path.startsWith('/auth/') && path !== '/share-code')go('login'); }
  if (res.statusCode >= 400) { const error = new Error(res.data?.error || '请求失败，请稍后重试'); error.status = res.statusCode; throw error }
  return resolveUploadedAssets(res.data, API_BASE.replace(/\/api$/, ''))
}
export function toast(message) { uni.showToast({ title: message || '操作未完成，请稍后重试', icon: 'none' }) }
export function go(page, query = '') { const url='/pages/'+page+'/index'; if(['home','mall','discover','mine'].includes(page)){uni.setStorageSync('tab-query-'+page,query);uni.switchTab({url});}else uni.navigateTo({url:url+query}) }
export function money(value) { return Number(value || 0).toFixed(2) }



