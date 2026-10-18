<template>
  <view class="income-dashboard">
    <view class="income-summary"><view><text class="summary-label">静态收益</text><text class="summary-value">¥{{money(summary.static)}}</text></view><view><text class="summary-label">动态收益</text><text class="summary-value">¥{{money(summary.dynamic)}}</text></view></view>
    <view class="income-note">累计净收益 ¥{{money(summary.total)}} · 计划待入账 ¥{{money(summary.pending)}}<view>收益按订单规则记账；退款冲回以负数列示。</view></view>
    <view class="income-tabs"><button v-for="item in tabs" :key="item.value" :class="{active:filter===item.value}" @click="filter=item.value">{{item.label}}</button></view>
    <view v-for="r in filtered" :key="r.id" class="income-record"><view class="record-heading"><text>{{r.source==='pool'?'分红池':r.type==='static'?'静态收益':r.source==='referral'?'推荐奖励 · '+(r.tier==='first'?'首单':'后续'):r.type==='dynamic'?'动态收益':'历史收益'}}{{r.kind==='reversal'?' · 退款冲回':''}}</text><text class="record-amount">{{r.amount>0?'+':''}}{{money(r.amount)}}元</text></view><view>{{r.name}}</view><view class="record-date">{{date(r.createdAt)}}</view></view>
    <view v-if="!filtered.length&&!loading" class="income-empty">暂无{{filter==='static'?'静态':filter==='dynamic'?'动态':''}}收益记录</view>
    <view v-if="activePlans.length" class="plans"><view class="plans-heading">待入账计划</view><view v-for="p in activePlans" :key="p.id" class="plan-row"><view>{{p.name}}</view><view class="plan-meta">{{p.type==='static'?'静态收益':p.source==='referral'?'推荐奖励 · '+(p.tier==='first'?'首单 ':'后续 ')+p.percent+'%':'动态收益'}} · 已入账 {{p.posted}} / {{p.periods}} 期</view><view class="plan-meta">下期 ¥{{money(p.amount)}} · {{date(p.nextAt)}}</view></view></view>
    <view class="income-footnote">计划金额尚未入账。此页面为收益账本，当前不提供微信提现或自动转账。</view>
  </view>
</template>
<script setup>
import {ref,computed} from 'vue'
const props=defineProps({records:{type:Array,default:()=>[]},summary:{type:Object,default:()=>({})},loading:Boolean})
const filter=ref(''),tabs=[{value:'',label:'全部'},{value:'static',label:'静态收益'},{value:'dynamic',label:'动态收益'}]
const filtered=computed(()=>props.records.filter(r=>!filter.value||r.type===filter.value).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))))
const activePlans=computed(()=>(props.summary.plans||[]).filter(p=>p.status==='active'&&(!filter.value||p.type===filter.value)))
const money=v=>Number(v||0).toFixed(2)
function date(value){if(!value)return '';const d=new Date(Date.parse(value)+8*3600000);return d.toISOString().slice(0,16).replace('T',' ')+'（北京时间）'}
</script>
<style scoped>
.income-dashboard{padding:32rpx 28rpx;color:#352d3e}.income-summary{display:flex;padding:32rpx 0;border-bottom:1px solid #e8dfed}.income-summary>view{flex:1}.summary-label{display:block;color:#75677b;font-size:28rpx}.summary-value{display:block;margin-top:16rpx;font-size:40rpx;font-weight:600;font-variant-numeric:tabular-nums}.income-note{font-size:24rpx;line-height:1.8;color:#7c6c84;margin:24rpx 0}.income-tabs{display:flex;border-bottom:1px solid #e0d5e6;margin-top:30rpx}.income-tabs button{margin:0;border-radius:0;flex:1;background:transparent;font-size:28rpx;color:#75677b;padding:4rpx 0}.income-tabs button::after{border:0}.income-tabs button.active{color:#8954a3;border-bottom:2px solid #a16fbb}.income-record{padding:30rpx 0;border-bottom:1px solid #e8dfed;font-size:27rpx;line-height:1.65}.record-heading{display:flex;justify-content:space-between;gap:24rpx;margin-bottom:10rpx;font-weight:600}.record-amount{flex-shrink:0;color:#8954a3;font-variant-numeric:tabular-nums}.record-date,.plan-meta{font-size:24rpx;color:#7c6c84;margin-top:8rpx}.income-empty{padding:64rpx 0;text-align:center;color:#8c8091;font-size:28rpx}.plans{margin-top:32rpx}.plans-heading{font-size:31rpx;font-weight:600}.plan-row{padding:24rpx 0;border-bottom:1px solid #e8dfed;font-size:27rpx}.income-footnote{font-size:23rpx;color:#8c8091;line-height:1.7;margin-top:32rpx}
</style>
