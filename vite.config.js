import { defineConfig } from 'vite'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'

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

function parseLedger(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })

  // 找表头行（前 10 行中非空单元格最多的行）
  let headerIdx = 0
  let best = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const nonEmpty = (rows[i] || []).filter((c) => String(c).trim() !== '').length
    if (nonEmpty > best) {
      best = nonEmpty
      headerIdx = i
    }
  }
  const headers = (rows[headerIdx] || []).map((h) => String(h).trim())

  // 自动识别关键列
  const findCol = (pred) => headers.findIndex((h) => pred(h))
  let dateCol = findCol((h) => h.includes('灌注'))
  if (dateCol < 0) dateCol = findCol((h) => h.includes('日期'))
  const col = {
    date: dateCol,
    bridge: findCol((h) => h.includes('桥')),
    pier: findCol((h) => h.includes('墩') && !h.includes('高') && !h.includes('顶')),
    pileNo: findCol((h) => h.includes('桩')),
    type: findCol((h) => h.includes('部位') || h.includes('类型'))
  }

  const records = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const dateStr = col.date >= 0 ? String(r[col.date] || '').trim() : ''
    if (!dateStr) continue
    const date = normalizeDate(dateStr)
    if (!date) continue
    records.push({
      bridge: col.bridge >= 0 ? String(r[col.bridge] || '').trim() : '',
      pier: col.pier >= 0 ? String(r[col.pier] || '').trim() : '',
      pileNo: col.pileNo >= 0 ? String(r[col.pileNo] || '').trim() : '',
      type: col.type >= 0 ? String(r[col.type] || '').trim() : '',
      date
    })
  }
  return { records, count: records.length, headers, columns: col }
}

function normalizeDate(s) {
  s = String(s).trim()
  // 2024-05-06 / 2024/5/6 / 2024年5月6日 / 2024.5.6
  let m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[0]
  return null
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
