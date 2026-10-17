// 部署 dist/ 到腾讯云 COS 静态网站
// 用法（Windows PowerShell）：
//   $env:COS_SECRET_ID="你的SecretId"
//   $env:COS_SECRET_KEY="你的SecretKey"
//   $env:COS_BUCKET="你的桶名-1250000000"
//   $env:COS_REGION="ap-guangzhou"   # 可选，默认广州
//   npm run deploy:cos
import COS from 'cos-nodejs-sdk-v5'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'
import { get } from 'node:https'

// 清洗：去掉首尾空白与误带的引号
const clean = (v) => String(v ?? '').trim().replace(/^["'“”]|["'“”]$/g, '')
const secretId = clean(process.env.COS_SECRET_ID)
const secretKey = clean(process.env.COS_SECRET_KEY)
const bucket = clean(process.env.COS_BUCKET)
const region = clean(process.env.COS_REGION) || 'ap-guangzhou'

function checkKey(name, v) {
  if (!v) {
    console.error(`✗ ${name} 为空——PowerShell 每次重新打开都需要重新设置环境变量`)
    return false
  }
  if (/[^\x20-\x7e]/.test(v)) {
    console.error(`✗ ${name} 包含非英文字符（中文、全角引号、换行等），请只填纯英文数字的密钥值`)
    return false
  }
  console.log(`✓ ${name}: ${v.slice(0, 6)}***（共 ${v.length} 位）`)
  return true
}
if (!checkKey('COS_SECRET_ID', secretId) || !checkKey('COS_SECRET_KEY', secretKey)) {
  process.exit(1)
}
if (!bucket) {
  console.error('✗ COS_BUCKET 为空，请设置完整桶名（含 AppId 后缀）')
  process.exit(1)
}

const cos = new COS({ SecretId: secretId, SecretKey: secretKey })
const distDir = resolve(process.cwd(), 'dist')

// .wasm 必须用 application/wasm，否则浏览器无法实例化
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const files = walk(distDir)
if (!files.length) {
  console.error('dist 目录为空，请先运行 npm run build')
  process.exit(1)
}

// 上传前校验：列出账户下所有存储桶，核对桶名与地域
let bucketList = []
try {
  const { Buckets } = await new Promise((res, rej) =>
    cos.getService((err, data) => (err ? rej(err) : res(data)))
  )
  bucketList = Buckets || []
} catch (e) {
  console.error('✗ 无法获取存储桶列表：', e.message)
  process.exit(1)
}
const found = bucketList.find((b) => b.Name === bucket)
if (!found) {
  console.error(`✗ 未找到存储桶「${bucket}」（地域 ${region}）`)
  console.log('\n你的账户下现有的存储桶：')
  for (const b of bucketList) {
    console.log(`  桶名: ${b.Name}   地域: ${b.Location}`)
  }
  console.log('\n请把环境变量改为上面列表中的值：')
  console.log(`  $env:COS_BUCKET="<完整桶名（含 AppId 后缀）>"`)
  console.log(`  $env:COS_REGION="<对应地域>"`)
  process.exit(1)
}
console.log(`✓ 存储桶校验通过：${bucket}（${region}）\n`)

// 自动开启静态网站托管（根路径 / 直接返回 index.html）
try {
  await new Promise((res, rej) =>
    cos.putBucketWebsite(
      {
        Bucket: bucket,
        Region: region,
        WebsiteConfiguration: {
          IndexDocument: { Suffix: 'index.html' },
          ErrorDocument: { Key: 'index.html' }
        }
      },
      (err, data) => (err ? rej(err) : res(data))
    )
  )
  console.log('✓ 静态网站托管已开启（索引文档 index.html）\n')
} catch (e) {
  console.warn('⚠ 开启静态网站失败：', e.message, '——请到控制台手动开启：桶 → 基础配置 → 静态网站')
}

let failed = 0
for (const f of files) {
  const key = f.slice(distDir.length + 1).replace(/\\/g, '/')
  const contentType = MIME[extname(f).toLowerCase()] || 'application/octet-stream'
  try {
    // HTML 先删后传：删除会连旧对象上的自定义元数据一起清空
    // （控制台误勾「强制下载」留下的 x-cos-forcedownload / Content-Disposition 标记，覆盖上传清不掉）
    if (key.endsWith('.html')) {
      await new Promise((res, rej) =>
        cos.deleteObject({ Bucket: bucket, Region: region, Key: key }, (err, data) => (err ? rej(err) : res(data)))
      )
      console.log('  已清除旧文件标记', key)
    }
    await new Promise((res, rej) =>
      cos.putObject(
        { Bucket: bucket, Region: region, Key: key, Body: readFileSync(f), ContentType: contentType },
        (err, data) => (err ? rej(err) : res(data)))
    )
    console.log('✓ 已上传', key, `(${contentType})`)
  } catch (err) {
    failed++
    console.error('✗ 上传失败', key, err.message)
  }
}

const siteUrl = `https://${bucket}.cos-website.${region}.myqcloud.com/`
console.log(failed ? `\n完成，但有 ${failed} 个文件失败` : '\n全部上传完成')

// 自动验证：检查首页是否仍带「强制下载」响应头
await new Promise((r) => setTimeout(r, 2000))
const verdict = await new Promise((resolve) => {
  const req = get(siteUrl, (res) => {
    const cd = String(res.headers['content-disposition'] || '')
    res.resume()
    resolve(cd.toLowerCase().includes('attachment') ? 'attachment' : 'ok')
  })
  req.setTimeout(8000, () => { req.destroy(); resolve(null) })
  req.on('error', () => resolve(null))
})
if (verdict === 'attachment') {
  console.log('✗ 验证失败：腾讯云政策限制——2024年1月1日后创建的存储桶，')
  console.log('  通过默认域名（含 cos-website 静态网站域名）访问会强制下载，无法在浏览器预览。')
  console.log('  这是平台级限制，无法通过文件设置绕过。可选方案：')
  console.log('  1. 绑定自定义域名（需已备案域名）：https://cloud.tencent.com/document/product/436/36638')
  console.log('  2. 改用其他静态托管：GitHub Pages / Vercel / Netlify / Cloudflare Pages')
} else if (verdict === 'ok') {
  console.log('✓ 验证通过：index.html 会直接在浏览器中渲染')
} else {
  console.log('⚠ 验证请求失败，请稍后手动打开网址确认')
}
console.log(`访问地址：${siteUrl}`)
