// 解析桥梁统计表（markdown，含数量列）→ 结构化 JSON
// 用法：node scripts/parse-bridges.mjs <markdown路径> <输出json路径>
import { readFileSync, writeFileSync } from 'node:fs'

const mdPath = process.argv[2]
const outPath = process.argv[3]

// 桥型布置图提取的桥级参数（跨径/纵坡/平面线形/桥面宽）
const BRIDGE_META = {
  卢福1号大桥: {
    span: 20,
    deckWidth: 11.5,
    upper: '预应力砼小箱梁（先简支后连续）',
    right: { curve: 4950, grade: 0, spans: '30×20m' },
    left: { curve: 4950, straight: 346, grade: 0, spans: '9联：4×20×8+3×20' }
  },
  卢福2号大桥: {
    span: 30,
    deckWidth: 11.5,
    upper: '预应力砼小箱梁（先简支后连续）',
    right: { curve: 0, grade: -0.028, spans: '3×30+3×30+4×30+3×30' },
    left: { curve: 4950, grade: -0.028, spans: '4×30+4×30+3×30' }
  },
  中新大桥: {
    station: 'K5+110（右）/ K5+124（左）',
    grade: -0.025,
    deckWidth: 11.5,
    upper: '预应力砼小箱梁（先简支后连续）',
    right: { curve: 4000, spans: '3×30+4×30+3×30' },
    left: { curve: 2940, spans: '4×30+4×30+3×30' }
  },
  中兴大桥: {
    station: 'K3+210（右）/ K3+220（左）',
    grade: -0.02,
    deckWidth: 11.5,
    upper: '预应力砼小箱梁（先简支后连续）',
    right: { curve: 0, spans: '3×30+4×30+4×30+4×30+4×30+3×30+3×30' },
    left: { curve: 0, spans: '4×30×6' }
  }
}

const lines = readFileSync(mdPath, 'utf8').split(/\r?\n/)

const rows = []
for (const line of lines) {
  if (!line.startsWith('|')) continue
  const c = line.split('|').map((s) => s.trim())
  const name = c[1]
  if (!name || name === '桥梁名称' || name === '汇总') continue
  if (c[2] === '' || Number.isNaN(parseInt(c[2], 10))) continue
  rows.push(c)
}

const bridges = {}
for (const c of rows) {
  const name = c[1]
  const no = parseInt(c[2], 10)
  const side = name.endsWith('Y') ? 'right' : 'left'
  const base = name.replace(/[YZ]$/, '')
  if (!bridges[base]) bridges[base] = { name: base, right: [], left: [] }

  const qty = (v) => {
    const n = parseInt(v, 10)
    return Number.isNaN(n) ? 0 : n
  }

  const entry = {
    no,
    colDia: c[4] || '',
    height: parseFloat(c[7]) || 0,
    pileDia: c[8] || '',
    pileLen: parseInt(c[9], 10) || 0,
    groundTie: c[10] || '',
    groundTieQty: qty(c[11]),
    midTie: c[12] || '',
    midTieQty: qty(c[13]),
    capBeam: c[14] || '',
    capBeamQty: qty(c[15]),
    cap: c[16] || '',
    capQty: qty(c[17]),
    rib: c[18] || '',
    ribQty: qty(c[19]),
    abutCap: c[20] || '',
    abutCapQty: qty(c[21]),
    backWall: c[22] || '',
    backWallQty: qty(c[23])
  }
  bridges[base][side].push(entry)
}

for (const b of Object.values(bridges)) {
  b.right.sort((a, b2) => a.no - b2.no)
  b.left.sort((a, b2) => a.no - b2.no)
  if (BRIDGE_META[b.name]) b.meta = BRIDGE_META[b.name]
}

const out = { bridges: Object.values(bridges) }
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`已解析 ${Object.keys(bridges).length} 座桥 -> ${outPath}`)
for (const b of out.bridges) {
  console.log(`  ${b.name}: 右幅 ${b.right.length} 墩 / 左幅 ${b.left.length} 墩`)
}
