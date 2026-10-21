import * as THREE from 'three'
import { createViewer } from './viewer.js'
import { buildDemoBridge } from './bridgeModel.js'
import { Schedule4D, STATUS_LABEL } from './schedule4d.js'
import { PanoramaViewer } from './panorama.js'
import { createInfoPanel } from './infoPanel.js'
import { buildRealBridge, setTerrainOpacity } from './realBridge.js'
import bridgesData from './data/bridges.json'
import demoScheduleData from './data/schedule.json'

const container = document.getElementById('canvas-container')

const viewer = createViewer(container)
const pano = new PanoramaViewer(viewer.renderer, container)
const infoPanel = createInfoPanel()
const schedule = new Schedule4D()

let mode = 'model' // 'model' | 'pano'
let currentModel = null // { group, elements }
let currentIfc = null // { ifcApi, modelID }
let highlighted = null
let selectedElement = null
let playing = false
let demoSchedule = { items: [], duration: 0 }
let currentTerrain = null
let terrainCutaway = false
let currentGeoGroups = []
let geologyVisible = true

const SPEEDS = [1, 2, 4, 8]
let speedIdx = 0
let speed = SPEEDS[speedIdx]

// ===== 界面元素 =====
const btnModel = document.getElementById('btn-model')
const btnPano = document.getElementById('btn-pano')
const btnDemo = document.getElementById('btn-demo')
const btnPlay = document.getElementById('btn-play')
const btnSpeed = document.getElementById('btn-speed')
const slider = document.getElementById('slider')
const timeLabel = document.getElementById('time-label')
const ganttRows = document.getElementById('gantt-rows')
const ganttPlayhead = document.getElementById('gantt-playhead')
const panoHud = document.getElementById('pano-hud')
const dropHint = document.getElementById('drop-hint')
const ifcInput = document.getElementById('ifc-input')
const schedEditor = document.getElementById('schedule-editor')
const schedStart = document.getElementById('sched-start')
const schedEnd = document.getElementById('sched-end')
const schedSave = document.getElementById('sched-save')
const schedHint = document.getElementById('sched-hint')
const btnResetSchedule = document.getElementById('btn-reset-schedule')
const bridgeSelect = document.getElementById('bridge-select')
const btnCutaway = document.getElementById('btn-cutaway')
const btnLabels = document.getElementById('btn-labels')
const tooltip = document.getElementById('tooltip')

// ===== 初始化 =====
async function init() {
  schedule.loadData(demoScheduleData)
  loadScheduleOverrides()
  demoSchedule = { items: schedule.items.slice(), duration: schedule.duration }
  slider.max = schedule.duration
  buildGantt()
  populateBridgeSelector()
  loadDemo()
  setMode('model')
  applyToday()
  wireScheduleEditor()
  wireFilter()
  wireCutaway()
  wireGeology()
  wirePileLabels()
  wireLedger()
  animate()
}

// ===== 桩号标签（视角拉近时显示图纸桩号）=====
let pileLabelsOn = false
let pileSprites = [] // { sprite, object }
const _tmpV = new THREE.Vector3()

function clearPileSprites() {
  for (const s of pileSprites) {
    s.sprite.parent?.remove(s.sprite)
    s.sprite.material.map?.dispose()
    s.sprite.material.dispose()
  }
  pileSprites = []
}

function buildPileSprites() {
  clearPileSprites()
  if (!currentModel) return
  for (const { object } of currentModel.elements) {
    const ud = object.userData
    if (!ud.pileNo || !ud.pileTop) continue
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 36
    const ctx = c.getContext('2d')
    ctx.fillStyle = 'rgba(18,22,28,.78)'
    ctx.fillRect(0, 0, 128, 36)
    ctx.strokeStyle = 'rgba(255,255,255,.35)'
    ctx.strokeRect(0.5, 0.5, 127, 35)
    ctx.fillStyle = '#e8eef5'
    ctx.font = 'bold 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(ud.pileNo, 64, 19)
    const tex = new THREE.CanvasTexture(c)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
    sprite.scale.set(9, 2.5, 1)
    sprite.position.copy(ud.pileTop)
    sprite.visible = false
    object.add(sprite)
    pileSprites.push({ sprite, object })
  }
}

function wirePileLabels() {
  btnLabels.addEventListener('click', () => {
    pileLabelsOn = !pileLabelsOn
    btnLabels.classList.toggle('active', pileLabelsOn)
    if (pileLabelsOn) {
      if (!pileSprites.length) buildPileSprites()
    } else {
      for (const s of pileSprites) s.sprite.visible = false
    }
    toast(pileLabelsOn ? '桩号标签已开启：拉近视角查看每根桩的编号' : '桩号标签已关闭')
  })
}

function updatePileLabels() {
  if (!pileLabelsOn || !pileSprites.length) return
  const camPos = viewer.camera.position
  for (const s of pileSprites) {
    s.sprite.getWorldPosition(_tmpV)
    s.sprite.visible = s.object.visible && _tmpV.distanceTo(camPos) < 130
  }
}

function wireGeology() {
  document.getElementById('btn-geology').addEventListener('click', () => {
    geologyVisible = !geologyVisible
    document.getElementById('btn-geology').classList.toggle('active', geologyVisible)
    for (const g of currentGeoGroups) g.visible = geologyVisible
    toast(geologyVisible ? '已显示地质分层柱状体' : '已隐藏地质分层柱状体')
  })
}

function wireCutaway() {
  btnCutaway.addEventListener('click', () => {
    terrainCutaway = !terrainCutaway
    btnCutaway.classList.toggle('active', terrainCutaway)
    if (currentTerrain) setTerrainOpacity(currentTerrain, terrainCutaway ? 0.25 : 1)
    toast(terrainCutaway ? '已开启地下结构剖面（地形半透明）' : '已关闭地下结构剖面')
  })
}

// ===== 桩基台账同步（灌注混凝土日期 → 构件完成时间）=====
let lastLedgerData = null
let lastLedgerMtime = 0

async function fetchPileLedger(manual = false) {
  try {
    // 双数据源：开发模式优先走 Vite 中间件（实时读 xlsx），
    // 线上（GitHub Pages）读部署时生成的台账 JSON；没有台账时静默跳过
    let data = null
    try {
      const res = await fetch('/api/pile-ledger', { cache: 'no-store' })
      if (res.ok) data = await res.json()
    } catch (e) { /* 线上无此接口，走 JSON */ }
    if (!data || !data.ok) {
      const res = await fetch(`./data/pile-ledger.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      data = await res.json()
    }
    if (!data.ok) {
      if (manual) toast('台账不可用：' + (data.error || '未知错误'))
      return
    }
    if (data.mtimeMs === lastLedgerMtime) return // 数据没变化，跳过
    lastLedgerMtime = data.mtimeMs || 0
    lastLedgerData = data
    const n = applyPileLedger(data)
    if (n > 0) toast(`台账已同步：${n} 个构件完成时间已按灌注日期更新（${data.count} 条记录）`)
    else toast(`台账已读取：${data.count} 条记录，未匹配到当前桥梁的构件`)
  } catch (e) {
    if (manual) toast('无法读取台账：请把导出的台账命名为 pile-ledger.xlsx 放到项目根目录，然后双击「更新台账.bat」')
  }
}

// 把台账里的灌注混凝土日期写入排期：对应构件的"完工日"= 灌注日期
function applyPileLedger(data) {
  if (!schedule.startDate || !data.records || !data.records.length) return 0
  let applied = 0
  for (const rec of data.records) {
    const day = schedule.dateToDay(rec.date)
    if (day == null) continue
    const bridge = String(rec.bridge || '').trim()
    const pier = String(rec.pier || '')
    const pierDigits = (pier.match(/\d+/g) || []).pop() || null
    const side = pier.includes('左') ? 'Z' : pier.includes('右') ? 'Y' : null
    // 桩号如「左幅5a-0#」/「左幅1-0#」→ 桩位标签（a0 / 0）
    let pileLabel = null
    const pm = String(rec.pileNo || '').match(/(\d+)([a-z])?-(\d+)(?=[#]?\s*$)/)
    if (pm) pileLabel = (pm[2] || '') + pm[3]
    for (const item of schedule.items) {
      if (bridge && !item.id.includes(bridge)) continue
      // 施工单元编号形如「卢福2号大桥Z-f-5-a0」：
      // 侧幅(Z=左/Y=右) + 类型(f=桩基/承台、a=桥台) + 墩号 + 桩位标签（单桩）或整体单元（承台）
      // 灌注日期只标记桩基；墩身/盖梁/系梁（p 单元）在承台之后施工，不受桩灌注日期影响
      const m = item.id.match(/([YZ])-(f|a)-(\d+)(?:-([a-z]?\d+))?$/)
      if (!m) continue
      if (pierDigits != null && m[3] !== pierDigits) continue
      if (side && m[1] !== side) continue // 区分左右幅，避免左幅日期误套到右幅
      if (pileLabel != null) {
        if (m[4] !== pileLabel) continue // 有桩号时精确到单根桩
      } else if (m[4] !== undefined) {
        continue // 无桩号时只标记整墩基础单元（承台）
      }
      item.end = Math.max(0, Math.min(schedule.duration, day))
      if (item.start >= item.end) item.start = Math.max(0, item.end - 10)
      applied++
    }
  }
  if (applied > 0) {
    schedule.rebuild()
    buildGantt()
    updateStats()
  }
  return applied
}

function wireLedger() {
  document.getElementById('btn-ledger-refresh').addEventListener('click', () => {
    fetchPileLedger(true)
    fetchPhotosManifest().then(() => toast('施工影像清单已刷新'))
  })
  fetchPileLedger() // 启动时拉取一次
  fetchPhotosManifest() // 启动时拉取施工影像清单
  setInterval(() => fetchPileLedger(false), 30000) // 每 30 秒轮询
}

// ===== 施工影像清单（photos/photos.json，由「更新台账.bat」生成）=====
let photosManifest = null

async function fetchPhotosManifest() {
  try {
    const res = await fetch(`./data/photos.json?t=${Date.now()}`, { cache: 'no-store' })
    if (res.ok) photosManifest = await res.json()
  } catch (e) {
    /* 尚无影像数据时忽略 */
  }
}

// 按「桥|幅|桩号」或「桥|幅|墩号」匹配关联照片
function photosForElement(ud) {
  if (!photosManifest || !photosManifest.photos) return null
  const m = String(ud.id || '').match(/^(.*?)([YZ])-(?:f|p|a)-(\d+)/)
  if (!m) return null
  const side = m[2] === 'Y' ? '右' : '左'
  const keys = []
  if (ud.pileNo) keys.push(`${m[1]}|${side}|${ud.pileNo}`) // 单桩照片优先
  keys.push(`${m[1]}|${side}|${m[3]}`) // 墩级照片兜底
  for (const k of keys) {
    const list = photosManifest.photos[k]
    if (list && list.length) return list
  }
  return null
}

function loadDemo() {
  clearPileSprites()
  if (currentModel) viewer.scene.remove(currentModel.group)
  if (currentIfc) {
    try { currentIfc.ifcApi.CloseModel(currentIfc.modelID) } catch (e) { /* ignore */ }
    currentIfc = null
  }
  highlighted = null
  selectedElement = null
  infoPanel.hide()
  currentTerrain = null
  currentGeoGroups = []

  const { group, elements } = buildDemoBridge()
  viewer.scene.add(group)
  currentModel = { group, elements }
  schedule.setSchedule(demoSchedule.items, demoSchedule.duration)
  schedule.setElements(elements)
  slider.max = demoSchedule.duration
  buildGantt()
  updateStats()
  fitCamera(group)
  applyToday()
  toast('已载入示例桥梁')
}

function loadRealBridge(index) {
  const bridge = bridgesData.bridges[index]
  if (!bridge) return
  clearPileSprites()
  if (currentModel) viewer.scene.remove(currentModel.group)
  if (currentIfc) {
    try { currentIfc.ifcApi.CloseModel(currentIfc.modelID) } catch (e) { /* ignore */ }
    currentIfc = null
  }
  highlighted = null
  selectedElement = null
  infoPanel.hide()

  const { group, elements, terrain, geoGroups } = buildRealBridge(bridge)
  viewer.scene.add(group)
  currentModel = { group, elements }
  currentTerrain = terrain
  currentGeoGroups = geoGroups || []
  for (const g of currentGeoGroups) g.visible = geologyVisible
  if (terrainCutaway) setTerrainOpacity(currentTerrain, 0.25)
  schedule.setElements(elements)
  const { items, duration } = generateBridgeSchedule(elements)
  schedule.setSchedule(items, duration)
  slider.max = duration
  buildGantt()
  updateStats()
  if (lastLedgerData) applyPileLedger(lastLedgerData)
  fitCamera(group)
  applyToday()
  toast(`已载入 ${bridge.name}（${elements.length} 个施工单元）`)
}

function generateBridgeSchedule(elements) {
  // 每个施工单元（schedId）一条排期；细分的构件共享同一单元的起止时间
  const units = new Map()
  for (const el of elements) {
    const key = el.schedId || el.id
    const cur = units.get(key)
    const primary = el.name.includes('桩基') || el.name.includes('墩身') || el.name.includes('桥台')
    if (!cur || (primary && !cur.primary)) {
      units.set(key, { id: key, group: el.group, no: el.no, name: el.name, primary })
    }
  }
  const all = [...units.values()]
  const abut = all.filter((u) => u.group === 'abutment')
  const found = all.filter((u) => u.group === 'foundation').sort((a, b) => a.no - b.no)
  const piers = all.filter((u) => u.group === 'pier').sort((a, b) => a.no - b.no)
  const supers = all.filter((u) => u.group === 'superstructure')
  const decks = all.filter((u) => u.group === 'deck')

  const items = []
  // 未施工构件的默认排期整体规划到 2027 年；台账中已灌注的构件由 applyPileLedger 按实际日期覆盖
  const planStart = schedule.startDate
    ? Math.max(0, Math.round((Date.parse('2027-01-01') - schedule.startDate.getTime()) / 86400000))
    : 0
  let day = planStart
  abut.forEach((a, i) => items.push({ id: a.id, name: a.name, group: 'abutment', start: planStart + i * 4, end: planStart + i * 4 + 20 }))
  day = planStart + 20
  found.forEach((f) => { items.push({ id: f.id, name: f.name, group: 'foundation', start: day, end: day + 14 }); day += 3 })
  piers.forEach((p) => { items.push({ id: p.id, name: p.name, group: 'pier', start: day, end: day + 16 }); day += 3 })
  supers.forEach((s) => items.push({ id: s.id, name: s.name, group: 'superstructure', start: day, end: day + 22 }))
  day += 22
  decks.forEach((d) => items.push({ id: d.id, name: d.name, group: 'deck', start: day - 6, end: day + 12 }))
  return { items, duration: Math.ceil(day + 12) }
}

function populateBridgeSelector() {
  bridgeSelect.innerHTML = ''
  const demoOpt = document.createElement('option')
  demoOpt.value = 'demo'
  demoOpt.textContent = '示例桥梁（演示）'
  bridgeSelect.append(demoOpt)
  bridgesData.bridges.forEach((b, i) => {
    const opt = document.createElement('option')
    opt.value = String(i)
    opt.textContent = b.name
    bridgeSelect.append(opt)
  })
  bridgeSelect.value = 'demo'
  bridgeSelect.addEventListener('change', () => {
    if (bridgeSelect.value === 'demo') loadDemo()
    else loadRealBridge(parseInt(bridgeSelect.value, 10))
  })
}

function fitCamera(object) {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 100
  const dist = maxDim * 1.5
  viewer.controls.target.copy(center)
  viewer.camera.position.set(center.x + dist * 0.6, center.y + dist * 0.5, center.z + dist * 0.9)
  viewer.controls.update()
}

// ===== 视图模式切换 =====
function setMode(m) {
  mode = m
  btnModel.classList.toggle('active', m === 'model')
  btnPano.classList.toggle('active', m === 'pano')
  panoHud.classList.toggle('hidden', m !== 'pano')
  viewer.controls.enabled = m === 'model'
  pano.setEnabled(m === 'pano')
  if (m === 'pano' && pano.currentIndex < 0) pano.load(0)
  hideTooltip()
}

btnModel.addEventListener('click', () => setMode('model'))
btnPano.addEventListener('click', () => setMode('pano'))
pano.onSwitch = (index) => pano.load(index)

// ===== 时间轴 / 4D 模拟 =====
const GROUP_COLORS = {
  foundation: '#3f6fb5',
  abutment: '#5a8bc0',
  pier: '#6a7fae',
  superstructure: '#4a6ea8',
  deck: '#7a6a9e',
  __other: '#556'
}

let ganttBars = new Map() // id -> { bar, item, isGroup }
const expandedGroups = new Set() // 已展开的墩级分组键

// 墩级分组：施工单元编号如「卢福2号大桥Z-f-5-a0」→ { key: 桥+侧幅+墩号 }
function pierGroupOf(item) {
  const m = String(item.id).match(/^(.+[YZ])-(?:f|p|a)-(\d+)(?:-[a-z]?\d+)?$/)
  return m ? { key: `${m[1]}-${m[2]}`, bridgeSide: m[1], no: m[2] } : null
}

// 按起止天数判定状态（用于分组头的聚合时间条）
function rangeStatus(item, day) {
  if (day < item.start) return 'pending'
  if (day <= item.end) return 'active'
  return 'done'
}

function makeGanttRow(item) {
  const row = document.createElement('div')
  row.className = 'gantt-row'
  row.title = `${item.name}：第 ${item.start} ~ ${item.end} 天`

  const name = document.createElement('span')
  name.className = 'gantt-name'
  name.textContent = item.name

  const track = document.createElement('div')
  track.className = 'gantt-track'

  const bar = document.createElement('div')
  bar.className = 'gantt-bar'
  bar.style.left = `${(item.start / schedule.duration) * 100}%`
  bar.style.width = `${Math.max(0.4, (item.end - item.start) / schedule.duration) * 100}%`
  bar.style.background = GROUP_COLORS[item.group] || GROUP_COLORS.__other
  track.append(bar)

  row.append(name, track)
  return { row, bar }
}

function jumpToItem(item) {
  playing = false
  updatePlayBtn()
  slider.value = item.start
  applyDay(item.start)
}

function buildGantt() {
  ganttRows.innerHTML = ''
  ganttBars = new Map()

  // 按墩台分组；上部结构/桥面等无墩号的构件平铺
  const groups = new Map()
  const ungrouped = []
  for (const item of schedule.items) {
    const g = pierGroupOf(item)
    if (g) {
      if (!groups.has(g.key)) groups.set(g.key, [])
      groups.get(g.key).push(item)
    } else ungrouped.push(item)
  }

  for (const item of ungrouped) {
    const { row, bar } = makeGanttRow(item)
    row.addEventListener('click', () => jumpToItem(item))
    ganttRows.append(row)
    ganttBars.set(item.id, { bar, item })
  }

  for (const [key, items] of groups) {
    const sorted = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh'))
    const g = pierGroupOf(sorted[0])
    const isAbut = sorted.every((t) => /-a-\d+/.test(t.id))
    const label = `${g.bridgeSide.endsWith('Y') ? '右幅' : '左幅'} ${g.no}#${isAbut ? '桥台' : '墩'}`
    // 分组头：时间跨度 = 组内最早开工 ~ 最晚完工
    const headerItem = {
      id: key,
      name: label,
      group: sorted[0].group,
      start: Math.min(...sorted.map((t) => t.start)),
      end: Math.max(...sorted.map((t) => t.end))
    }
    const { row, bar } = makeGanttRow(headerItem)
    row.classList.add('gantt-group')
    const expanded = expandedGroups.has(key)
    if (expanded) row.classList.add('open')
    // 桩完成数徽章
    const piles = sorted.filter((t) => /-(?:f|a)-\d+-[a-z]?\d+$/.test(t.id))
    if (piles.length) {
      const doneCount = piles.filter((t) => schedule.currentDay > t.end).length
      const badge = document.createElement('span')
      badge.className = 'gantt-badge'
      badge.textContent = `${doneCount}/${piles.length}`
      row.querySelector('.gantt-name').append(badge)
    }
    row.addEventListener('click', () => {
      if (expandedGroups.has(key)) expandedGroups.delete(key)
      else expandedGroups.add(key)
      buildGantt()
    })
    ganttRows.append(row)
    ganttBars.set(key, { bar, item: headerItem, isGroup: true })

    if (expandedGroups.has(key)) {
      for (const item of sorted) {
        const { row: subRow, bar: subBar } = makeGanttRow(item)
        subRow.classList.add('gantt-sub')
        subRow.addEventListener('click', () => jumpToItem(item))
        ganttRows.append(subRow)
        ganttBars.set(item.id, { bar: subBar, item })
      }
    }
  }
  updateGantt()
}

function updateGantt() {
  const frac = schedule.duration ? schedule.currentDay / schedule.duration : 0
  ganttPlayhead.style.left = `calc(var(--name-w) + (100% - var(--name-w)) * ${frac})`
  for (const { bar, item, isGroup } of ganttBars.values()) {
    const st = isGroup
      ? rangeStatus(item, schedule.currentDay)
      : schedule.statusFor(item.id, item.group, schedule.currentDay)
    bar.className = 'gantt-bar ' + st
  }
}

function updateStats() {
  const s = schedule.getStats()
  document.getElementById('stat-total').textContent = s.total
  document.getElementById('stat-pending').textContent = s.pending
  document.getElementById('stat-active').textContent = s.active
  document.getElementById('stat-done').textContent = s.done
}

function wireFilter() {
  const rows = document.querySelectorAll('#legend .filter-row')
  rows.forEach((row) => {
    row.addEventListener('click', () => {
      rows.forEach((r) => r.classList.remove('active'))
      row.classList.add('active')
      schedule.setFilter(row.dataset.filter)
    })
  })
}

// 时间轴默认定位到"今天"（超出工期时取边界），打开页面即可看到当前施工状态
function applyToday() {
  if (!schedule.startDate) {
    applyDay(0)
    return
  }
  const today = schedule.dateToDay(new Date().toISOString().slice(0, 10))
  const day = today == null ? 0 : Math.max(0, Math.min(Math.round(today), schedule.duration))
  applyDay(day)
}

function applyDay(day) {
  schedule.applyDay(day)
  if (highlighted) setHighlight(highlighted, true)
  const d = Math.round(day)
  const ds = schedule.dayToDate(d)
  timeLabel.textContent = ds
    ? `第 ${d} 天（${ds}）/ 共 ${schedule.duration} 天`
    : `第 ${d} 天 / 共 ${schedule.duration} 天`
  updateGantt()
  updateStats()
}

slider.addEventListener('input', () => {
  playing = false
  updatePlayBtn()
  applyDay(parseFloat(slider.value))
})

btnPlay.addEventListener('click', () => {
  playing = !playing
  updatePlayBtn()
})

function updatePlayBtn() {
  btnPlay.textContent = playing ? '⏸' : '▶'
}

btnSpeed.addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length
  speed = SPEEDS[speedIdx]
  btnSpeed.textContent = `${speed}×`
})

// ===== 构件拾取 =====
viewer.renderer.domElement.addEventListener('click', onPick)

function onPick(e) {
  if (mode !== 'model') return
  const rect = viewer.renderer.domElement.getBoundingClientRect()
  viewer.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  viewer.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  viewer.raycaster.setFromCamera(viewer.pointer, viewer.camera)
  const hits = viewer.raycaster.intersectObjects(viewer.scene.children, true)
  const el = findElement(hits)
  if (el) showElementInfo(el)
  else {
    const geo = findGeoInfo(hits)
    if (geo) {
      schedEditor.classList.add('hidden')
      infoPanel.show(geo.名称, '地质层', Object.entries(geo).filter(([k]) => k !== '名称').map(([k, v]) => [k, v]))
    } else {
      infoPanel.hide()
    }
  }
}

function findElement(hits) {
  for (const h of hits) {
    // 实例化渲染的桩：命中批次网格 → 按实例序号定位构件
    if (h.instanceId != null && h.object.userData.pileEntries) {
      const en = h.object.userData.pileEntries[h.instanceId]
      if (en) return en.el
    }
    let o = h.object
    while (o) {
      if (o.userData && o.userData.isElement) return o
      o = o.parent
    }
  }
  return null
}

function findGeoInfo(hits) {
  for (const h of hits) {
    let o = h.object
    while (o) {
      if (o.userData && o.userData.geoInfo) return o.userData.geoInfo
      o = o.parent
    }
  }
  return null
}

// ===== 悬停标注 =====
let hoveredElement = null
let pointerDown = false

viewer.renderer.domElement.addEventListener('pointerdown', () => { pointerDown = true })
window.addEventListener('pointerup', () => { pointerDown = false })

viewer.renderer.domElement.addEventListener('mousemove', (e) => {
  if (mode !== 'model' || pointerDown) {
    hideTooltip()
    return
  }
  const rect = viewer.renderer.domElement.getBoundingClientRect()
  viewer.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  viewer.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  viewer.raycaster.setFromCamera(viewer.pointer, viewer.camera)
  const hits = viewer.raycaster.intersectObjects(viewer.scene.children, true)
  const el = findElement(hits)
  if (el) {
    if (el !== hoveredElement) {
      hoveredElement = el
      tooltip.textContent = tooltipContent(el)
      tooltip.classList.remove('hidden')
    }
    tooltip.style.left = `${e.clientX + 14}px`
    tooltip.style.top = `${e.clientY + 14}px`
  } else {
    const geo = findGeoInfo(hits)
    if (geo) {
      const label = `${geo.名称} · 承载力 ${geo['承载力fak']}`
      if (label !== tooltip.textContent) {
        hoveredElement = null
        tooltip.textContent = label
        tooltip.classList.remove('hidden')
      }
      tooltip.style.left = `${e.clientX + 14}px`
      tooltip.style.top = `${e.clientY + 14}px`
    } else {
      hideTooltip()
    }
  }
})

function tooltipContent(el) {
  const ud = el.userData
  const p = ud.props || {}
  const parts = [ud.name]
  for (const key of ['桩径', '桩长', '直径', '柱径', '墩高', '高度', '桩号', '跨径', '数量']) {
    if (p[key]) parts.push(`${key}${p[key]}`)
  }
  return parts.join(' · ')
}

function hideTooltip() {
  tooltip.classList.add('hidden')
  hoveredElement = null
}

async function showElementInfo(el) {
  setHighlight(el, true)
  selectedElement = el
  const ud = el.userData
  const statusLabel = STATUS_LABEL[schedule.statusFor(ud.id, ud.group, schedule.currentDay)]

  if (ud.expressID != null && currentIfc) {
    try {
      const props = await currentIfc.ifcApi.properties.getItemProperties(currentIfc.modelID, ud.expressID)
      const rows = buildIfcRows(props, ud.expressID)
      rows.unshift(['当前状态', statusLabel])
      infoPanel.show(props.Name || ud.ifcType, ud.ifcType, rows)
    } catch (e) {
      infoPanel.show(ud.ifcType, ud.ifcType, [['当前状态', statusLabel], ['ExpressID', ud.expressID]])
    }
  } else if (ud.props) {
    const rows = Object.entries(ud.props).map(([k, v]) => [k, v])
    rows.unshift(['当前状态', statusLabel])
    const item = schedule.itemFor(ud.schedId || ud.id)
    if (item) {
      const ds = schedule.dayToDate(item.start)
      const de = schedule.dayToDate(item.end)
      rows.push(['施工时段', ds ? `${ds} ~ ${de}（第 ${item.start}~${item.end} 天）` : `第 ${item.start} ~ ${item.end} 天`])
    }
    infoPanel.show(ud.name, ud.props.构件类型, rows)
    const photos = photosForElement(ud)
    if (photos) infoPanel.showPhotos(photos)
  }

  populateScheduleEditor(ud)
}

function buildIfcRows(props, expressID) {
  const rows = [
    ['ExpressID', expressID],
    ['IFC 类型', props.type],
    ['Name', props.Name],
    ['GlobalId', props.GlobalId],
    ['Description', props.Description],
    ['ObjectType', props.ObjectType],
    ['PredefinedType', props.PredefinedType],
    ['Tag', props.Tag]
  ].filter(([, v]) => v != null && v !== '')

  // 数量属性（Qto）
  if (props.Quantities && props.Quantities.length) {
    for (const q of props.Quantities) {
      const name = q.Name || q.name
      const val = q.NominalValue?.value ?? q.value ?? null
      if (val != null) rows.push([name, formatNumber(val)])
    }
  }
  return rows
}

function formatNumber(v) {
  return typeof v === 'number' ? (Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(3)) : v
}

function setHighlight(obj, on) {
  if (on && highlighted !== obj) {
    if (highlighted) setEmissive(highlighted, 0x000000)
    highlighted = obj
  } else if (on && highlighted === obj) {
    highlighted = obj
  }
  setEmissive(obj, on ? 0xff8800 : 0x000000)
}

function setEmissive(obj, color) {
  if (obj.userData.highlightOverride) {
    obj.userData.highlightOverride(color !== 0x000000)
    return
  }
  obj.traverse((o) => {
    if (o.isMesh && o.material) {
      if (!o.material.emissive) o.material.emissive = new THREE.Color(0)
      o.material.emissive.set(color)
    }
  })
}

// ===== 排期编辑（每个构件可独立设置开工/完工日期）=====
const STORAGE_KEY = 'bridge-schedule-overrides'

function populateScheduleEditor(ud) {
  if (!schedule.startDate) {
    schedEditor.classList.add('hidden')
    return
  }
  const key = ud.schedId || ud.id
  let item = schedule.itemFor(key)
  let startDay, endDay
  if (item) {
    startDay = item.start
    endDay = item.end
  } else {
    const g = schedule.groupMap.get(ud.group)
    startDay = g ? g.start : 0
    endDay = g ? g.end : schedule.duration
  }
  schedStart.value = schedule.dayToDate(startDay)
  schedEnd.value = schedule.dayToDate(endDay)
  schedHint.textContent = item ? '' : '该构件暂无独立排期，保存后将新增一条'
  schedEditor.dataset.id = key
  schedEditor.dataset.group = ud.group || '__other'
  schedEditor.dataset.name = ud.name || key || ''
  schedEditor.classList.remove('hidden')
}

function loadScheduleOverrides() {
  let overrides
  try {
    overrides = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
  } catch (e) {
    overrides = null
  }
  if (!overrides || typeof overrides !== 'object') return
  for (const id in overrides) {
    const o = overrides[id]
    if (o && typeof o.start === 'number' && typeof o.end === 'number') {
      schedule.updateItem(id, o.start, o.end, { name: o.name, group: o.group })
    }
  }
}

function persistSchedule() {
  const overrides = {}
  for (const item of schedule.items) {
    overrides[item.id] = { start: item.start, end: item.end, name: item.name, group: item.group }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch (e) {
    /* ignore */
  }
}

function wireScheduleEditor() {
  schedSave.addEventListener('click', async () => {
    const id = schedEditor.dataset.id
    if (!id) return
    const startDay = schedule.dateToDay(schedStart.value)
    const endDay = schedule.dateToDay(schedEnd.value)
    if (startDay == null || endDay == null) {
      schedHint.textContent = '请选择有效的日期'
      return
    }
    if (endDay < startDay) {
      schedHint.textContent = '完工日期需晚于开工日期'
      return
    }
    schedule.updateItem(id, startDay, endDay, {
      name: schedEditor.dataset.name,
      group: schedEditor.dataset.group
    })
    persistSchedule()
    buildGantt()
    if (selectedElement) await showElementInfo(selectedElement)
    schedHint.textContent = '已保存 ✓'
  })

  btnResetSchedule.addEventListener('click', () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      /* ignore */
    }
    location.reload()
  })
}

// ===== IFC 导入 =====
ifcInput.addEventListener('change', async () => {
  if (ifcInput.files[0]) await importIfc(ifcInput.files[0])
})

btnDemo.addEventListener('click', () => {
  if (currentIfc) {
    try {
      currentIfc.ifcApi.CloseModel(currentIfc.modelID)
    } catch (e) {
      /* ignore */
    }
    currentIfc = null
  }
  loadDemo()
})

window.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (mode === 'model') dropHint.classList.remove('hidden')
})
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropHint.classList.add('hidden')
})
window.addEventListener('drop', async (e) => {
  e.preventDefault()
  dropHint.classList.add('hidden')
  const file = [...e.dataTransfer.files].find((f) => f.name.toLowerCase().endsWith('.ifc'))
  if (file) await importIfc(file)
})

async function importIfc(file) {
  toast('正在加载 IFC 模型…')
  try {
    if (currentModel) viewer.scene.remove(currentModel.group)
    if (currentIfc) {
      try {
        currentIfc.ifcApi.CloseModel(currentIfc.modelID)
      } catch (e) {
        /* ignore */
      }
    }
    // 按需加载：web-ifc 解析模块仅在真正导入 IFC 文件时才下载（减小首屏体积）
    toast('正在下载 IFC 解析模块（首次约 1MB）…')
    const { loadIfcFile } = await import('./ifcLoader.js')
    const result = await loadIfcFile(file, (n) => toast(`正在转换构件：${n}`))
    viewer.scene.add(result.group)
    currentModel = { group: result.group, elements: result.elements }
    currentTerrain = null
    currentGeoGroups = []
    currentIfc = { ifcApi: result.ifcApi, modelID: result.modelID }
    schedule.setElements(result.elements)
    updateStats()
    fitCamera(result.group)
    toast(`IFC 加载完成：${result.count} 个构件`)
  } catch (err) {
    console.error(err)
    toast('IFC 加载失败：' + (err?.message || err))
    if (!currentModel) loadDemo()
  }
}

// ===== 提示 =====
let toastTimer = null
function toast(msg) {
  let el = document.getElementById('toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    document.body.append(el)
  }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600)
}

// ===== 渲染循环 =====
function animate() {
  requestAnimationFrame(animate)

  if (playing && mode === 'model') {
    let day = schedule.currentDay + speed * 0.1
    if (day >= schedule.duration) day = 0
    slider.value = day
    applyDay(day)
  }

  if (mode === 'pano') {
    pano.render()
  } else {
    updatePileLabels()
    viewer.render()
  }
}

init()
