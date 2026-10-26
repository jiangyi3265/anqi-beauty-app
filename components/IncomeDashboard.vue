<template>
  <view class="xr-income xr-gutter">
    <view class="xr-income-summary"><view><text>静态收益</text><text>¥{{amount(summary.static)}}</text></view><view><text>动态收益</text><text>¥{{amount(summary.dynamic)}}</text></view></view><view class="xr-income-note"><view>累计净收益 <text>¥{{amount(summary.total)}}</text> · 计划待入账 <text>¥{{amount(summary.pending)}}</text></view><view v-if="summary.available!==undefined" class="xr-income-balance">已兑现 <text>¥{{amount(summary.paidOut)}}</text> · 待兑现 <text>¥{{amount(summary.available)}}</text></view></view>
    <view v-if="summary.transferring>0" class="xr-income-note">微信转账处理中 ¥{{amount(summary.transferring)}}，暂不计入待兑现金额</view>
    <view v-if="summary.dailyPool?.enabled" class="xr-panel"><text>今日分配 {{amount(summary.dailyPool.personalAmount)}} 元{{summary.dailyPool.status==='pending'?'（预计）':''}}</text></view>
    <view v-if="summary.transfers?.length" class="xr-income-plans"><view class="xr-section-heading">微信到账记录</view><view v-for="transfer in summary.transfers" :key="transfer.id" class="xr-income-plan"><text>{{transfer.date}} · ¥{{amount(transfer.amount)}} · {{transfer.statusText}}</text><text v-if="transfer.error" class="xr-caption">{{transfer.error}}</text><button v-if="transfer.confirmation" class="xr-button xr-button-primary xr-button-small" @click="confirmTransfer(transfer)">确认微信收款</button></view></view>
    <view class="xr-income-records"><view class="xr-tabs"><button v-for="item in tabs" :key="item.value" :class="{'is-active':filter===item.value}" @click="filter=item.value">{{item.label}}</button></view><view v-for="record in filtered" :key="record.id" class="xr-income-record"><view class="xr-income-record-icon"><UiIcon :name="record.kind==='reversal'?'minus':record.source==='pool'?'crown':'user'" tone="rose" :size="32"/></view><view class="xr-income-record-copy"><view class="xr-between"><text>{{recordTitle(record)}}</text><text class="xr-price">{{record.amount>0?'+':record.amount<0?'−':''}}¥{{amount(Math.abs(record.amount))}}</text></view><text v-if="record.name" class="xr-caption">{{record.name}}</text><text class="xr-caption">{{date(record.createdAt)}}</text></view></view><EmptyState v-if="!filtered.length&&!loading" icon="document" :title="error?'暂时无法加载收益记录':'暂无'+(filter==='static'?'静态':filter==='dynamic'?'动态':'')+'收益记录'" :description="error?'请检查网络后重新加载':'收益入账后，会在这里清晰展示'" compact/></view>
    <button v-if="hasDetails" class="xr-menu-row xr-panel xr-income-more" @click="detailsOpen=!detailsOpen"><UiIcon name="document" :size="36"/><text>{{detailsOpen?'收起结算信息':'查看结算信息与规则'}}</text><UiIcon name="chevron" :size="26"/></button>
    <template v-if="detailsOpen">
      <view v-if="activePlans.length" class="xr-income-plans"><view class="xr-section-heading"><text>待入账计划</text><text class="xr-caption">计划金额尚未入账</text></view><view v-for="plan in activePlans" :key="plan.id" class="xr-income-plan"><text class="xr-product-name">{{plan.name}}</text><text class="xr-caption">{{plan.type==='static'?'静态收益':plan.source==='referral'?'推荐奖励 · '+(plan.tier==='first'?'首单':'后续')+' '+plan.percent+'%':'动态收益'}} · 已入账{{plan.posted}}/{{plan.periods}}期</text><view class="xr-caption">下期 <text class="xr-price">¥{{amount(plan.amount)}}</text> · {{date(plan.nextAt)}}</view></view></view>
      <view v-if="payouts.length" class="xr-income-plans xr-income-payouts"><view class="xr-section-heading"><text>兑现记录</text><text class="xr-caption">{{config.shareholderProgram?.activatedAt?'以实际到账记录为准':'门店线下付款后登记'}}</text></view><view v-for="payout in payouts" :key="payout.id" class="xr-income-plan"><view class="xr-between"><text class="xr-product-name">{{payout.method||'收益兑现'}}</text><text class="xr-price">¥{{amount(payout.amount)}}</text></view><text class="xr-caption">{{date(payout.createdAt)}}{{payout.note?' · '+payout.note:''}}</text></view></view>
      <view v-if="referral.enabled||pool.enabled" class="xr-income-rules"><view v-if="referral.enabled">推荐奖励：首单{{referral.firstPercent}}%，后续{{referral.laterPercent}}%{{config.shareholderProgram?.activatedAt?'，推荐人须经后台认证为股东':referral.requireCard?'，推荐人须已办理VIP卡':''}}</view><view v-if="pool.enabled&&!config.shareholderProgram?.activatedAt">{{poolLabel}}</view></view>
    </template>
    <view class="xr-income-footnote">收益按订单规则记账，退款冲回以负数列示。{{config.shareholderProgram?.activatedAt?'分配入账后，实际到账结果以微信转账或门店兑现记录为准。':'收益由门店线下兑现，兑现后会出现在“兑现记录”里；小程序内不提供提现。'}}</view>
  </view>
</template>
<script setup>
import {ref,computed} from 'vue'
import {formatPrice} from '../common/ui.js'
import UiIcon from './UiIcon.vue'
import EmptyState from './EmptyState.vue'
const props=defineProps({records:{type:Array,default:()=>[]},summary:{type:Object,default:()=>({})},config:{type:Object,default:()=>({})},loading:Boolean,error:Boolean})
const emit=defineEmits(['refresh'])
function confirmTransfer(row){
  if(typeof wx==='undefined'||!wx.canIUse('requestMerchantTransfer'))return uni.showModal({content:'请使用支持收款确认的微信版本打开小程序',showCancel:false})
  wx.requestMerchantTransfer({...row.confirmation,complete:()=>emit('refresh')})
}
const filter=ref(''),tabs=[{value:'',label:'全部'},{value:'static',label:'静态收益'},{value:'dynamic',label:'动态收益'}]
const detailsOpen=ref(false)
const filtered=computed(()=>props.records.filter(record=>!filter.value||record.type===filter.value).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))))
const activePlans=computed(()=>(props.summary.plans||[]).filter(plan=>plan.status==='active'&&(!filter.value||plan.type===filter.value)))
const payouts=computed(()=>Array.isArray(props.summary.payouts)?props.summary.payouts:[])
const referral=computed(()=>props.config.referralReward||{})
const pool=computed(()=>props.config.poolReward||{})
const hasDetails=computed(()=>(props.summary.plans||[]).some(plan=>plan.status==='active')||payouts.value.length||referral.value.enabled||pool.value.enabled)
const poolLabel=computed(()=>{
  const value=pool.value,cycle={daily:'每日',weekly:'每周',monthly:'每月'}[value.cycle]||'按规则'
  const source={revenue:'营业额',sales:'新增办卡金额'}[value.source]||'约定基数'
  return '分红池：'+cycle+source+value.percent+'%'+(value.activityDays?'，'+value.activityDays+'天一轮':'')
})
function amount(value){return value===undefined||value===null?'—':formatPrice(value,true)}
function recordTitle(record){return (record.source==='shareholder'?'每日分配':record.source==='pool'?'分红池':record.source==='referral'?'推荐奖励 · '+(record.tier==='first'?'首单':'后续'):record.type==='static'?'静态收益':record.type==='dynamic'?'动态收益':'历史收益')+(record.kind==='reversal'?' · 退款冲回':'')}
function date(value){const timestamp=Date.parse(value);return Number.isFinite(timestamp)?new Date(timestamp+8*3600000).toISOString().slice(0,16).replace('T',' ')+'（北京时间）':''}
</script>

<script>export default {options:{virtualHost:true,styleIsolation:"shared"}}</script>
