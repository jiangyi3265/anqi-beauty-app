const crypto=require('node:crypto');
const events={appointmentBooked:'预约成功',appointmentCancelled:'预约取消',appointmentCompleted:'服务完成',orderPaid:'确认收款',orderShipped:'商品发货'};
const sources=['project','store','date','time','status','orderNumber','amount'];
let cachedToken=null;
function init(db){db.notifications||=[];db.config.notificationTemplates||={}}
function validateTemplates(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('订阅消息模板配置无效');
 const out={};for(const [event,rule]of Object.entries(value)){
  if(!events[event]||!rule||typeof rule!=='object')throw Error('消息场景无效');
  if(typeof rule.templateId!=='string'||!/^[a-zA-Z0-9_-]{0,150}$/.test(rule.templateId))throw Error('订阅模板ID无效');
  const fields={};for(const [key,source]of Object.entries(rule.fields||{})){if(!/^(thing|time|date|phrase|character_string|number|amount|name|phone_number)\d+$/.test(key)||!sources.includes(source))throw Error('消息模板字段映射无效');fields[key]=source}
  if(rule.enabled===true&&(!rule.templateId||!Object.keys(fields).length))throw Error('启用消息前请配置模板ID及字段');
  out[event]={templateId:rule.templateId,enabled:rule.enabled===true,fields};
 }return out;
}
function options(db){init(db);if(!db.config.subscriptionEnabled||!db.config.messageReminderEnabled)return [];return Object.entries(db.config.notificationTemplates).filter(([,r])=>r.enabled&&r.templateId).map(([event,r])=>({event,templateId:r.templateId}))}
function consent(db,user,ids){const allowed=new Set(options(db).map(r=>r.templateId));if(!Array.isArray(ids)||ids.length>3||ids.some(id=>typeof id!=='string'||!allowed.has(id)))throw Error('订阅模板不在已启用的配置中');user.subscriptionCredits||={};for(const id of new Set(ids))user.subscriptionCredits[id]=Math.min(10,(Number(user.subscriptionCredits[id])||0)+1);return {accepted:true,count:new Set(ids).size}}
function enqueue(db,event,record){init(db);const key=event+':'+record.id;if(db.notifications.some(n=>n.key===key))return;
 const rule=db.config.notificationTemplates[event];if(!db.config.subscriptionEnabled||!db.config.messageReminderEnabled||!rule?.enabled||!rule.templateId)return;
 const user=db.users.find(u=>u.id===record.userId&&!u.disabled);if(!user?.openid)return;
 const credits=Number(user.subscriptionCredits?.[rule.templateId])||0;const status=credits>0?'pending':'not_subscribed';if(credits>0)user.subscriptionCredits[rule.templateId]=credits-1;
 const appointment=event.startsWith('appointment');const values={project:record.name||record.product?.name||'到店服务',store:record.store?.name||db.stores.find(s=>s.id===record.storeId)?.name||db.config.name,date:record.date||new Date(Date.now()+8*3600000).toISOString().slice(0,10),time:record.date?record.date+' '+record.time:new Date(Date.now()+8*3600000).toISOString().slice(0,16).replace('T',' '),status:events[event],orderNumber:record.number||'',amount:Number(record.total||0).toFixed(2)};
 const data={};for(const [field,source]of Object.entries(rule.fields||{})){const prefix=field.replace(/\d+$/,'');const limit={thing:20,phrase:5,name:10,character_string:32,phone_number:17}[prefix]||32;data[field]={value:String(values[source]||'').slice(0,limit)}}
 db.notifications.push({id:crypto.randomUUID(),key,event,userId:user.id,sourceId:record.id,templateId:rule.templateId,data,page:appointment?'pages/appointments/index?tab=booked':'pages/order-detail/index?id='+record.id,status,createdAt:new Date().toISOString(),attempts:0});
}
async function accessToken(){
 if(cachedToken&&cachedToken.expires>Date.now())return cachedToken.value;
 let data;try{const response=await fetch('https://api.weixin.qq.com/cgi-bin/token?'+new URLSearchParams({grant_type:'client_credential',appid:process.env.WECHAT_APPID||'',secret:process.env.WECHAT_APPSECRET||''}),{signal:AbortSignal.timeout(8000),redirect:'error'});data=await response.json()}catch{throw Error('微信凭据接口暂不可用')}
 if(!data.access_token)throw Error('微信凭据获取失败（'+Number(data.errcode||0)+'）');cachedToken={value:data.access_token,expires:Date.now()+Math.max(60,Number(data.expires_in||7200)-120)*1000};return cachedToken.value;
}
async function templates(){const token=await accessToken();let data;try{data=await(await fetch('https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate?access_token='+encodeURIComponent(token),{signal:AbortSignal.timeout(8000),redirect:'error'})).json()}catch{throw Error('微信模板列表暂不可用')};if(data.errcode)throw Error('微信模板列表获取失败（'+data.errcode+'）');return {templates:(data.data||[]).map(row=>({templateId:row.priTmplId,title:row.title,content:row.content,fields:[...String(row.content||'').matchAll(/\{\{(\w+)\.DATA\}\}/g)].map(m=>m[1])})),events,sources}}
async function send(job,openid){
 if(process.env.NODE_ENV==='test'&&process.env.WECHAT_NOTIFICATION_MOCK==='true')return {status:'sent',errcode:0};
 const token=await accessToken();let response,data;try{response=await fetch('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),redirect:'error',body:JSON.stringify({touser:openid,template_id:job.templateId,page:job.page,data:job.data,miniprogram_state:process.env.WECHAT_ENV_VERSION||'trial',lang:'zh_CN'})});data=await response.json()}catch{return {status:'unknown',error:'发送结果未确认，为避免重复提醒不自动重发'}}
 if(data.errcode===0)return {status:'sent',errcode:0};if([40001,42001].includes(data.errcode))cachedToken=null;
 return {status:'failed',errcode:Number(data.errcode||-1),error:({43101:'顾客未订阅或订阅次数已用完',47003:'模板字段与微信模板要求不符',40037:'订阅模板ID无效'}[data.errcode]||'微信拒绝发送，请核对模板配置')};
}
module.exports={events,sources,init,options,consent,enqueue,validateTemplates,templates,send};
