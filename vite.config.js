import { defineConfig } from 'vite'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { parseLedger } from './scripts/ledger-parser.mjs'

// 桩基台账接口：读取项目根目录的 pile-ledger.xlsx（从金山文档导出的台账），
// 自动识别"灌注混凝土日期"等列，供浏览器轮询获取真实完成时间。
// 每次请求都重新读文件，因此替换/更新文件后无需重启，浏览器 30 秒内自动同步。
function pileLedgerPlugin() {
  return {
    name: 'pile-ledger-api',
    configureServer(server) {
      server.middlewares.use('/api/pile-ledger', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          const candidates = [
            resolve(process.cwd(), 'pile-ledger.xlsx'),
            resolve(process.cwd(), 'data/pile-ledger.xlsx'),
            resolve(process.cwd(), 'public/pile-ledger.xlsx')
          ]
          const file = candidates.find((f) => existsSync(f))
          if (!file) {
            res.end(JSON.stringify({ ok: false, error: '未找到 pile-ledger.xlsx，请导出台账并放到项目根目录后刷新' }))
            return
          }
          const wb = XLSX.readFile(file)
          const parsed = parseLedger(wb)
          res.end(JSON.stringify({ ok: true, mtimeMs: statSync(file).mtimeMs, file, ...parsed }))
        } catch (e) {
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [pileLedgerPlugin()],
  base: './', // 相对路径，兼容任意子路径部署
  server: {
    host: true,
    port: 5173,
    open: false
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500
  }
})
