<template>
  <view class="xr-panel xr-wallet">
    <text class="xr-caption">可提现余额</text>
    <text class="xr-stat-value">¥{{money(Math.max(0, summary.available || 0))}}</text>
    <text class="xr-caption">提现中 ¥{{money(summary.transferring || 0)}} · 已兑现 ¥{{money(summary.paidOut || 0)}}</text>
    <button class="xr-button xr-button-primary" :disabled="loading || (!requestId && (!summary.withdrawalReady || summary.available <= 0))" @click="open">{{requestId ? '查询上次提现' : '提现'}}</button>
    <text v-if="!summary.withdrawalReady" class="xr-caption">微信提现暂未开通，请联系门店。</text>
    <text v-else-if="summary.available < 0" class="xr-caption">存在退款冲回，请联系门店核对。</text>
  </view>
  <view v-if="opened" class="xr-overlay" @click="!saving && (opened = false)">
    <view class="xr-sheet xr-withdraw-sheet" role="dialog" aria-modal="true" aria-label="余额提现" @click.stop>
      <view class="xr-sheet-handle"/>
      <view class="xr-section-heading"><text>余额提现</text><button class="xr-text-button" :disabled="saving" @click="opened = false">关闭</button></view>
      <text class="xr-caption">提现至当前账号绑定的微信，可提现 ¥{{money(Math.max(0, summary.available || 0))}}</text>
      <text v-if="summary.withdrawalLimits" class="xr-caption">单笔可提 {{summary.withdrawalLimits.min}}—{{summary.withdrawalLimits.max}} 元</text>
      <view class="xr-withdraw-input"><text>¥</text><input v-model="value" type="digit" maxlength="12" :disabled="saving || !!requestId" placeholder="请输入提现金额" aria-label="提现金额" @input="error = ''"/></view>
      <text v-if="error" class="xr-caption xr-withdraw-error">{{error}}</text>
      <text class="xr-caption">提交后请在提现记录中确认微信收款。正在处理的金额不会重复扣除。</text>
      <button class="xr-button xr-button-primary" :disabled="saving" @click="submit">{{saving ? '提交中…' : requestId ? '查询上次提交结果' : '确认提现'}}</button>
    </view>
  </view>
</template>
<script setup>
import {ref, watch, onMounted, onUnmounted} from 'vue'
import {api, money, toast} from '../common/api.js'
const props = defineProps({summary: {type: Object, required: true}, loading: Boolean})
const emit = defineEmits(['refresh'])
const opened = ref(false), saving = ref(false), value = ref(''), error = ref(''), requestId = ref('')
const storageKey = () => 'withdrawal-draft-' + props.summary.walletUserId
function restoreDraft() {
  const draft = uni.getStorageSync(storageKey())
  value.value = draft?.amount ? String(draft.amount) : ''
  requestId.value = draft?.requestId || ''
}
watch(() => props.summary.walletUserId, restoreDraft, {immediate: true})
function open() {
  error.value = ''; restoreDraft()
  opened.value = true
}
async function submit() {
  if (saving.value) return
  const amount = Number(value.value)
  if (!/^\d+(\.\d{1,2})?$/.test(value.value) || amount <= 0 || (!requestId.value && amount > props.summary.available)) {
    error.value = '请输入不超过可提现余额的金额，最多两位小数'; return
  }
  const limits = props.summary.withdrawalLimits
  if (!requestId.value && limits && (amount < limits.min || amount > limits.max)) {
    error.value = `单笔提现金额为${limits.min}至${limits.max}元`; return
  }
  if (!requestId.value) requestId.value = 'withdraw-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  uni.setStorageSync(storageKey(), {amount, requestId: requestId.value})
  saving.value = true; error.value = ''
  try {
    await api('/withdrawals', 'POST', {amount, requestId: requestId.value})
    uni.removeStorageSync(storageKey()); requestId.value = ''; opened.value = false
    toast('申请已提交，请查看提现记录'); emit('refresh')
  } catch (e) {
    // 断网时保留原提交编号，重新打开页面也只查询/重试同一笔提现。
    if (e.status === 400) { uni.removeStorageSync(storageKey()); requestId.value = '' }
    error.value = e.message
  } finally { saving.value = false }
}
let timer
onMounted(() => { timer = setInterval(() => { if (props.summary.transferring > 0 && !saving.value) emit('refresh') }, 5000) })
onUnmounted(() => clearInterval(timer))
</script>
<script>export default {options: {virtualHost: true, styleIsolation: 'shared'}}</script>
<style scoped>
.xr-wallet,.xr-withdraw-sheet{display:flex;flex-direction:column;gap:20rpx}.xr-wallet{margin:24rpx 0}.xr-withdraw-sheet{box-sizing:border-box}.xr-withdraw-input{display:flex;align-items:center;gap:18rpx;padding:24rpx 0;border-bottom:1px solid #dccfc8;font-size:40rpx}.xr-withdraw-input input{flex:1;min-width:0;height:64rpx;font-size:36rpx}.xr-withdraw-error{color:#a74537}.xr-withdraw-sheet .xr-section-heading{display:flex;align-items:center;justify-content:space-between}
</style>
