const trialCatalogue = require('../common/trial-catalogue.json');
module.exports = () => ({
  config: { name: '暨美丽', version: '1.0.9', appointmentCapacity: 1, appointmentTimes: '09:00,10:00,11:00,14:00,15:00,16:00,17:00,18:00', shortcutTrialLabel: '体验卡', shortcutVipLabel: '贵宾卡', shortcutShareLabel: '邀请码', maxGifts: 3, homeImage: '/static/brand/hero-middle.jpg', heroTop: '/static/brand/hero-top-jimeili-v2.jpg', heroBottom: '/static/brand/hero-bottom-v2.jpg', storeDefaultImage: '/static/brand/store-cover-jimeili-v2.jpg', brandLogo: '/static/brand/logo-jimeili.png', hero: '/static/brand/jimeili-1-steamed-face.jpg', welcome: '/static/assets/service-heading.jpg', brand: '/static/brand/brand-jimeili.png', projectPromo: '/static/assets/service-heading.jpg', storePromo: '/static/brand/store-cover-jimeili-v2.jpg', customerQr: '', serviceHeading: '/static/assets/service-heading.jpg', productHeading: '/static/assets/product-heading.jpg', agreement: '本协议说明您使用暨美丽小程序时的服务规则。您在注册、登录、下单、预约、兑换或领取礼品前，请核对商品、价格、库存、门店、数量和联系方式。您应遵守法律法规及平台规则，不得从事违法、欺诈、骚扰或损害他人权益的行为。订单、预约、礼品和售后以小程序及后台实时记录为准。如有疑问，请通过客服或门店渠道咨询。经营方会在法律允许范围内调整服务规则，并在小程序内公布调整内容。', privacy: '本隐私政策说明暨美丽在提供微信登录、商品购买、门店预约、订单履约、礼品领取和客服服务时的信息处理方式。我们仅在实现相应功能所必需的范围内处理微信身份标识、昵称头像、联系方式、收货地址、订单、预约和设备运行信息，不会向前端展示微信密钥或会话密钥。您可以通过个人中心、客服或门店渠道咨询、更正或删除相关信息。政策发生重大变化时，我们会在小程序内提示。正式上线前请经营方根据实际主体和业务完成审核。', subscriptionEnabled: true, messageReminderEnabled: true, marketingEnabled: true },
  categories: [{ id: 'category-featured', name: '特色项目', sort: 1, enabled: true }, { id: 'category-goods', name: '优选单品', sort: 2, enabled: true }],
  stores: [{ id: 'store-1', name: '暨美丽', contact: '庞敬敬', phone: '13140131984', address: '晋安路集英花园北门吕庄一组集资楼3号楼第4套', image: '/static/brand/store-cover-jimeili-v2.jpg', hours: '09:00—20:00', enabled: true }],
  products: [
  {
    "id": "jimeili-rejuvenation-set",
    "sort": 7,
    "categoryId": "category-goods",
    "name": "逆龄肽奢护焕颜套",
    "image": "/static/brand/product-rejuvenation-set-generated.png",
    "detailImage": "/static/brand/jimeili-product-info.jpg",
    "price": 1980,
    "coursePrice": 2980,
    "kind": "service",
    "stock": 100,
    "sold": 0,
    "home": true,
    "gift": false,
    "trial": false,
    "enabled": true,
    "description": "多肽精粹焕颜护理套装，包含焕颜精华液与多肽精华液，深层滋养、紧致焕亮。具体适用方案与到店服务安排请咨询门店。"
  },
  {
    "id": "jimeili-collagen-salmon",
    "categoryId": "category-featured",
    "name": "暨美丽胶原蛋水光（三文鱼）",
    "image": "/static/brand/product-salmon-aquatic.jpg",
    "detailImage": "/static/brand/product-salmon-aquatic.jpg",
    "price": 398,
    "coursePrice": 2980,
    "kind": "service",
    "stock": 100,
    "sold": 0,
    "home": true,
    "gift": false,
    "trial": false,
    "enabled": true,
    "description": "单次：398元/次；疗程：2980元/10次。补水嫩肤、抗氧提亮、紧致修护。"
  },
  {
    "id": "jimeili-collagen-vitamin-c",
    "categoryId": "category-featured",
    "name": "暨美丽胶原蛋水光（VC）",
    "image": "/static/brand/product-vitamin-c.jpg",
    "detailImage": "/static/brand/product-vitamin-c.jpg",
    "price": 398,
    "coursePrice": 2980,
    "kind": "service",
    "stock": 100,
    "sold": 0,
    "home": true,
    "gift": false,
    "trial": false,
    "enabled": true,
    "description": "单次：398元/次；疗程：2980元/10次。美白提亮、改善肤色、抗氧修护。"
  },
  {
    "id": "jimeili-collagen-composite",
    "categoryId": "category-featured",
    "name": "暨美丽胶原蛋水光（复合性）",
    "image": "/static/brand/product-composite-aqueous.jpg",
    "detailImage": "/static/brand/product-composite-aqueous.jpg",
    "price": 398,
    "coursePrice": 2980,
    "kind": "service",
    "stock": 100,
    "sold": 0,
    "home": true,
    "gift": false,
    "trial": false,
    "enabled": true,
    "description": "单次：398元/次；疗程：2980元/10次。补水嫩肤、抗氧提亮、紧致修护。"
  },
  {
    "id": "jimeili-collagen-type-iii",
    "categoryId": "category-featured",
    "name": "暨美丽胶原蛋水光（三型胶原蛋白）",
    "image": "/static/brand/product-recombinant-collagen.jpg",
    "detailImage": "/static/brand/product-recombinant-collagen.jpg",
    "price": 498,
    "coursePrice": 1980,
    "kind": "service",
    "stock": 100,
    "sold": 0,
    "home": true,
    "gift": false,
    "trial": false,
    "enabled": true,
    "description": "单瓶：498元/瓶；十瓶疗程：1980元。促进胶原蛋白再生，修护老化肌肤。"
  },
  {
    "id": "jimeili-ai-light-restart",
    "categoryId": "category-featured",
    "name": "暨美丽AI光屿重启",
    "image": "/static/brand/product-ai-light-restart-v2.jpg",
    "detailImage": "/static/brand/product-ai-light-info.jpg",
    "price": 3980,
    "coursePrice": 6980,
    "kind": "service",
    "stock": 100,
    "sold": 0,
    "home": true,
    "gift": false,
    "trial": false,
    "enabled": true,
    "description": "单部位：3980元/次；单部位疗程：6980元/3次；全脸：16800元/3次。具体方案到店咨询。"
  },
  ...trialCatalogue.map(product => ({ ...product }))
],
  incomeRules: [], incomePlans: [], poolSettlements: [], staff: [], shifts: [], homeModules: [], assets: [], inventory: [], activities: [], alliances: [], users: [], orders: [], appointments: [], addresses: [], claims: [], shares: [], earnings: [], paymentAudits: [], rewards: [], ledger: [], redemptions: []
})










