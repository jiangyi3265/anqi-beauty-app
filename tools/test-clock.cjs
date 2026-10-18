// 仅供验收测试预加载：按 ANQI_TEST_CLOCK_OFFSET_MS 平移 Date.now()，模拟周期结算前后的时间。
const offset = Number(process.env.ANQI_TEST_CLOCK_OFFSET_MS || 0);
if (offset) { const realNow = Date.now; Date.now = () => realNow() + offset; }
