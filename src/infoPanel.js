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

  return { show, hide }
}
