import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
// HBuilderX runs from its compiler directory; resolve the project from this config.
process.env.UNI_INPUT_DIR = __dirname
// 使用微信开发者工具控制台，避免注入需要本地 WebSocket 的日志回显。
if (process.env.UNI_PLATFORM === 'mp-weixin') {
  delete process.env.UNI_SOCKET_HOSTS
}
export default defineConfig({ plugins: [uni()], server: { port: 5173 }, build: { sourcemap: false } })
