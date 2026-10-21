// 构件信息侧栏
export function createInfoPanel() {
  const panel = document.getElementById('info-panel')
  const titleEl = document.getElementById('info-title')
  const body = document.getElementById('info-body')

  document.getElementById('info-close').addEventListener('click', () => panel.classList.add('hidden'))

  function show(title, type, rows) {
    titleEl.textContent = title || '构件信息'
    body.innerHTML = ''

    if (type) {
      const chip = document.createElement('div')
      chip.className = 'prop-type'
      chip.textContent = type
      body.append(chip)
    }

    if (rows && rows.length) {
      const table = document.createElement('table')
      table.className = 'prop-table'
      for (const [label, value] of rows) {
        const tr = document.createElement('tr')
        const td1 = document.createElement('td')
        td1.textContent = label
        const td2 = document.createElement('td')
        td2.textContent = value == null ? '' : String(value)
        tr.append(td1, td2)
        table.append(tr)
      }
      body.append(table)
    } else if (!type) {
      const empty = document.createElement('div')
      empty.className = 'prop-empty'
      empty.textContent = '暂无属性信息'
      body.append(empty)
    }

    panel.classList.remove('hidden')
  }

  function hide() {
    panel.classList.add('hidden')
  }

  // 施工影像：在属性表下方追加照片缩略图网格
  function showPhotos(photos) {
    if (!photos || !photos.length) return
    const sec = document.createElement('div')
    sec.className = 'photo-section'
    const h = document.createElement('div')
    h.className = 'photo-title'
    h.textContent = `📷 施工影像（${photos.length}）`
    sec.append(h)
    const grid = document.createElement('div')
    grid.className = 'photo-grid'
    for (const url of photos.slice(0, 12)) {
      const img = document.createElement('img')
      img.src = url
      img.loading = 'lazy'
      img.title = '点击放大'
      img.addEventListener('click', () => openLightbox(url))
      grid.append(img)
    }
    sec.append(grid)
    body.append(sec)
  }

  function openLightbox(src) {
    let lb = document.getElementById('photo-lightbox')
    if (!lb) {
      lb = document.createElement('div')
      lb.id = 'photo-lightbox'
      const im = document.createElement('img')
      lb.append(im)
      document.body.append(lb)
      lb.addEventListener('click', () => lb.classList.remove('show'))
    }
    lb.querySelector('img').src = src
    lb.classList.add('show')
  }

  return { show, hide, showPhotos }
}
