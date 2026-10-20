<template>
  <view class="xr-booking-options">
    <view class="xr-panel xr-gutter"><view class="xr-booking-date-heading"><text>选择日期</text><picker mode="date" :start="today" :value="date" :disabled="disabled" @change="date=$event.detail.value"><view class="xr-text-button">{{date?date.slice(0,7).replace('-','年')+'月':'选择日期'}} <UiIcon name="chevron" :size="25"/></view></picker></view><view class="xr-date-grid"><button v-for="day in days" :key="day.value" :class="['xr-date-chip',{'is-selected':date===day.value}]" :disabled="disabled" @click="date=day.value"><text>{{day.label}}</text><text>{{day.weekday}}</text></button></view></view>
    <view class="xr-panel xr-gutter"><view class="xr-section-heading"><text>选择时间</text><text v-if="loading" class="xr-caption">正在查询…</text></view><view v-if="loading" class="xr-slot-grid"><view v-for="n in 6" :key="n" class="xr-slot xr-skeleton"/></view><EmptyState v-else-if="error" icon="cloud-off" title="暂时无法加载预约时段" :description="error" action="重新查询" compact @action="load"/><view v-else-if="slots.length" class="xr-slot-grid"><button v-for="slot in slots" :key="slot.time" :class="['xr-slot',{'is-selected':time===slot.time}]" :disabled="disabled||slot.remaining<=0" @click="selectTime(slot.time)"><text>{{slot.time}}</text><text v-if="slot.remaining<=0">已满</text></button></view><EmptyState v-else-if="date&&!disabled" icon="calendar" title="当天暂无可约时段" description="请选择其他日期，或联系门店了解安排" action="选择其他日期" compact @action="nextDate"/><view v-else class="xr-caption">请先选择可预约项目与门店。</view></view>
    <view v-if="time&&!loading&&!error" class="xr-panel xr-gutter"><button class="xr-booking-staff" :disabled="disabled||!result.scheduled" @click="result.scheduled&&(staffSheet=true)"><text>服务人员</text><view><UiIcon name="user" :size="30"/><text>{{selectedStaffName}}</text><UiIcon v-if="result.scheduled" name="chevron" :size="24"/></view></button></view>
    <view v-if="date&&!loading&&!error" class="xr-booking-duration"><UiIcon name="clock" tone="rose" :size="30"/><text>服务时长{{result.durationMinutes||60}}分钟 · 北京时间</text></view>
    <view v-if="staffSheet" class="xr-overlay" @click="staffSheet=false"><view class="xr-sheet" role="dialog" aria-modal="true" aria-label="选择服务员工" @click.stop><view class="xr-sheet-handle"/><view class="xr-section-heading"><text>服务员工</text><button class="xr-icon-button" aria-label="关闭" @click="staffSheet=false"><UiIcon name="close" :size="32"/></button></view><view class="xr-caption">仅显示该时段有排班的员工，可由门店自动安排。</view><view class="xr-staff-options"><button v-for="staff in staffOptions" :key="staff.id||'auto'" class="xr-staff-option" @click="staffId=staff.id;publish()"><view class="xr-generic-avatar"><UiIcon :name="staff.id?'user':'calendar'" :size="36"/></view><text>{{staff.name}}</text><text :class="['xr-check',{'is-checked':staffId===staff.id}]">{{staffId===staff.id?'✓':''}}</text></button></view><button class="xr-button xr-button-primary" @click="staffSheet=false">确认选择</button></view></view>
  </view>
</template>
<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue'
import {api} from '../common/api.js'
import {beijingDate} from '../common/ui.js'
import UiIcon from './UiIcon.vue'
import EmptyState from './EmptyState.vue'
const props=defineProps({source:{type:Object,required:true},disabled:Boolean,today:String,refreshKey:Number})
const emit=defineEmits(['selection'])
const date=ref(props.today||beijingDate()),time=ref(''),staffId=ref(''),staffSheet=ref(false),loading=ref(false),error=ref('')
const result=ref({scheduled:false,slots:[],durationMinutes:60})
let sequence=0
const days=computed(()=>{
  const start=props.today||beijingDate()
  const values=Array.from({length:3},(_,index)=>beijingDate(Date.parse(start+'T12:00:00+08:00')+index*86400000))
  if(date.value&&!values.includes(date.value))values[2]=date.value
  return values.map(value=>({value,label:Number(value.slice(5,7))+'月'+Number(value.slice(8,10))+'日',weekday:'周'+'日一二三四五六'[new Date(value+'T12:00:00+08:00').getUTCDay()]}))
})
const slots=computed(()=>Array.isArray(result.value.slots)?result.value.slots:[])
const times=computed(()=>slots.value.filter(slot=>slot.remaining>0).map(slot=>slot.time))
const staffOptions=computed(()=>[{id:'',name:'门店自动安排'},...(slots.value.find(slot=>slot.time===time.value)?.staff||[])])
const selectedStaffName=computed(()=>staffOptions.value.find(staff=>staff.id===staffId.value)?.name||'门店自动安排')
function publish(){emit('selection',{date:date.value,time:time.value,staffId:staffId.value,staffName:selectedStaffName.value,durationMinutes:Number(result.value.durationMinutes)||60,ready:!props.disabled&&!loading.value&&!error.value&&times.value.includes(time.value)})}
function selectTime(value){time.value=value;staffId.value='';publish()}
function nextDate(){date.value=beijingDate(Date.parse((date.value||props.today)+'T12:00:00+08:00')+86400000)}
async function load(){
  const current=++sequence
  time.value='';staffId.value='';staffSheet.value=false;result.value={scheduled:false,slots:[],durationMinutes:60};error.value='';loading.value=false;publish()
  if(!date.value||props.disabled)return
  loading.value=true;publish()
  try{const next=await api('/appointment-options','POST',{...props.source,date:date.value});if(current===sequence)result.value=next}
  catch(reason){if(current===sequence)error.value=reason.message||'时段查询失败，请重试'}
  finally{if(current===sequence){loading.value=false;publish()}}
}
watch([date,()=>JSON.stringify(props.source),()=>props.disabled,()=>props.refreshKey],load,{immediate:true})
watch(()=>props.today,value=>{if(value&&date.value<value)date.value=value})
onBeforeUnmount(()=>sequence++)
</script>

<script>export default {options:{virtualHost:true,styleIsolation:"shared"}}</script>
