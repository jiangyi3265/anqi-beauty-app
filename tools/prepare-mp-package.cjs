const fs=require('fs'),path=require('path'),Jimp=require('jimp');
const source=path.resolve(process.argv[2]||'dist/build/mp-weixin');
if(!fs.existsSync(path.join(source,'project.config.json')))throw new Error('找不到小程序编译目录：'+source);
const root=fs.mkdtempSync(path.resolve('dist/mp-weixin-ready-'));
// Business catalogue media is served by the API; package only the active UI.
const keep=new Set(['static/assets/avatar.png']);
function walk(p,out=[]){for(const e of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,e.name);if(e.isDirectory())walk(q,out);else out.push(q)}return out}
for(const file of walk(source)){
 const rel=path.relative(source,file).replace(/\\/g,'/');
 if(rel.endsWith('.tmp')||rel.startsWith('static/')&&!keep.has(rel)&&!rel.startsWith('static/xiurong/'))continue;
 const target=path.join(root,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);
}
(async()=>{for(const f of walk(path.join(root,'static'))){if(!/\.(jpg|jpeg|png)$/i.test(f))continue;const st=fs.statSync(f);if(st.size<40000)continue;const im=await Jimp.read(f);const max=f.endsWith('devices.png')?1440:f.includes('xiurong')?1080:450;if(im.bitmap.width>max)im.scaleToFit(max,2000,Jimp.RESIZE_BILINEAR);if(/\.(jpg|jpeg)$/i.test(f))im.quality(80);else{im.deflateLevel(9).deflateStrategy(3).filterType(-1)}await im.writeAsync(f);}
const total=walk(root).reduce((s,f)=>s+fs.statSync(f).size,0);if(total>2*1024*1024)throw new Error('小程序主包超过2MB，请压缩素材后再上传');console.log(JSON.stringify({uploadDirectory:root,kept:walk(path.join(root,'static')).length,totalBytes:total,totalMB:(total/1048576).toFixed(2)}));})().catch(e=>{console.error(e);process.exitCode=1});

// Catch SFC registrations hidden behind script decorators before upload. H5
// resolves them at runtime, but WeChat requires a static usingComponents map.
const nativeTags=new Set(['scroll-view','swiper-item','rich-text','movable-area','movable-view','cover-view','cover-image','page-meta','navigation-bar','match-media','web-view','open-data','official-account','live-player','live-pusher','camera','ad-custom','functional-page-navigator','checkbox-group','radio-group','picker-view','picker-view-column']);
for(const file of walk(root).filter(file=>file.endsWith('.wxml'))){
 const configFile=file.replace(/\.wxml$/,'.json');const registered=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')).usingComponents||{}:{};
 const tags=[...fs.readFileSync(file,'utf8').matchAll(/<([a-z][a-z0-9-]*)\b/g)].map(row=>row[1]);
 for(const tag of new Set(tags.filter(tag=>tag.includes('-')&&!nativeTags.has(tag))))if(!registered[tag])throw Error(path.relative(root,file)+': unregistered native component '+tag);
 for(const target of Object.values(registered)){if(target.startsWith('plugin://'))continue;const local=target.startsWith('/')?path.join(root,target):path.resolve(path.dirname(file),target);if(!fs.existsSync(local+'.json'))throw Error('Missing component '+target+' in '+file)}
}
