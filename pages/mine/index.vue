<template><BeautyScreen ref="screen" page="mine" :query="query"/></template>
<script>
import BeautyScreen from '../../components/BeautyScreen.vue'
export default { components:{BeautyScreen}, data(){return {query:{},ready:false}}, onLoad(query){this.query=query},onReady(){this.ready=true},onShow(){uni.hideTabBar({fail:()=>{}});if(this.ready)this.$nextTick(()=>this.$refs.screen?.refresh())} }
</script>
