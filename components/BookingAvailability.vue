<template>
  <view>
    <view class="field"><label>预约日期</label><picker mode="date" :start="today" :value="date" :disabled="disabled" @change="date=$event.detail.value">{{date||'选择预约日期'}}</picker></view>
    <view class="field"><label>预约时间</label><picker :disabled="disabled||loading||!times.length" :range="times" @change="selectTime(times[$event.detail.value])">{{time||(loading?'正在查询时段':!date?'请先选择日期':times.length?'选择预约时间':'当天无可约时段')}}</picker></view>
    <view v-if="result.scheduled&&time" class="field"><label>服务员工</label><picker :disabled="disabled||loading" :range="staffOptions" range-key="name" @change="selectStaff(staffOptions[$event.detail.value].id)">{{staffOptions.find(s=>s.id===staffId)?.name||'门店自动安排'}} ›</picker></view>
    <view v-if="error" class="booking-time-notice">{{error}}<button class="outline" :disabled="loading||disabled" @click="load">重新查询</button></view>
    <view v-else-if="date&&!loading&&!times.length" class="booking-time-notice">当天暂无可预约时段，请选择其他日期或联系门店。</view>
    <view v-if="date&&!error&&!loading" class="booking-time-notice">本次预约占用 {{result.durationMinutes}} 分钟，时间以北京时间为准。{{result.scheduled?'员工可选，也可由门店自动安排。':''}}</view>
  </view>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { api } from '../common/api.js'
const props=defineProps({source:{type:Object,required:true},disabled:Boolean,today:String,refreshKey:Number})
const emit=defineEmits(['selection'])
const date=ref(''),time=ref(''),staffId=ref(''),loading=ref(false),error=ref(''),result=ref({scheduled:false,slots:[],durationMinutes:60})
let sequence=0
const times=computed(()=>result.value.slots.filter(s=>s.remaining>0).map(s=>s.time))
const staffOptions=computed(()=>[{id:'',name:'门店自动安排'},...(result.value.slots.find(s=>s.time===time.value)?.staff||[])])
function publish(){emit('selection',{date:date.value,time:time.value,staffId:staffId.value,ready:!props.disabled&&!loading.value&&!error.value&&times.value.includes(time.value)})}
function selectTime(value){time.value=value;staffId.value='';publish()}
function selectStaff(value){staffId.value=value;publish()}
async function load(){
  const current=++sequence;time.value='';staffId.value='';result.value={scheduled:false,slots:[],durationMinutes:60};error.value='';loading.value=false;publish()
  if(!date.value||props.disabled)return
  loading.value=true;publish()
  try{const next=await api('/appointment-options','POST',{...props.source,date:date.value});if(current===sequence)result.value=next}
  catch(e){if(current===sequence)error.value=e.message||'时段查询失败，请重试'}
  finally{if(current===sequence){loading.value=false;publish()}}
}
watch([date,()=>JSON.stringify(props.source),()=>props.disabled,()=>props.refreshKey],load)
onBeforeUnmount(()=>sequence++)
</script>
