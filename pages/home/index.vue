<template><BeautyScreen ref="screen" page="home" :query="query"/></template>
<script>
import BeautyScreen from '../../components/BeautyScreen.vue'
import { captureInvite } from '../../common/invite.js'
export default { components:{BeautyScreen}, data(){return {query:{},ready:false}}, onLoad(query){
  const invite=captureInvite(query)
  this.query={...query,...(invite?{invite}:{})}
},onPullDownRefresh(){Promise.resolve(this.$refs.screen?.refresh()).finally(()=>uni.stopPullDownRefresh())},onReady(){this.ready=true},onShow(){uni.hideTabBar({fail:()=>{}});if(this.ready)this.$nextTick(()=>this.$refs.screen?.refresh())}
}
</script>

