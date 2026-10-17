// 首屏离线兜底数据：服务暂时不可达时保留完整页面骨架，不显示错误遮罩。
import trialCatalogue from './trial-catalogue.json'
export const fallbackCatalogue = {
  config: {
    name: '暨美丽', version: '1.1.12', maxGifts: 3,
    appointmentTimes: '09:00,10:00,11:00,14:00,15:00,16:00,17:00,18:00',
    shortcutTrialLabel: '体验卡', shortcutVipLabel: '贵宾卡', shortcutShareLabel: '邀请码',
    homeImage: '/static/brand/hero-middle.jpg', heroTop: '/static/brand/hero-top-jimeili-v2.jpg', heroBottom: '/static/brand/hero-bottom-v2.jpg',
    storeDefaultImage: '/static/brand/store-cover-jimeili-v2.jpg', brandLogo: '/static/brand/logo-jimeili.png', projectPromo: '/static/assets/service-heading.jpg', storePromo: '/static/brand/store-cover-jimeili-v2.jpg', customerQr: '',
    serviceHeading: '/static/assets/service-heading.jpg', productHeading: '/static/assets/product-heading.jpg', brand: '/static/brand/brand-jimeili.png',
    pointsBanner: '/static/assets/points-banner.jpg', signPoints: 100, pointsRules: '每日可签到一次，签到获得100积分。'
  },
  categories: [{ id: 'category-featured', name: '特色项目', sort: 1, enabled: true }, { id: 'category-goods', name: '优选单品', sort: 2, enabled: true }],
  stores: [{ id: 'store-1', name: '暨美丽', contact: '庞敬敬', phone: '13140131984', address: '晋安路集英花园北门吕庄一组集资楼3号楼第4套', hours: '09:00—20:00', image: '/static/brand/store-cover-jimeili-v2.jpg', enabled: true }],
  products: [
    { id: 'jimeili-collagen-type-iii', name: '暨美丽胶原蛋水光（三型胶原蛋白）', image: '/static/brand/product-recombinant-collagen.jpg', detailImage: '/static/brand/product-recombinant-collagen.jpg', price: 498, coursePrice: 1980, kind: 'service', stock: 100, sold: 0, home: true, recommended: true, sort: 1, gift: true, trial: false, enabled: true, status: 'published', description: '单瓶：498元/瓶；十瓶疗程：1980元。促进胶原蛋白再生，修护老化肌肤。' },
    { id: 'jimeili-rejuvenation-set', name: '逆龄肽奢护焕颜套', image: '/static/brand/product-rejuvenation-set-generated.png', detailImage: '/static/brand/284c27d5c43001f0f7f0ba76dcd24623.jpg', price: 1980, kind: 'service', stock: 100, sold: 0, home: true, recommended: true, sort: 7, gift: true, trial: false, enabled: true, status: 'published', description: '多肽精粹焕颜护理套装，包含焕颜精华液与多肽精华液。' },
    // 体验项目的品牌图由在线接口提供，离线时使用包内占位图。
    ...trialCatalogue.map(product => ({ ...product, image: '/static/assets/product-placeholder.jpg', detailImage: '/static/assets/product-placeholder.jpg' }))
  ],
  homeModules: [], activities: [], alliances: []
}

