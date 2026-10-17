// 桩基台账解析：从 xlsx 工作簿提取（灌注混凝土日期 → 桥/墩/桩/部位）记录
// 供 vite 开发中间件（vite.config.js）与「更新台账」脚本（update-ledger.mjs）共用
import * as XLSX from 'xlsx'

export function parseLedger(wb) {
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
