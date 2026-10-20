// Isolated local data for browser acceptance. Never connects to the live DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const seed=require('../server/seed.cjs');
const output=path.resolve('verification/xiurong-ui');fs.mkdirSync(output,{recursive:true});
const snapshot=JSON.parse(fs.readFileSync(path.resolve('common/offline-catalogue.json'),'utf8'));
const db={...seed(),...snapshot};
db.config={...db.config,name:'秀荣科技美肤',appointmentCapacity:10,appointmentTimes:'09:00,10:00,11:00,14:00,15:00,16:00,17:00',poolReward:{enabled:true,source:'revenue',percent:5,cycle:'daily',activityDays:3,startDate:'2026-10-19'},referralReward:{enabled:true,firstPercent:50,laterPercent:10,scope:'all',trigger:'paid',delayDays:0,durationDays:0,refundPolicy:'reverse'}};
// Real public catalogue, with an explicitly local-only goods/reward fixture.
db.products.push({id:'ui-goods',code:'UI-GOODS',categoryId:db.categories.find(c=>c.name.includes('优选'))?.id||'category-goods',name:'秀荣护理套装',kind:'goods',image:'/static/brand/product-rejuvenation-set-generated.png',price:1980,stock:20,sold:0,enabled:true,status:'published',home:true,sort:99});
db.rewards=[{id:'ui-reward',name:'秀荣护理礼盒',points:300,stock:10,enabled:true,image:'/static/brand/product-rejuvenation-set-generated.png'},{id:'ui-reward-more',name:'护理套装',points:800,stock:10,enabled:true,image:'/static/brand/product-skincare-set.jpg'}];
db.activities=[{id:'ui-activity',name:'科技美肤体验日',description:'门店精选护理与套餐服务，具体安排请联系门店。',enabled:true,productId:db.products.find(p=>p.packagePlans?.length)?.id,image:'/static/xiurong/arch-room.jpg'}];
db.alliances=[{id:'ui-merchant',name:'花艺生活馆',description:'门店介绍与服务信息',phone:'18639035033',enabled:true,image:'/static/xiurong/silk-banner.jpg'}];
const file=path.join(output,'fixture-db.json'),secret=crypto.randomBytes(24).toString('hex');fs.writeFileSync(file,JSON.stringify(db));
const port=Number(process.env.UI_API_PORT||3197),base='http://127.0.0.1:'+port+'/api';
const server=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:'',NODE_ENV:'test',WECHAT_MOCK:'true',WECHAT_APPID:'wxmocktest00000000',DEMO_MODE:'false',PAYMENT_MODE:'off',INTERNAL_SECRET:secret,ADMIN_PASSWORD:secret},stdio:['ignore','ignore','pipe']});
server.stderr.on('data',chunk=>process.stderr.write(chunk));
async function request(route,method='GET',body,token,admin=false){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(admin?{'x-anqi-internal':secret}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(route+': '+JSON.stringify(data));return data;}
(async()=>{for(let n=0;n<100;n++){try{await request('/health');break}catch{}await new Promise(r=>setTimeout(r,100))}
const user=await request('/auth/wechat','POST',{code:'ui-review-owner'});await request('/admin/users/'+user.user.id,'PUT',{invited:true},null,true);await request('/me','PUT',{name:'林女士',gender:'female'},user.token);
// Arrange initial points/ledger in this isolated fixture, without production APIs.
server.kill();await new Promise(resolve=>server.once('exit',resolve));
const stored=JSON.parse(fs.readFileSync(file));const person=stored.users.find(u=>u.id===user.user.id);person.points=300;person.streak=2;const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);person.lastSign=new Date(Date.parse(today+'T12:00:00+08:00')-86400000+8*3600000).toISOString().slice(0,10);stored.ledger.push({id:'ui-initial-points',userId:person.id,name:'签到获得积分',amount:300,createdAt:new Date(Date.now()-86400000).toISOString()});fs.writeFileSync(file,JSON.stringify(stored));
fs.writeFileSync(path.join(output,'session.local.json'),JSON.stringify({base,secret,token:user.token,userId:user.user.id,file}));
const active=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_FILE:file,DB_NAME:'',NODE_ENV:'test',WECHAT_MOCK:'true',WECHAT_APPID:'wxmocktest00000000',DEMO_MODE:'false',PAYMENT_MODE:'off',INTERNAL_SECRET:secret,ADMIN_PASSWORD:secret},stdio:['ignore','ignore','inherit']});
process.on('SIGTERM',()=>active.kill());process.on('SIGINT',()=>active.kill());active.on('exit',code=>process.exit(code||0));console.log('Isolated UI fixture ready on '+base);
})().catch(error=>{console.error(error);server.kill();process.exit(1)});
