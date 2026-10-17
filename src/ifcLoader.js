import * as THREE from 'three'
import { IfcAPI } from 'web-ifc'

// IFC 类型 -> 施工分组（用于 4D 进度着色）。未匹配的类型视为"已完成"始终可见。
const TYPE_TO_GROUP = [
  ['foundation', ['IFCPILE', 'IFCFOOTING', 'IFCFOUNDATION', 'IFCCAISSONFOUNDATION']],
  ['pier', ['IFCCOLUMN', 'IFCPIER', 'IFCPYLON']],
  ['abutment', ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCABUTMENT']],
  ['superstructure', ['IFCBEAM', 'IFCMEMBER', 'IFCPLATE', 'IFCGIRDER']],
  ['deck', ['IFCSLAB', 'IFCROOF', 'IFCRAILING', 'IFCSTAIR', 'IFCRAMP', 'IFCFOOTINGBEAM']]
]

const GROUP_BY_TYPE = new Map()
for (const [group, types] of TYPE_TO_GROUP) {
  for (const t of types) GROUP_BY_TYPE.set(t, group)
}

// 加载 .ifc 文件并转换为 Three.js 场景。
// 返回 { ifcApi, modelID, group, elements }
export async function loadIfcFile(file, onProgress) {
  const ifcApi = new IfcAPI()
  // WASM 路径相对当前页面，兼容子路径部署（如 GitHub Pages /仓库名/）
  ifcApi.SetWasmPath(new URL('wasm/', window.location.href).toString(), true)
  await ifcApi.Init(undefined, true) // 强制单线程，避免 COOP/COEP 依赖

  const bytes = new Uint8Array(await file.arrayBuffer())
  const modelID = ifcApi.OpenModel(bytes, {
    COORDINATE_TO_ORIGIN: true,
    CIRCLE_SEGMENTS: 12
  })

  // 类型编号 -> 类型名
  const typeNameMap = new Map()
  for (const t of ifcApi.GetAllTypesOfModel(modelID)) {
    typeNameMap.set(t.typeID, t.typeName)
  }

  const root = new THREE.Group()
  root.name = file.name
  const expressGroups = new Map() // expressID -> THREE.Group

  ifcApi.StreamAllMeshes(modelID, (mesh) => {
    const expressID = mesh.expressID
    const group = new THREE.Group()
    group.name = `express-${expressID}`
    let baseColor = null

    const placedGeometries = mesh.geometries
    for (let i = 0; i < placedGeometries.size(); i++) {
      const placed = placedGeometries.get(i)
      const geom = ifcApi.GetGeometry(modelID, placed.geometryExpressID)
      const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize())
      const indices = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize())
      const bufferGeometry = buildBufferGeometry(verts, indices, placed.flatTransformation)
      geom.delete()

      if (!bufferGeometry) continue

      const color = new THREE.Color(placed.color.x, placed.color.y, placed.color.z)
      if (!baseColor) baseColor = color.clone()

      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.05,
        side: THREE.DoubleSide
      })
      material.transparent = true

      const child = new THREE.Mesh(bufferGeometry, material)
      child.castShadow = true
      child.receiveShadow = true
      child.userData = { baseColor: color.clone() }
      group.add(child)
    }

    if (!baseColor) baseColor = new THREE.Color(0x9aa4b0)
    group.userData = { isElement: true, expressID, ifcType: '', group: '__other', baseColor }
    root.add(group)
    expressGroups.set(expressID, group)

    if (onProgress) onProgress(expressGroups.size)
  })

  // 解析每个构件的 IFC 类型并映射到施工分组
  const elements = []
  for (const [expressID, group] of expressGroups) {
    let typeName = 'IFCELEMENT'
    try {
      const line = ifcApi.GetLine(modelID, expressID)
      if (line && line.type != null) {
        typeName = typeNameMap.get(line.type) || `IFC#${line.type}`
      }
    } catch (e) {
      /* 某些构件可能无法直接 GetLine，忽略 */
    }
    group.userData.ifcType = typeName
    group.userData.group = GROUP_BY_TYPE.get(typeName) || '__other'
    group.userData.id = `ifc-${expressID}`
    group.userData.name = `${typeName} #${expressID}`
    elements.push({ object: group, group: group.userData.group, id: group.userData.id })
  }

  return { ifcApi, modelID, group, elements, count: expressGroups.size }
}

// 交错顶点数据（[pos×3, normal×3]，步长 6）转 BufferGeometry，并应用实例变换矩阵
function buildBufferGeometry(vertexData, indexData, flatTransformation) {
  if (!vertexData || vertexData.length < 6) return null
  const count = vertexData.length / 6
  const pos = new Float32Array(count * 3)
  const norm = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const v = i * 6
    pos[i * 3] = vertexData[v]
    pos[i * 3 + 1] = vertexData[v + 1]
    pos[i * 3 + 2] = vertexData[v + 2]
    norm[i * 3] = vertexData[v + 3]
    norm[i * 3 + 1] = vertexData[v + 4]
    norm[i * 3 + 2] = vertexData[v + 5]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(norm, 3))
  if (indexData && indexData.length) {
    geometry.setIndex(new THREE.BufferAttribute(indexData, 1))
  }
  if (Array.isArray(flatTransformation) && flatTransformation.length === 16) {
    const m = new THREE.Matrix4()
    m.fromArray(flatTransformation)
    geometry.applyMatrix4(m)
  }
  return geometry
}
