import { resolveUploadedAssets } from './assets.js'
// 正式包固定使用服务器 HTTPS 接口，开发机的 .env 不能覆盖发布地址。
// 本地调试仍可通过 VITE_API_BASE 指定测试服务。
const productionApiBase = 'https://anqiht.okam.top/api'
const configuredApiBase = import.meta.env.VITE_API_BASE || productionApiBase
export const API_BASE = (import.meta.env.PROD ? productionApiBase : configuredApiBase).replace(/\/$/, '')
export async function api(path, method = 'GET', data, extraHeaders = {}) {
  let res
  try { res = await uni.request({ url: API_BASE + path, method, data, header: { Authorization: 'Bearer ' + (uni.getStorageSync('token') || ''), ...extraHeaders }, timeout: 12000 }) } catch { throw new Error('网络连接暂时不稳定，请稍后再试') }
  // 网关可能返回没有响应体的 401，必须先处理状态码，避免过期登录被当作断网。
  if (res.statusCode === 401) { uni.removeStorageSync('token'); if(!path.startsWith('/auth/') && path !== '/share-code')go('login'); }
  if (res.statusCode >= 400) { const error = new Error(res.data?.error || (res.statusCode === 401 ? '登录已过期，请重新登录' : '请求失败，请稍后重试')); error.status = res.statusCode; throw error }
  if (!res.data || typeof res.data !== 'object') throw new Error('网络连接暂时不稳定，请稍后再试')
  return resolveUploadedAssets(res.data, API_BASE.replace(/\/api$/, ''))
}
export function toast(message) { uni.showToast({ title: message || '操作未完成，请稍后重试', icon: 'none' }) }
export function go(page, query = '') { const url='/pages/'+page+'/index'; if(['home','mall','discover','mine'].includes(page)){uni.setStorageSync('tab-query-'+page,query);uni.switchTab({url});}else uni.navigateTo({url:url+query}) }
export function money(value) { return Number(value || 0).toFixed(2) }



