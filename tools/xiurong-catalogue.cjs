// Explicit publication plan, never run as a bootstrap migration.
function cataloguePlan(products, categories, media) {
  const categoryId = categories.find(c => c.name === '特色项目')?.id;
  if (!categoryId) throw Error('特色项目分类不存在');
  const image = name => { if (!media[name]) throw Error('图片未上传: '+name); return media[name]; };
  const placeholder='/static/assets/product-placeholder.jpg';
  const base={kind:'service',categoryId,enabled:true,status:'published',price:0,stock:1000,sold:0,home:false,recommended:false,trial:false,gift:false,trialOnly:false,skus:[],packagePlans:[]};
  const existing = id => { const p=products.find(p=>p.id===id); if(!p)throw Error('原商品不存在: '+id);return p; };
  const mutations=[];
  for(const p of products)if(p.gift || (p.home && p.categoryId===categoryId && !p.trialOnly))mutations.push({id:p.id,patch:{...(p.gift?{gift:false}:{}),...(p.home&&p.categoryId===categoryId&&!p.trialOnly?{home:false,recommended:false}:{})}});
  const sku=(id,name,price,serviceSessions,stock=1000)=>({id,name,price,serviceSessions,stock,enabled:true});
  const paid=(id,code,name,asset,sort,skus,description,extra={})=>{
    const old=id?existing(id):null;
    const cover=image(asset);
    if(old)skus[0].stock=old.stock;
    const patch={...(!old?base:{}),code,name,subtitle:skus[0].name,categoryId,image:cover,detailImage:cover,gallery:[],coursePrice:null,memberPrice:null,price:skus[0].price,skus,home:true,recommended:true,sort,description,...extra};
    mutations.push({...(id?{id}:{}),code,patch});
  };
  paid(null,'XIURONG-9D-EYE','9D变眼术','9d-face.jpg',10,[sku('9d-eye-single','单次',3980,1),sku('9d-eye-course','疗程 · 10次',12800,10)],'单次3980元；疗程12800元，共10次。购买后选择门店和时间预约。');
  paid('3eeaa4b1-19dc-42a2-adbf-b4a6f8a4e679','XIURONG-9D-FACE','9D变脸术','9d-face.jpg',20,[sku('9d-face-single','单次',9800,1),sku('9d-face-course','疗程 · 10次',39800,10)],'单次9800元；疗程39800元，共10次。体验卡、贵宾卡项目的展示价值不作为本商品下单价。',{gallery:[image('9d-info.jpg')]});
  paid(null,'XIURONG-GOLD-AI','10D金钻AI大师','gold-ai-master.jpg',30,[sku('gold-ai-part','单部位 · 1次',6980,1)],'单部位6980元/次。全脸方案19800—39800元/次，具体方案与价格请联系门店确认；当前在线规格仅为单部位。',{subtitle:'全脸方案 19800—39800元/次，请联系门店确认'});
  paid('b83752e9-b64f-43d7-9539-8bf8dd26aa7d','XIURONG-SUPER-THERMAGE','超玛吉','super-thermage.jpg',40,[sku('thermage-part','单部位 · 1次',6980,1),sku('thermage-face','全脸 · 1次',29800,1)],'单部位6980元/次；全脸29800元/次。购买后预约到店使用。');
  const light=existing('jimeili-ai-light-restart');
  media['light-existing']=light.image;
  paid(light.id,'XIURONG-LIGHT','光屿重启','light-existing',50,[sku('light-part','单部位 · 1次',3980,1),sku('light-face','全脸 · 1次',6980,1),sku('light-course','疗程 · 3次',13800,3)],'单部位3980元/次；全脸6980元/次；疗程13800元，共3次。',{gallery:light.gallery||[],detailImage:light.detailImage||light.image});
  const black=existing('2504b7af-3dbb-4780-b50c-600204a1314e');
  mutations.push({id:black.id,patch:{name:'黑金AI大师',subtitle:'单部位',image:image('black-gold-ai-master.jpg'),detailImage:image('black-gold-ai-master.jpg'),gallery:[],home:false,recommended:false,categoryId,sort:60}});
  const choices=[
    ['n-eye','N迪迈（眼）','眼部',598,null],['n-face','N迪迈（面）','面部',598,null],
    ['jibai','玑白（面）','面部',598,'jibai.jpg'],['white','超透白（面）','面部',598,null],
    ['9d-eye','9D变眼术','单次',980,'9d-face.jpg'],['9d-face','9D变脸术','单次',3980,'9d-face.jpg'],
    ['10d','10D童颜女神（面）','面部',6980,'gold-ai-master.jpg'],['light','光屿重启','单部位',3980,'light-existing'],
    ['ai','AI大师','单部位 · 黑金AI大师',6980,'black-gold-ai-master.jpg'],['thermage','超玛吉','单部位',6980,'super-thermage.jpg']
  ];
  choices.forEach(([key,name,subtitle,referencePrice,asset],i)=>{
    const cover=asset?image(asset):placeholder;
    mutations.push({code:'XIURONG-VIP-'+key,patch:{...base,code:'XIURONG-VIP-'+key,name,subtitle,referencePrice,gift:true,trialOnly:true,sort:200+i,image:cover,detailImage:cover,description:'贵宾卡十选三项目。领取后可预约到店使用一次，所示金额为项目展示价值，领取无需支付。'}});
  });
  for(const [id,asset] of [['69b6dac2-7ba3-4e92-a008-09056c7019f9','9d-face.jpg'],['6fdfb407-ab3f-47b1-8c8c-b9e3c9b2586b','black-gold-ai-master.jpg'],['29525620-e803-44b9-98f9-b0b7369f4744','super-thermage.jpg']]){
    existing(id);mutations.push({id,patch:{image:image(asset),detailImage:image(asset),gallery:[]}});
  }
  const stores=[
    {name:'秀容美容·建业店',address:'商丘市南京路星林路交叉口建业桂园小区27# 商铺',phone:'18639035033',contact:'秀容美容',image:image('storefront-render.png'),imageCaption:'秀容门店效果图',gallery:[],enabled:true,schedulingEnabled:false,appointmentDurationMinutes:60},
    {name:'秀容美容·和谐店',address:'虞城县木兰大道和谐北大花园南门商铺',phone:'18639035033',contact:'秀容美容',image:image('hexie-store-poster.jpg'),gallery:Array.from({length:11},(_,i)=>image('interior-'+String(i+1).padStart(2,'0')+'.jpg')),enabled:true,schedulingEnabled:false,appointmentDurationMinutes:60}
  ];
  return {mutations,stores};
}
module.exports={cataloguePlan};
