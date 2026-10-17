import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// 白昼天空渐变背景（顶部晴空蓝 → 地平线淡白）
function makeSkyBackground() {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 1024
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, 1024)
  g.addColorStop(0.0, '#3d7dc4')
  g.addColorStop(0.55, '#8fbcdd')
  g.addColorStop(1.0, '#dceaf3')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 16, 1024)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 创建主 3D 场景（模型视图）。不启动自己的渲染循环，由 main.js 统一驱动。
export function createViewer(container) {
  const scene = new THREE.Scene()
  scene.background = makeSkyBackground()
  scene.fog = new THREE.Fog(0xdceaf3, 350, 1400)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000)
  camera.position.set(110, 70, 150)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 18, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI * 0.5
  controls.minDistance = 15
  controls.maxDistance = 800
  controls.update()

  // 灯光：环境光 + 半球光 + 主光（太阳）+ 补光 + 顶部柔光
  scene.add(new THREE.AmbientLight(0x8899aa, 0.45))
  scene.add(new THREE.HemisphereLight(0xffffff, 0x39404d, 1.4))

  const sun = new THREE.DirectionalLight(0xffffff, 2.4)
  sun.position.set(160, 220, 100)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -260
  sun.shadow.camera.right = 260
  sun.shadow.camera.top = 260
  sun.shadow.camera.bottom = -260
  sun.shadow.camera.far = 700
  scene.add(sun)

  // 补光（对面方向，无阴影，减轻背光面过暗）
  const fill = new THREE.DirectionalLight(0xbfd6e8, 0.9)
  fill.position.set(-140, 70, -110)
  scene.add(fill)

  // 顶部柔光（提亮整体，消除局部死黑）
  const topLight = new THREE.DirectionalLight(0xffffff, 0.45)
  topLight.position.set(0, 320, 20)
  scene.add(topLight)

  // 地面与网格
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshStandardMaterial({ color: 0x3a352a, roughness: 1 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.1
  ground.receiveShadow = true
  scene.add(ground)

  const grid = new THREE.GridHelper(1400, 140, 0x4a4436, 0x3a352a)
  grid.position.y = 0.01
  scene.add(grid)

  // 拾取
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  window.addEventListener('resize', resize)
  resize()

  function render() {
    controls.update()
    renderer.render(scene, camera)
  }

  return { scene, camera, renderer, controls, raycaster, pointer, render, resize }
}
