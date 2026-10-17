const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const remote=process.argv.includes('--remote');
const out=path.resolve('verification/ui-20260926');
const base=remote?'https://anqi.okam.top':'http://127.0.0.1:3119';
let child;
(async()=>{
 if(!remote){child=spawn(process.execPath,['server/index.cjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'3119',DATA_FILE:path.join(out,'isolated-db-final-target.json'),DB_NAME:'',DEMO_MODE:'true'},stdio:'ignore'});for(let n=0;n<40;n++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}}
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
 if(!remote){for(const origin of ['https://anqi.okam.top','https://anqiht.okam.top'])await context.route(origin+'/api/**',async route=>{const req=route.request();const response=await context.request.fetch(req.url().replace(origin,base),{method:req.method(),data:req.postData()||undefined});await route.fulfill({response})})}
 const page=await context.newPage();const errors=[];const broken=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))broken.push({url:r.url().split('?')[0],status:r.status()})});
 const bootstrap=remote?'https://anqi.okam.top/api/bootstrap':base+'/api/bootstrap';
 const data=await (await fetch(bootstrap)).json();assert.ok(Array.isArray(data.products)&&data.products.length>=1);assert.ok(data.products.some(p=>p.id==='jimeili-rejuvenation-set')); 
 await page.goto(base+'/#/pages/home/index');await page.locator('.home-product').first().waitFor();await page.locator('.loading').waitFor({state:'hidden'});await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete));
 assert.equal(await page.locator('.hero-wrap').count(),1);assert.equal(await page.locator('.welcome-live').count(),1);assert.equal(await page.locator('.error-bar').count(),0);assert.equal(await page.locator('.shortcuts .shortcut').count(),3);assert.equal(await page.locator('.entry-grid').count(),1);assert.equal(await page.locator('.tabbar .tabitem').count(),4);assert.ok(await page.locator('.home-product').count()>=1);
 await page.evaluate(async()=>{await Promise.all(Array.from(document.querySelectorAll('uni-image')).map(el=>{const url=el.getAttribute('src');return new Promise((resolve,reject)=>{if(!url)return resolve();const img=new Image();img.onload=resolve;img.onerror=()=>reject(Error('Image did not load: '+url));img.src=url})}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))});
 await page.screenshot({path:path.join(out,(remote?'online':'local')+'-home.png'),fullPage:true});
 await page.locator('.tabitem').filter({hasText:'商城'}).click();await page.locator('.page-mall .mall-product-row').first().waitFor();assert.ok(await page.locator('.mall-product-row').count()>=1);
 await page.screenshot({path:path.join(out,(remote?'online':'local')+'-mall.png')});
 const targetProduct=page.locator('.mall-product-row').filter({hasText:'暨美丽胶原蛋水光（三型胶原蛋白）'});if(await targetProduct.count())await targetProduct.first().click();else await page.locator('.mall-product-row').first().click();await page.locator('.product-info').waitFor();assert.match(await page.locator('.product-info').innerText(),/暨美丽胶原蛋水光（三型胶原蛋白）/);
 await page.locator('.bottom-actions .primary').click();await page.locator('.sheet').waitFor();await page.locator('.spec').filter({hasText:'1疗程'}).click();assert.match(await page.locator('.sheet-head').innerText(),/1980|2980/);
 await page.screenshot({path:path.join(out,(remote?'online':'local')+'-product.png')});
 await page.locator('.sheet .primary').click();await page.locator('.page-login').waitFor();
 const loginText=await page.locator('body').innerText();assert.match(loginText,/暨美丽/);assert.match(loginText,/微信一键登录/);assert(!/安棋美容|安琪美容|玥色塑美|月色塑美|测试商品|本地模拟/.test(loginText));
 await page.goto(base+'/#/pages/activities/index');await page.locator('.page-activities').waitFor();await page.waitForFunction(()=>!document.querySelector('.loading'));const activityCount=await page.locator('.activity-card').count();if(activityCount)assert.match(await page.locator('.activity-card').first().innerText(),/查看商品并购买|活动详情/);
 assert.deepEqual(errors,[]);assert.deepEqual(broken,[]);
 const result={environment:remote?'production H5 read-only':'isolated local Node/file database',passed:['bootstrap one production product','original home entries and navigation','mall one product','product details','course selection price','unauthenticated purchase redirects to login','activity details and related purchase entry'],pageErrors:errors,failedResponses:broken,ordersCreated:0};
 fs.writeFileSync(path.join(out,(remote?'online':'local')+'-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(child)child.kill()});

