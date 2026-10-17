// Exchange the temporary wx.login code on the server only. Never log this URL.
function failure(message,status){return Object.assign(new Error(message),{status})}
function configured(){return (process.env.NODE_ENV==='test' && process.env.WECHAT_MOCK==='true') || (/^wx[a-zA-Z0-9]{16}$/.test(process.env.WECHAT_APPID||'') && !!(process.env.WECHAT_APPSECRET||'').trim())}
async function exchangeCode(code){
 if(typeof code!=='string'||!code.trim()||code.length>256)throw failure('微信登录凭证无效，请重试',400);
 if(!configured())throw failure('微信登录尚未配置，请联系管理员',503);
 if(process.env.NODE_ENV==='test' && process.env.WECHAT_MOCK==='true'){const hash=require('node:crypto').createHash('sha256').update(code).digest('hex');return {openid:'mock_'+hash,appid:process.env.WECHAT_APPID||'wxmocktest00000000'};}
 const url=new URL('https://api.weixin.qq.com/sns/jscode2session');
 url.search=new URLSearchParams({appid:process.env.WECHAT_APPID,secret:process.env.WECHAT_APPSECRET,js_code:code,grant_type:'authorization_code'}).toString();
 let response,data;
 try{response=await fetch(url,{signal:AbortSignal.timeout(6000),redirect:'error'});if(!response.ok)throw Error('upstream');data=await response.json()}catch{throw failure('微信登录服务暂不可用，请稍后重试',502)}
 if(!data||typeof data!=='object')throw failure('微信登录服务响应无效',502);
 if([40029,40163].includes(data.errcode))throw failure('微信登录凭证已失效，请重试',401);
 if(data.errcode===45011)throw failure('微信登录过于频繁，请稍后重试',429);
 if(data.errcode)throw failure('微信登录服务暂不可用，请联系管理员',502);
 if(typeof data.openid!=='string'||!data.openid||data.openid.length>128||typeof data.session_key!=='string'||!data.session_key)throw failure('微信登录服务响应无效',502);
 // session_key and unionid are deliberately not persisted or sent to the client.
 return {openid:data.openid,appid:process.env.WECHAT_APPID};
}
module.exports={configured,exchangeCode};
