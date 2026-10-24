// 标高数据修正：0号台台顶标高（桥面线锚点）按「地面高程 + 台高 + 台盖梁」校验
// 与图纸交叉验证：卢福2号左幅图纸 651.4 ≈ 反算 651.3（原数据 661.4 有 10m 错误）
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const data = JSON.parse(readFileSync(resolve(root, 'src/data/bridges.json'), 'utf-8'))

// 图纸确认的 0 台台顶标高（从桥型布置图 标高表 OCR 提取；无图纸值时用 null）
const DRAWING_ANCHORS = {
  '卢福2号大桥': { left: 651.4 } // p137 桥型布置图标高表
}

for (const b of data.bridges) {
  const meta = b.meta || {}
  for (const side of ['left', 'right']) {
    const list = b[side] || []
    if (!list.length) continue
    const a = list.find((e) => e.no === 0)
    if (!a) continue
    const sideMeta = meta[side] || {}
    let anchor = null
    if (DRAWING_ANCHORS[b.name] && DRAWING_ANCHORS[b.name][side] != null) {
      anchor = DRAWING_ANCHORS[b.name][side]
    } else if (a.topElev != null && a.groundElev != null && Math.abs(a.topElev - a.groundElev) <= 12) {
      anchor = a.topElev // 台顶与地面差距合理，直接采用
    } else if (a.groundElev != null && a.pierH != null) {
      anchor = Math.round((a.groundElev + a.pierH + 1.5) * 1000) / 1000 // 反算
    }
    if (anchor != null) {
      sideMeta.anchor = anchor
      meta[side] = sideMeta
      if (a.topElev != null && Math.abs(a.topElev - anchor) > 0.5) {
        console.log(`✎ ${b.name} ${side === 'left' ? '左' : '右'}幅 0台: ${a.topElev} → ${anchor}（修正 ${Math.round((anchor - a.topElev) * 100) / 100}m）`)
        a.topElev = anchor
      } else {
        console.log(`✓ ${b.name} ${side === 'left' ? '左' : '右'}幅 0台: ${a.topElev}（无需修正）`)
      }
    }
  }
}
writeFileSync(resolve(root, 'src/data/bridges.json'), JSON.stringify(data, null, 2))
console.log('完成')
