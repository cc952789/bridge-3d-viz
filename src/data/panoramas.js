// 全景漫游机位配置。
// texture 支持两种写法：
//   'procedural:site'  -> 使用程序化占位全景（开箱即用）
//   '/panoramas/xxx.jpg' -> 使用你自己的 2:1 等距柱状投影全景图（放到 public/panoramas/ 目录）
// hotspots: { name, target, yaw, pitch }  yaw/pitch 单位为弧度
export const PANORAMAS = [
  {
    id: 'site',
    name: '场地全景',
    texture: 'procedural:site',
    hotspots: [
      { name: '桥面施工视角', target: 1, yaw: -0.2, pitch: -0.05 },
      { name: '墩顶俯瞰视角', target: 2, yaw: 1.6, pitch: 0.1 }
    ]
  },
  {
    id: 'deck',
    name: '桥面施工',
    texture: 'procedural:deck',
    hotspots: [
      { name: '返回场地全景', target: 0, yaw: 0, pitch: 0 }
    ]
  },
  {
    id: 'pier',
    name: '墩顶俯瞰',
    texture: 'procedural:pier',
    hotspots: [
      { name: '返回场地全景', target: 0, yaw: 0, pitch: 0 }
    ]
  }
]
