import App from './App'

// #ifndef VUE3
import Vue from 'vue'
import './uni.promisify.adaptor'
Vue.config.productionTip = false
App.mpType = 'app'
const app = new Vue({
	...App
})
app.$mount()
// #endif

// #ifdef VUE3
import {
	createSSRApp
} from 'vue'
// #ifdef MP-WEIXIN
import { shareMixin } from './common/wechat-share.js'
// #endif
export function createApp() {
	const app = createSSRApp(App)
	// #ifdef MP-WEIXIN
	// 每个页面都可转发、分享和复制链接
	app.mixin(shareMixin)
	// #endif
	return {
		app
	}
}
// #endif
