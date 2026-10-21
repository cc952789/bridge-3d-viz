// 站点数据一键同步：施工影像清单 + 桩基台账 → 提交推送（GitHub Actions 自动部署）
// 用法：node scripts/sync-site.mjs（或双击「更新台账.bat」）
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })

console.log('======== 1/3 施工影像 ========')
run('node scripts/scan-photos.mjs')

console.log('\n======== 2/3 桩基台账 ========')
try {
  run('node scripts/update-ledger.mjs --no-git')
} catch {
  console.log('（未找到 pile-ledger.xlsx，跳过台账）')
}

console.log('\n======== 3/3 提交推送 ========')
const changed = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' }).trim()
if (!changed) {
  console.log('没有变化（内容与上次相同），无需提交')
  process.exit(0)
}
run('git add -A')
run('git commit -m "sync site data: photos & ledger"')
run('git push origin main')
console.log('\n✓ 已推送到 GitHub，约 1~2 分钟后线上自动更新：')
console.log('  https://cc952789.github.io/bridge-3d-viz/')
