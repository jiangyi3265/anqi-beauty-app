// 仅供验收测试预加载：按 ANQI_TEST_CLOCK_OFFSET_MS 平移 Date.now() 和 new Date()，模拟周期结算前后的时间。
// 两者一起平移，订单的创建/付款时间与服务时钟保持一致，不会被“超时未付款”误取消。
const offset = Number(process.env.ANQI_TEST_CLOCK_OFFSET_MS || 0);
if (offset) { const Real = Date; global.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset) } static now() { return Real.now() + offset } }; }
