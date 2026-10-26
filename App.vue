<script>
import { captureInvite } from './common/invite.js'
export default {
  onLaunch(options) { captureInvite(options); uni.hideTabBar({fail:()=>{}}) },
  onShow(options) { captureInvite(options) }
}
</script>
<style>@import './common/xiurong.css';</style>
