// 桩基台账解析：从 xlsx 工作簿提取（灌注混凝土日期 → 桥/墩/桩/部位）记录
// 供 vite 开发中间件（vite.config.js）与「更新台账」脚本（update-ledger.mjs）共用
import XLSX from 'xlsx'

export function parseLedger(wb) {
  const all = []
  let lastHeaders = []
  // 遍历全部工作表（统计表日期常为空、资料表才有实际日期），合并后按记录去重
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
    const parsed = parseSheet(rows, name)
    if (parsed.length && parsed.headers) lastHeaders = parsed.headers
    all.push(...parsed)
  }
  const seen = new Set()
  const records = all.filter((r) => {
    const k = `${r.bridge}|${r.pier}|${r.pileNo}|${r.date}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return { records, count: records.length, sheets: wb.SheetNames, headers: lastHeaders }
}

function parseSheet(rows, name) {
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
  if (col.date < 0) return []

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
  records.headers = headers
  return records
}

function normalizeDate(s) {
  s = String(s).trim()
  let m
  // 2024-05-06 / 2024/5/6 / 2024年5月6日 / 2024.5.6
  m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
  if (m) return fmt(m[1], m[2], m[3])
  // 9/23/26 / 9-23-26 / 9/23/2026（台账常见的两位年份格式）
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/)
  if (m) return fmt(m[3].length === 2 ? '20' + m[3] : m[3], m[1], m[2])
  return null
}

function fmt(y, mo, d) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
