import * as THREE from 'three'
import { STATUS_STYLE } from './schedule4d.js'

// 依据桥梁统计表（下部结构）与桥型布置图生成三维桥梁。
// 上部结构：预应力砼小箱梁（先简支后连续）；桥面净宽按 meta.deckWidth；
// 纵坡按 meta.grade；平面曲线按 meta.right/left.curve（半径 m，0 = 直线）。
const SPAN = 30 // 标准跨径（m）
const DECK_SIDE_OFFSET = 13.5 // 左右幅中心距（m）
const COL_SPACING = 6.2 // 双柱横向间距（m）
const GIRDER_H = 1.6 // 小箱梁梁高（m）
const SLAB_H = 0.3 // 桥面板厚度（m）

const COLORS = {
  concrete: 0x9aa4b0,
  capBeam: 0xa7b0ba,
  abutment: 0x8b93a0,
  pile: 0x6f757d,
  steel: 0x6b7a8d,
  deck: 0x3a4148,
  railing: 0x4d5560,
  terrain: 0x6d7a4d
}

function nums(str) {
  return (String(str || '').match(/[\d.]+/g) || []).map(Number)
}
function capBeamDims(str) {
  const n = nums(str)
  return n.length >= 3 ? { h: n[0], w: n[1], l: n[2] } : { h: 1.4, w: 1.8, l: 11.7 }
}
function abutCapDims(str) {
  const n = nums(str)
  const d = n.length >= 4 ? n.slice(-3) : n
  return d.length >= 3 ? { h: d[0], w: d[1], l: d[2] } : { h: 1.3, w: 1.6, l: 12.5 }
}
function abutPileCapDims(str) {
  // "2×H1.8×2.2×5.2" → 高1.8×宽2.2×长5.2；"工9.5×5.2×1.8" → 长9.5×宽5.2×高1.8
  const n = nums(str)
  if (!n.length) return null
  if (str.includes('工')) return { w: n[1] || 5.2, h: n[2] || 1.8, l: n[0] || 9.5 }
  const d = n.length >= 4 ? n.slice(-3) : n
  return { w: d[1] || 2.2, h: d[0] || 1.8, l: d[2] || 5.2 }
}
function backWallDims(str) {
  const n = nums(str)
  return { h: n[0] || 3, w: n[1] || 3.5 }
}
function pileCapDims(str) {
  const n = nums(str)
  return n.length >= 3 ? { x: n[0], z: n[1], h: n[2] } : null
}
function colSection(str) {
  const n = nums(str)
  if (!n.length) return { round: true, d: 1.2 }
  if (n.length >= 2) return { round: false, w: n[0], d: n[1] }
  return { round: true, d: n[0] }
}

function makeMesh(geometry, colorHex, parent, { x = 0, y = 0, z = 0, ry = 0, metalness = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.8 })
  mat.transparent = true
  if (metalness) mat.metalness = metalness
  const m = new THREE.Mesh(geometry, mat)
  m.position.set(x, y, z)
  if (ry) m.rotation.y = ry
  m.castShadow = true
  m.receiveShadow = true
  m.userData = { baseColor: new THREE.Color(colorHex) }
  parent.add(m)
  return m
}

// ===== 桩基实例化渲染：整幅桥的桩合并为一个 InstancedMesh，绘制调用从数百次降到 1 次 =====
const HIGHLIGHT_COLOR = 0xff8800

function buildPileInstances(parent, entries) {
  const count = entries.length
  const geo = new THREE.CylinderGeometry(1, 1, 1, 12) // 单位圆柱，实例矩阵缩放成实际桩径/桩长
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, transparent: true })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false // 实例矩阵动态变化（状态过滤），禁用视锥剔除避免误消隐
  mesh.userData.pileEntries = entries

  // 实例颜色 + 逐实例透明度（注入材质）
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
  mesh.instanceColor = colors
  const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
  geo.setAttribute('iAlpha', alphaAttr)
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float iAlpha;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAlpha = iAlpha;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <opacity_fragment>', 'diffuseColor.a *= vAlpha;')
  }

  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const c = new THREE.Color()

  entries.forEach((en, i) => {
    en.state = { status: 'done', visible: true, highlighted: false }
    en.el.userData.pileTop = new THREE.Vector3(en.x, en.y + en.L / 2, en.z) // 桩顶局部坐标（标签定位用）
    const apply = () => {
      const st = en.state
      if (!st.visible) {
        s.set(0, 0, 0) // 隐藏：缩放为 0
        m4.compose(p, q, s)
        mesh.setMatrixAt(i, m4)
        mesh.instanceMatrix.needsUpdate = true
        return
      }
      p.set(en.x, en.y, en.z)
      s.set(en.r, en.L, en.r)
      m4.compose(p, q, s)
      // 桩位于墩组（pg）局部坐标，实例矩阵需换算到本批次（侧幅组）空间
      m4.premultiply(en.pg.matrix)
      mesh.setMatrixAt(i, m4)
      mesh.instanceMatrix.needsUpdate = true
      const style = STATUS_STYLE[st.status] || STATUS_STYLE.done
      c.set(st.highlighted ? HIGHLIGHT_COLOR : style.color)
      mesh.setColorAt(i, c)
      alphaAttr.setX(i, style.alpha)
      alphaAttr.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    // Schedule4D.applyDay 与高亮通过这两个钩子驱动实例
    en.el.userData.applyStatusOverride = (status, visible) => {
      en.state.status = status
      en.state.visible = visible
      apply()
    }
    en.el.userData.highlightOverride = (on) => {
      en.state.highlighted = on
      apply()
    }
    apply()
  })

  mesh.instanceMatrix.needsUpdate = true
  alphaAttr.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  parent.add(mesh)
  return mesh
}

function newElement(parent, elements, { id, schedId = id, group, name, no = 0, props = {} }) {
  const g = new THREE.Group()
  g.name = name
  g.userData = {
    isElement: true,
    id,
    schedId,
    expressID: null,
    ifcType: null,
    name,
    group,
    props: { 名称: name, ...props },
    baseColor: null
  }
  parent.add(g)
  elements.push({ object: g, group, id, schedId, no, name })
  return g
}

// 平面中心线：直线或圆曲线（右偏），可含直线段（前 straightLen 米为直线，之后进入曲线）
function makeCenterline(curveR, straightLen = 0) {
  if (!curveR) return (s) => ({ x: s, z: 0, ry: 0 })
  return (s) => {
    if (s <= straightLen) return { x: s, z: 0, ry: 0 }
    const t = (s - straightLen) / curveR
    return { x: straightLen + curveR * Math.sin(t), z: curveR * (1 - Math.cos(t)), ry: -t }
  }
}

// 分段线性函数（由已知点插值，两端平直延伸）
function makePiecewise(points) {
  const pts = [...points].sort((a, b) => a.s - b.s)
  return (s) => {
    if (!pts.length) return null
    if (s <= pts[0].s) return pts[0].y
    for (let i = 0; i < pts.length - 1; i++) {
      if (s <= pts[i + 1].s) {
        const a = pts[i]
        const b = pts[i + 1]
        return a.y + ((b.y - a.y) * (s - a.s)) / (b.s - a.s)
      }
    }
    return pts[pts.length - 1].y
  }
}

// 地质岩层程序化纹理缓存（每种岩层不同的材质图）
const GEO_TEXTURES = new Map()
function layerTexture(kind) {
  const key = String(kind || '').trim()
  if (GEO_TEXTURES.has(key)) return GEO_TEXTURES.get(key)
  const S = 128
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')
  let base
  let speck
  let speck2
  if (key.includes('填土')) {
    base = '#8a6f4d'
    speck = '#6e5538'
    speck2 = '#a58a63'
  } else if (key.includes('黏土')) {
    base = '#a8905a'
    speck = '#8a7444'
    speck2 = '#c0a878'
  } else if (key.includes('全风化')) {
    base = '#9a9278'
    speck = '#7e765f'
    speck2 = '#b5ae92'
  } else if (key.includes('强风化')) {
    base = '#6e6a5e'
    speck = '#57544a'
    speck2 = '#87836f'
  } else if (key.includes('卵石') || key.includes('砾') || key.includes('碎石')) {
    base = '#8d8070'
    speck = '#6d6155'
    speck2 = '#a89a88'
  } else {
    base = '#8a8578'
    speck = '#6f6a5e'
    speck2 = '#a09b8d'
  }
  ctx.fillStyle = base
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    ctx.fillStyle = Math.random() < 0.5 ? speck : speck2
    ctx.fillRect(x, y, 1.5 + Math.random() * 2, 1.5 + Math.random() * 2)
  }
  if (key.includes('花岗岩')) {
    ctx.strokeStyle = 'rgba(55,55,55,0.28)'
    ctx.lineWidth = 0.8
    for (let i = 0; i < 22; i++) {
      const y = Math.random() * S
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(S, y + (Math.random() - 0.5) * 22)
      ctx.stroke()
    }
  }
  const tex = new THREE.Texture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  GEO_TEXTURES.set(key, tex)
  return tex
}

// ===== 地质分层柱状体（钻孔位置，各岩层独立材质）=====
function buildGeologyColumn(parent, e, zCenter, groundY, base) {
  if (!e.geo || !e.geo.length) return null
  const g = new THREE.Group()
  g.name = `geo-${e.no}`
  g.userData = { isGeology: true, no: e.no }
  // 使地质柱顶（层①顶）对齐模型地面，保持各层厚度
  const shift = groundY - (e.geo[0].top - base)
  for (const layer of e.geo) {
    const top = layer.top - base + shift
    const bottom = layer.bottom - base + shift
    if (!(top > bottom)) continue
    const h = top - bottom
    const mat = new THREE.MeshStandardMaterial({ map: layerTexture(layer.name), roughness: 0.95, side: THREE.DoubleSide })
    mat.transparent = true
    const m = new THREE.Mesh(new THREE.BoxGeometry(5.5, h, 5.5), mat)
    m.position.set(0, bottom + h / 2, zCenter)
    m.receiveShadow = true
    m.userData = {
      geoInfo: {
        名称: layer.name,
        层顶标高: `${layer.top}m`,
        层底标高: `${layer.bottom}m`,
        承载力fak: layer.fak != null ? `${layer.fak} kPa` : '—'
      }
    }
    g.add(m)
  }
  parent.add(g)
  return g
}

// ===== 桥墩（每个构件独立分组：桩基/承台/墩身/墩盖梁/地系梁/中系梁）=====
function buildPier(parent, e, pos, zCenter, groundY, deckBottomHere, bid, sideLabel, elements, base, geoGroups, pileBatch) {
  const no = e.no
  const section = colSection(e.colDia)
  const cbh = e.capBeam ? capBeamDims(e.capBeam).h : 1.4
  const cbw = e.capBeam ? capBeamDims(e.capBeam).w : 1.8
  const cbl = e.capBeam ? capBeamDims(e.capBeam).l : 11.7
  const cap = e.cap ? pileCapDims(e.cap) : null
  const gtDims = e.groundTie && e.groundTie !== '/' ? nums(e.groundTie) : null
  // 完成面 = 地面线；承台/地系梁顶与地面线齐平、底与桩头同高
  const finishY = groundY
  const pileHeadY = cap ? groundY - cap.h : gtDims ? groundY - (gtDims[0] || 1.2) : groundY
  const columnBase = finishY // 墩柱起点 = 完成面（地面线）
  // 墩高：优先取表格墩高，否则按标高推算
  const colH = Math.max(0.5, e.pierH != null ? e.pierH : deckBottomHere - cbh - columnBase)
  const pileD = e.pileDia ? parseFloat(e.pileDia) : 1.4
  // 桩长优先取真实桩底标高（地面标高 - 桩底标高）；
  // 若标高数据不可信（推算桩长 < 8m），回退用统计表的桩长
  let pileL
  if (e.pileBottom != null && base != null) {
    const derived = groundY - (e.pileBottom - base)
    pileL = derived >= 8 ? derived : e.pileLen || 20
  } else {
    pileL = e.pileLen || 20
  }

  const pg = new THREE.Group()
  pg.position.set(pos.x, 0, pos.z)
  pg.rotation.y = pos.ry
  parent.add(pg)

  const fSched = `${bid}-f-${no}`
  const pSched = `${bid}-p-${no}`

  // 桩基：每根桩按图纸编号拆分为独立构件
  // 承台墩：4 根桩（a-0/a-1/b-0/b-1，两列×两排）；系梁墩（桩柱式）：2 根桩（0/1，一柱一桩）
  const pileSpecs = cap
    ? [
        { label: 'a0', dx: -cap.x * 0.3, dz: -cap.z * 0.3 },
        { label: 'b0', dx: cap.x * 0.3, dz: -cap.z * 0.3 },
        { label: 'a1', dx: -cap.x * 0.3, dz: cap.z * 0.3 },
        { label: 'b1', dx: cap.x * 0.3, dz: cap.z * 0.3 }
      ]
    : [
        { label: '0', dx: 0, dz: -COL_SPACING / 2 },
        { label: '1', dx: 0, dz: COL_SPACING / 2 }
      ]
  for (const ps of pileSpecs) {
    const pileNo = cap ? `${no}${ps.label[0]}-${ps.label[1]}` : `${no}-${ps.label}` // 图纸桩号，如 5a-0 / 1-0
    const pileEl = newElement(pg, elements, {
      id: `${bid}-pile-${no}-${ps.label}`, schedId: `${fSched}-${ps.label}`, group: 'foundation',
      name: `${sideLabel} 桩基 ${pileNo}#`, no,
      props: { 构件类型: '钻孔灌注桩', 桩号: `${pileNo}#`, 桩径: `${pileD}m`, 桩长: `${Math.round(pileL * 10) / 10}m` }
    })
    pileEl.userData.pileNo = pileNo // 桩号（供标签显示/影像关联使用）
    pileBatch.entries.push({ el: pileEl, pg, x: ps.dx, y: pileHeadY - pileL / 2, z: zCenter + ps.dz, r: pileD / 2, L: pileL })
  }

  // 承台（独立构件）
  if (cap) {
    const capEl = newElement(pg, elements, {
      id: `${bid}-pcap-${no}`, schedId: fSched, group: 'foundation',
      name: `${sideLabel} 承台 P${no}`, no,
      props: { 构件类型: '承台', 数量: e.capQty || 1, 尺寸: `${cap.x}×${cap.z}×${cap.h}m` }
    })
    makeMesh(new THREE.BoxGeometry(cap.x, cap.h, cap.z), COLORS.concrete, capEl, { y: groundY - cap.h / 2, z: zCenter })
  }

  // 墩身（独立构件）
  const colEl = newElement(pg, elements, {
    id: `${bid}-col-${no}`, schedId: pSched, group: 'pier',
    name: `${sideLabel} 墩身 P${no}`, no,
    props: { 构件类型: '柱式墩身', 柱径: e.colDia, 墩高: `${colH}m` }
  })
  for (const cz of [-COL_SPACING / 2, COL_SPACING / 2]) {
    const geom = section.round
      ? new THREE.CylinderGeometry(section.d / 2, section.d / 2, colH, 16)
      : new THREE.BoxGeometry(section.w, colH, section.d)
    makeMesh(geom, COLORS.concrete, colEl, { y: columnBase + colH / 2, z: zCenter + cz })
  }

  // 墩盖梁（独立构件）
  const beamEl = newElement(pg, elements, {
    id: `${bid}-cbeam-${no}`, schedId: pSched, group: 'pier',
    name: `${sideLabel} 墩盖梁 P${no}`, no,
    props: { 构件类型: '墩盖梁', 数量: e.capBeamQty || 1, 尺寸: `${cbh}×${cbw}×${cbl}m` }
  })
  makeMesh(new THREE.BoxGeometry(cbw, cbh, cbl), COLORS.capBeam, beamEl, { y: deckBottomHere - cbh / 2, z: zCenter })

  // 地系梁（独立构件）
  if (e.groundTie && e.groundTie !== '/') {
    const gt = nums(e.groundTie)
    const gtEl = newElement(pg, elements, {
      id: `${bid}-gtie-${no}`, schedId: pSched, group: 'pier',
      name: `${sideLabel} 地系梁 P${no}`, no,
      props: { 构件类型: '地系梁', 数量: e.groundTieQty || 1, 尺寸: `${gt[0] || 1.2}×${gt[1] || 1.0}m` }
    })
    makeMesh(new THREE.BoxGeometry(gt[1] || 1.0, gt[0] || 1.2, COL_SPACING + (section.d || 1)), COLORS.concrete, gtEl, { y: finishY - (gt[0] || 1.2) / 2, z: zCenter })
  }

  // 中系梁（独立构件；数量 N → 沿墩高等分布置 N 道）
  if (e.midTie && e.midTie !== '/') {
    const mt = nums(e.midTie)
    const nBeams = Math.max(1, e.midTieQty || 1)
    const mtEl = newElement(pg, elements, {
      id: `${bid}-mtie-${no}`, schedId: pSched, group: 'pier',
      name: `${sideLabel} 中系梁 P${no}`, no,
      props: { 构件类型: '中系梁', 数量: nBeams, 尺寸: `${mt[0] || 1.0}×${mt[1] || 0.8}m` }
    })
    for (let i = 0; i < nBeams; i++) {
      const y = columnBase + (colH * (i + 1)) / (nBeams + 1)
      makeMesh(new THREE.BoxGeometry(mt[1] || 0.8, mt[0] || 1.0, COL_SPACING + (section.d || 1)), COLORS.concrete, mtEl, { y, z: zCenter })
    }
  }

  // 地质分层柱状体（钻孔位置，各岩层独立材质）
  if (e.geo && e.geo.length && base != null) {
    const geoG = buildGeologyColumn(pg, e, zCenter, groundY, base)
    if (geoG) geoGroups.push(geoG)
  }
  pg.updateMatrix() // 供桩基实例化批次换算实例矩阵
}

// ===== 桥台（每个构件独立分组：承台/肋板/台盖梁/耳背墙/桩基）=====
function buildAbutment(parent, e, pos, zCenter, groundY, deckBottomHere, bid, sideLabel, elements, abutPiles = 4, pileBatch) {
  const no = e.no
  const ag = new THREE.Group()
  ag.position.set(pos.x, 0, pos.z)
  ag.rotation.y = pos.ry
  parent.add(ag)

  const ac = e.abutCap ? abutCapDims(e.abutCap) : { h: 1.5, w: 1.8, l: 12.5 }
  const bw = e.backWall ? backWallDims(e.backWall) : { h: 3, w: 3.5 }
  const isUType = /U型|u型|U形/.test(e.cap || '')
  const bodyH = Math.max(3, deckBottomHere - groundY - ac.h)
  const label = no === 0 ? '起点' : '终点'
  const aSched = `${bid}-a-${no}`

  // 承台（独立构件；"2×" 表示两个承台分置两侧）
  if (e.cap && !isUType) {
    const c = abutPileCapDims(e.cap)
    if (c) {
      const two = /^\s*2\s*[×xX*]/.test(e.cap)
      const capEl = newElement(ag, elements, {
        id: `${bid}-acap-${no}`, schedId: aSched, group: 'abutment',
        name: `${sideLabel} ${label}桥台承台`, no,
        props: { 构件类型: '桥台承台', 数量: e.capQty || 1, 尺寸: `${c.w}×${c.l}×${c.h}m` }
      })
      for (const zz of two ? [-3.5, 3.5] : [0]) {
        makeMesh(new THREE.BoxGeometry(c.w, c.h, c.l), COLORS.abutment, capEl, { y: groundY - c.h / 2, z: zCenter + zz })
      }
    }
  }

  // 台身 + 台盖梁（独立构件）
  const beamEl = newElement(ag, elements, {
    id: `${bid}-abeam-${no}`, schedId: aSched, group: 'abutment',
    name: `${sideLabel} ${label}桥台台盖梁`, no,
    props: { 构件类型: '台盖梁（含台身）', 数量: e.abutCapQty || 1, 尺寸: `${ac.h}×${ac.w}×${ac.l}m` }
  })
  if (isUType) {
    // U 型桥台：两道纵向翼墙 + 后墙
    makeMesh(new THREE.BoxGeometry(ac.w * 4, bodyH, 0.9), COLORS.abutment, beamEl, { y: groundY + bodyH / 2, z: zCenter - ac.l / 2 + 0.45 })
    makeMesh(new THREE.BoxGeometry(ac.w * 4, bodyH, 0.9), COLORS.abutment, beamEl, { y: groundY + bodyH / 2, z: zCenter + ac.l / 2 - 0.45 })
    makeMesh(new THREE.BoxGeometry(0.9, bodyH, ac.l), COLORS.abutment, beamEl, { x: -ac.w * 2, y: groundY + bodyH / 2, z: zCenter })
  } else {
    // 座板台/肋板台：台身（考虑耳背墙厚度）+ 台盖梁
    const bodyW = ac.w + bw.w * 0.8
    makeMesh(new THREE.BoxGeometry(bodyW, bodyH, ac.l), COLORS.abutment, beamEl, { x: -(bw.w * 0.4), y: groundY + bodyH / 2, z: zCenter })
    makeMesh(new THREE.BoxGeometry(ac.w, ac.h, ac.l), COLORS.capBeam, beamEl, { y: deckBottomHere - ac.h / 2, z: zCenter })
  }

  // 肋板（独立构件，肋板台两侧）
  if (e.rib && !isUType) {
    const rn = nums(e.rib)
    const ribEl = newElement(ag, elements, {
      id: `${bid}-arib-${no}`, schedId: aSched, group: 'abutment',
      name: `${sideLabel} ${label}桥台肋板`, no,
      props: { 构件类型: '肋板', 数量: e.ribQty || 1, 规格: e.rib }
    })
    // "2×H5.3×3.4"：第一个数字是数量，跳过
    const dims = rn.length >= 3 ? rn.slice(-2) : rn
    const rh = dims[0] || 5.3
    const rw = dims[1] || 3.4
    for (const rz of [-(ac.l / 2 - 0.8), ac.l / 2 - 0.8]) {
      makeMesh(new THREE.BoxGeometry(rw, rh, 0.5), COLORS.abutment, ribEl, { y: groundY + rh / 2, z: zCenter + rz })
    }
  }

  // 耳背墙（独立构件，立于台盖梁后缘上方，L 形，厚度取表值）
  const wallEl = newElement(ag, elements, {
    id: `${bid}-awall-${no}`, schedId: aSched, group: 'abutment',
    name: `${sideLabel} ${label}桥台耳背墙`, no,
    props: { 构件类型: '耳背墙', 数量: e.backWallQty || 1, 尺寸: `${bw.h}×${bw.w}m` }
  })
  makeMesh(new THREE.BoxGeometry(bw.w, bw.h, ac.l), COLORS.abutment, wallEl, { x: -(ac.w / 2 + bw.w / 2), y: deckBottomHere + bw.h / 2, z: zCenter })

  // 桩基：每根桩按图纸编号拆分为独立构件（默认 4 根 a-0/a-1/b-0/b-1；中新大桥桥台 2 根 0/1）
  const aPileD = e.pileDia ? parseFloat(e.pileDia) : 1.2
  const aPileL = e.pileLen || 15
  const hasCap2 = e.cap && /^\s*2\s*[×xX*]/.test(e.cap)
  const pileSpecs = abutPiles === 2
    ? [
        { label: '0', dx: -1.5, dz: 0 },
        { label: '1', dx: 1.5, dz: 0 }
      ]
    : (hasCap2
        ? [
            { label: 'a0', dx: -1.2, dz: -3.5 },
            { label: 'b0', dx: 1.2, dz: -3.5 },
            { label: 'a1', dx: -1.2, dz: 3.5 },
            { label: 'b1', dx: 1.2, dz: 3.5 }
          ]
        : [
            { label: 'a0', dx: -1.5, dz: -2.5 },
            { label: 'b0', dx: 1.5, dz: -2.5 },
            { label: 'a1', dx: -1.5, dz: 2.5 },
            { label: 'b1', dx: 1.5, dz: 2.5 }
          ])
  // 桩头与承台底同高（有承台）或与地面线齐平
  const aCapH = e.cap && !isUType ? abutPileCapDims(e.cap)?.h || 0 : 0
  const aPileHeadY = groundY - aCapH
  for (const ps of pileSpecs) {
    const pileNo = abutPiles === 2 ? `${no}-${ps.label}` : `${no}${ps.label[0]}-${ps.label[1]}` // 图纸桩号，如 0a-0 / 0-0
    const pileEl = newElement(ag, elements, {
      id: `${bid}-apile-${no}-${ps.label}`, schedId: `${aSched}-${ps.label}`, group: 'abutment',
      name: `${sideLabel} ${label}桥台桩基 ${pileNo}#`, no,
      props: { 构件类型: '钻孔灌注桩', 桩号: `${pileNo}#`, 桩径: `${aPileD}m`, 桩长: `${aPileL}m` }
    })
    pileEl.userData.pileNo = pileNo
    pileBatch.entries.push({ el: pileEl, pg: ag, x: ps.dx, y: aPileHeadY - aPileL / 2, z: zCenter + ps.dz, r: aPileD / 2, L: aPileL })
  }
  ag.updateMatrix()
}

// ===== 上部结构（小箱梁 + 桥面 + 护栏），逐跨分段（可随曲线/纵坡）=====
function buildSuperstructure(parent, bid, sideLabel, list, centerline, zCenter, deckBottom, deckWidth, grade, span, elements) {
  const maxNo = list[list.length - 1].no
  const sEl = newElement(parent, elements, {
    id: `${bid}-super`,
    group: 'superstructure',
    name: `${sideLabel} 小箱梁`,
    no: maxNo + 1,
    props: { 构件类型: '预应力砼小箱梁（先简支后连续）' }
  })
  const dEl = newElement(parent, elements, {
    id: `${bid}-deck`,
    group: 'deck',
    name: `${sideLabel} 桥面系`,
    no: maxNo + 2,
    props: { 构件类型: '桥面板 + SA四级护栏' }
  })

  const girderZs = [-4.35, -1.45, 1.45, 4.35] // 4 片小箱梁横向位置
  const girderW = 1.2

  for (let i = 0; i < list.length - 1; i++) {
    const sA = list[i].no * span
    const sB = list[i + 1].no * span
    if (sB <= sA) continue
    const pA = centerline(sA)
    const pB = centerline(sB)
    const dx = pB.x - pA.x
    const dz = pB.z - pA.z
    const chord = Math.hypot(dx, dz)
    const ry = Math.atan2(-dz, dx)
    const tilt = Math.atan2(deckBottom(sB) - deckBottom(sA), chord) // 纵坡倾角
    const yMid = (deckBottom(sA) + deckBottom(sB)) / 2
    const midX = (pA.x + pB.x) / 2
    const midZ = (pA.z + pB.z) / 2

    const gSeg = new THREE.Group()
    gSeg.position.set(midX, 0, midZ)
    gSeg.rotation.y = ry
    gSeg.rotation.z = tilt
    sEl.add(gSeg)
    for (const gz of girderZs) {
      makeMesh(new THREE.BoxGeometry(chord, GIRDER_H, girderW), COLORS.steel, gSeg, { y: yMid + GIRDER_H / 2, z: zCenter + gz, metalness: 0.3 })
    }

    const dSeg = new THREE.Group()
    dSeg.position.set(midX, 0, midZ)
    dSeg.rotation.y = ry
    dSeg.rotation.z = tilt
    dEl.add(dSeg)
    makeMesh(new THREE.BoxGeometry(chord, SLAB_H, deckWidth), COLORS.deck, dSeg, { y: yMid + GIRDER_H + SLAB_H / 2, z: zCenter })
    for (const rz of [-(deckWidth / 2 - 0.3), deckWidth / 2 - 0.3]) {
      makeMesh(new THREE.BoxGeometry(chord, 1.0, 0.4), COLORS.railing, dSeg, { y: yMid + GIRDER_H + SLAB_H + 0.5, z: zCenter + rz, metalness: 0.2 })
    }
  }
}

// 程序化土壤/草地纹理
function makeGroundTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')

  const base = ctx.createLinearGradient(0, 0, 0, S)
  base.addColorStop(0, '#7a6648')
  base.addColorStop(1, '#65553a')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, S, S)

  for (let i = 0; i < 3200; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const v = 80 + Math.random() * 70
    ctx.fillStyle = `rgba(${v - 20 | 0},${v - 5 | 0},${v - 45 | 0},0.35)`
    ctx.fillRect(x, y, 1.5, 1.5)
  }

  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 1.5 + Math.random() * 4
    const g = 120 + Math.random() * 40
    ctx.fillStyle = `rgba(${g - 15 | 0},${g - 5 | 0},${g - 20 | 0},0.5)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 2 + Math.random() * 7
    ctx.fillStyle = `rgba(${70 + Math.random() * 30 | 0},${110 + Math.random() * 45 | 0},${50 + Math.random() * 25 | 0},0.28)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new THREE.Texture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

// ===== 地形：沿中心线的高度场（真实地面标高 + 插值）=====
function terrainProfile(bridge, side, groundFn, deckFn, span) {
  const list = bridge[side]
  const profile = []
  for (const e of list) {
    const s = e.no * span
    let y = groundFn(s)
    if (y == null) {
      // 无真实地面标高时按墩高反推
      const cbh = e.capBeam ? capBeamDims(e.capBeam).h : 1.4
      y = e.height > 0 ? deckFn(s) - cbh - e.height : deckFn(s) - 7
    }
    profile.push({ s, y })
  }
  profile.unshift({ s: profile[0].s - span, y: profile[0].y })
  profile.push({ s: profile[profile.length - 1].s + span, y: profile[profile.length - 1].y })
  return profile
}

// 拟真地形：高度场顶面（纹理 + 标高渐变色）+ 侧壁向下延伸到谷底
function buildTerrain(parent, profile, zHalf, centerline) {
  const n = profile.length
  const yMin = Math.min(...profile.map((p) => p.y))
  const yMax = Math.max(...profile.map((p) => p.y))
  const baseY = -0.5 // 侧壁向下延伸到基准面下方
  const terrainGroup = new THREE.Group()
  terrainGroup.name = 'terrain'

  const texture = makeGroundTexture()
  const lowC = new THREE.Color(0x6a5638) // 谷地：深褐
  const highC = new THREE.Color(0xa89868) // 高地：浅黄褐
  const c = new THREE.Color()

  function noise(x, z) {
    return Math.sin(x * 0.055) * Math.cos(z * 0.09) * 0.6 + Math.sin(x * 0.02 + z * 0.035) * 0.9
  }

  // 中心线采样缓存
  const arc = profile.map((p) => {
    const q = centerline(p.s)
    return { x: q.x, z: q.z, nx: Math.sin(q.ry), nz: Math.cos(q.ry) }
  })

  // ===== 顶面高度场 =====
  const segZ = 20
  const pos = []
  const nrm = []
  const col = []
  const uv = []
  const idx = []
  for (let iz = 0; iz <= segZ; iz++) {
    const t = -zHalf + (2 * zHalf) * (iz / segZ)
    for (let ix = 0; ix < n; ix++) {
      const a = arc[ix]
      const x = a.x + a.nx * t
      const z = a.z + a.nz * t
      const y = profile[ix].y + noise(x, z)
      pos.push(x, y, z)
      nrm.push(0, 1, 0)
      const tt = yMax > yMin ? (y - yMin) / (yMax - yMin) : 0.5
      c.copy(lowC).lerp(highC, tt)
      col.push(c.r, c.g, c.b)
      uv.push((profile[ix].s - profile[0].s) / 14, (t + zHalf) / 14)
    }
  }
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix
      const b = a + 1
      const d = a + n
      const e = d + 1
      idx.push(a, d, b, b, d, e)
    }
  }
  const topGeom = new THREE.BufferGeometry()
  topGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  topGeom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  topGeom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  topGeom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  topGeom.setIndex(idx)
  topGeom.computeVertexNormals()
  const topMesh = new THREE.Mesh(topGeom, new THREE.MeshStandardMaterial({ map: texture, vertexColors: true, roughness: 1, side: THREE.DoubleSide }))
  topMesh.castShadow = true
  topMesh.receiveShadow = true
  terrainGroup.add(topMesh)

  // ===== 侧壁（前后 + 两端，向下到基准面）=====
  const wPos = []
  const wIdx = []
  function addWall(a, b, c2, d2) {
    const base = wPos.length / 3
    wPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c2[0], c2[1], c2[2], d2[0], d2[1], d2[2])
    wIdx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
  }
  for (let ix = 0; ix < n - 1; ix++) {
    const a1 = arc[ix]
    const a2 = arc[ix + 1]
    const y1 = profile[ix].y
    const y2 = profile[ix + 1].y
    for (const t of [-zHalf, zHalf]) {
      addWall(
        [a1.x + a1.nx * t, y1, a1.z + a1.nz * t],
        [a2.x + a2.nx * t, y2, a2.z + a2.nz * t],
        [a1.x + a1.nx * t, baseY, a1.z + a1.nz * t],
        [a2.x + a2.nx * t, baseY, a2.z + a2.nz * t]
      )
    }
  }
  addWall(
    [arc[0].x + arc[0].nx * -zHalf, profile[0].y, arc[0].z + arc[0].nz * -zHalf],
    [arc[0].x + arc[0].nx * zHalf, profile[0].y, arc[0].z + arc[0].nz * zHalf],
    [arc[0].x + arc[0].nx * -zHalf, baseY, arc[0].z + arc[0].nz * -zHalf],
    [arc[0].x + arc[0].nx * zHalf, baseY, arc[0].z + arc[0].nz * zHalf]
  )
  addWall(
    [arc[n - 1].x + arc[n - 1].nx * zHalf, profile[n - 1].y, arc[n - 1].z + arc[n - 1].nz * zHalf],
    [arc[n - 1].x + arc[n - 1].nx * -zHalf, profile[n - 1].y, arc[n - 1].z + arc[n - 1].nz * -zHalf],
    [arc[n - 1].x + arc[n - 1].nx * zHalf, baseY, arc[n - 1].z + arc[n - 1].nz * zHalf],
    [arc[n - 1].x + arc[n - 1].nx * -zHalf, baseY, arc[n - 1].z + arc[n - 1].nz * -zHalf]
  )
  const wallGeom = new THREE.BufferGeometry()
  wallGeom.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3))
  wallGeom.setIndex(wIdx)
  wallGeom.computeVertexNormals()
  const wallMesh = new THREE.Mesh(wallGeom, new THREE.MeshStandardMaterial({ color: 0x3f3524, roughness: 1, side: THREE.DoubleSide }))
  wallMesh.receiveShadow = true
  terrainGroup.add(wallMesh)

  parent.add(terrainGroup)
  return terrainGroup
}

// 设置地形透明度（地下结构剖面开关用）
export function setTerrainOpacity(terrainGroup, opacity) {
  if (!terrainGroup) return
  terrainGroup.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material.transparent = opacity < 1
      o.material.opacity = opacity
      o.material.depthWrite = opacity >= 0.99
    }
  })
}

function buildSide(bridge, side, zCenter, deckFn, groundFn, centerline, deckWidth, grade, span, elements, base, geoGroups, abutPiles) {
  const list = bridge[side]
  const g = new THREE.Group()
  g.name = `${bridge.name}-${side}`
  const bid = `${bridge.name}${side === 'right' ? 'Y' : 'Z'}`
  const sideLabel = side === 'right' ? '右幅' : '左幅'

  const pileBatch = { entries: [] }
  for (const e of list) {
    const s = e.no * span
    const pos = centerline(s)
    const deckBottomHere = deckFn(s)
    if (e.height > 0) {
      const cbh = e.capBeam ? capBeamDims(e.capBeam).h : 1.4
      // 地面：优先按表格墩高反推/插值（保证墩高=表值），最后用真实标高
      let groundY = groundFn(s)
      if (groundY == null) {
        groundY = deckBottomHere - cbh - (e.pierH != null ? e.pierH : e.height)
      }
      buildPier(g, e, pos, zCenter, groundY, deckBottomHere, bid, sideLabel, elements, base, geoGroups, pileBatch)
    } else {
      const groundY = groundFn(s) != null ? groundFn(s) : deckBottomHere - 7
      buildAbutment(g, e, pos, zCenter, groundY, deckBottomHere, bid, sideLabel, elements, abutPiles, pileBatch)
    }
  }
  // 桩基合并为实例化渲染（整幅 1 次绘制调用）
  if (pileBatch.entries.length) buildPileInstances(g, pileBatch.entries)

  buildSuperstructure(g, bid, sideLabel, list, centerline, zCenter, deckFn, deckWidth, grade, span, elements)
  return g
}

// ===== 入口 =====
export function buildRealBridge(bridge) {
  const root = new THREE.Group()
  root.name = bridge.name
  const elements = []
  const geoGroups = []

  const meta = bridge.meta || {}
  const span = meta.span || 30
  const deckWidth = meta.deckWidth || 11.5
  const rightMeta = meta.right || {}
  const leftMeta = meta.left || {}
  const rightCurve = rightMeta.curve || 0
  const leftCurve = leftMeta.curve || 0
  const rightGrade = rightMeta.grade != null ? rightMeta.grade : meta.grade || 0
  const leftGrade = leftMeta.grade != null ? leftMeta.grade : meta.grade || 0
  const rightStraight = rightMeta.straight || 0
  const leftStraight = leftMeta.straight || 0

  // 基准标高：全桥最低桩底标高，把绝对标高归一化到 y≈0
  let base = Infinity
  for (const side of ['left', 'right']) {
    for (const e of bridge[side] || []) {
      if (e.pileBottom != null && e.pileBottom < base) base = e.pileBottom
      else if (e.groundElev != null && e.groundElev < base) base = e.groundElev
    }
  }
  if (!Number.isFinite(base)) base = 0

  // 每侧的桥面线（墩顶标高分段线性）与地面线（地面标高分段线性）
  const fns = {}
  for (const side of ['left', 'right']) {
    const list = bridge[side] || []
    const grade = side === 'right' ? rightGrade : leftGrade
    // 锚点：0号台台顶标高，桥面线按纵坡从锚点反算
    const anchor = list.find((e) => e.no === 0 && e.topElev != null)
    let deck
    if (anchor) {
      const top0 = anchor.topElev - base
      deck = (s) => top0 + grade * s
    } else {
      // 回退：按墩顶标高分段 / 按墩高反推桥面线
      const topPts = []
      for (const e of list) {
        const s = e.no * span
        if (e.height > 0 && e.topElev != null) topPts.push({ s, y: e.topElev - base })
      }
      let A = 0
      for (const e of list) {
        if (e.height <= 0) continue
        const cbh = e.capBeam ? capBeamDims(e.capBeam).h : 1.4
        A = Math.max(A, e.height + cbh - grade * e.no * span)
      }
      const fallback = (s) => A + grade * s
      deck = topPts.length ? makePiecewise(topPts) : fallback
    }
    // 地面线：由桥面反算（桥面 − 盖梁/台盖梁高 − 墩高/台高）；无墩高时用真实地面标高
    const groundPts = []
    for (const e of list) {
      const s = e.no * span
      if (e.pierH != null) {
        const cbh = e.height > 0
          ? (e.capBeam ? capBeamDims(e.capBeam).h : 1.4)
          : (e.abutCap ? abutCapDims(e.abutCap).h : 1.5)
        groundPts.push({ s, y: deck(s) - cbh - e.pierH })
      } else if (e.groundElev != null) {
        groundPts.push({ s, y: e.groundElev - base })
      }
    }
    fns[side] = {
      deck,
      ground: groundPts.length ? makePiecewise(groundPts) : ((s) => null)
    }
  }

  const terrainSide = bridge.right && bridge.right.length ? 'right' : 'left'
  const terrainCurve = terrainSide === 'right' ? rightCurve : leftCurve
  const terrainStraight = terrainSide === 'right' ? rightStraight : leftStraight
  const terrain = buildTerrain(root, terrainProfile(bridge, terrainSide, fns[terrainSide].ground, fns[terrainSide].deck, span), 30, makeCenterline(terrainCurve, terrainStraight))

  if (bridge.right && bridge.right.length) {
    root.add(buildSide(bridge, 'right', DECK_SIDE_OFFSET / 2, fns.right.deck, fns.right.ground, makeCenterline(rightCurve, rightStraight), deckWidth, rightGrade, span, elements, base, geoGroups, meta.abutPiles || 4))
  }
  if (bridge.left && bridge.left.length) {
    root.add(buildSide(bridge, 'left', -DECK_SIDE_OFFSET / 2, fns.left.deck, fns.left.ground, makeCenterline(leftCurve, leftStraight), deckWidth, leftGrade, span, elements, base, geoGroups, meta.abutPiles || 4))
  }

  return { group: root, elements, terrain, geoGroups }
}
