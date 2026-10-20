import {api} from './api.js'
// Invoke directly inside a customer tap handler. Refusal never prevents a
// booking or order, and accepted credits are only recorded for enabled IDs.
export async function requestServiceSubscriptions(config,events){
 // #ifdef MP-WEIXIN
 if(!config?.subscriptionEnabled||!config?.messageReminderEnabled)return
 const ids=[...new Set(events.map(event=>config.notificationTemplates?.[event]).filter(rule=>rule?.enabled&&rule.templateId).map(rule=>rule.templateId))].slice(0,3)
 if(!ids.length)return
 try{const result=await uni.requestSubscribeMessage({tmplIds:ids});const accepted=ids.filter(id=>result[id]==='accept');if(accepted.length)await api('/subscriptions','POST',{acceptedTemplateIds:accepted})}catch{ /* Business actions remain available when subscription is declined. */ }
 // #endif
}
