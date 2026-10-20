<template><BeautyScreen ref="screen" page="order-detail" :query="query"/></template>
<script>
import BeautyScreen from '../../components/BeautyScreen.vue'
export default { components:{BeautyScreen}, data(){return {query:{},ready:false}}, onLoad(query){this.query=query},onPullDownRefresh(){Promise.resolve(this.$refs.screen?.refresh()).finally(()=>uni.stopPullDownRefresh())},onReady(){this.ready=true},onShow(){if(this.ready)this.$nextTick(()=>this.$refs.screen?.refresh())} }
</script>
