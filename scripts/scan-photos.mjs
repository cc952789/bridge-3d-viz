// 扫描 photos/ 目录，按文件名约定生成施工影像清单 public/data/photos.json
// 命名约定：{桥名}_{左幅|右幅}_{桩号或墩号}_{序号}.{jpg|png|webp}
// 例：卢福2号大桥_左幅_5a-0_1.jpg → 键「卢福2号大桥|左|5a-0」
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const photoDir = resolve(root, 'photos')
if (!existsSync(photoDir)) {
  console.log('无 photos 目录，跳过影像清单')
  process.exit(0)
}

const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const files = readdirSync(photoDir).filter((f) => EXTS.has(extname(f).toLowerCase()))
if (!files.length) {
  console.log('photos 目录为空，跳过影像清单')
  process.exit(0)
}

const photos = {}
for (const f of files.sort()) {
  const m = f.match(/^(.+?)_(左幅|右幅)_(.+?)_(\d+)\.(jpg|jpeg|png|webp)$/i)
  if (!m) {
    console.log('⚠ 跳过无法识别的文件名：', f)
    continue
  }
  const side = m[2] === '右幅' ? '右' : '左'
  const no = m[3].replace(/#/g, '').replace(/号墩$/, '')
  const key = `${m[1]}|${side}|${no}`
  ;(photos[key] = photos[key] || []).push(`photos/${encodeURIComponent(f)}`)
}

const out = { ok: true, updatedAt: new Date().toISOString(), count: files.length, photos }
mkdirSync(resolve(root, 'public/data'), { recursive: true })
writeFileSync(resolve(root, 'public/data/photos.json'), JSON.stringify(out))
console.log(`✓ 施工影像清单已生成：${files.length} 张，关联 ${Object.keys(photos).length} 个构件`)
