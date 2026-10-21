const STATUS = { PENDING: 'pending', ACTIVE: 'active', DONE: 'done' }

const STATUS_LABEL = { pending: '未施工', active: '施工中', done: '已完成' }

const PENDING_COLOR = 0x3a4150
const ACTIVE_COLOR = 0xff9800
const DONE_COLOR = 0x4caf50

// 实例化渲染构件（桩基）用的状态配色与透明度
export const STATUS_STYLE = {
  pending: { color: PENDING_COLOR, alpha: 0.12 },
  active: { color: ACTIVE_COLOR, alpha: 0.92 },
  done: { color: DONE_COLOR, alpha: 1 }
}

const DAY_MS = 86400000

// 施工进度 4D 控制器：每个构件拥有独立的起止时间。
// 依据当前"天数"把构件分为三态：
//   未施工（pending，灰色幽灵）/ 施工中（active，橙色）/ 已完成（done，绿色）
// schedule.json 的 items 数组按构件 id 指定 start/end（相对开工日的天数）；
// startDate 为开工日历日期，用于界面上的日期输入换算。
export class Schedule4D {
  constructor() {
    this.items = []
    this.duration = 0
    this.startDate = null // Date（开工日，UTC 午夜）
    this.currentDay = 0
    this.itemMap = new Map() // id -> item
    this.groupMap = new Map() // group -> { start, end }
    this.elements = []
    this.filter = null // null 表示显示全部；否则为 'pending' | 'active' | 'done'
  }

  async load(url) {
    const data = await fetch(url).then((r) => r.json())
    return this.loadData(data)
  }

  // 直接载入排期数据对象（静态部署时用 import 代替 fetch）
  loadData(data) {
    this.items = data.items || []
    this.duration = data.duration || 0
    this.startDate = data.startDate ? parseDate(data.startDate) : null
    this.itemMap = new Map(this.items.map((t) => [t.id, t]))
    this.groupMap = this._buildGroupMap(this.items)
    return this
  }

  _buildGroupMap(items) {
    const m = new Map()
    for (const it of items) {
      if (!it.group) continue
      const prev = m.get(it.group)
      if (!prev) {
        m.set(it.group, { start: it.start, end: it.end })
      } else {
        if (it.start < prev.start) prev.start = it.start
        if (it.end > prev.end) prev.end = it.end
      }
    }
    return m
  }

  setElements(elements) {
    this.elements = elements
    this.applyDay(this.currentDay)
  }

  // 动态替换整份排期（用于真实桥梁的自动排期）
  setSchedule(items, duration) {
    this.items = items || []
    this.duration = duration || 0
    this.itemMap = new Map(this.items.map((t) => [t.id, t]))
    this.groupMap = this._buildGroupMap(this.items)
    this.applyDay(this.currentDay)
  }

  // 排期数据被外部修改（如台账日期）后重建索引并重绘
  rebuild() {
    this.itemMap = new Map(this.items.map((t) => [t.id, t]))
    this.groupMap = this._buildGroupMap(this.items)
    this.applyDay(this.currentDay)
  }

  itemFor(id) {
    return this.itemMap.get(id) || null
  }

  statusFor(id, group, day) {
    const item = this.itemMap.get(id)
    if (item) return statusFromRange(item, day)
    const g = this.groupMap.get(group)
    if (g) return statusFromRange(g, day)
    return STATUS.DONE // 未纳入排期的构件始终视为"已完成"
  }

  applyDay(day) {
    this.currentDay = day
    for (const { object, group, id, schedId } of this.elements) {
      const st = this.statusFor(schedId || id, group, day)
      object.userData.status = st
      const visible = this.filter == null || st === this.filter
      if (object.userData.applyStatusOverride) {
        // 实例化渲染的构件（桩基）：由构件自身维护颜色/可见性
        object.userData.applyStatusOverride(st, visible)
      } else {
        object.visible = visible
        object.traverse((o) => {
          if (o.isMesh && o.material) applyStatus(o, st)
        })
      }
    }
  }

  // 过滤显示：null / 'all' 显示全部，否则只显示指定状态的构件
  setFilter(filter) {
    this.filter = filter === 'all' || filter == null ? null : filter
    this.applyDay(this.currentDay)
  }

  // 当前日期下，各状态（按施工单元 schedId 去重后的）数量统计
  getStats() {
    const seen = new Set()
    let pending = 0
    let active = 0
    let done = 0
    for (const { id, schedId, group } of this.elements) {
      const key = schedId || id
      if (seen.has(key)) continue
      seen.add(key)
      const st = this.statusFor(key, group, this.currentDay)
      if (st === STATUS.PENDING) pending++
      else if (st === STATUS.ACTIVE) active++
      else done++
    }
    return { pending, active, done, total: seen.size }
  }

  // ===== 日期换算 =====
  dayToDate(day) {
    if (!this.startDate) return ''
    const d = new Date(this.startDate.getTime() + day * DAY_MS)
    return d.toISOString().slice(0, 10)
  }

  dateToDay(str) {
    if (!this.startDate || !str) return null
    const t = Date.parse(str)
    if (Number.isNaN(t)) return null
    return (t - this.startDate.getTime()) / DAY_MS
  }

  // ===== 动态修改某构件的排期（不存在则新增）=====
  updateItem(id, start, end, meta = {}) {
    const s = Math.max(0, Math.min(this.duration, start))
    const e = Math.max(s, Math.min(this.duration, end))
    let item = this.itemMap.get(id)
    if (!item) {
      item = { id, name: meta.name || id, group: meta.group || '__other', start: s, end: e }
      this.items.push(item)
      this.itemMap.set(id, item)
    } else {
      item.start = s
      item.end = e
      if (meta.name) item.name = meta.name
      if (meta.group) item.group = meta.group
    }
    this.groupMap = this._buildGroupMap(this.items)
    this.applyDay(this.currentDay)
    return item
  }
}

function statusFromRange(range, day) {
  if (day < range.start) return STATUS.PENDING
  if (day <= range.end) return STATUS.ACTIVE
  return STATUS.DONE
}

function parseDate(s) {
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t)
}

function applyStatus(mesh, status) {
  if (status === STATUS.PENDING) {
    mesh.material.color.set(PENDING_COLOR)
    mesh.material.opacity = 0.12
    mesh.material.emissive.set(0x000000)
  } else if (status === STATUS.ACTIVE) {
    mesh.material.color.set(ACTIVE_COLOR)
    mesh.material.opacity = 0.92
    mesh.material.emissive.set(0x331a00)
  } else {
    mesh.material.color.set(DONE_COLOR)
    mesh.material.opacity = 1
    mesh.material.emissive.set(0x000000)
  }
}

export { STATUS, STATUS_LABEL }
