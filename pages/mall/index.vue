<template><BeautyScreen ref="screen" page="mall" :query="query"/></template>
<script>
import BeautyScreen from '../../components/BeautyScreen.vue'
export default { components:{BeautyScreen}, data(){return {query:{},ready:false}}, onLoad(query){const stored=uni.getStorageSync('tab-query-mall')||'';if(stored&&!query?.category){const m=stored.match(/[?&]category=([^&]+)/);if(m)query={...query,category:decodeURIComponent(m[1])};uni.removeStorageSync('tab-query-mall')}this.query=query||{}},onPullDownRefresh(){Promise.resolve(this.$refs.screen?.refresh()).finally(()=>uni.stopPullDownRefresh())},onReady(){this.ready=true},onShow(){uni.hideTabBar({fail:()=>{}});const stored=uni.getStorageSync('tab-query-mall')||'';if(stored){const m=stored.match(/[?&]category=([^&]+)/);if(m)this.query={...this.query,category:decodeURIComponent(m[1])};uni.removeStorageSync('tab-query-mall');if(this.$refs.screen)this.$refs.screen.mallCategory=this.query.category||'all'}if(this.ready)this.$nextTick(()=>this.$refs.screen?.refresh())}
}
</script>
