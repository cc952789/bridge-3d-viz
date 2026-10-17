// 把 web-ifc 的 WASM 文件复制到 public/wasm，供 IfcAPI.SetWasmPath('/wasm/') 使用
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dest = resolve(root, 'public', 'wasm')
mkdirSync(dest, { recursive: true })

for (const f of ['web-ifc.wasm', 'web-ifc-mt.wasm']) {
  const src = resolve(root, 'node_modules', 'web-ifc', f)
  if (existsSync(src)) {
    copyFileSync(src, resolve(dest, f))
    console.log(`[copy-wasm] ${f} -> public/wasm/`)
  } else {
    console.warn(`[copy-wasm] 未找到 ${src}，请确认 web-ifc 已安装`)
  }
}
