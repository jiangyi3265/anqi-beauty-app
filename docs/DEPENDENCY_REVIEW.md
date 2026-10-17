# 依赖复查记录

检查日期：2026-10-17。来源：当前锁文件的 `npm audit --json`，包含开发依赖。

## 已处理

修复兼容范围内的 Express / proxy-addr、ws、Babel、PostCSS、source-map-js 依赖，并将旧版 @intlify/core-base / message-resolver 的 9.1.9 分支升级至 9.1.11。保留 UniApp 插件当前声明的 Vite 5.2.8 peer 版本。

修复后重新执行 `npm ci` 与正式构建均通过。用户端还通过体验卡、套餐、排班、收益、数据一致性、微信登录与权限回归；三端使用隔离 MySQL / Redis 完成登录、菜单和业务代理联调。微信登录测试使用 mock，未执行真实支付或生产写入。

## 未清零的告警

| 严重程度 | 依赖节点数 |
| --- | --- |
| Critical | 0 |
| High | 22 |
| Moderate | 12 |
| Low | 0 |
| 合计 | 34 |

- UniApp 依赖链仍引入旧版 Vite/esbuild、Vue 服务端渲染组件、国际化组件、选择器解析器等；Jimp 的 file-type 和部分 glob 依赖也存在告警。
- 部分问题位于构建、开发服务器或 SSR 代码路径；不能据此认定正在被利用，也不能视为已经安全。Node 业务服务采用原生 HTTP，项目没有实现 SSR 页面服务，但相关包仍在依赖树中。
- 继续修复需要统一评估 UniApp / Vue / Vite 的配套版本与图片处理 API。不要使用 `npm audit fix --force` 自动降级 DCloud 包或绕过 peer 依赖检查。
- 开发服务器只绑定本机；生产部署使用静态构建产物和 Node 业务服务，不开放 Vite 开发服务器。

参考：[Vue I18n 原型污染公告](https://github.com/advisories/GHSA-p2ph-7g93-hw3m)、[Vite 开发服务器公告](https://github.com/advisories/GHSA-p9ff-h696-f583)。

## 复查命令

```bash
npm ci
npm audit --json
```

`npm audit` 当前会因剩余告警返回非零状态，不能把构建成功解释为安全审计已清零。此记录只覆盖上述检查，没有对 Java 全部第三方依赖执行漏洞扫描。推送本次改动不会自动部署服务器或上传微信小程序。
