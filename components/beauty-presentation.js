import { api, go, toast } from '../common/api.js'
import { BRAND_NAME, UI_ASSETS, formatPrice, shortStoreName, brandedStoreName, beijingDate, deviceColumn } from '../common/ui.js'
import BrandMark from './BrandMark.vue'
import UiIcon from './UiIcon.vue'
import ProductVisual from './ProductVisual.vue'
import EmptyState from './EmptyState.vue'
import {requestServiceSubscriptions} from '../common/subscriptions.js'
import {requireInviteBinding} from '../common/invite.js'
import {dailyPoolForToday} from '../common/daily-pool.js'

const pageTitles = {
  mall: '商城', discover: '发现', product: '项目详情', stores: '选择门店',
  profile: '个人资料', appointments: '我的预约', booking: '预约到店',
  activities: '活动', alliances: '百业联盟', checkout: '确认订单',
  'order-detail': '订单详情', orders: '我的订单', addresses: '收货地址',
  'address-edit': '编辑地址', shares: '邀请记录', earnings: '我的收益',
  about: '关于与客服', share: '邀请好友', points: '积分明细', sign: '每日签到',
  redemptions: '兑换记录'
}

export default function decorateScreen(base) {
  return {
    ...base,
    components: { ...base.components, BrandMark, UiIcon, ProductVisual, EmptyState },
    data() {
      return {
        ...base.data.call(this),
        subscriptionPending:false, bookingResult: null, bookingDuration: 60, bookingSelected: {},
        rewardToConfirm: null, orderToCancel: null, claimedJustNow: false,
        giftView: 'available', uiClockTimer: null,
        orderTabs: ['全部', '待付款', '待使用', '待收货', '已完成', '售后'],
        allMemberEntries: [
          { label: '我的预约', page: 'appointments', icon: 'calendar' },
          { label: '我的卡券', page: 'gifts', query: '?type=trial', icon: 'ticket' },
          { label: '邀请好友', page: 'share', icon: 'share' },
          { label: '邀请记录', page: 'shares', icon: 'document' }
        ]
      }
    },
    computed: {
      ...base.computed,
      brandName(){return this.config.name||BRAND_NAME},
      memberSubtitle(){
        if(!this.me.id)return '登录后查看订单与服务'
        if(this.membershipCard?.preview)return '测试会员 · 仅展示，不含消费权益'
        return this.me.memberCode?'会员编号 '+this.me.memberCode:'欢迎来到'+this.brandName
      },
      publicDailyPool(){return dailyPoolForToday(this.dailyPool, this.clockNow)},
      currentIncomeSummary(){return {...this.incomeSummary,dailyPool:dailyPoolForToday(this.incomeSummary.dailyPool,this.clockNow)}},
      memberFeatureTitle(){return this.me.id?(this.membershipCard?.name||'VIP服务套餐'):'VIP服务套餐'},
      memberFeatureNote(){
        if(this.membershipCard?.preview)return '测试会员 · 仅展示，不含消费权益'
        return this.me.vipLevel?'已开通 · 按项目预约核销':'按需选择 · 分次预约'
      },
      ui(){return { ...UI_ASSETS,room:this.config.homeImage||UI_ASSETS.room,silk:this.config.themeImage||UI_ASSETS.silk,portrait:this.config.mallBanner||UI_ASSETS.portrait,booking:this.config.bookingImage||this.config.homeImage||UI_ASSETS.room,alliance:this.config.allianceImage||this.config.themeImage||UI_ASSETS.silk }},
      memberEntries(){return this.allMemberEntries.filter(entry=>entry.page!=='share'||(this.config.marketingEnabled!==false&&this.shareAllowed))},
      quickEntries(){return [
        {label:this.config.shortcutTrialLabel||'体验卡',page:'gifts',query:'?type=trial',icon:'ticket'},
        {label:this.config.shortcutVipLabel||'贵宾卡',page:'gifts',query:'?type=vip',icon:'crown'},
        {label:this.config.shortcutShareLabel||'邀请好友',page:'share',icon:'share'}
      ].filter(entry=>entry.page!=='share'||(this.config.marketingEnabled!==false&&this.shareAllowed))},
      selectedVisualProduct(){const image=this.selectedSku?.image;return image?{...this.product,image,visualMode:'image'}:this.product},
      homeBanners(){return this.homeModules.filter(m=>m.type==='banner')},
      homeContentModules(){return this.homeModules.filter(m=>m.type!=='banner')},

      title() {
        if (this.page === 'gifts') { const cn = n => n >= 1 && n <= 10 ? '一二三四五六七八九十'[n - 1] : String(n); return this.giftType === 'vip' ? '贵宾卡' + cn(this.giftProducts.length || 10) + '选' + cn(this.maxGiftCount) : this.me.trialQuota?.legacy ? cn(this.maxGiftCount) + '项体验卡' : '体验预约' }
        if (this.page === 'legal') return this.legalTitle
        if (this.page === 'stores' && this.displayStore) return shortStoreName(this.displayStore)
        if (this.page === 'booking' && this.bookingResult) return '预约结果'
        if (this.page === 'product') return this.isPackage ? 'VIP服务套餐' : this.product?.kind === 'goods' ? '商品详情' : '项目详情'
        return pageTitles[this.page] || ''
      },
      brandHeader() { return ['home', 'mine'].includes(this.page) },
      displayStore() { return this.query.id ? this.stores.find(store => store.id === this.query.id) : null },
      activeStore() { return this.chosenStore.id ? this.chosenStore : this.stores.find(s => /和谐/.test(s.name)) || this.stores[0] || {} },
      homeFeatured() { const limit=Number(this.config.homeFeaturedLimit)||0;return limit>0?this.featuredProducts.slice(0,limit):this.featuredProducts },
      isVipCategory() { return /VIP|套餐/.test(this.selectedMallCategoryName) },
      mallProducts() { return base.computed.mallProducts.call(this).slice().sort((a,b) => Number(b.home === true) - Number(a.home === true) || (a.sort || 0) - (b.sort || 0)) },
      maxGiftCount() { const n = this.giftType === 'trial' ? (this.config.trialPick ?? this.config.maxGifts) : this.config.maxGifts; return Math.max(1, Number(n) || 3) },
      packageHeroProduct() { return this.selectedPackagePlan?.services?.find(service => deviceColumn(service) >= 0) || {name:this.product?.name,image:this.product?.image} },
      canClaim() { return !this.loading && !this.busy && !this.error && this.giftEligible && this.selectedGifts.length === this.maxGiftCount },
      profileValid() { return !!String(this.form.name || '').trim() && ['male', 'female'].includes(this.form.gender) },
      addressValid() { return !!String(this.form.name || '').trim() && /^1\d{10}$/.test(String(this.form.phone || '')) && !!String(this.form.city || '').trim() && !!String(this.form.detail || '').trim() },
      availableStock() { return Number(this.selectedSku?.stock ?? this.product?.stock ?? 0) },
      canBuy() { return !this.subscriptionPending&&!!this.product && this.product.enabled !== false && !['offline', 'draft'].includes(this.product.status) && this.availableStock > 0 && !this.loading && !this.error && !this.busy },
      pointRows() { return (Array.isArray(this.rows) ? this.rows : []).filter(row => this.tab === 1 ? Number(row.amount) > 0 : this.tab === 2 ? Number(row.amount) < 0 : true).slice().sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))) },
      currentSignStreak() {
        const last = Date.parse(String(this.me.lastSign || '') + 'T12:00:00+08:00')
        const elapsed = (Date.parse(this.today + 'T12:00:00+08:00') - last) / 86400000
        return elapsed >= 0 && elapsed <= 1 ? Number(this.me.streak) || 0 : 0
      },
      recentSignDays() {
        return Array.from({length: 7}, (_, index) => {
          const value = new Date(Date.parse(this.today + 'T12:00:00+08:00') + (index - 2) * 86400000)
          const date = beijingDate(value.getTime())
          const last = Date.parse(String(this.me.lastSign || '') + 'T12:00:00+08:00')
          const distance = (last - Date.parse(date + 'T12:00:00+08:00')) / 86400000
          return { date, label: date.slice(5).replace('-', '/'), signed: distance >= 0 && distance < Number(this.me.streak || 0), today: date === this.today }
        })
      },
      successRedemption() { return this.query.success ? this.rows.find(row => row.id === this.query.success) : null },
      legalCopy() {
        const type = ['privacy','agreement','pointsRules'].includes(this.query.type) ? this.query.type : 'agreement'
        return String(this.config[type] || '').replace(/暨美丽/g, this.brandName)
      },
      orderServices() { return this.order?.package?.services || [] },
      entitlementTotals() {
        return this.orderServices.filter(item=>item.kind!=='goods').reduce((total, item) => {
          total.total += Number(item.total) || 0
          total.used += Number(item.used) || 0
          total.booked += this.bookedCount(this.order, item)
          total.available += this.packageRemaining(this.order, item)
          return total
        }, { total: 0, used: 0, booked: 0, available: 0 })
      },
      orderAppointments() { return (this.rows || []).filter(row => row.orderId === this.order?.id).slice().sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time)) },
      checkoutReady() { return this.canBuy && !!this.chosenStore.id && (this.product?.kind !== 'goods' || !!this.chosenAddress.id) },
      bookingResultStore() { return this.bookingResult?.store || this.bookingStore || {} },
      bookedDateLabel() { return this.bookingResult ? this.calendarLabel(this.bookingResult.date) : '' }
    },
    mounted() {
      const orderTab = ['', 'pending', 'ready', 'shipping', 'completed', 'aftersale'].indexOf(this.query.tab || '')
      if (this.page === 'orders' && orderTab >= 0) this.tab = orderTab
      base.mounted.call(this)
      this.updateClock()
    },
    beforeUnmount() { clearTimeout(this.uiClockTimer) },
    methods: {
      ...base.methods,
      updateClock() {
        this.clockNow = Date.now()
        const midnight = Date.parse(this.today + 'T00:00:00+08:00') + 86400000
        // 保留预约时间刷新频率，跨零点时立即切换当天积分池。
        this.uiClockTimer = setTimeout(() => this.updateClock(), Math.min(30000, midnight - this.clockNow))
      },
      price: formatPrice,
      open(page,query=''){if(page==='share'&&this.config.marketingEnabled===false)return toast('门店暂未开放邀请分享');return go(page,query)},
      async createOrder(){
        if (this.subscriptionPending || this.busy) return
        this.subscriptionPending = true
        try{
          // 订单创建时固定推荐关系，先处理扫码带来的待绑定邀请码。
          try { await this.bindPendingInvite() }
          catch (error) {
            if (error.inviteStatus) uni.removeStorageSync('invite')
            return toast(error.inviteStatus ? error.message + '，本次未下单' : '推荐人绑定失败，请刷新后重试')
          }
          await requestServiceSubscriptions(this.config, ['orderPaid','orderShipped'])
        } finally { this.subscriptionPending = false }
        return base.methods.createOrder.call(this)
      },

      async bindPendingInvite(){
        const invite = uni.getStorageSync('invite')
        if (!this.me.id || !invite) return
        const result = await api('/invite/bind', 'POST', { invite })
        this.me = { ...this.me, ...result.user }
        requireInviteBinding(result.status)
        uni.removeStorageSync('invite')
        if (result.status === 'bound') toast('已自动绑定推荐人')
      },

      shortStore: shortStoreName,
      storeName: brandedStoreName,
      async refresh() {
        const selected = this.selectedStoreId
        await base.methods.refresh.call(this)
        if (this.me.id && uni.getStorageSync('invite') && !this.error) {
          this.loading = true
          try {
            await this.bindPendingInvite()
          } catch (error) {
            if (error.inviteStatus) toast(error.message)
            else {
              this.error = '推荐人绑定失败，请下拉刷新重试'
              return
            }
          } finally {
            this.loading = false
          }
        }
        if(!this.error){uni.setNavigationBarTitle({title:this.isTab?this.brandName:this.title});if(this.nativeDevice){const pagePublic=['home','mall','discover','product','stores','activities','alliances'].includes(this.page);if(this.config.marketingEnabled!==false&&pagePublic&&this.shareAllowed)uni.showShareMenu({menus:['shareAppMessage','shareTimeline'],fail(){}});else uni.hideShareMenu({menus:['shareAppMessage','shareTimeline'],fail(){}})}}
        if (this.page === 'mall' && !this.mallCategories.some(row => row.id === this.mallCategory)) this.mallCategory = this.mallCategories[0]?.id || 'all'
        if (!selected) {
          const saved = uni.getStorageSync('xiurong-preferred-store')
          const preferred = this.stores.find(s => s.id === saved) || this.stores.find(s => /和谐/.test(s.name))
          if (preferred) this.selectedStoreId = preferred.id
        }
      },
      homeModuleClick(module){
        const target=module.targetId;
        if(module.targetType==='store'&&target)return go('stores','?id='+encodeURIComponent(target));
        if(module.targetType==='activity'&&target)return go('activities','?id='+encodeURIComponent(target));
        return base.methods.homeModuleClick.call(this,module);
      },
      previewStoreCover(store){const cover=this.storePhoto(store);const photos=[...new Set([cover,...(store.gallery||[])].filter(Boolean))];if(photos.length)uni.previewImage({urls:photos,current:cover})},
      chooseStore(event) {
        this.storeIndex = Number(event.detail.value)
        if (this.chosenStore.id) uni.setStorageSync('xiurong-preferred-store', this.chosenStore.id)
      },
      viewStore(store) { go('stores', '?id=' + encodeURIComponent(store.id)) },
      chooseStoreBooking(store) {
        uni.setStorageSync('xiurong-preferred-store', store.id)
        go('appointments')
      },
      storePhoto(store = {}) { return store.image || store.gallery?.[0] || this.config.storeDefaultImage || '' },
      giftLabel(product) { const name=String(product.name||'');return /[（(]/.test(name)||!String(product.subtitle||'').startsWith('单部位')?name:name+'（单部位）' },
      hasCustomAvatar(value) { return !!value && !String(value).includes('/static/assets/avatar.png') },
      openVip() {
        const category = this.mallCategories.find(row => /VIP|套餐/.test(row.name))
        if (category) go('mall', '?category=' + encodeURIComponent(category.id))
        else go('activities')
      },
      showGiftType(type) { uni.redirectTo({url:'/pages/gifts/index?type=' + type}) },
      giftStatus(product) {
        if (product.useStatus === 'completed') return product.kind === 'goods' ? '已领取' : '已使用'
        if (product.useStatus === 'booked') return '已预约'
        return product.kind === 'service' ? '待预约' : '待领取'
      },
      giftStatusClass(product) { return product.useStatus === 'completed' ? 'muted' : product.useStatus === 'booked' ? 'rose' : 'amber' },
      bookedCount(order, item) { return (this.rows || []).filter(row => row.orderId === order?.id && row.entitlementId === item.id && row.status === 'booked').length },
      orderSpec(order) { return order.package?.planName || order.product?.selectedSku?.name || (order.spec === 'course' ? '1疗程' : order.product?.kind === 'goods' ? '1件' : '单次 · 1次') },
      orderPaymentLabel(order) {
        if (order.paymentMode === 'wechat') return '微信支付'
        if (order.paymentMode === 'mock') return '模拟支付'
        if (order.paymentMode === 'offline') return '现金支付（门店收银）'
        if (order.paymentMode === 'demo') return '历史记录'
        if (order.status === 'pending') return '微信支付 / 现金支付'
        if (order.paymentChoice === 'wechat') return '微信支付'
        return this.onlinePay && order.paymentChoice !== 'offline' ? '微信支付' : '现金支付（门店收银）'
      },
      statusText(status) { return {pending:'待付款',ready:'待使用',shipping:'待收货 / 取货',completed:'已完成',cancelled:'已取消',aftersale:'退款已登记'}[status] || status },
      orderStatus(order) { return order.status === 'ready' ? order.product?.kind === 'goods' ? '待发货 / 取货' : '待预约' : this.statusText(order.status) },
      orderNote(order) {
        if (order.status === 'pending') return '可选择微信支付或现金支付；现金支付需门店确认收款后生效。未付款订单2小时后自动取消。'
        if (order.status === 'cancelled') return '订单已取消，如需服务可重新下单。'
        if (order.status === 'aftersale') return order.wechatRefund ? {SUCCESS:'退款已原路退回微信支付账户。',PROCESSING:'退款已提交微信支付，一般1-3个工作日原路到账。',ABNORMAL:'退款到账异常，请联系门店处理。',CLOSED:'退款已关闭，请联系门店处理。'}[order.wechatRefund.status] || '退款已提交微信支付。' : '具体到账情况请联系门店核实。'
        if (order.status === 'shipping') return '商品履约进度请查看物流信息或联系门店。'
        return order.paymentMode === 'offline' ? '门店已确认收款，服务可按项目预约。' : order.paymentMode === 'wechat' ? '已通过微信支付，服务可按项目预约。' : '订单状态以实际履约记录为准。'
      },
      refundText(order) { return order.wechatRefund ? {SUCCESS:'已原路退回',PROCESSING:'退款处理中',ABNORMAL:'退款异常',CLOSED:'退款已关闭'}[order.wechatRefund.status] || '退款处理中' : '退款已登记' },
      async cancelOrder(order) { if (order.status === 'pending' && !this.busy) this.orderToCancel = order },
      confirmCancelOrder() {
        if (!this.orderToCancel || this.busy) return
        return this.run(async () => {
          await api('/orders/' + this.orderToCancel.id + '/cancel', 'POST')
          this.orderToCancel = null
          toast('订单已取消')
          await this.refresh()
        })
      },
      selectTrial(product) {
        if(!this.me.id)return go('login')
        return this.run(async()=>{
          const row=await api('/claims','POST',{type:'trial',productIds:[product.id]})
          go('booking','?claimId='+row.id+'&productId='+product.id)
        })
      },
      claim() {
        if (!this.me.id) return go('login')
        if (!this.giftEligible) return toast('贵宾卡面向受邀会员开放，请联系门店')
        if (this.error) return toast('请重新加载后再领取')
        if (this.selectedGifts.length !== this.maxGiftCount) return toast('请选择' + this.maxGiftCount + '项')
        return this.run(async () => {
          const row = await api('/claims', 'POST', { productIds: this.selectedGifts, type: this.giftType })
          if (row?.id) this.claimRows = [...this.claimRows.filter(old => old.id !== row.id), row]
          this.selectedGifts = []
          this.claimedJustNow = true
          await this.refresh()
        })
      },
      redeemReward(reward) {
        if (!this.me.id) return go('login')
        if (this.error) return toast('请重新加载后再兑换')
        if (Number(reward.stock) <= 0) return toast('奖品暂时缺货')
        if (Number(this.me.points) < Number(reward.points)) return toast('当前积分不足')
        this.rewardToConfirm = reward
      },
      confirmRedemption() {
        if (!this.rewardToConfirm || this.busy) return
        return this.run(async () => {
          const record = await api('/redemptions', 'POST', { rewardId: this.rewardToConfirm.id })
          this.rewardToConfirm = null
          go('redemptions', record?.id ? '?success=' + encodeURIComponent(record.id) : '')
        })
      },
      setBookingSelection(value) {
        base.methods.setBookingSelection.call(this, value)
        this.bookingSelected = value
        this.bookingDuration = Number(value.durationMinutes) || 60
      },
      async book() {
        if (this.bookingResult || this.busy) return
        if (!this.bookingAvailable || !this.bookingStoreEnabled) return toast('项目或门店暂不可预约，请联系门店')
        if (!this.bookingReady || Date.parse(this.form.date + 'T' + this.form.time + ':00+08:00') <= Date.now()) return toast('请选择尚未开始的预约时间')
        if (this.error) return toast('请重新加载后再预约')
        if(this.subscriptionPending)return;this.subscriptionPending=true;try{await requestServiceSubscriptions(this.config,['appointmentBooked','appointmentCancelled','appointmentCompleted'])}finally{this.subscriptionPending=false}
        return this.run(async () => {
          const payload = { date: this.form.date, time: this.form.time, staffId: this.form.staffId || '' }
          if (this.query.claimId) Object.assign(payload, {claimId:this.query.claimId,productId:this.query.productId,storeId:this.chosenStore.id})
          else Object.assign(payload, {orderId:this.query.orderId,...(this.query.entitlementId ? {entitlementId:this.query.entitlementId} : {})})
          try {
            const record = await api('/appointments', 'POST', payload)
            this.bookingResult = {...record, date:record.date || payload.date, time:record.time || payload.time, product:{...this.bookingProduct}, store:{...this.bookingStore}, durationMinutes:this.bookingDuration}
            this.bookingReady = false
          } catch (error) { this.bookingRefresh++; throw error }
        })
      },
      calendarLabel(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || ''
        const weekday = new Date(value + 'T12:00:00+08:00').getUTCDay()
        return Number(value.slice(5,7)) + '月' + Number(value.slice(8,10)) + '日 周' + '日一二三四五六'[weekday]
      },
      appointmentProduct(record) { return record.entitlementId ? {name:record.name} : record.product || this.products.find(product => product.id === record.productId) || {name:record.name || this.orders.find(order=>order.id===record.orderId)?.product?.name} },
      appointmentName(record) { return record.name || this.appointmentProduct(record).name || '到店服务' },
      shortDate(value) { return this.date(value).slice(0,16) },
      copyStoreAddress(store) { if (store?.address) this.copy(store.address) },
      contact(store) {
        const target = store?.phone ? store : this.activeStore
        if (!target.phone) return toast('门店联系方式暂未配置')
        uni.showModal({title:'联系门店',content:(brandedStoreName(target) || BRAND_NAME) + '\n' + target.phone,confirmText:'拨打电话',success: result => {if(result.confirm) this.call(target.phone)}})
      },
      saveProfile() { if (this.profileValid && !this.error) return base.methods.saveProfile.call(this) },
      saveAddress() { if (this.addressValid && !this.error) return base.methods.saveAddress.call(this) },
      selectGift(id) { if (!this.busy && !this.loading && !this.error && this.giftEligible) return base.methods.selectGift.call(this,id) }
    }
  }
}
