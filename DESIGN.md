# 秀荣科技美肤 design system

The user approved the blush, ivory and ink XIURONG design boards on 2026-10-20. This direction replaces the previous green and purple interface. The brand is **秀荣科技美肤**, using 荣, not 容.

## Reference

Approved board index: `/Users/jiangyi/.codex/generated_images/01a14f3b-1c5c-7383-bba6-7bd64a8a0648/xiurong-ui-design-board-index-v2.json`. Nine boards cover 48 screen states across the existing 26 routes. The boards use example data; production content and eligibility always come from the business API.

## Scene and palette

Customers use a phone one-handed in bright shops and warmly lit treatment rooms. Light surfaces and dark readable controls support this. Foundation #FCF9F6, blush #F4DDD8, muted rose #BC817B, ink #24201F, secondary #827775, rule #EADFD9. Use compatible hex fallbacks in WXSS. Do not restore green/purple gradients.

## Type and layout

- Native PingFang/system sans for actions, labels, data and prose. Chinese Song-style serif is limited to editorial brand headlines.
- Phone content gutters 20px equivalent, 8px rhythm, panel corners 14px, buttons 12px with at least 44px touch height.
- Bottom tabs only on 首页、商城、发现、我的. All other screens use back navigation and a contextual action bar.
- Blush silk, an arched treatment room and bounded product photos are reusable assets. Live text and real interactive controls must never be flattened into screenshots.
- Loading, empty, offline, disabled, eligibility, booked and completed states are explicit. Failed requests must not display success or authoritative zero balances.

## Implementation

`common/xiurong.css` owns global tokens and layout. `BrandMark`, `UiIcon`, `ProductVisual` and `EmptyState` provide reusable presentation. Known equipment uses the approved four-column studio sprite, while other catalogue images continue to use backend media. Avatar, phone, address, order and income values remain live data. Never import the boards' example customers, products or earnings into the real database.

1.1.30 沿用本设计：展示组件的图片与文案从后台读取。仪器图保留为显式 studio 选项，运营上传图使用 image 选项；布局、色彩、字号和圆角不变。发布 Banner 使用原首页主图区域。
