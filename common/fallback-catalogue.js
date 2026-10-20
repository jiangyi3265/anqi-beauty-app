import snapshot from './offline-catalogue.json'

// A public catalogue snapshot keeps browsing useful during a connection error.
// The offline notice is visible and all writes stay disabled until a live load.
// No customers, example orders or invented rewards are added to the database.
export const fallbackCatalogue = { ...snapshot, demoMode: false, paymentMode: 'off' }
