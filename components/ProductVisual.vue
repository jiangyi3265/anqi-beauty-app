<template>
  <view :class="['xr-product-visual', {'xr-product-device':column>=0, 'xr-product-fallback':failed || !source}]">
    <view v-if="column>=0" class="xr-device-window"><view class="xr-device-crop" :style="layout.crop"><image :src="devices" class="xr-device-sprite" :style="layout.sprite" mode="scaleToFill" /></view></view>
    <template v-else-if="source && !failed"><view v-if="!ready" class="xr-visual-loader"><UiIcon name="sparkles" tone="rose" :size="52"/></view><image class="xr-product-image" :src="source" :mode="fit" @load="ready=true" @error="failed=true" /></template>
    <view v-else class="xr-visual-placeholder"><UiIcon :name="product.kind==='goods'?'gift':'sparkles'" tone="rose" :size="72"/><text v-if="showName">{{product.name || '秀荣科技美肤'}}</text></view>
  </view>
</template>
<script>
import {deviceColumn, deviceLayout, UI_ASSETS} from '../common/ui.js'
import UiIcon from './UiIcon.vue'
export default {
  options:{virtualHost:true,styleIsolation:'shared'},
  components:{UiIcon},
  props:{product:{type:Object,default:()=>({})},fit:{type:String,default:'aspectFit'},showName:Boolean},
  data(){return {failed:false,ready:false,devices:UI_ASSETS.devices}},
  computed:{column(){return this.source&&this.product.visualMode!=='studio'&&!this.failed?-1:deviceColumn(this.product)},layout(){return deviceLayout(this.column)},source(){const value=this.product.image||'';return value.includes('product-placeholder')?'':value}},
  watch:{source(){this.failed=false;this.ready=false}}
}
</script>
