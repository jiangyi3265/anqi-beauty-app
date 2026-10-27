import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const source=await readFile(new URL('../common/wechat-share.js',import.meta.url),'utf8')
const {shareToFriend,shareToTimeline,copyUrl}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
test('只有后台认证股东的分享才带邀请码',()=>{
  const screen={page:'share',inviteCode:'ABCDEFGH',config:{shareholderProgram:{activatedAt:'2026-10-26'}},me:{canShare:true,vipLevel:null}}
  assert.match(shareToFriend(screen).path,/invite=ABCDEFGH/)
  assert.match(shareToTimeline(screen).query,/invite=ABCDEFGH/)
  assert.match(copyUrl(screen).query,/invite=ABCDEFGH/)
  screen.me={vipLevel:{name:'VIP'},canShare:false}
  assert.doesNotMatch(shareToFriend(screen).path,/invite=/)
  delete screen.me.canShare
  assert.doesNotMatch(shareToFriend(screen).path,/invite=/)
  screen.config={}
  assert.doesNotMatch(shareToFriend(screen).path,/invite=/)
  screen.me.canShare=true
  assert.match(shareToFriend(screen).path,/invite=ABCDEFGH/)
  screen.config.marketingEnabled=false
  assert.doesNotMatch(shareToFriend(screen).path,/invite=/)
})
