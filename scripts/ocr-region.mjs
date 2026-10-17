// 定位关键词所在区域并输出 TSV（找表格标题/表头的像素位置）
// 用法：node scripts/ocr-region.mjs <png> <关键词>
import { createWorker } from 'tesseract.js'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [png, kw] = process.argv.slice(2)

const worker = await createWorker('chi_sim', 1, { langPath: root })
const { data } = await worker.recognize(resolve(root, png), {}, { text: true, blocks: false, hocr: false, tsv: true })
// TSV: level page_num block_num par_num line_num word_num left top width height conf text
for (const line of (data.tsv || '').split('\n').slice(1)) {
  const c = line.split('\t')
  if (c.length < 12) continue
  const text = c[11]
  if (text && text.includes(kw)) {
    console.log(`"${text}" 位于 (${c[6]}, ${c[7]}) 尺寸 ${c[8]}×${c[9]} 置信度 ${c[10]}`)
  }
}
await worker.terminate()
