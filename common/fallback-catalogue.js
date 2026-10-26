import snapshot from './offline-catalogue.json'
// #ifdef MP-WEIXIN
import { API_BASE } from './api.js'
import { resolveUploadedAssets } from './assets.js'
// #endif

// A public catalogue snapshot keeps browsing useful during a connection error.
// The offline notice is visible and all writes stay disabled until a live load.
// No customers, example orders or invented rewards are added to the database.
let catalogue = snapshot
// #ifdef MP-WEIXIN
catalogue = resolveUploadedAssets(snapshot, API_BASE.replace(/\/api$/, ''))
// #endif
export const fallbackCatalogue = { ...catalogue, demoMode: false, paymentMode: 'off' }
