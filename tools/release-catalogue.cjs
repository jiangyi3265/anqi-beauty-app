// One-time reversible catalogue publication. Run only from a protected release directory.
const fs=require('node:fs');
const crypto=require('node:crypto');
const mysql=require('/opt/anqi/business/node_modules/mysql2/promise');
const release=__dirname;
const rollback=process.argv.includes('--rollback');
(async()=>{
 const vars={};for(const line of fs.readFileSync('/opt/anqi/shared/business.env','utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m)vars[m[1]]=m[2].replace(/^['"]|['"]$/g,'')}
 const c=await mysql.createConnection({host:'127.0.0.1',port:Number(vars.DB_PORT),user:vars.DB_USER,password:vars.DB_PASSWORD,database:vars.DB_NAME});
 try{
 await c.beginTransaction();await c.query('SELECT id FROM anqi_lock WHERE id=1 FOR UPDATE');
 const [rows]=await c.query('SELECT id,payload FROM anqi_products');
 const old=rows.map(r=>JSON.parse(r.payload));
 const product=JSON.parse(fs.readFileSync(release+'/product.json','utf8'));
 if(!rollback){
  if(fs.existsSync(release+'/products-before.json'))throw Error('Backup exists; refusing repeated deployment');
  fs.writeFileSync(release+'/products-before.json',JSON.stringify(old,null,2),{mode:0o600});
  if(old.some(p=>p.id===product.id))throw Error('Test product ID already exists');
  for(const p of old)await c.query('DELETE FROM anqi_products WHERE id=?',[p.id]);
  await c.query('INSERT INTO anqi_products (id,payload) VALUES (?,?)',[product.id,JSON.stringify(product)]);
 }else{
  const before=JSON.parse(fs.readFileSync(release+'/products-before.json','utf8'));
  for(const p of before){const current=old.find(b=>b.id===p.id);if(current){current.enabled=p.enabled;await c.query('UPDATE anqi_products SET payload=? WHERE id=?',[JSON.stringify(current),p.id])}else await c.query('INSERT INTO anqi_products (id,payload) VALUES (?,?)',[p.id,JSON.stringify(p)])}
  const testProduct=old.find(p=>p.id===product.id);if(testProduct){testProduct.enabled=false;await c.query('UPDATE anqi_products SET payload=? WHERE id=?',[JSON.stringify(testProduct),testProduct.id])}
 }
 const audit={id:crypto.randomUUID(),actor:'authorized-release-20260926',resource:'products',target:product.id,method:rollback?'ROLLBACK':'PUBLISH',createdAt:new Date().toISOString()};
 await c.query('INSERT INTO anqi_audit (id,payload) VALUES (?,?)',[audit.id,JSON.stringify(audit)]);
 await c.commit();
 const [counts]=await c.query('SELECT COUNT(*) AS total, SUM(JSON_EXTRACT(payload,\'$.enabled\')=true) AS enabled FROM anqi_products');
 console.log(JSON.stringify({action:rollback?'rollback':'publish',productCounts:counts[0],oldTestProductsDeleted:rollback?0:old.length,ordersDeleted:0,usersDeleted:0}));
 }catch(e){await c.rollback();throw e}finally{await c.end()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
