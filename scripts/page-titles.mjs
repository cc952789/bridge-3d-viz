// 扫描页码范围内的图名标题（含关键词的行），快速定位图纸
// 用法：node scripts/page-titles.mjs <pdf路径> <起始页> <结束页> [关键词，默认 桩位|坐标|构造|布置|目录|数量]
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')

const [pdfPath, startPage, endPage, kwRaw] = process.argv.slice(2)
const kw = kwRaw || '桩位|坐标|构造|布置|目录|数量|桥型|桥台|桥墩'
const re = new RegExp(kw)

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), isEvalSupported: false, useSystemFonts: true }).promise
for (let p = parseInt(startPage, 10); p <= parseInt(endPage, 10); p++) {
  try {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    // 提取包含关键词的"行"：按 y 聚类，宽松容差
    const items = tc.items.map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str }))
    items.sort((a, b) => Math.abs(a.y - b.y) < 6 ? a.x - b.x : b.y - a.y)
    const lines = []
    let cur = [], lastY = null
    for (const it of items) {
      if (lastY != null && Math.abs(it.y - lastY) > 6) { lines.push(cur.join('')); cur = [] }
      cur.push(it.s)
      lastY = it.y
    }
    if (cur.length) lines.push(cur.join(''))
    const hits = lines.filter((l) => re.test(l)).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (hits.length) console.log(`p${p}: ${hits.slice(0, 4).join(' ║ ')}`)
    page.cleanup()
  } catch (e) {
    console.log(`p${p}: 解析失败 ${e.message}`)
  }
}
