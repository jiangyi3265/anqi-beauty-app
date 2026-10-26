# 业务接口说明

签到、积分明细、积分商品及兑换接口已启用；VIP 积分池和分佣规则尚未启用。

正式用户接口：`https://anqiht.okam.top/api`（`https://anqi.okam.top/api` 同样代理到业务接口）；若依管理接口：`https://anqiht.okam.top/prod-api/anqi/:collection`。正式管理认证使用若依 `/prod-api/login` 与角色权限，公网不开放旧 `/api/admin/*`。以下旧管理路径仅供本地演示或内部业务服务参考。

登录接口：`POST /auth/wechat`（微信小程序 `wx.login` code，由服务端换取 openid；当前只支持微信一键登录）；后台 `POST /anqi/orders/:id`（线下收款、取消、物流说明）、`POST /anqi/users/:id`（会员资格与停用状态）。预约核销完成会同步将服务订单标记完成。

根地址 `http://127.0.0.1:3016/api`。JSON 请求和响应；失败返回 HTTP 400/401/403/404/503 与 `{ "error": "说明" }`。用户和管理员令牌放在 `Authorization: Bearer <token>`，管理员令牌不能用于用户数据接口。

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | /health | 服务状态/演示模式 |
| GET | /bootstrap | 页面配置、上架商品、门店 |
| POST | /auth/wechat | 微信小程序一键登录，body `{code,invite?}`；带邀请码时返回 `inviteStatus` |
| POST | /invite/bind | 已登录会员首次绑定推荐人，body `{invite}`；已有推荐关系不覆盖，历史订单不追溯推荐奖励 |
| POST | /auth/refresh | 刷新当前微信会话 |
| POST | /auth/logout | 退出并使当前会话失效 |
| GET/PUT | /me | 当前用户；更新name、gender |
| GET/POST | /addresses | 地址列表/创建 |
| PUT/DELETE | /addresses/:id | 修改/删除本人地址 |
| GET/POST | /orders | 本人订单/创建订单 |
| GET | /orders/:id | 本人订单详情 |
| POST | /orders/:id/cancel | 取消待付款订单并回补库存 |
| POST | /orders/:id/pay | 测试环境模拟支付；body outcome=success/failure/cancel，必须带 Idempotency-Key |
| GET/POST | /appointments | 本人预约/新增预约 |
| GET | /activities、/alliances | 已上架的活动和联盟 |
| GET/POST | /claims | 本人领取记录及项目使用状态/领取礼品；body `{type,productIds}` |
| POST | /sign | 北京时间每天一次签到，原子增加积分及明细 |
| GET | /ledger | 当前用户积分明细 |
| GET | /rewards | 已上架积分商品 |
| GET/POST | /redemptions | 当前用户兑换记录/兑换商品，body `{rewardId}` |
| GET | /shares、/earnings | 本人已绑定的邀请会员及收益列表 |
| POST | /admin/login | 管理登录；password |
| GET | /admin/dashboard | 经营统计 |
| GET/PUT | /admin/config | 首页海报、协议、会员规则 |
| POST | /admin/upload | data为PNG/JPEG/WebP Data URL，最大5MB |
| GET/POST | /admin/:collection | 内容列表/新增 |
| PUT/DELETE | /admin/:collection/:id | 内容更新/删除 |
| PUT | /admin/orders/:id | 将已付订单核销completed |
| PUT | /admin/appointments/:id | booked/completed/cancelled |
| PUT | /admin/users/:id | invited布尔值，维护领取资格 |

内容 collection：products、categories、stores、activities、alliances、rewards、homeModules。只读管理列表还包括 orders、appointments、users、claims、paymentAudits（支付审计）。

创建订单示例：

```json
{"productId":"p1","quantity":1,"spec":"single","storeId":"store-1","message":"预约前请电话联系"}
```

spec取single/course；服务器读取实时商品价格，忽略客户端金额。实物订单还需本人addressId。订单保存下单时商品、服务门店（`store`）和收货地址快照，库存不足会拒绝。待付订单满2小时在下一次API请求中自动关闭并回补库存。

创建地址：name、phone（11位手机号）、city、detail、isDefault。默认地址对当前用户唯一。

创建预约：orderId、date（YYYY-MM-DD）、time（09/10/11/14/15/16/17/18:00）；当前一个已付款服务订单只允许一个有效预约，服务门店固定为订单的 `storeId`。

体验卡预约无需购买或支付：登录会员用 `type: "trial"` 和 `productIds` 领取配置数量的体验项目（默认三项，每位会员限领取一次）；贵宾卡使用 `type: "vip"`，仍需受邀资格。仅体验卡项目不会作为商城商品售卖。默认体验项目为 9D变脸术、AI大师、超玛吉，均为单部位；`subtitle` 保存体验范围，`referencePrice` 保存展示价值（分别999、6980、6980），与实际领取价格 `price: 0` 分开。项目封面及详情使用对应原始海报。

领取后用 `claimId`、`productId`、`storeId`、`date`、`time` 创建预约。体验卡须显式指定营业中门店的 `storeId`。预约保存对应门店的 `store` 快照（名称、地址、联系人、电话和营业时间），页面按相同 ID 读取当前信息，门店停用或删除后使用本记录的快照，不能改用其他门店。每个服务项目单独预约，预约取消后可以重约，已完成项目不能再次使用。`GET /claims` 中每个项目的 `useStatus` 为 `available`、`booked` 或 `completed`，`bookingId` 关联预约记录；实物礼品请到店领取。

本地隔离回归：`node tools/trial-booking-acceptance.cjs`，覆盖旧目录补齐、领取数量、免支付预约、名额限制、取消重约、完成核销及库存持久化；同时检查逐店配置地址、各店独立预约名额、订单门店一致，以及停用或删除门店后的历史信息保留。

安全与部署边界：演示只监听回环地址；后台密码限速；资源按userId校验所有权；库存和订单状态在单进程中同步更新并原子替换数据文件。MySQL 模式使用 InnoDB 事务和 `anqi_lock` 行锁，失败整体回滚；2026-10-14 已在隔离 MySQL 库回归。正式支付回调、分佣规则和跨进程登录限流仍未接入。

新增：POST /me/avatar 接收图片Data URL，DELETE /me/avatar恢复默认头像；GET /share-code生成当前会员分享码图片。本地演示二维码与正式微信小程序码分开处理。




预约时间以北京时间计算，必须晚于当前时刻；后台可配置不重复的24小时制 `HH:MM` 时段。当天已过时段在前端隐藏，服务端再次校验。`signPoints`、`maxGifts`、`appointmentCapacity` 均为1至10000的整数。图片配置允许空值，客户端使用默认资源；删除图片时检查页面配置、历史订单和领取记录等引用。

六档 VIP 套餐的选择、逐次核销及售后规则详见 [VIP 套餐部署说明](VIP套餐部署说明.md)。普通服务订单每单一个有效预约；套餐按 `entitlementId` 独立计次。
