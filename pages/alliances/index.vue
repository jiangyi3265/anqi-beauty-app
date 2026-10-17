<template><BeautyScreen ref="screen" page="alliances" :query="query"/></template>
<script>
import BeautyScreen from '../../components/BeautyScreen.vue'
export default { components:{BeautyScreen}, data(){return {query:{},ready:false}}, onLoad(query){this.query=query},onReady(){this.ready=true},onShow(){if(this.ready)this.$nextTick(()=>this.$refs.screen?.refresh())} }
</script>
