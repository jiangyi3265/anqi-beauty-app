<template>
  <view :class="['xr-empty',{'xr-empty-compact':compact}]">
    <view class="xr-empty-symbol"><UiIcon :name="icon" tone="rose" :size="76"/></view>
    <view class="xr-empty-title">{{title}}</view>
    <view v-if="description" class="xr-empty-description">{{description}}</view>
    <button v-if="action" class="xr-button xr-button-primary" @click="$emit('action')">{{action}}</button>
    <slot/>
  </view>
</template>
<script>
import UiIcon from './UiIcon.vue'
export default {
  options:{virtualHost:true,styleIsolation:'shared'},components:{UiIcon},props:{icon:{type:String,default:'gift'},title:{type:String,default:'暂无内容'},description:String,action:String,compact:Boolean},emits:['action']}
</script>
