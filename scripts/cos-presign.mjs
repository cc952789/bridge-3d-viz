// 生成签名 URL，用于对比 API 端点与静态网站端点的响应头
import COS from 'cos-nodejs-sdk-v5'

const bucket = process.env.COS_BUCKET || 'bridge-3d-viz-1433124262'
const region = process.env.COS_REGION || 'ap-guangzhou'
const cos = new COS({ SecretId: process.env.COS_SECRET_ID, SecretKey: process.env.COS_SECRET_KEY })

cos.getObjectUrl(
  { Bucket: bucket, Region: region, Key: 'index.html', Sign: true, Expires: 600 },
  (err, data) => {
    if (err) {
      console.error('生成签名 URL 失败:', err.message)
      process.exit(1)
    }
    console.log(data.Url)
  }
)
