// 提取指定 PDF 指定页的完整文本（带坐标排序），输出到 tmp/pages/ 下
// 用法：node scripts/dump-pages.mjs <pdf路径> <页码列表，逗号分隔>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')

const [pdfPath, pageList] = process.argv.slice(2)
mkdirSync('tmp/pages', { recursive: true })

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), isEvalSupported: false, useSystemFonts: true }).promise
const pages = pageList.split(',').map((s) => parseInt(s.trim(), 10))

for (const p of pages) {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  // 按纵向分组、横向排序，尽量还原版面
  const items = tc.items.map((it) => ({
    x: it.transform[4],
    y: it.transform[5],
    str: it.str
  }))
  items.sort((a, b) => Math.abs(a.y - b.y) < 4 ? a.x - b.x : b.y - a.y)
  const lines = []
  let cur = []
  let lastY = null
  for (const it of items) {
    if (lastY != null && Math.abs(it.y - lastY) > 4) {
      lines.push(cur.join(' '))
      cur = []
    }
    cur.push(it.str)
    lastY = it.y
  }
  if (cur.length) lines.push(cur.join(' '))
  const outFile = resolve('tmp/pages', `p${p}.txt`)
  writeFileSync(outFile, lines.join('\n'))
  console.log(`第 ${p} 页 → ${outFile}（${lines.length} 行）`)
  page.cleanup()
}
