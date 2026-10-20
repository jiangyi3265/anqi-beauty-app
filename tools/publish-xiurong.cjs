const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {cataloguePlan}=require('./xiurong-catalogue.cjs');
const dir=__dirname;
const base=`http://127.0.0.1:${process.env.PORT||8097}/api`;
async function api(route,method='GET',body){const r=await fetch(base+route,{method,headers:{'content-type':'application/json','x-anqi-internal':process.env.INTERNAL_SECRET,'x-anqi-actor':'authorized-xiurong-20261019'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(method+' '+route+': '+JSON.stringify(d));return d;}
const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+'\n',{mode:0o600});
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name)));
(async()=>{
 if(fs.existsSync(path.join(dir,'catalogue-result.json')))throw Error('Catalogue already published; refusing repeat.');
 if(fs.existsSync(path.join(dir,'before-catalogue.json'))&&!process.argv.includes('--resume'))throw Error('Previous attempt exists: inspect journal, then explicitly --resume.');
 const before=fs.existsSync(path.join(dir,'before-catalogue.json'))?read('before-catalogue.json'):{products:await api('/admin/products'),stores:await api('/admin/stores'),rules:await api('/admin/incomeRules'),claims:await api('/admin/claims')};
 if(!fs.existsSync(path.join(dir,'before-catalogue.json')))save('before-catalogue.json',before);
 const media=fs.existsSync(path.join(dir,'media.json'))?read('media.json'):{};
 for(const name of fs.readdirSync(path.join(dir,'media')).filter(n=>/\.(jpg|png)$/.test(n)&&n!=='gold-ai-reference.jpg')){
  if(media[name])continue;const bytes=fs.readFileSync(path.join(dir,'media',name));
  const asset=await api('/admin/upload','POST',{name:'xiurong-20261019-'+name,data:'data:image/'+(name.endsWith('.png')?'png':'jpeg')+';base64,'+bytes.toString('base64')});
  media[name]=asset.url;save('media.json',media);
 }
 const plan=fs.existsSync(path.join(dir,'plan.json'))?read('plan.json'):cataloguePlan(before.products,await api('/admin/categories'),media);save('plan.json',plan);
 const journal=fs.existsSync(path.join(dir,'journal.json'))?read('journal.json'):[];
 for(let i=0;i<plan.mutations.length;i++){
  const key='product-'+i;if(journal.some(x=>x.key===key))continue;
  const m=plan.mutations[i];const current=m.id?null:(await api('/admin/products')).find(p=>p.code===m.code);
  const id=m.id||current?.id;
  // Unknown POST outcome is recovered by the unique product code, without resetting stock.
  if(current){journal.push({key,id:current.id,recovered:true});save('journal.json',journal);continue;}
  const result=await api('/admin/products'+(id?'/'+id:''),id?'PUT':'POST',m.patch);journal.push({key,id:result.id,created:!id});save('journal.json',journal);
 }
 for(let i=0;i<plan.stores.length;i++){
  const key='store-'+i;if(journal.some(x=>x.key===key))continue;
  const s=plan.stores[i],current=(await api('/admin/stores')).find(x=>x.name===s.name);
  if(current && !before.stores.some(x=>x.id===current.id)){journal.push({key,id:current.id,recovered:true});save('journal.json',journal);continue;}
  assert.ok(!current,'New store unexpectedly exists');const result=await api('/admin/stores','POST',s);journal.push({key,id:result.id,created:true});save('journal.json',journal);
 }
 const after={products:await api('/admin/products'),stores:await api('/admin/stores'),rules:await api('/admin/incomeRules'),claims:await api('/admin/claims')};save('after-catalogue.json',after);
 const pub=await api('/bootstrap'),vip=pub.products.filter(p=>p.gift),trials=pub.products.filter(p=>p.trial);
 assert.equal(vip.length,10);assert.ok(vip.every(p=>p.trialOnly&&p.price===0));
 assert.deepEqual(vip.map(p=>p.referencePrice),[598,598,598,598,980,3980,6980,3980,6980,6980]);
 assert.equal(trials.length,3);
 for(const p of before.products.filter(p=>p.trial)){const next=trials.find(n=>n.id===p.id);for(const field of ['name','price','referencePrice','subtitle','trial','trialOnly'])assert.deepEqual(next[field],p[field]);}
 for(const old of before.products)assert.ok(after.products.some(p=>p.id===old.id),'Product record lost');
 for(const old of before.stores)assert.deepEqual(after.stores.find(s=>s.id===old.id),old);
 for(const old of before.claims)assert.deepEqual(after.claims.find(c=>c.id===old.id),old);
 // Live summary totals may move during normal trading; immutable settings must not change.
 for(const key of ['referral','pool'])if(before.rules[key]!==undefined)assert.deepEqual(after.rules[key],before.rules[key]);
 const categoryId=(await api('/admin/categories')).find(c=>c.name==='特色项目').id;const featured=pub.products.filter(p=>p.home&&p.categoryId===categoryId&&!p.trialOnly);assert.equal(featured.length,5);
 const result={ok:true,version:'1.1.27',publishedAt:new Date().toISOString(),productsBefore:before.products.length,productsAfter:after.products.length,vipChoices:vip.map(p=>({id:p.id,name:p.name,value:p.referencePrice})),trialPreserved:true,featured:featured.map(p=>({id:p.id,name:p.name,skus:p.skus})),stores:after.stores.map(s=>({id:s.id,name:s.name,address:s.address,phone:s.phone,galleryCount:s.gallery?.length||0})),oldClaimsPreserved:true,rulesUnchanged:JSON.stringify(before.rules)===JSON.stringify(after.rules)};
 save('catalogue-result.json',result);console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
