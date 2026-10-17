// 扫描三份桥梁图纸 PDF：页数 + 按关键词定位桥梁相关页（结果写入 tmp/pdf-scan.json）
import { readFileSync, writeFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')

const files = [
  ['00401', 'C:/Users/14539/AppData/Roaming/CherryStudio/Data/Files/01a147b7-9029-74bf-b9c1-df8f6fa0b639.pdf'],
  ['00402', 'C:/Users/14539/AppData/Roaming/CherryStudio/Data/Files/01a147b7-902a-7199-9e34-74a594cfed4d.pdf'],
  ['00403', 'C:/Users/14539/AppData/Roaming/CherryStudio/Data/Files/01a147b7-9028-72fa-b212-605b0bf10ec0.pdf']
]
const KEYWORDS = ['卢福', '中新', '中兴', '桩位', '桩基', '墩台', '总体布置', '桥型', '地质', '桩长', '涵洞']

const out = []
for (const [tag, path] of files) {
  const entry = { tag, pages: 0, matches: [] }
  out.push(entry)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), isEvalSupported: false, useSystemFonts: true }).promise
  entry.pages = doc.numPages
  console.log(`[${tag}] 共 ${doc.numPages} 页，开始扫描…`)
  for (let p = 1; p <= doc.numPages; p++) {
    try {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      const text = tc.items.map((i) => i.str).join(' ')
      page.cleanup()
      if (!text.trim()) continue
      const hits = KEYWORDS.filter((k) => text.includes(k))
      if (hits.length) entry.matches.push({ page: p, hits, snippet: text.replace(/\s+/g, ' ').slice(0, 150) })
    } catch (e) {
      console.log(`[${tag}] 第 ${p} 页解析失败: ${e.message}`)
    }
    if (p % 50 === 0) {
      writeFileSync('tmp/pdf-scan.json', JSON.stringify(out))
      console.log(`[${tag}] ${p}/${doc.numPages}，命中 ${entry.matches.length} 页`)
    }
  }
  writeFileSync('tmp/pdf-scan.json', JSON.stringify(out))
  console.log(`[${tag}] 完成：${doc.numPages} 页，命中 ${entry.matches.length} 页`)
}
console.log('全部完成 → tmp/pdf-scan.json')
