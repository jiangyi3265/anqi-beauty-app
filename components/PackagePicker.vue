<template>
  <view class="xr-package-picker xr-gutter">
    <view v-if="plans.length>1" class="xr-plan-tabs"><button v-for="item in plans" :key="item.id" :class="{'is-active':plan?.id===item.id}" :disabled="disabled" @click="changePlan(item.id)">{{item.name}}</button></view>
    <template v-if="plan">
      <view class="xr-package-section"><view class="xr-section-heading"><text>固定项目</text><text class="xr-caption">包含以下服务</text></view><view v-for="item in plan.services" :key="item.id" class="xr-included-service"><ProductVisual :product="item"/><view><text class="xr-product-name">{{item.name}}</text><text class="xr-caption">{{item.total}}次</text></view><UiIcon name="chevron" tone="muted" :size="24"/></view></view>
      <view v-for="group in plan.groups" :key="group.id" class="xr-package-section"><view class="xr-section-heading"><text>{{group.name}}</text><text class="xr-caption">选{{group.pick}}项 · 已选{{choices(group).length}}项</text></view><view v-for="item in group.services" :key="item.id" class="xr-package-choice"><button :class="['xr-service-choice',{'is-selected':selected(group,item)}]" :disabled="disabled" @click="toggle(group,item)"><text :class="['xr-check',{'is-checked':selected(group,item)}]">{{selected(group,item)?'✓':''}}</text><text class="xr-choice-name">{{item.name}}</text><text class="xr-caption">{{item.total}}次</text></button><picker v-if="selected(group,item)&&item.options?.length" :range="item.options" :disabled="disabled" @change="setOption(group,item,$event.detail.value)"><view class="xr-service-option"><text>护理类型：{{selectedOption(group,item)||'请选择具体类型'}}</text><UiIcon name="chevron" tone="muted" :size="24"/></view></picker></view></view>
      <view class="xr-notice"><UiIcon name="info" tone="rose" :size="30"/><text>自选内容下单时确定，确认收款后可按项目分次预约。</text></view>
    </template>
  </view>
</template>
<script>
import ProductVisual from './ProductVisual.vue'
import UiIcon from './UiIcon.vue'
export default {
  options:{virtualHost:true,styleIsolation:'shared'},
  components:{ProductVisual,UiIcon},
  props:{plans:{type:Array,default:()=>[]},modelValue:{type:Object,default:()=>({})},disabled:Boolean},
  emits:['update:modelValue'],
  computed:{plan(){return this.plans.find(row=>row.id===this.modelValue.planId)||this.plans[0]}},
  methods:{
    changePlan(planId){this.$emit('update:modelValue',{planId,groups:{}})},
    choices(group){return this.modelValue.planId===this.plan?.id?this.modelValue.groups?.[group.id]||[]:[]},
    selected(group,item){return this.choices(group).some(row=>row.serviceId===item.id)},
    selectedOption(group,item){return this.choices(group).find(row=>row.serviceId===item.id)?.option||''},
    update(group,choices){this.$emit('update:modelValue',{planId:this.plan.id,groups:{...(this.modelValue.groups||{}),[group.id]:choices}})},
    toggle(group,item){
      if(this.disabled)return
      let choices=this.choices(group).map(row=>({...row}))
      if(this.selected(group,item))choices=choices.filter(row=>row.serviceId!==item.id)
      else if(group.pick===1)choices=[{serviceId:item.id}]
      else if(choices.length<group.pick)choices.push({serviceId:item.id})
      else return uni.showToast({title:'最多选择'+group.pick+'项，请先取消一项',icon:'none'})
      this.update(group,choices)
    },
    setOption(group,item,index){this.update(group,this.choices(group).map(row=>row.serviceId===item.id?{...row,option:item.options[Number(index)]}:row))}
  }
}
</script>
