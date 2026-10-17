// OCR 识别渲染后的图纸 PNG，全文保存到 tmp/ocr/
// 用法：node scripts/ocr-pages.mjs <页码列表，逗号分隔>
import { createWorker } from 'tesseract.js'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pages = process.argv[2].split(',').map(Number)
mkdirSync(resolve(root, 'tmp/ocr'), { recursive: true })

const worker = await createWorker('chi_sim', 1, {
  langPath: root, // 项目根目录下有 chi_sim.traineddata
  logger: (m) => {
    if (m.status === 'recognizing text' && m.progress % 0.25 < 0.02) console.log(`  OCR ${(m.progress * 100).toFixed(0)}%`)
  }
})

for (const p of pages) {
  const file = resolve(root, `tmp/imgs/page-${String(p).padStart(3, '0')}.png`)
  if (!existsSync(file)) {
    console.log(`第 ${p} 页图片不存在，跳过`)
    continue
  }
  try {
    const { data } = await worker.recognize(file)
    writeFileSync(resolve(root, `tmp/ocr/p${p}.txt`), data.text)
    console.log(`第 ${p} 页 OCR 完成，${data.text.length} 字符 → tmp/ocr/p${p}.txt`)
  } catch (e) {
    console.log(`第 ${p} 页 OCR 失败: ${e.message}`)
  }
}
await worker.terminate()
