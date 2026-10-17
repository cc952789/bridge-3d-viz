// 诊断：为什么根路径 / 会带「强制下载」标记
import COS from 'cos-nodejs-sdk-v5'

const secretId = process.env.COS_SECRET_ID
const secretKey = process.env.COS_SECRET_KEY
const bucket = process.env.COS_BUCKET || 'bridge-3d-viz-1433124262'
const region = process.env.COS_REGION || 'ap-guangzhou'

const cos = new COS({ SecretId: secretId, SecretKey: secretKey })
const p = (fn) => new Promise((res, rej) => fn((err, data) => (err ? rej(err) : res(data))))

// 1. 当前静态网站配置
try {
  const cfg = await p((cb) => cos.getBucketWebsite({ Bucket: bucket, Region: region }, cb))
  console.log('静态网站配置:', JSON.stringify(cfg, null, 2))
} catch (e) {
  console.log('getBucketWebsite 失败:', e.code || e.statusCode, e.message)
}

// 2. index.html 对象存储的头信息
try {
  const data = await p((cb) => cos.headObject({ Bucket: bucket, Region: region, Key: 'index.html' }, cb))
  console.log('\n对象「index.html」的头信息:')
  console.log('  Content-Type:', data.headers['content-type'])
  console.log('  Content-Disposition:', data.headers['content-disposition'])
  console.log('  x-cos-forcedownload:', data.headers['x-cos-forcedownload'])
  const custom = Object.keys(data.headers).filter((h) => /^x-cos-/.test(h))
  console.log('  自定义头:', custom.join(', ') || '（无）')
} catch (e) {
  console.log('headObject 失败:', e.code || e.statusCode, e.message)
}

// 3. 桶内全部对象，看看有没有特殊 key
try {
  const list = await p((cb) => cos.getBucket({ Bucket: bucket, Region: region, MaxKeys: 200 }, cb))
  console.log('\n桶内对象:')
  for (const o of list.Contents || []) console.log('  ', JSON.stringify(o.Key))
} catch (e) {
  console.log('list 失败:', e.message)
}
