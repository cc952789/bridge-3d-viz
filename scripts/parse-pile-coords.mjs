// 从 OCR 文本提取桩位坐标表 → 逐桩 (X, Y) → 投影到桥轴 → 写入 bridges.json 的逐桩偏移
// 表结构（每页 1~4 个块）：
//   位置 | 0 | X1 Y1 X2 Y2 ...（第 0 列桩，每墩 1~2 根）
//   位置 | 1 | X1 Y1 X2 Y2 ...（第 1 列桩，每墩 1~2 根）
// 行 0 = a 列（4 桩墩含 a-0/a-1 两根），行 1 = b 列；两桩墩每行 1 根（0/1 号）
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bridges = JSON.parse(readFileSync(resolve(root, 'src/data/bridges.json'), 'utf-8')).bridges

const SIDES = [
  { bridge: '卢福1号大桥', side: 'left', pages: ['hi-45', 'hi-46'] },
  { bridge: '卢福1号大桥', side: 'right', pages: ['hi-55'] },
  { bridge: '卢福2号大桥', side: 'left', pages: ['hi-141'] },
  { bridge: '卢福2号大桥', side: 'right', pages: ['hi-147'] },
  { bridge: '中兴大桥', side: 'left', pages: ['hi-20', 'hi-21', 'hi-22', 'hi-23'] },
  { bridge: '中兴大桥', side: 'right', pages: ['hi-34', 'hi-35', 'hi-36', 'hi-37'] },
  { bridge: '中新大桥', side: 'left', pages: ['p16-clean'] },
  { bridge: '中新大桥', side: 'right', pages: ['p24-clean'] }
]

// 从 OCR 文本中提取行 0 / 行 1 的 (X, Y) 坐标对序列
function extractRows(text) {
  const rows = { 0: [], 1: [] }
  let expectRow = 0 // 行号乱码/缺失时按 0/1 交替推断（每块两行）
  for (const line of text.split('\n')) {
    let rest = null
    let label = null
    // 优先匹配带闭合管道的标签行：`| 0 | X Y`、`| 1 工 | X Y`、`| | X Y`
    const pm = line.match(/^\s*[|｜]\s*([^|｜]{0,8}?)\s*[|｜]\s*(.*)$/)
    if (pm) {
      label = pm[1].trim()
      rest = pm[2]
    } else {
      // 无闭合管道：`0 X Y`、`| 1 X Y`、`| X Y`（行号缺失）
      const nm = line.match(/^\s*[|｜]?\s*([01I工])?\s*[|｜]?\s*/)
      if (!nm || nm[0].length === 0) continue
      label = nm[1] || ''
      rest = line.slice(nm[0].length)
    }
    // 排除「中心桩号」行（标签含 中心/桩/柱/号 字样）
    if (/中心|桩|柱|号/.test(label)) continue
    // 坐标值：整数 6~7 位 + 小数 2~4 位；小数点可能被 OCR 识别为逗号/空格或丢失
    const nums = [...rest.matchAll(/(\d{6,7})\s*[.,]?\s*(\d{2,4})/g)].map((x) => parseFloat(x[1] + '.' + x[2]))
    if (nums.length < 4) continue // 坐标行至少 2 对 (X, Y)
    // 只信任明确的单字符行号；乱码（如「国生」「.1」）按交替状态推断
    const clean = label.replace(/\s/g, '')
    let rowIdx
    if (clean === '1' || clean === 'I' || clean === '工') rowIdx = 1
    else if (clean === '0') rowIdx = 0
    else rowIdx = expectRow
    expectRow = rowIdx === 0 ? 1 : 0
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const [a, b] = [nums[i], nums[i + 1]]
      if (a > 4700000 && b > 470000 && a < 4900000 && b < 490000) rows[rowIdx].push([a, b])
    }
  }
  return rows
}

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])

// 把一行内的坐标按墩聚类：相邻两点距离 < 12m 视为同墩（横向/纵向对），否则下一墩
function clusterByPier(points) {
  const groups = []
  let cur = null
  for (const p of points) {
    if (!cur || dist(cur[cur.length - 1], p) >= 12) {
      cur = [p]
      groups.push(cur)
    } else cur.push(p)
  }
  return groups
}

const result = []
for (const cfg of SIDES) {
  const rows = { 0: [], 1: [] }
  for (const f of cfg.pages) {
    const file = resolve(root, `tmp/ocr2/${f}.txt`)
    let text
    try { text = readFileSync(file, 'utf-8') } catch (e) { console.warn(`⚠ 缺 OCR 文本 ${f}`); continue }
    console.log(`  DEBUG ${f}: ${text.length} 字, 首行:`, JSON.stringify(text.split('\n')[0].slice(0, 40)))
    const r = extractRows(text)
    rows[0].push(...r[0])
    rows[1].push(...r[1])
  }
  const g0 = clusterByPier(rows[0])
  const g1 = clusterByPier(rows[1])
  console.log(`\n== ${cfg.bridge} ${cfg.side === 'left' ? '左幅' : '右幅'} ==`)
  console.log(`  行0: ${rows[0].length} 根 → ${g0.length} 墩；行1: ${rows[1].length} 根 → ${g1.length} 墩`)
  result.push({ ...cfg, rows, g0, g1 })
}

// 预期墩数与实测对比
for (const r of result) {
  const b = bridges.find((x) => x.name === r.bridge)
  const expect = (b[r.side] || []).length
  console.log(`${r.bridge} ${r.side}: 聚类 ${r.g0.length}/${r.g1.length} 墩，预期 ${expect} 墩`)
}

// 输出原始提取结果（先保存，供下一步投影与写入）
writeFileSync(resolve(root, 'tmp/pile-coords-raw.json'), JSON.stringify(result, null, 2))
console.log('\n原始坐标已保存 → tmp/pile-coords-raw.json')
