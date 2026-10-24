// 把提取的桩位坐标投影到桥轴 → 逐桩 (s, d) 偏移 → 写入 bridges.json
// 表结构：行0 = a 列（4 桩墩含 a-0/a-1 两排）/ 0 号桩；行1 = b 列 / 1 号桩
// 校验不通过的墩保持默认网格布局（回退），保证模型不坏
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bridgesData = JSON.parse(readFileSync(resolve(root, 'src/data/bridges.json'), 'utf-8'))
const raw = JSON.parse(readFileSync(resolve(root, 'tmp/pile-coords-raw.json'), 'utf-8'))

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])
const norm = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l] }

// 每墩每行期望的桩数（1 或 2）
function expectedPattern(bridge, side) {
  const abut = (bridge.meta && bridge.meta.abutPiles) === 2 ? 1 : 2
  return (bridge[side] || []).map((e) => (e.height <= 0 ? abut : e.cap && e.cap !== '/' ? 2 : 1))
}

// 聚类：相邻点 < 12m 同墩
function cluster(points) {
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

const stats = []
for (const cfg of raw) {
  const bridge = bridgesData.bridges.find((x) => x.name === cfg.bridge)
  const side = cfg.side
  const list = bridge[side] || []
  const expect = expectedPattern(bridge, side)

  const g0 = cluster(cfg.rows[0])
  const g1 = cluster(cfg.rows[1])
  const sideName = side === 'left' ? '左幅' : '右幅'
  console.log(`\n== ${cfg.bridge} ${sideName}: 行0 ${cfg.rows[0].length}点/${g0.length}墩, 行1 ${cfg.rows[1].length}点/${g1.length}墩, 预期 ${list.length} 墩 ==`)

  // 按预期模式对齐：j = 墩序号, k0/k1 = 行聚类指针
  let j = 0, k0 = 0, k1 = 0
  let ok = 0, fallback = 0
  const result = []
  while (j < list.length && k0 < g0.length && k1 < g1.length) {
    const e = list[j]
    const eCount = expect[j]
    const c0 = g0[k0]
    const c1 = g1[k1]
    const countOK = c0.length === eCount && c1.length === eCount
    // 行内两点距离 2~8m 且两行质心距离 2~12m 视为可信
    const intraOK = (c) => c.length === 1 || (dist(c[0], c[1]) >= 2 && dist(c[0], c[1]) <= 9)
    const cross = dist([(c0[0][0] + c0[c0.length - 1][0]) / 2, (c0[0][1] + c0[c0.length - 1][1]) / 2],
      [(c1[0][0] + c1[c1.length - 1][0]) / 2, (c1[0][1] + c1[c1.length - 1][1]) / 2])
    const crossOK = c0.length === 1 || (cross >= 2 && cross <= 14)
    if (countOK && intraOK(c0) && intraOK(c1) && crossOK) {
      result.push({ no: e.no, c0, c1, eCount })
      ok++
      j++; k0++; k1++
    } else {
      // 数据异常：保守回退当前墩（丢弃该墩的点，避免对齐漂移）
      result.push({ no: e.no, fallback: true })
      fallback++
      j++
      k0++
      k1++
    }
  }
  // 剩余墩回退
  while (j < list.length) {
    result.push({ no: list[j].no, fallback: true })
    fallback++
    j++
  }

  // 计算墩中心与桥轴方向，投影逐桩
  const centers = result.map((r, idx) => {
    if (r.fallback) return null
    const pts = [...r.c0, ...r.c1]
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
  })
  const dirs = centers.map((c, idx) => {
    if (!c) return null
    const prev = centers.slice(0, idx).reverse().find((x) => x)
    const next = centers.slice(idx + 1).find((x) => x)
    if (prev && next) return norm([next[0] - prev[0], next[1] - prev[1]])
    if (next) return norm([next[0] - c[0], next[1] - c[1]])
    if (prev) return norm([c[0] - prev[0], c[1] - prev[1]])
    return null
  })

  // 墩中心间距校验：相邻墩中心距离应 ≈ 跨径（20/30m），偏差超 8m 视为对齐漂移 → 回退
  const span = bridge.meta ? bridge.meta.span || 30 : 30
  for (let i = 1; i < centers.length; i++) {
    const a = centers[i - 1]
    const b = centers[i]
    if (!a || !b) continue
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (Math.abs(d - span) > 8) {
      result[i].drift = true
      ok--
      fallback++
    }
  }

  const out = []
  for (let i = 0; i < result.length; i++) {
    const r = result[i]
    if (r.fallback || r.drift || !dirs[i]) {
      out.push({ no: r.no, fallback: true })
      continue
    }
    const u = dirs[i]
    const n = [-u[1], u[0]] // 法向
    const proj = (p) => {
      const v = [p[0] - centers[i][0], p[1] - centers[i][1]]
      return { s: v[0] * u[0] + v[1] * u[1], d: v[0] * n[0] + v[1] * n[1] }
    }
    const piles = []
    // 行0 = a 列（或 0 号桩）；行内按里程 s 排序 → 0/1
    const sortByS = (pts) => pts.map((p) => ({ ...proj(p) })).sort((a, b) => a.s - b.s)
    let sane = true
    const check = (x) => { if (Math.abs(x.s) > 8 || Math.abs(x.d) > 8) sane = false }
    if (r.eCount === 1) {
      const p0 = proj(r.c0[0])
      const p1 = proj(r.c1[0])
      check(p0)
      check(p1)
      piles.push({ label: '0', ...p0 })
      piles.push({ label: '1', ...p1 })
    } else {
      const col0 = sortByS(r.c0)
      const col1 = sortByS(r.c1)
      col0.forEach(check)
      col1.forEach(check)
      // 列 a/b 按法向位置分配：d 小的一列 = a（保持与台账 a/b 一致的相对约定）
      const d0 = (col0[0].d + col0[col0.length - 1].d) / 2
      const d1 = (col1[0].d + col1[col1.length - 1].d) / 2
      const [colA, colB] = d0 <= d1 ? [col0, col1] : [col1, col0]
      colA.forEach((x, k) => piles.push({ label: 'a' + k, s: x.s, d: x.d }))
      colB.forEach((x, k) => piles.push({ label: 'b' + k, s: x.s, d: x.d }))
    }
    if (!sane) {
      out.push({ no: r.no, fallback: true })
      ok--
      fallback++
    } else {
      out.push({ no: r.no, piles })
    }
  }
  stats.push({ bridge: cfg.bridge, side, out, ok, fallback })
}

// 写回 bridges.json：每个墩加 piles 字段（fallback 的墩不加）
// 先清空全部已有的 piles 字段，避免上次运行残留
for (const b of bridgesData.bridges) {
  for (const side of ['left', 'right']) {
    for (const e of b[side] || []) delete e.piles
  }
}
let updated = 0
for (const s of stats) {
  const bridge = bridgesData.bridges.find((x) => x.name === s.bridge)
  for (const o of s.out) {
    if (o.fallback) continue
    const e = bridge[s.side].find((x) => x.no === o.no)
    if (!e) continue
    e.piles = o.piles.map((p) => ({
      label: p.label,
      s: Math.round(p.s * 100) / 100,
      d: Math.round(p.d * 100) / 100
    }))
    updated++
  }
}
writeFileSync(resolve(root, 'src/data/bridges.json'), JSON.stringify(bridgesData, null, 2))
console.log(`\n写入完成：${updated} 个墩台更新了逐桩坐标`)
for (const s of stats) console.log(`  ${s.bridge} ${s.side === 'left' ? '左' : '右'}幅: ${s.ok} 墩更新, ${s.fallback} 墩回退默认`)
writeFileSync(resolve(root, 'tmp/pile-coords-applied.json'), JSON.stringify(stats, null, 2))
