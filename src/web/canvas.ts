export {} // 标记为模块，避免 interface Node 与 DOM 全局 Node 合并

interface Stage { id: string; name: string; status: string; note: string }
interface Engine { id: string; name: string; status: string; runs: number; lastRun: string | null; reviewerVersion: string | null }
interface PR { number: number; merged: boolean; reverted: boolean; rounds: number; findings: number; high: number; medium: number; low: number }
interface Cat { category: string; total: number; fixed: number; high: number }
interface Pipeline {
  generatedAt: string
  store: string
  stages: Stage[]
  engines: Engine[]
  prs: PR[]
  findingsByCategory: Cat[]
}

interface Node {
  id: string
  kind: 'stage' | 'pr' | 'cat' | 'engine'
  title: string
  sub: string
  dot: string
  x: number
  y: number
}

const viewport = document.getElementById('viewport')!
const world = document.getElementById('world')!
const edgesSvg = document.getElementById('edges')!
const hudStore = document.getElementById('hud-store')!

const view = { x: 60, y: 80, scale: 1 }
let nodes: Node[] = []
let edges: Array<[string, string]> = []

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
}

function statusDot(s: string): string {
  return s === 'ok' ? 'dot-ok' : s === 'warn' ? 'dot-warn' : s === 'fail' ? 'dot-fail' : 'dot-idle'
}

function buildGraph(data: Pipeline) {
  nodes = []
  edges = []
  const W = 240
  const H = 110

  // 四阶段横排
  data.stages.forEach((s, i) => {
    nodes.push({ id: `stage-${s.id}`, kind: 'stage', title: s.name, sub: s.note, dot: statusDot(s.status), x: i * W, y: 0 })
    const prev = data.stages[i - 1]
    if (prev) edges.push([`stage-${prev.id}`, `stage-${s.id}`])
  })

  // 引擎行
  data.engines.forEach((e, i) => {
    nodes.push({
      id: `engine-${e.id}`,
      kind: 'engine',
      title: e.name,
      sub: `${e.status} · runs=${e.runs}${e.reviewerVersion ? ` · v=${e.reviewerVersion.slice(0, 8)}` : ''}`,
      dot: e.status === 'running' ? 'dot-ok' : 'dot-idle',
      x: i * W,
      y: H + 40,
    })
    edges.push(['stage-during', `engine-${e.id}`])
  })

  // PR 网格
  data.prs.forEach((p, i) => {
    const col = i % 4
    const row = Math.floor(i / 4)
    const dot = p.high > 0 ? 'dot-high' : p.findings > 0 ? 'dot-med' : 'dot-ok'
    nodes.push({
      id: `pr-${p.number}`,
      kind: 'pr',
      title: `PR#${p.number}${p.merged ? ' ✅' : ''}${p.reverted ? ' ⏪' : ''}`,
      sub: `${p.rounds} 轮 · ${p.findings} findings (h${p.high}/m${p.medium}/l${p.low})`,
      dot,
      x: col * (W - 40),
      y: (H + 40) * 2 + row * (H - 20),
    })
    edges.push(['stage-during', `pr-${p.number}`])
  })

  // 分类聚类
  data.findingsByCategory.forEach((c, i) => {
    const col = i % 4
    const row = Math.floor(i / 4)
    nodes.push({
      id: `cat-${c.category}`,
      kind: 'cat',
      title: c.category,
      sub: `${c.total} 条 · 已修 ${c.fixed} · high ${c.high}`,
      dot: c.high > 0 ? 'dot-high' : c.total > c.fixed ? 'dot-med' : 'dot-ok',
      x: col * (W - 40) + 520,
      y: (H + 40) * 2 + row * (H - 20),
    })
  })
}

function render() {
  // 清旧节点（保留 svg）
  world.querySelectorAll('.node').forEach((n) => n.remove())
  for (const n of nodes) {
    const el = document.createElement('div')
    el.className = `node kind-${n.kind}`
    el.dataset.id = n.id
    el.style.left = `${n.x}px`
    el.style.top = `${n.y}px`
    el.innerHTML = `<div class="n-title"><span class="n-dot ${n.dot}"></span>${escapeHtml(n.title)}</div><div class="n-sub">${escapeHtml(n.sub)}</div>`
    world.appendChild(el)
  }
  drawEdges()
}

function nodeCenter(id: string): { x: number; y: number } | null {
  const n = nodes.find((x) => x.id === id)
  if (!n) return null
  const el = world.querySelector(`.node[data-id="${id}"]`) as HTMLElement | null
  const w = el ? el.offsetWidth : 160
  const h = el ? el.offsetHeight : 60
  return { x: n.x + w / 2, y: n.y + h / 2 }
}

function drawEdges() {
  edgesSvg.innerHTML = ''
  for (const [a, b] of edges) {
    const pa = nodeCenter(a)
    const pb = nodeCenter(b)
    if (!pa || !pb) continue
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', String(pa.x))
    line.setAttribute('y1', String(pa.y))
    line.setAttribute('x2', String(pb.x))
    line.setAttribute('y2', String(pb.y))
    line.setAttribute('stroke', '#4b5563')
    line.setAttribute('stroke-width', '1.5')
    edgesSvg.appendChild(line)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

// === pan / zoom / drag ===
let panning = false
let dragNode: { id: string; ox: number; oy: number } | null = null
let last = { x: 0, y: 0 }

viewport.addEventListener('mousedown', (e) => {
  const nodeEl = (e.target as HTMLElement).closest('.node') as HTMLElement | null
  if (nodeEl) {
    const n = nodes.find((x) => x.id === nodeEl.dataset.id)
    if (!n) return
    dragNode = { id: n.id, ox: e.clientX, oy: e.clientY }
    last = { x: n.x, y: n.y }
  } else {
    panning = true
    viewport.classList.add('panning')
    last = { x: e.clientX, y: e.clientY }
  }
})

window.addEventListener('mousemove', (e) => {
  if (dragNode) {
    const n = nodes.find((x) => x.id === dragNode!.id)
    if (!n) return
    n.x = last.x + (e.clientX - dragNode.ox) / view.scale
    n.y = last.y + (e.clientY - dragNode.oy) / view.scale
    const el = world.querySelector(`.node[data-id="${n.id}"]`) as HTMLElement | null
    if (el) {
      el.style.left = `${n.x}px`
      el.style.top = `${n.y}px`
    }
    drawEdges()
  } else if (panning) {
    view.x += e.clientX - last.x
    view.y += e.clientY - last.y
    last = { x: e.clientX, y: e.clientY }
    applyView()
  }
})

window.addEventListener('mouseup', () => {
  panning = false
  dragNode = null
  viewport.classList.remove('panning')
})

viewport.addEventListener('wheel', (e) => {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.1 : 0.9
  const next = Math.min(3, Math.max(0.3, view.scale * factor))
  // 以光标为中心缩放
  const rect = viewport.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top
  view.x = cx - ((cx - view.x) / view.scale) * next
  view.y = cy - ((cy - view.y) / view.scale) * next
  view.scale = next
  applyView()
}, { passive: false })

// === load ===
async function load() {
  try {
    const res = await fetch('/api/pipeline')
    const data = (await res.json()) as Pipeline
    hudStore.textContent = `store=${data.store} · ${data.generatedAt.slice(11, 19)}`
    buildGraph(data)
    render()
    applyView()
  } catch (e) {
    hudStore.textContent = `加载失败: ${e instanceof Error ? e.message : '未知'}`
  }
}

load()
setInterval(load, 30_000) // 30s 自动刷新状态
