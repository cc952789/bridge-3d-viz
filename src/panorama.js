import * as THREE from 'three'
import { PANORAMAS } from './data/panoramas.js'

const RADIUS = 500

// 全景漫游：独立的球体场景 + 鼠标拖拽旋转 + 热点跳转。
// 复用主渲染器，仅在"全景"模式下渲染。
export class PanoramaViewer {
  constructor(renderer, container) {
    this.renderer = renderer
    this.container = container
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 2000)
    this.camera.position.set(0, 0, 0)

    this.yaw = 0
    this.pitch = 0
    this.enabled = false
    this.currentIndex = -1
    this.sphere = null
    this.hotspots = []
    this.onSwitch = null

    this.raycaster = new THREE.Raycaster()
    this.ndc = new THREE.Vector2()

    this._dragging = false
    this._lastX = 0
    this._lastY = 0
    this._moved = 0
    this._bindEvents()
  }

  setEnabled(on) {
    this.enabled = on
  }

  resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  load(index) {
    const pano = PANORAMAS[index]
    if (!pano) return
    this.currentIndex = index

    // 清理旧球体与热点
    if (this.sphere) {
      this.scene.remove(this.sphere)
      this.sphere.geometry.dispose()
      this.sphere.material.map?.dispose()
      this.sphere.material.dispose()
      this.sphere = null
    }
    this._clearHotspots()

    const texture = this._getTexture(pano)
    const geometry = new THREE.SphereGeometry(RADIUS, 64, 48)
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide })
    this.sphere = new THREE.Mesh(geometry, material)
    this.scene.add(this.sphere)

    // 热点
    for (const h of pano.hotspots || []) {
      this._addHotspot(h)
    }

    // 更新 HUD
    const nameEl = document.getElementById('pano-name')
    if (nameEl) nameEl.textContent = pano.name

    // 重置视角（每次切换机位回正）
    this.yaw = 0
    this.pitch = 0
  }

  _getTexture(pano) {
    const src = pano.texture
    if (src && src.startsWith('procedural:')) {
      return makeProceduralTexture(src.slice('procedural:'.length))
    }
    const texture = new THREE.TextureLoader().load(src)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  _addHotspot(h) {
    const dir = dirFromYawPitch(h.yaw, h.pitch)
    const geometry = new THREE.RingGeometry(6, 14, 32)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd54f,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    })
    const ring = new THREE.Mesh(geometry, material)
    ring.position.copy(dir).multiplyScalar(RADIUS * 0.6)
    ring.lookAt(0, 0, 0)
    ring.userData.hotspot = h
    this.scene.add(ring)
    this.hotspots.push({ ring, dir, h })
  }

  _clearHotspots() {
    for (const { ring } of this.hotspots) {
      this.scene.remove(ring)
      ring.geometry.dispose()
      ring.material.dispose()
    }
    this.hotspots = []
  }

  _bindEvents() {
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', (e) => this._onDown(e))
    window.addEventListener('pointermove', (e) => this._onMove(e))
    window.addEventListener('pointerup', (e) => this._onUp(e))
  }

  _onDown(e) {
    if (!this.enabled) return
    this._dragging = true
    this._lastX = e.clientX
    this._lastY = e.clientY
    this._moved = 0
  }

  _onMove(e) {
    if (!this.enabled || !this._dragging) return
    const dx = e.clientX - this._lastX
    const dy = e.clientY - this._lastY
    this._moved += Math.abs(dx) + Math.abs(dy)
    this.yaw -= dx * 0.005
    this.pitch += dy * 0.005
    this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch))
    this._lastX = e.clientX
    this._lastY = e.clientY
  }

  _onUp(e) {
    if (!this.enabled) return
    this._dragging = false
    // 视作"点击"：移动很小
    if (this._moved < 6) this._pick(e)
  }

  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const clickDir = this.raycaster.ray.direction.clone().normalize()

    let best = null
    let bestAngle = 0.12 // 命中角阈值（弧度）
    for (const { dir, h } of this.hotspots) {
      const angle = clickDir.angleTo(dir)
      if (angle < bestAngle) {
        bestAngle = angle
        best = h
      }
    }
    if (best && this.onSwitch) {
      this.onSwitch(best.target)
    }
  }

  render() {
    // 相机朝向由 yaw/pitch 驱动
    this.camera.rotation.order = 'YXZ'
    this.camera.rotation.y = this.yaw
    this.camera.rotation.x = this.pitch
    this.renderer.render(this.scene, this.camera)
  }
}

function dirFromYawPitch(yaw, pitch) {
  // 与相机 YXZ 旋转一致的 -Z 前方向
  const cp = Math.cos(pitch)
  return new THREE.Vector3(-cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw))
}

// 程序化生成 2:1 等距柱状投影全景占位图（施工现场风格）
function makeProceduralTexture(theme) {
  const W = 2048
  const H = 1024
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55)
  sky.addColorStop(0, '#2f6fb0')
  sky.addColorStop(0.65, '#79b1e0')
  sky.addColorStop(1, '#cfe4f5')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H * 0.55)

  // 太阳与光晕
  const sunX = W * 0.68
  const sunY = H * 0.18
  const glow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 150)
  glow.addColorStop(0, 'rgba(255,250,220,1)')
  glow.addColorStop(1, 'rgba(255,250,220,0)')
  ctx.fillStyle = glow
  ctx.fillRect(sunX - 160, sunY - 160, 320, 320)
  ctx.fillStyle = '#fffbe6'
  ctx.beginPath()
  ctx.arc(sunX, sunY, 36, 0, Math.PI * 2)
  ctx.fill()

  // 云
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  for (const [cx, cy, r] of [
    [W * 0.18, H * 0.12, 42], [W * 0.24, H * 0.10, 30],
    [W * 0.46, H * 0.20, 54], [W * 0.52, H * 0.17, 36],
    [W * 0.85, H * 0.10, 40]
  ]) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 河道
  const riverY = H * 0.55
  const river = ctx.createLinearGradient(0, riverY, 0, H * 0.72)
  river.addColorStop(0, '#5b9ec4')
  river.addColorStop(1, '#3d7fa8')
  ctx.fillStyle = river
  ctx.fillRect(0, riverY, W, H * 0.17)

  // 滩涂 / 地面
  const ground = ctx.createLinearGradient(0, H * 0.72, 0, H)
  ground.addColorStop(0, '#7a6a4f')
  ground.addColorStop(1, '#544837')
  ctx.fillStyle = ground
  ctx.fillRect(0, H * 0.72, W, H * 0.28)

  drawSilhouettes(ctx, theme, W, H, riverY)

  const texture = new THREE.Texture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function drawSilhouettes(ctx, theme, W, H, riverY) {
  ctx.fillStyle = '#23272f'
  if (theme === 'deck') {
    // 桥面视角：向前延伸的桥面与两侧护栏
    ctx.fillStyle = '#3a4148'
    ctx.beginPath()
    ctx.moveTo(0, H * 0.52)
    ctx.lineTo(W, H * 0.52)
    ctx.lineTo(W * 0.82, H * 0.72)
    ctx.lineTo(W * 0.18, H * 0.72)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#23272f'
    ctx.fillRect(W * 0.18, H * 0.46, W * 0.02, H * 0.26)
    ctx.fillRect(W * 0.80, H * 0.46, W * 0.02, H * 0.26)
    // 远处吊机
    drawCrane(ctx, W * 0.5, H * 0.3, 0.5)
    drawCrane(ctx, W * 0.72, H * 0.36, 0.4)
  } else if (theme === 'pier') {
    // 墩顶俯瞰：脚下是桥面，远处是河面与对岸
    ctx.fillStyle = '#3a4148'
    ctx.beginPath()
    ctx.moveTo(0, H * 0.4)
    ctx.lineTo(W, H * 0.4)
    ctx.lineTo(W * 0.88, H * 0.62)
    ctx.lineTo(W * 0.12, H * 0.62)
    ctx.closePath()
    ctx.fill()
    drawCrane(ctx, W * 0.3, H * 0.25, 0.45)
    drawCrane(ctx, W * 0.62, H * 0.28, 0.35)
  } else {
    // 场地全景（默认）：塔吊 + 桥墩 + 部分桥面
    drawCrane(ctx, W * 0.22, H * 0.55, 1.0)
    drawCrane(ctx, W * 0.62, H * 0.55, 0.85)
    drawCrane(ctx, W * 0.88, H * 0.58, 0.6)
    // 桥墩
    ctx.fillRect(W * 0.34, H * 0.46, W * 0.012, H * 0.09)
    ctx.fillRect(W * 0.40, H * 0.46, W * 0.012, H * 0.09)
    ctx.fillRect(W * 0.34, H * 0.445, W * 0.072, H * 0.015)
    // 桥面
    ctx.fillRect(W * 0.30, H * 0.43, W * 0.16, H * 0.018)
  }
}

function drawCrane(ctx, cx, baseY, scale) {
  const h = 0.30 * H * scale
  const jib = 0.22 * W * scale
  ctx.strokeStyle = '#23272f'
  ctx.lineWidth = Math.max(3, 8 * scale)
  ctx.beginPath()
  ctx.moveTo(cx, baseY)
  ctx.lineTo(cx, baseY - h)
  ctx.lineTo(cx + jib, baseY - h)
  ctx.moveTo(cx, baseY - h * 0.85)
  ctx.lineTo(cx - jib * 0.4, baseY - h * 0.85)
  ctx.stroke()
  // 拉索
  ctx.lineWidth = Math.max(1, 2 * scale)
  ctx.beginPath()
  ctx.moveTo(cx, baseY - h * 0.95)
  ctx.lineTo(cx + jib, baseY - h)
  ctx.moveTo(cx, baseY - h * 0.95)
  ctx.lineTo(cx - jib * 0.4, baseY - h * 0.85)
  ctx.stroke()
}
