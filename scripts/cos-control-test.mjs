// 对照实验：新建一个测试桶，上传同样的 HTML，看是否也带强制下载标记
// 如果测试桶干净 → 问题在老桶的某种残留配置，直接换新桶即可
import COS from 'cos-nodejs-sdk-v5'

const testBucket = 'bridge-3d-test-' + process.env.COS_APPID
const region = process.env.COS_REGION || 'ap-guangzhou'
const cos = new COS({ SecretId: process.env.COS_SECRET_ID, SecretKey: process.env.COS_SECRET_KEY })
const p = (fn) => new Promise((res, rej) => fn((err, data) => (err ? rej(err) : res(data))))

try {
  await p((cb) => cos.putBucket({ Bucket: testBucket, Region: region }, cb))
  console.log('✓ 测试桶已创建:', testBucket)
} catch (e) {
  console.log('创建测试桶失败（可能已存在）:', e.code || e.statusCode, e.message)
}

const html = '<!doctype html><html><body><h1>test</h1></body></html>'
await p((cb) => cos.putObject({ Bucket: testBucket, Region: region, Key: 'index.html', Body: html, ContentType: 'text/html; charset=utf-8' }, cb))
console.log('✓ 已上传 index.html')

cos.getObjectUrl({ Bucket: testBucket, Region: region, Key: 'index.html', Sign: true, Expires: 600 }, (err, data) => {
  if (err) {
    console.error('签名 URL 失败:', err.message)
    process.exit(1)
  }
  console.log('SIGNED_URL=' + data.Url)
})
