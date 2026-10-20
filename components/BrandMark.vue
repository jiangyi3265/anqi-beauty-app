<template>
  <view :class="['xr-brand', { 'xr-brand-compact': compact }]">
    <image class="xr-wordmark-image" :src="logo || '/static/xiurong/wordmark.svg'" mode="aspectFit" aria-label="XIURONG"/>
    <text class="xr-brand-name">{{name}}</text>
    <text v-if="tagline" class="xr-brand-tagline">{{subtitle}}</text>
  </view>
</template>
<script>
export default {
  options:{virtualHost:true,styleIsolation:'shared'}, props: { compact: Boolean, tagline: Boolean, name:{type:String,default:'秀荣科技美肤'}, logo:String, subtitle:{type:String,default:'科技美肤 · 私享护理'} } }
</script>
