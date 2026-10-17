import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import path from 'node:path'
process.env.UNI_INPUT_DIR = path.resolve(process.cwd())
export default defineConfig({ plugins: [uni()], server: { port: 5173 }, build: { sourcemap: false } })
