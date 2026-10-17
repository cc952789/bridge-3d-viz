// 渲染 PDF 指定页为 PNG（用于视觉检查 / OCR）
// 用法：node scripts/render-pages.mjs <pdf路径> <页码列表，逗号分隔> <输出目录> [scale=2.5]
import { pdf } from 'pdf-to-img'
import { writeFileSync, mkdirSync } from 'node:fs'
import { basename } from 'node:path'

const [pdfPath, pageList, outDir, scaleRaw] = process.argv.slice(2)
const scale = parseFloat(scaleRaw || '2.5')
mkdirSync(outDir, { recursive: true })
console.log(`渲染 ${basename(pdfPath)} 第 ${pageList} 页（scale=${scale}）…`)

const doc = await pdf(pdfPath, { scale })
for (const p of pageList.split(',').map(Number)) {
  try {
    const buf = await doc.getPage(p)
    const f = `${outDir}/page-${String(p).padStart(3, '0')}.png`
    writeFileSync(f, buf)
    console.log(`✓ 第 ${p} 页 → ${f}（${(buf.length / 1024 / 1024).toFixed(1)} MB）`)
  } catch (e) {
    console.log(`✗ 第 ${p} 页渲染失败: ${e.message}`)
  }
}
await doc.destroy?.()
