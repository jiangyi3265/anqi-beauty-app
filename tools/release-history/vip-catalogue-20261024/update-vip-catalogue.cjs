// 按用户确认的秀容方案更新六档套餐；使用现有管理接口，保留历史订单快照。
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const path=require('node:path'),crypto=require('node:crypto');
const root=process.env.BUSINESS_ROOT||'/opt/anqi/business';
const base=process.env.ANQI_API||'http://127.0.0.1:'+(process.env.PORT||3016)+'/api';
const secret=process.env.INTERNAL_SECRET;if(!secret)throw Error('缺少 INTERNAL_SECRET');
const desired=JSON.parse(fs.readFileSync('desired-products.json'));
const prior=JSON.parse(fs.readFileSync('before-local-vip-catalogue.json'));
const fields=['name','price','subtitle','description','packagePlans'];
const selected=o=>Object.fromEntries(fields.map(k=>[k,o[k]]));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(name,o)=>fs.writeFileSync(name,JSON.stringify(o,null,2)+'\n',{mode:0o600});
async function call(p,method='GET',body){const r=await fetch(base+p,{method,headers:{'content-type':'application/json','x-anqi-internal':secret,'x-anqi-actor':'vip-catalogue-20261024'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error(method+' '+p+' → '+r.status+' '+JSON.stringify(d));return d;}
const resources=['products','config','orders','appointments','users','claims','earnings','incomePlans','ledger'];
async function snapshot(){const entries=await Promise.all(resources.map(async r=>[r,await call('/admin/'+r)]));const s=Object.fromEntries(entries);s.payouts=await call('/admin/earnings/payouts');return s;}
const byId=rows=>Object.fromEntries(rows.map(r=>[r.id,r]));
const catalogueFile=path.join(root,'common/vip-catalogue.json');
let before,originalCatalogue,touched=[];
(async()=>{
  before=await snapshot();
  assert.equal(before.config.version,'1.1.38');
  assert.equal(before.config.referralReward.requireCard,true);
  assert.equal(before.config.referralReward.firstPercent,50);assert.equal(before.config.referralReward.laterPercent,10);
  assert.equal(desired.length,6);assert.equal(new Set(desired.map(p=>p.id)).size,6);
  const validator=require(path.join(root,'server/vip-packages.cjs'));
  for(const target of desired){
    const live=before.products.find(p=>p.id===target.id),old=prior.products.find(p=>p.id===target.id);
    assert.ok(live&&old,'缺少套餐 '+target.id);assert.equal(live.name,target.name);assert.equal(live.price,target.price);
    assert.equal(live.memberPrice??null,null,'会员价需单独确认');
    assert.deepEqual(live.packagePlans,old.packagePlans,'线上套餐已被改动，停止覆盖 '+target.id);
    assert.deepEqual(validator.validatePlans(target.packagePlans),target.packagePlans);
  }
  originalCatalogue=fs.readFileSync(catalogueFile);assert.deepEqual(JSON.parse(originalCatalogue),prior,'线上目录文件已变化');
  const nextCatalogue=JSON.parse(fs.readFileSync('vip-catalogue.json'));
  for(const target of desired)assert.deepEqual(selected(nextCatalogue.products.find(p=>p.id===target.id)),selected(target));
  const preview={checkedAt:new Date().toISOString(),version:before.config.version,products:desired.map(p=>({id:p.id,name:p.name,price:p.price,beforePlans:before.products.find(x=>x.id===p.id).packagePlans.map(x=>x.name),afterPlans:p.packagePlans.map(x=>x.name),fixedProjects:p.packagePlans[0].services.length,totalUses:p.packagePlans[0].services.reduce((n,s)=>n+s.total,0)+2,groups:p.packagePlans[0].groups.map(g=>({name:g.name,count:g.services.length,pick:g.pick,usesPerChoice:1}))})),oldOrdersToPreserve:before.orders.length,settingsUnchanged:true};
  save('preview.json',preview);console.log(JSON.stringify(preview,null,2));
  if(process.env.APPLY!=='1')return;
  assert.ok(!fs.existsSync('applied.ok'),'已执行，拒绝重复应用');
  const credentials=JSON.parse(fs.readFileSync('/opt/anqi/shared/credentials.json'));
  const fd=fs.openSync('before-database.sql','wx',0o600);
  const dump=spawnSync('mysqldump',['-h','127.0.0.1','-P',String(process.env.DB_PORT||3309),'-u',credentials.dbUser,'--single-transaction','--no-tablespaces','--skip-lock-tables','--default-character-set=utf8mb4',process.env.DB_NAME],{env:{...process.env,MYSQL_PWD:credentials.dbPassword},stdio:['ignore',fd,'pipe']});fs.closeSync(fd);
  if(dump.status!==0)throw Error('数据库备份失败：'+String(dump.stderr).replaceAll(credentials.dbPassword,'[已隐藏]'));
  assert.ok(fs.statSync('before-database.sql').size>1000);
  save('before-api.json',before);fs.writeFileSync('before-server-vip-catalogue.json',originalCatalogue,{mode:0o600});
  for(const target of desired){
    const current=(await call('/admin/products')).find(p=>p.id===target.id);
    assert.deepEqual(selected(current),selected(before.products.find(p=>p.id===target.id)),'套餐正在被其他管理员编辑 '+target.id);
    touched.push(target.id);await call('/admin/products/'+target.id,'PUT',selected(target));
  }
  const after=await snapshot();
  assert.deepEqual(after.config,before.config,'配置不应改变');
  for(const r of resources.filter(r=>!['products','config'].includes(r)))assert.deepEqual(byId(after[r]),byId(before[r]),r+' 不应改变');
  assert.deepEqual(after.payouts,before.payouts,'兑现数据不应改变');
  const expected=before.products.map(p=>{const update=desired.find(d=>d.id===p.id);return update?{...p,...selected(update)}:p;});
  assert.deepEqual(byId(after.products),byId(expected),'六个指定套餐字段以外的商品数据不应改变');
  fs.writeFileSync(catalogueFile,fs.readFileSync('vip-catalogue.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(catalogueFile)),nextCatalogue);
  const report={success:true,checkedAt:new Date().toISOString(),version:after.config.version,products:preview.products,oldOrdersPreserved:after.orders.length,appointmentsPreserved:after.appointments.length,usersPreserved:after.users.length,payoutRecordsPreserved:after.payouts.payouts.length,otherProductsPreserved:true,allSettingsUnchanged:true,historyAndBalancesUnchanged:true,backupBytes:fs.statSync('before-database.sql').size,catalogueSha256:hash(fs.readFileSync(catalogueFile))};
  save('result.json',report);fs.writeFileSync('applied.ok',report.checkedAt);console.log('六档 VIP 套餐已更新；历史订单、预约、会员、收益和设置均保持不变。');
})().catch(async e=>{
  const error=e.stack||String(e),rollback=[];
  // 仅恢复本次写入的套餐字段；不触碰订单或任何其他业务记录。
  for(const id of touched.reverse())try{await call('/admin/products/'+id,'PUT',selected(before.products.find(p=>p.id===id)));rollback.push({id,restored:true});}catch(re){rollback.push({id,restored:false,error:re.stack||String(re)});}
  if(touched.length&&originalCatalogue)try{fs.writeFileSync(catalogueFile,originalCatalogue);}catch(re){rollback.push({file:catalogueFile,restored:false,error:re.stack||String(re)});}
  save('error.json',{success:false,error,rollback});console.error(error);process.exitCode=1;
});
