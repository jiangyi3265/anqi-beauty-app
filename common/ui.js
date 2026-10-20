export const BRAND_NAME = '秀荣科技美肤'
export const UI_ASSETS = Object.freeze({
  room: '/static/xiurong/arch-room.jpg',
  silk: '/static/xiurong/silk-banner.jpg',
  portrait: '/static/xiurong/skincare-banner.jpg',
  devices: '/static/xiurong/devices.png'
})

export function formatPrice(value, fixed = false) {
  const amount = Number(value)
  const text = (Number.isFinite(amount) ? amount : 0).toFixed(2)
  const [whole, decimal] = text.split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fixed || decimal !== '00' ? '.' + decimal : '')
}

// Studio art is an explicit backend choice; uploaded covers always take precedence
// when the operator selects the image mode.
export function deviceColumn(product = {}) {
  const text = [product.code, product.name, product.image].filter(Boolean).join(' ')
  if (/金钻|10D|gold-ai-master/i.test(text)) return 3
  if (/超玛吉|超玛古|super-thermage/i.test(text)) return 2
  if (/黑金|AI大师|black-gold-ai|trial-ai-master/i.test(text)) return 1
  if (/9D|变眼术|变脸术|9d-face/i.test(text)) return 0
  return -1
}

// The generated atlas has unequal empty gutters. Clip each measured column
// with ordinary nested views, then contain its visible equipment in a 360×600
// frame. This preserves the hardware proportions without neighboring pixels.
const DEVICE_RECTS = [
  {start:0,end:339,x:20,y:48,width:317,height:521},
  {start:339,end:653,x:410,y:48,width:241,height:502},
  {start:653,end:1007,x:755,y:62,width:250,height:488},
  {start:1007,end:1440,x:1013,y:231,width:418,height:300}
]
export function deviceLayout(column) {
  const rect = DEVICE_RECTS[column] || DEVICE_RECTS[0]
  const scale = .9 * Math.min(360 / rect.width, 600 / rect.height)
  const offsetX = (360 - rect.width * scale) / 2 - rect.x * scale
  const offsetY = (600 - rect.height * scale) / 2 - rect.y * scale
  const width = rect.end - rect.start
  return {
    crop: {left:(offsetX + rect.start * scale) / 360 * 100+'%',top:offsetY / 600 * 100+'%',width:width * scale / 360 * 100+'%',height:scale * 100+'%'},
    sprite: {left:-rect.start / width * 100+'%',width:1440 / width * 100+'%'}
  }
}

export function beijingDate(value = Date.now()) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10)
}

export function shortStoreName(store = {}) {
  const name = String(store.name || '')
  if (name.includes('和谐')) return '和谐店'
  if (name.includes('建业')) return '建业店'
  return name || '选择门店'
}

export function brandedStoreName(store = {}) {
  return String(store.name || '')
}
