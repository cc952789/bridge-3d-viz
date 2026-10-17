// 图纸 PNG 预处理：灰度 → 二值化 → 去除长横/竖线（表格线）→ 可选裁剪区域 → 输出干净图
// 用法：node scripts/preprocess.mjs <输入png> <输出png> [crop:x,y,w,h(0~1比例)] [upscale倍数]
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

const [inFile, outFile, cropRaw, upRaw] = process.argv.slice(2)
const img = await loadImage(inFile)
const W = img.width
const H = img.height

// 裁剪区域（比例）
let cx = 0, cy = 0, cw = W, ch = H
if (cropRaw) {
  const [x, y, w, h] = cropRaw.split(',').map(Number)
  cx = Math.round(x * W); cy = Math.round(y * H); cw = Math.round(w * W); ch = Math.round(h * H)
}
const up = parseFloat(upRaw || '1')

const src = createCanvas(W, H)
const sctx = src.getContext('2d')
sctx.drawImage(img, 0, 0)

// 灰度 + 二值化
const imgData = sctx.getImageData(0, 0, W, H)
const d = imgData.data
const bin = new Uint8Array(W * H)
for (let i = 0; i < W * H; i++) {
  const g = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114)
  bin[i] = g < 180 ? 1 : 0 // 黑=1
}

// 去除长横线：连续黑像素超过阈值（>35% 宽度或 >300px）的行段置白
const H_LINE = Math.max(300, Math.round(W * 0.3))
const V_LINE = Math.max(300, Math.round(H * 0.3))
const kill = new Uint8Array(W * H)
for (let y = 0; y < H; y++) {
  let run = 0
  for (let x = 0; x <= W; x++) {
    const on = x < W && bin[y * W + x]
    if (on) run++
    else {
      if (run >= H_LINE) for (let k = x - run; k < x; k++) kill[y * W + k] = 1
      run = 0
    }
  }
}
for (let x = 0; x < W; x++) {
  let run = 0
  for (let y = 0; y <= H; y++) {
    const on = y < H && bin[y * W + x]
    if (on) run++
    else {
      if (run >= V_LINE) for (let k = y - run; k < y; k++) kill[k * W + x] = 1
      run = 0
    }
  }
}
for (let i = 0; i < W * H; i++) {
  const v = (bin[i] && !kill[i]) ? 0 : 255
  d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255
}

const out = createCanvas(Math.round(cw * up), Math.round(ch * up))
const octx = out.getContext('2d')
octx.fillStyle = '#fff'
octx.fillRect(0, 0, out.width, out.height)
const tmp = createCanvas(W, H)
const tctx = tmp.getContext('2d')
tctx.putImageData(imgData, 0, 0)
octx.drawImage(tmp, cx, cy, cw, ch, 0, 0, out.width, out.height)
writeFileSync(outFile, out.toBuffer('image/png'))
console.log(`✓ ${inFile} (${W}×${H}) → ${outFile} (${out.width}×${out.height})${cropRaw ? ` crop=[${cx},${cy},${cw},${ch}]` : ''}`)
