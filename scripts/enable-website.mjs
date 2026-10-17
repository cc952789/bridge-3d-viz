// 只开启 COS 存储桶的静态网站托管（索引文档 index.html）
import COS from 'cos-nodejs-sdk-v5'

const clean = (v) => String(v ?? '').trim().replace(/^["'“”]|["'“”]$/g, '')
const secretId = clean(process.env.COS_SECRET_ID)
const secretKey = clean(process.env.COS_SECRET_KEY)
const bucket = clean(process.env.COS_BUCKET)
const region = clean(process.env.COS_REGION) || 'ap-guangzhou'

if (!secretId || !secretKey || !bucket) {
  console.error('✗ 缺少环境变量 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET')
  process.exit(1)
}

const cos = new COS({ SecretId: secretId, SecretKey: secretKey })
console.log(`正在为存储桶 ${bucket}（${region}）开启静态网站托管…`)

cos.putBucketWebsite(
  {
    Bucket: bucket,
    Region: region,
    WebsiteConfiguration: {
      IndexDocument: { Suffix: 'index.html' },
      ErrorDocument: { Key: 'index.html' }
    }
  },
  (err) => {
    if (err) {
      console.error('✗ 开启失败：', err.statusCode, err.message)
      const code = err.code || (err.error && err.error.Code)
      if (code === 'AccessDenied') {
        console.error('原因：你的密钥没有「配置存储桶」权限')
        console.error('解决：请用主账号的密钥，或到控制台手动开启（桶 → 基础配置 → 静态网站 → 索引文档填 index.html）')
      } else if (code === 'NoSuchBucket') {
        console.error('原因：桶名或地域不对（桶名要含 AppId 后缀）')
      } else {
        console.error('错误码：', code)
      }
      process.exit(1)
    }
    console.log('✓ 静态网站托管已开启！')
    console.log(`现在可以直接访问：https://${bucket}.cos.${region}.myqcloud.com/`)
  }
)
