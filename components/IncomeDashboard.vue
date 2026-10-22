<template>
  <view class="xr-income xr-gutter">
    <view class="xr-income-summary"><view><text>静态收益</text><text>¥{{amount(summary.static)}}</text></view><view><text>动态收益</text><text>¥{{amount(summary.dynamic)}}</text></view></view><view class="xr-income-note">累计净收益 <text>¥{{amount(summary.total)}}</text> · 计划待入账 <text>¥{{amount(summary.pending)}}</text></view>
    <view class="xr-income-records"><view class="xr-tabs"><button v-for="item in tabs" :key="item.value" :class="{'is-active':filter===item.value}" @click="filter=item.value">{{item.label}}</button></view><view v-for="record in filtered" :key="record.id" class="xr-income-record"><view class="xr-income-record-icon"><UiIcon :name="record.kind==='reversal'?'minus':record.source==='pool'?'crown':'user'" tone="rose" :size="32"/></view><view class="xr-income-record-copy"><view class="xr-between"><text>{{recordTitle(record)}}</text><text class="xr-price">{{record.amount>0?'+':record.amount<0?'−':''}}¥{{amount(Math.abs(record.amount))}}</text></view><text v-if="record.name" class="xr-caption">{{record.name}}</text><text class="xr-caption">{{date(record.createdAt)}}</text></view></view><EmptyState v-if="!filtered.length&&!loading" icon="document" :title="error?'暂时无法加载收益记录':'暂无'+(filter==='static'?'静态':filter==='dynamic'?'动态':'')+'收益记录'" :description="error?'请检查网络后重新加载':'收益入账后，会在这里清晰展示'" compact/></view>
    <view v-if="activePlans.length" class="xr-income-plans"><view class="xr-section-heading"><text>待入账计划</text><text class="xr-caption">计划金额尚未入账</text></view><view v-for="plan in activePlans" :key="plan.id" class="xr-income-plan"><text class="xr-product-name">{{plan.name}}</text><text class="xr-caption">{{plan.type==='static'?'静态收益':plan.source==='referral'?'推荐奖励 · '+(plan.tier==='first'?'首单':'后续')+' '+plan.percent+'%':'动态收益'}} · 已入账{{plan.posted}}/{{plan.periods}}期</text><view class="xr-caption">下期 <text class="xr-price">¥{{amount(plan.amount)}}</text> · {{date(plan.nextAt)}}</view></view></view>
    <view v-if="referral.enabled||pool.enabled" class="xr-income-rules"><view v-if="referral.enabled">推荐奖励：首单{{referral.firstPercent}}%，后续{{referral.laterPercent}}%{{referral.requireCard?'，推荐人须已办理VIP卡':''}}</view><view v-if="pool.enabled">{{poolLabel}}</view></view><view class="xr-income-footnote">收益按订单规则记账，退款冲回以负数列示。计划金额尚未入账，当前不提供微信提现或自动转账。</view>
  </view>
</template>
<script setup>
import {ref,computed} from 'vue'
import {formatPrice} from '../common/ui.js'
import UiIcon from './UiIcon.vue'
import EmptyState from './EmptyState.vue'
const props=defineProps({records:{type:Array,default:()=>[]},summary:{type:Object,default:()=>({})},config:{type:Object,default:()=>({})},loading:Boolean,error:Boolean})
const filter=ref(''),tabs=[{value:'',label:'全部'},{value:'static',label:'静态收益'},{value:'dynamic',label:'动态收益'}]
const filtered=computed(()=>props.records.filter(record=>!filter.value||record.type===filter.value).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))))
const activePlans=computed(()=>(props.summary.plans||[]).filter(plan=>plan.status==='active'&&(!filter.value||plan.type===filter.value)))
const referral=computed(()=>props.config.referralReward||{})
const pool=computed(()=>props.config.poolReward||{})
const poolLabel=computed(()=>{
  const value=pool.value,cycle={daily:'每日',weekly:'每周',monthly:'每月'}[value.cycle]||'按规则'
  const source={revenue:'营业额',sales:'新增办卡金额'}[value.source]||'约定基数'
  return '分红池：'+cycle+source+value.percent+'%'+(value.activityDays?'，'+value.activityDays+'天一轮':'')
})
function amount(value){return value===undefined||value===null?'—':formatPrice(value,true)}
function recordTitle(record){return (record.source==='pool'?'分红池':record.source==='referral'?'推荐奖励 · '+(record.tier==='first'?'首单':'后续'):record.type==='static'?'静态收益':record.type==='dynamic'?'动态收益':'历史收益')+(record.kind==='reversal'?' · 退款冲回':'')}
function date(value){const timestamp=Date.parse(value);return Number.isFinite(timestamp)?new Date(timestamp+8*3600000).toISOString().slice(0,16).replace('T',' ')+'（北京时间）':''}
</script>

<script>export default {options:{virtualHost:true,styleIsolation:"shared"}}</script>
