import test from 'node:test'
import assert from 'node:assert/strict'
import {captureInvite, inviteBound, requireInviteBinding} from '../common/invite.js'

test('a valid scene code survives entry until binding succeeds', () => {
  const storage = new Map()
  globalThis.uni = {
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key)
  }
  assert.equal(captureInvite({query:{scene:'1e51675a'}}),'1E51675A')
  assert.equal(storage.get('invite'),'1E51675A')
  assert.equal(inviteBound('bound'),true)
  assert.equal(inviteBound('alreadyBound'),true)
})

test('rejected invite statuses stop the attempted order', () => {
  for (const status of ['invalid','hasInviter','']) {
    assert.throws(() => requireInviteBinding(status), error =>
      error.inviteStatus === (status || 'invalid') && !!error.message)
  }
  assert.doesNotThrow(() => requireInviteBinding('bound'))
  assert.doesNotThrow(() => requireInviteBinding('alreadyBound'))
})
