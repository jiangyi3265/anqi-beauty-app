<template><image class="xr-icon" :src="source" :style="{width:size+'rpx',height:size+'rpx'}" mode="aspectFit" :aria-label="label || name" /></template>
<script>
export default {
  options:{virtualHost:true,styleIsolation:'shared'},
  props: { name: { type: String, default: 'sparkles' }, tone: { type: String, default: 'ink' }, size: { type: [String, Number], default: 40 }, label: String },
  computed: { source() { return '/static/xiurong/icons/' + this.name + '-' + this.tone + '.svg' } }
}
</script>
