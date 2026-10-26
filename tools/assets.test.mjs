import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveUploadedAssets } from '../common/assets.js'

test('catalogue and uploaded pictures use the business server', () => {
  const origin = 'https://anqiht.okam.top'
  const result = resolveUploadedAssets({
    product: { image: '/static/brand/product.jpg' },
    banner: '/static/assets/service-heading.jpg',
    avatar: '/static/assets/avatar.png',
    uploaded: '/static/uploads/example.jpg',
    icon: '/static/reference/tab-home.png'
  }, origin)
  assert.equal(result.product.image, origin + '/static/brand/product.jpg')
  assert.equal(result.banner, origin + '/static/assets/service-heading.jpg')
  assert.equal(result.avatar, origin + '/static/assets/avatar.png')
  assert.equal(result.uploaded, origin + '/static/uploads/example.jpg')
  assert.equal(result.icon, '/static/reference/tab-home.png')
})
