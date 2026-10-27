import { beijingDate } from './ui.js'

// 只切换当天展示，保留历史池和已入账收益。
export function dailyPoolForToday(pool, now) {
  const date = beijingDate(now)
  if (pool?.date === date) return pool
  return { enabled: !!pool?.enabled, ...(pool?.fundingMode ? { fundingMode: pool.fundingMode } : {}), date, amount: 0, personalAmount: 0, status: 'empty', revision: 0 }
}
