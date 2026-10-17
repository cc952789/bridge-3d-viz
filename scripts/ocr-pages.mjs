// OCR 识别渲染后的图纸 PNG
// 用法：node scripts/ocr-pages.mjs <起始页> <结束页>
import { createWorker } from 'tesseract.js'

const [startP, endP] = process.argv.slice(2).map(Number)
const worker = await createWorker('chi_sim', 1, { logger: (m) => { if (m.status === 'recognizing text' && m.progress % 0.5 < 0.02) console.log(`  OCR 进度 ${(m.progress * 100).toFixed(0)}%`) } })

for (let p = startP; p <= endP; p++) {
  const file = `tmp/pdf-images/page-${String(p).padStart(2, '0')}.png`
  try {
    const { data } = await worker.recognize(file)
    const text = data.text.replace(/\s+/g, ' ').trim()
    console.log(`\n===== 第 ${p} 页 OCR =====`)
    console.log(text.slice(0, 900))
  } catch (e) {
    console.log(`第 ${p} 页 OCR 失败: ${e.message}`)
  }
}
await worker.terminate()
