import * as THREE from 'three'

// 程序化生成一座多跨 T 梁桥作为示例模型（沿 X 轴，桥面顶高约 26m）。
// 每个构件都带独立的 id（对应 schedule.json 里的排期项），共享同一施工单元的
// 多个网格（如某桥墩的桩基与承台）使用相同 id。
// 返回 { group, elements }，elements 为 { object, group, id } 列表。
export function buildDemoBridge() {
  const root = new THREE.Group()
  root.name = 'demo-bridge'

  const baseMaterials = {
    concrete: new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.82 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6b7a8d, roughness: 0.5, metalness: 0.3 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.9 }),
    railing: new THREE.MeshStandardMaterial({ color: 0x4d5560, roughness: 0.6, metalness: 0.2 }),
    abutment: new THREE.MeshStandardMaterial({ color: 0x8b93a0, roughness: 0.8 })
  }

  const elements = []

  function add(geometry, matKey, name, id, group, props, x, y, z, ry = 0) {
    const mat = baseMaterials[matKey].clone()
    mat.transparent = true
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.position.set(x, y, z)
    mesh.rotation.y = ry
    mesh.castShadow = true
    mesh.receiveShadow = true
    const baseColor = new THREE.Color(baseMaterials[matKey].color)
    mesh.userData = {
      isElement: true,
      id,
      expressID: null,
      ifcType: null,
      name,
      group,
      props: { 名称: name, ...props },
      baseColor
    }
    root.add(mesh)
    elements.push({ object: mesh, group, id })
    return mesh
  }

  // 桥台（两端，各自独立排期）
  const abutments = [
    [-92, 'abutment-w', '桥台（西）'],
    [92, 'abutment-e', '桥台（东）']
  ]
  for (const [x, id, label] of abutments) {
    add(new THREE.BoxGeometry(4, 26, 16), 'abutment', label, id, 'abutment',
      { 构件类型: '重力式桥台', 材料: 'C30 混凝土', 顶标高: '26m' }, x, 13, 0)
  }

  // 桥墩（4 组，每组桩基+承台为一个单元，墩身+盖梁为另一个单元）
  const pierXs = [-45, -15, 15, 45]
  pierXs.forEach((x, i) => {
    const n = i + 1
    const fId = `foundation-${n}`
    const pId = `pier-${n}`
    // 桩基（2×3 根灌注桩，同属一个基础单元）
    for (const dz of [-1, 0, 1]) {
      for (const dx of [-1.5, 1.5]) {
        add(new THREE.CylinderGeometry(0.75, 0.75, 13, 16), 'concrete',
          `桩基 P${n}`, fId, 'foundation',
          { 构件类型: '钻孔灌注桩', 直径: '1.5m', 桩长: '13m' }, x + dx, -5.5, dz * 2.5)
      }
    }
    // 承台
    add(new THREE.BoxGeometry(7, 2, 6), 'concrete', `承台 P${n}`, fId, 'foundation',
      { 构件类型: '承台', 材料: 'C30 混凝土', 尺寸: '7×6×2m' }, x, 1, 0)
    // 墩身
    add(new THREE.BoxGeometry(3, 21, 3), 'concrete', `桥墩 P${n}`, pId, 'pier',
      { 构件类型: '桥墩', 材料: 'C40 混凝土', 高度: '21m' }, x, 11.5, 0)
    // 盖梁
    add(new THREE.BoxGeometry(8, 1.6, 5), 'concrete', `盖梁 P${n}`, pId, 'pier',
      { 构件类型: '盖梁', 材料: 'C40 混凝土' }, x, 22.2, 0)
  })

  // 主梁（5 根纵向 T 梁，各自独立排期）
  for (let i = 0; i < 5; i++) {
    const z = (i - 2) * 3.2
    add(new THREE.BoxGeometry(196, 3.0, 1.4), 'steel', `主梁 G${i + 1}`, `girder-${i + 1}`, 'superstructure',
      { 构件类型: '预应力 T 梁', 材料: 'C50 混凝土 / 钢', 跨度: '6×32m' }, 0, 24.5, z)
  }

  // 桥面板
  add(new THREE.BoxGeometry(200, 0.5, 16), 'deck', '桥面板', 'deck', 'deck',
    { 构件类型: '桥面板', 材料: 'C40 混凝土', 厚度: '0.5m' }, 0, 26.35, 0)

  // 护栏（两侧，同一排期单元）
  for (const z of [-7.6, 7.6]) {
    add(new THREE.BoxGeometry(200, 1.0, 0.4), 'railing', '防撞护栏', 'railing', 'deck',
      { 构件类型: '防撞护栏', 材料: '钢' }, 0, 27.1, z)
  }

  return { group: root, elements }
}
