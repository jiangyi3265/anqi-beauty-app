<template>
  <view class="package-picker">
    <view class="package-heading">{{ plans.length > 1 ? '选择套餐方案' : '套餐包含项目' }}</view>
    <view v-if="plans.length > 1" class="plan-tabs">
      <button v-for="item in plans" :key="item.id" :class="['plan-tab', { active: plan?.id === item.id }]" :disabled="disabled" @click="changePlan(item.id)">{{item.name}}</button>
    </view>
    <template v-if="plan">
      <view class="package-caption">{{plan.name}} · 固定项目</view>
      <view v-for="item in plan.services" :key="item.id" class="included-service"><text>{{item.name}}</text><text class="service-count">{{item.total}}次</text></view>
      <view v-for="group in plan.groups" :key="group.id" class="choice-group">
        <view class="choice-heading"><text>{{group.name}}</text><text class="choice-count">选{{group.pick}}项 · 已选{{choices(group).length}}项</text></view>
        <view v-for="item in group.services" :key="item.id" class="choice-item">
          <button :class="['service-choice', { selected: selected(group,item) }]" :disabled="disabled" @click="toggle(group,item)"><text class="selection-mark">{{selected(group,item)?'✓':'○'}}</text><text class="choice-name">{{item.name}}</text><text class="service-count">{{item.total}}次</text></button>
          <picker v-if="selected(group,item)&&item.options?.length" :range="item.options" :disabled="disabled" @change="setOption(group,item,$event.detail.value)"><view class="service-option">{{selectedOption(group,item)||'请选择护理类型'}}<text>›</text></view></picker>
        </view>
      </view>
      <view class="package-note">自选项目在下单时确定，确认收款后可按项目分次预约。</view>
    </template>
  </view>
</template>
<script>
export default {
  props: { plans: { type: Array, default: () => [] }, modelValue: { type: Object, default: () => ({}) }, disabled: Boolean },
  emits: ['update:modelValue'],
  computed: { plan() { return this.plans.find(row => row.id === this.modelValue.planId) || this.plans[0] } },
  methods: {
    changePlan(planId) { this.$emit('update:modelValue', { planId, groups: {} }) },
    choices(group) { return this.modelValue.planId === this.plan?.id ? this.modelValue.groups?.[group.id] || [] : [] },
    selected(group,item) { return this.choices(group).some(row => row.serviceId === item.id) },
    selectedOption(group,item) { return this.choices(group).find(row => row.serviceId === item.id)?.option || '' },
    update(group, choices) { this.$emit('update:modelValue', { planId: this.plan.id, groups: { ...(this.modelValue.groups || {}), [group.id]: choices } }) },
    toggle(group,item) {
      let choices = this.choices(group).map(row => ({ ...row }))
      if (this.selected(group,item)) choices = choices.filter(row => row.serviceId !== item.id)
      else if (group.pick === 1) choices = [{ serviceId: item.id }]
      else if (choices.length < group.pick) choices.push({ serviceId: item.id })
      else return uni.showToast({title:'最多选择'+group.pick+'项，请先取消一项',icon:'none'})
      this.update(group, choices)
    },
    setOption(group,item,index) { this.update(group,this.choices(group).map(row => row.serviceId === item.id ? { ...row, option:item.options[Number(index)] } : row)) }
  }
}
</script>
<style scoped>
.package-picker{background:#fffafd;padding:32rpx 28rpx;margin:24rpx 20rpx;color:#352d3e}.package-heading{font-size:32rpx;font-weight:600;margin-bottom:24rpx}.plan-tabs{display:flex;gap:16rpx;margin-bottom:28rpx}.plan-tab{flex:1;margin:0;font-size:28rpx;background:#f2edf5;color:#62516e;border:1px solid #e6dcea;border-radius:10rpx}.plan-tab.active{background:#eadcf1;color:#794596;border-color:#b281c7}.package-caption{font-size:25rpx;color:#7c6c84;margin:12rpx 0}.included-service{display:flex;justify-content:space-between;gap:24rpx;padding:18rpx 0;font-size:27rpx;border-bottom:1px solid #eee5f0;line-height:1.5}.service-count{flex-shrink:0;font-variant-numeric:tabular-nums;color:#805690}.choice-group{margin-top:34rpx}.choice-heading{display:flex;justify-content:space-between;gap:16rpx;font-size:29rpx;font-weight:600;margin-bottom:16rpx}.choice-count{font-size:24rpx;font-weight:400;color:#7c6c84;flex-shrink:0}.service-choice{display:flex;align-items:center;gap:14rpx;text-align:left;font-size:26rpx;line-height:1.5;padding:22rpx 18rpx;margin:12rpx 0 0;background:#f8f3fa;color:#514559;border:1px solid #eee5f0;border-radius:10rpx}.service-choice.selected{background:#f0e5f5;border-color:#b487c8}.service-choice::after{border:0}.choice-name{flex:1}.selection-mark{color:#9162a7;font-size:30rpx}.service-option{display:flex;justify-content:space-between;padding:22rpx 20rpx;margin:0 8rpx;font-size:26rpx;color:#7d5094;border-bottom:1px solid #d9c4e3}.package-note{font-size:24rpx;color:#7c6c84;line-height:1.7;margin-top:30rpx}
</style>
