// 台账一键更新：pile-ledger.xlsx → public/data/pile-ledger.json → git 提交并推送
// GitHub Actions 会自动重新构建部署，约 1~2 分钟后线上同步。
// 用法：项目根目录下运行 node scripts/update-ledger.mjs（或双击「更新台账.bat」）
import { execSync } from 'node:child_process'
import { existsSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import { parseLedger } from './ledger-parser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const candidates = ['pile-ledger.xlsx', 'data/pile-ledger.xlsx', 'public/pile-ledger.xlsx'].map((f) =>
  resolve(root, f)
)
const file = candidates.find((f) => existsSync(f))
if (!file) {
  console.error('✗ 未找到台账文件 pile-ledger.xlsx')
  console.error('  请从金山文档/WPS 导出并保存为「pile-ledger.xlsx」，放到项目根目录（bridge-3d-viz 文件夹）后重试')
  process.exit(1)
}

try {
  const wb = XLSX.readFile(file)
  const parsed = parseLedger(wb)
  if (!parsed.count) {
    console.error('✗ 台账里没有找到带日期的记录，请检查表头是否包含「灌注」「日期」等列')
    process.exit(1)
  }

  const out = {
    ok: true,
    mtimeMs: statSync(file).mtimeMs,
    file: file.split(/[\\/]/).pop(),
    updatedAt: new Date().toISOString(),
    ...parsed
  }
  const outDir = resolve(root, 'public/data')
  mkdirSync(outDir, { recursive: true })
  const outFile = resolve(outDir, 'pile-ledger.json')
  writeFileSync(outFile, JSON.stringify(out))
  console.log(`✓ 已解析 ${out.count} 条记录 → ${outFile}`)
  console.log('  表头列：', (out.headers || []).slice(0, 20).filter(Boolean).join('、') || '（无）')

  // git 提交推送（凭据已缓存，无需输密码）
  const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf-8' })
  const changed = run('git status --porcelain').trim()
  if (!changed) {
    console.log('\n没有变化（内容与上次相同），无需提交')
    process.exit(0)
  }
  run('git add -A')
  run(`git commit -m "update pile ledger: ${out.count} records"`)
  run('git push origin main')
  console.log('\n✓ 已推送到 GitHub，约 1~2 分钟后线上自动更新：')
  console.log('  https://cc952789.github.io/bridge-3d-viz/')
  console.log('  打开页面的浏览器每 30 秒自动同步一次构件状态，无需手动刷新')
} catch (e) {
  console.error('✗ 更新失败：', (e && e.message) || e)
  process.exit(1)
}
