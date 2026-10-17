// 解析《桥梁标高与地质数据》markdown，合并进 bridges.json
// 用法：node scripts/parse-elevations.mjs <markdown路径> <bridges.json路径>
import { readFileSync, writeFileSync } from 'node:fs'

const mdPath = process.argv[2]
const jsonPath = process.argv[3]

const lines = readFileSync(mdPath, 'utf8').split(/\r?\n/)

// 区段定位
const sections = {}
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('## ')) sections[lines[i].slice(3).trim()] = i
}

function parseRows(startIdx, endIdx) {
  const rows = []
  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i]
    if (!line.startsWith('|')) continue
    const c = line.split('|').map((s) => s.trim())
    if (!c.slice(1).join('')) continue // 空行
    if (c[1].startsWith('---')) continue
    if (c[1] === '桥梁名称' || c[1] === '项目' || c[1].includes('汇总表') || c[1].includes('参数表')) continue
    rows.push(c)
  }
  return rows
}

const sideOf = (name) => (name.includes('左幅') ? 'left' : 'right')
const baseOf = (name) => name.replace(/(左幅|右幅).*$/, '')

// ===== 1. 墩台标高 =====
const elev = new Map() // `${base}|${side}` -> [{no, top, ground, pileBottom}]
let cur = ''
for (const c of parseRows(sections['墩台标高汇总'] ?? 0, sections['地质岩层数据'] ?? lines.length)) {
  if (c[1]) cur = c[1]
  const m = String(c[2] || '').match(/^(\d+)/)
  if (!m || !cur) continue
  const key = `${baseOf(cur)}|${sideOf(cur)}`
  if (!elev.has(key)) elev.set(key, [])
  elev.get(key).push({
    no: parseInt(m[1], 10),
    top: parseFloat(c[4]) || null,
    ground: parseFloat(c[5]) || null,
    pileBottom: parseFloat(c[6]) || null,
    pierH: parseFloat(c[7]) || null
  })
}

// ===== 2. 地质岩层 =====
const geo = new Map() // key -> { no -> [layers] }
cur = ''
for (const c of parseRows(sections['地质岩层数据'] ?? 0, sections['桥梁基本信息'] ?? lines.length)) {
  if (c[1]) cur = c[1]
  const m = String(c[2] || '').match(/^(\d+)/)
  if (!m || !cur) continue
  const key = `${baseOf(cur)}|${sideOf(cur)}`
  const no = parseInt(m[1], 10)
  if (!geo.has(key)) geo.set(key, new Map())
  const byNo = geo.get(key)
  if (!byNo.has(no)) byNo.set(no, [])
  byNo.get(no).push({
    name: c[4] || '',
    top: parseFloat(c[5]) || null,
    bottom: parseFloat(c[6]) || null,
    fak: parseFloat(c[7]) || null
  })
}

// ===== 3. 基本信息（纵坡）=====
const grades = {}
for (const c of parseRows(sections['桥梁基本信息'] ?? 0, lines.length)) {
  if (c[1] === '纵坡') {
    const names = ['卢福1号大桥', '卢福2号大桥', '中新大桥', '中兴大桥']
    names.forEach((n, i) => {
      const nums = [...String(c[2 + i] || '').matchAll(/(\d+\.?\d*)\s*%/g)].map((x) => parseFloat(x[1]))
      if (nums.length >= 2) grades[n] = { left: -nums[0] / 100, right: -nums[1] / 100 }
      else if (nums.length === 1) grades[n] = { left: -nums[0] / 100, right: -nums[0] / 100 }
    })
    break
  }
}

// ===== 合并 =====
const data = JSON.parse(readFileSync(jsonPath, 'utf8'))
for (const b of data.bridges) {
  if (grades[b.name]) {
    b.meta = b.meta || {}
    b.meta.right = { ...(b.meta.right || {}), grade: grades[b.name].right }
    b.meta.left = { ...(b.meta.left || {}), grade: grades[b.name].left }
  }
  for (const side of ['left', 'right']) {
    const key = `${b.name}|${side}`
    const eMap = new Map((elev.get(key) || []).map((x) => [x.no, x]))
    const gMap = geo.get(key)
    for (const e of b[side] || []) {
      const ev = eMap.get(e.no)
      if (ev) {
        e.topElev = ev.top
        e.groundElev = ev.ground
        e.pileBottom = ev.pileBottom
        if (ev.pierH != null) e.pierH = ev.pierH
      }
      if (gMap && gMap.has(e.no)) {
        e.geo = gMap.get(e.no).filter((l) => l.top != null && l.bottom != null)
      }
    }
  }
}
writeFileSync(jsonPath, JSON.stringify(data, null, 2))

console.log('已合并标高与地质数据')
for (const b of data.bridges) {
  const all = [...b.left, ...b.right]
  const withElev = all.filter((e) => e.topElev != null).length
  const withGeo = all.filter((e) => e.geo && e.geo.length).length
  console.log(`  ${b.name}: 标高 ${withElev} 处 / 地质柱状 ${withGeo} 个墩 / 纵坡 左${grades[b.name]?.left ?? '?'} 右${grades[b.name]?.right ?? '?'}`)
}
