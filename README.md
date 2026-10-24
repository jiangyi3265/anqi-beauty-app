# anqi-beauty-app

暨美丽美容门店的微信小程序 / H5 用户端，同时包含为三端提供业务能力的 Node.js 服务。

## 项目简介

用户可以浏览商品与门店、领取体验卡、购买 VIP 套餐、按可用时段预约、查看订单与剩余权益，并使用签到积分、邀请二维码及收益明细功能。

- 商品与套餐：商品分类、规格、库存、六档 VIP 套餐各一套方案，按 2026-10-24 确认方案更新；订单保存套餐权益快照，支持按项目预约和核销。
- 体验卡与门店：支持后台配置体验卡的可选项目、任选数量和使用次数，以及领取资格、门店独立地址、预约容量及员工班次校验。
- 会员中心：微信登录、个人资料、收货地址、订单、分享邀请、积分与收益分类账本。
- `server/`：Node.js HTTP 业务接口，覆盖库存、订单、预约、核销、员工排班、可配置静态/动态收益、退款冲回及数据迁移；支持 MySQL 事务存储和本地 JSON 存储。

**三端分工：** 本仓库承载用户界面与核心业务服务；Java 仓库负责管理员登录、权限和业务代理；Vue 管理后台负责运营配置。微信支付与回调校验已实现，开发环境默认 `PAYMENT_MODE=off`；收益兑现支持线下登记，不会自动转账。

换电脑继续开发，请先阅读 [换电脑开发与部署交接](docs/换电脑开发与部署交接.md)。当前代码版本为 1.1.38，六档套餐另于 2026-10-24 更新；1.1.37 已撤销，不能作为发布基线。

## 技术栈

| 层次 | 实际使用 |
| --- | --- |
| 用户界面 | Vue 3.4、UniApp 3、JavaScript、Sass、vue-i18n |
| 构建 | Vite 5、DCloud Vite 插件、npm 锁文件 |
| 平台 | H5、微信小程序（现有 npm 脚本覆盖这两种产物） |
| 业务服务 | Node.js 原生 HTTP / crypto / fs、mysql2、MySQL、qrcode |
| 图片打包 | Jimp，小程序资源裁剪与压缩 |

## 关联仓库

| 项目 | 说明 | GitHub |
| --- | --- | --- |
| anqi-beauty-backend | 后端服务 | [anqi-beauty-backend](https://github.com/jiangyi3265/anqi-beauty-backend) |
| anqi-beauty-admin | 管理后台 | [anqi-beauty-admin](https://github.com/jiangyi3265/anqi-beauty-admin) |
| anqi-beauty-app | 用户端 | [anqi-beauty-app](https://github.com/jiangyi3265/anqi-beauty-app) |

## 快速启动

建议 Node.js 24 LTS 和 npm。在本仓库根目录执行：

```bash
npm ci
cp .env.example .env
```

编辑本地 `.env`：

- `ADMIN_PASSWORD`：设置独立随机值，非演示模式下为空会拒绝启动。
- `INTERNAL_SECRET`：与 Java 的 `ANQI_INTERNAL_SECRET` 保持一致，用于管理后台联调。
- 保持 `HOST=127.0.0.1`、`PORT=3016`、`NODE_ENV=development` 和 `PAYMENT_MODE=off`。
- `DB_NAME` 留空时写入本地 `server/data/db.json`；需要 MySQL 时先创建空库，再填写 `DB_NAME`、`DB_USER`、`DB_PASSWORD`、`DB_PORT`。当前连接主机为 `127.0.0.1`，业务表由服务初始化。
- 示例中的 `VITE_API_BASE` 指向本地业务接口，`CORS_ORIGINS` 已列出两个前端的本地开发地址。

两个终端分别运行：

```bash
npm run server
```

```bash
npm run dev:h5
```

访问 `http://127.0.0.1:5173`，健康接口为 `http://127.0.0.1:3016/api/health`。仅浏览商品不需要微信凭据；真实微信登录需要在服务端配置 `WECHAT_APPID`、`WECHAT_APPSECRET`，且与 `manifest.json` 的小程序 AppID 对应。密钥不能写入 `VITE_*`。

微信小程序开发与构建：

```bash
npm run dev:mp-weixin
npm run build:h5
npm run build:mp-weixin
```

开发者工具导入 `dist/dev/mp-weixin` 或 `dist/build/mp-weixin`。H5 正式产物在 `dist/build/h5`。真机联调和发布前，将 `VITE_API_BASE` 改为自己的 HTTPS 接口地址并配置微信合法域名；真机不能访问开发电脑的 `127.0.0.1`。编译、上传开发版本、设为体验版是独立步骤。

### 隔离验证

以下现有脚本使用独立测试数据，不需要写入正式数据库：

```bash
node tools/trial-booking-acceptance.cjs
node tools/vip-package-acceptance.cjs
node tools/staff-scheduling-acceptance.cjs
node tools/income-acceptance.cjs
node tools/integrity-acceptance.cjs
node tools/run-wechat-regressions.cjs
```

验收输出保存在被忽略的 `verification/`。部分历史浏览器检查、SSH 运维脚本另需对应工具运行环境，未列入应用的启动依赖。历史部署脚本面向特定服务器布局，部署前需按自己的环境核对配置。

## 项目结构

```text
pages/             首页、商城、会员、预约、订单、收益等页面
components/        共享界面组件
custom-tab-bar/     小程序自定义底部导航
common/            API、资源处理及体验卡/VIP 套餐目录
server/            业务 API、存储、登录、排班、收益及迁移
static/            页面图标和商品/品牌静态资源
source-assets/     商品素材源文件
manifest.json      平台配置
pages.json         页面路由
tools/            编译包装、小程序压缩、验收与运维脚本
docs/             接口、协作、套餐、后台和业务使用说明
```

详细说明见 [协作开发](docs/协作开发.md)、[API](docs/API.md)、[员工排班](docs/员工排班使用说明.md)、[收益配置](docs/收益配置使用说明.md)。

## 配置与数据

`.env`、上传文件、运行数据库、密钥、构建产物和本地验收记录不纳入 Git；仓库保留无密钥的 `.env.example`、初始化商品目录和业务源代码。不要将运行数据库或生产配置复制到源码目录提交。推送 GitHub 不会自动更新服务器或微信版本。

## 简历描述示例

参与美容门店 UniApp 小程序与 H5 用户端开发，实现体验卡领取、VIP 套餐权益、门店预约和会员中心，并通过 Node.js / MySQL 构建订单、员工排班及可配置收益账本等业务能力。

## 依赖检查状态

构建和业务回归已通过，第三方依赖仍有待升级的安全告警，详情见 [依赖复查记录](docs/DEPENDENCY_REVIEW.md)。
