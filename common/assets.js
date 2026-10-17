// 上传素材不在小程序安装包中，需从 API 服务器读取。
// 生产接口中可能仍返回旧版商品图片路径；微信包使用压缩后的同名素材，
// 在小程序端做兼容映射，避免把高清原图重新打进 2MB 源码包。
const MP_IMAGE_MAP = {
  '/static/brand/product-closeup.png': '/static/brand/product-closeup.jpg',
  '/static/brand/284c27d5c43001f0f7f0ba76dcd24623.png': '/static/brand/284c27d5c43001f0f7f0ba76dcd24623.jpg'
}
function localAsset(path) {
  try {
    if (typeof uni !== 'undefined' && uni.getSystemInfoSync().uniPlatform === 'mp-weixin') return MP_IMAGE_MAP[path] || path
  } catch {}
  return path
}
export function resolveUploadedAssets(value, origin) {
  if (typeof value === 'string') {
    const local = localAsset(value)
    return (local.startsWith('/static/uploads/') || local.startsWith('/static/brand/')) ? origin + local : local
  }
  if (Array.isArray(value)) return value.map(item => resolveUploadedAssets(item, origin))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveUploadedAssets(item, origin)]))
  return value
}
