// 提取 PDF 指定页中的嵌入图片（用于扫描/图片版图纸页）
// 用法：node scripts/extract-pdf-images.mjs <pdf路径> <起始页> <结束页> <输出目录>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const [pdfPath, startPage, endPage, outDir] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

const data = new Uint8Array(readFileSync(pdfPath))
const doc = await pdfjs.getDocument({ data }).promise

for (let p = parseInt(startPage, 10); p <= parseInt(endPage, 10); p++) {
  const page = await doc.getPage(p)
  const ops = await page.getOperatorList()
  let imgCount = 0
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i]
    if (op !== pdfjs.OPS.paintImageXObject) continue
    const arg = ops.argsArray[i]
    const objId = arg && arg[0]
    if (objId == null) continue
    try {
      const img = page.objs.get(objId)
      if (!img) continue
      if (img.kind === 1) {
        // RGBA 原始数据，转换为 PNG 较复杂，先跳过并记录
        console.log(`第 ${p} 页 图片${imgCount}: RGBA ${img.width}x${img.height}（跳过）`)
      } else {
        const bytes = Buffer.from(img.data)
        const outFile = resolve(outDir, `page-${p}-img-${imgCount}.png`)
        writeFileSync(outFile, bytes)
        console.log(`第 ${p} 页 图片${imgCount}: ${img.width}x${img.height} -> ${outFile} (${bytes.length} 字节)`)
      }
      imgCount++
    } catch (e) {
      console.log(`第 ${p} 页 图片提取失败: ${e.message}`)
    }
  }
  if (imgCount === 0) console.log(`第 ${p} 页: 无嵌入图片（可能为矢量图）`)
  page.cleanup()
}
