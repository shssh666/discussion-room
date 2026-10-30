import { MsgType, sanitizeRoomId, type ChatPayload, type DemoPayload, type PresencePayload, type SystemPayload, type WsMessage } from '../shared/protocol.ts'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app missing')

app.innerHTML = `
  <header class="topbar">
    <h1>讨论室</h1>
    <span id="conn" class="badge">连接中…</span>
  </header>
  <main class="layout">
    <section class="panel chat-panel" id="chat-panel">
      <h2>聊天</h2>
      <div id="messages" class="messages"></div>
      <form id="send-form" class="send-form">
        <input id="msg-input" autocomplete="off" placeholder="输入消息…" disabled />
        <button type="submit" disabled>发送</button>
      </form>
    </section>
    <section class="panel" id="demo-panel">
      <h2>演示区</h2>
      <div class="upload-area">
        <input type="file" id="file-input" accept=".png,.jpg,.jpeg,.gif,.pdf,.pptx,.svg,.mmd" />
        <button id="upload-btn" disabled>上传</button>
        <span id="upload-status" class="hint"></span>
      </div>
      <div id="file-list" class="file-list"></div>
      <div id="preview-area" class="preview-area">
        <p class="hint" id="preview-hint">选择文件开始演示</p>
        <button id="convert-btn" style="display:none">🔄 转换并预览</button>
        <div id="mermaid-box" class="mermaid-box" style="display:none"></div>
        <img id="preview-img" style="display:none;max-width:100%;max-height:100%" />
        <iframe id="preview-pdf" style="display:none;width:100%;height:100%;border:none"></iframe>
      </div>
      <div class="demo-controls" id="demo-controls" style="display:none">
        <button id="prev-page">◀ 上一页</button>
        <span id="page-info"></span>
        <button id="next-page">下一页 ▶</button>
        <button id="present-btn">📢 同步给所有人</button>
      </div>
    </section>
  </main>
`

const connBadge = document.getElementById('conn')!
const messagesEl = document.getElementById('messages')!
const form = document.getElementById('send-form') as HTMLFormElement
const input = document.getElementById('msg-input') as HTMLInputElement
const sendBtn = form.querySelector('button')!

const userName = prompt('你的昵称', `user-${Math.random().toString(36).slice(2, 6)}`) || 'anon'
const roomId = sanitizeRoomId(new URLSearchParams(location.search).get('room'))
document.querySelector('.topbar h1')!.textContent = `讨论室 · ${roomId}`
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'

let ws: WebSocket
let retry = 0

function connect() {
  ws = new WebSocket(
    `${protocol}://${location.host}/ws?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(userName)}`,
  )

  ws.addEventListener('open', () => {
    retry = 0
    connBadge.textContent = '在线'
    connBadge.classList.add('online')
    input.disabled = false
    sendBtn.disabled = false
    uploadBtn.disabled = false
    input.focus()
  })

  ws.addEventListener('close', () => {
    connBadge.classList.remove('online')
    input.disabled = true
    sendBtn.disabled = true
    uploadBtn.disabled = true
    retry++
    if (retry > 10) {
      connBadge.textContent = '已断开（停止重连）'
      return
    }
    const delay = Math.min(15_000, 1000 * 2 ** (retry - 1))
    connBadge.textContent = `重连中(${retry})…`
    setTimeout(connect, delay)
  })

  ws.addEventListener('message', (ev) => {
    let msg: WsMessage
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    switch (msg.type) {
      case MsgType.chat: {
        const p = msg.payload as ChatPayload
        appendMessage(p.from, p.text, p.from === userName)
        break
      }
      case MsgType.presence: {
        const p = msg.payload as PresencePayload
        connBadge.title = `在线 ${p.users.length}/${p.max}: ${p.users.join(', ')}`
        break
      }
      case MsgType.system: {
        const p = msg.payload as SystemPayload
        appendSystem(p.reason)
        break
      }
      case MsgType.demo: {
        const p = msg.payload as DemoPayload
        showDemo(p.file, p.page, p.presenter)
        break
      }
    }
  })
}

connect()

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text) return
  ws.send(JSON.stringify({ type: MsgType.chat, payload: { text }, ts: Date.now() }))
  input.value = ''
})

function appendMessage(from: string, text: string, self: boolean) {
  const div = document.createElement('div')
  div.className = `msg ${self ? 'self' : 'other'}`
  div.innerHTML = `<span class="from">${escapeHtml(from)}</span><span class="text">${escapeHtml(text)}</span>`
  messagesEl.appendChild(div)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function appendSystem(reason: string) {
  const div = document.createElement('div')
  div.className = 'msg system'
  div.textContent = reason
  messagesEl.appendChild(div)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

// === 文件上传 ===
const fileInput = document.getElementById('file-input') as HTMLInputElement
const uploadBtn = document.getElementById('upload-btn') as HTMLButtonElement
const uploadStatus = document.getElementById('upload-status')!
const fileList = document.getElementById('file-list')!

uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  uploadBtn.disabled = true
  uploadStatus.textContent = '上传中…'
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/upload', { method: 'POST', body: form })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      uploadStatus.textContent = `失败: ${(err as { error: string }).error}`
      return
    }
    uploadStatus.textContent = '上传成功'
    fileInput.value = ''
    refreshFileList()
  } catch (e) {
    uploadStatus.textContent = `错误: ${e instanceof Error ? e.message : '未知'}`
  } finally {
    uploadBtn.disabled = false
  }
})

async function refreshFileList() {
  try {
    const res = await fetch('/files')
    const files = (await res.json()) as Array<{ name: string; size: number }>
    fileList.innerHTML = files
      .map(
        (f) =>
          `<a href="/files/${encodeURIComponent(f.name)}" target="_blank" class="file-item">${escapeHtml(f.name)} (${(f.size / 1024).toFixed(1)}KB)</a>`,
      )
      .join('')
    if (files.length === 0) fileList.innerHTML = '<p class="hint">暂无文件</p>'
  } catch {
    fileList.innerHTML = '<p class="hint">加载失败</p>'
  }
}

refreshFileList()

// === 演示区 ===
const previewHint = document.getElementById('preview-hint')!
const previewImg = document.getElementById('preview-img') as HTMLImageElement
const previewPdf = document.getElementById('preview-pdf') as HTMLIFrameElement
const demoControls = document.getElementById('demo-controls')!
const pageInfo = document.getElementById('page-info')!
const prevBtn = document.getElementById('prev-page')!
const nextBtn = document.getElementById('next-page')!
const presentBtn = document.getElementById('present-btn')!
const convertBtn = document.getElementById('convert-btn') as HTMLButtonElement
const mermaidBox = document.getElementById('mermaid-box')!

let currentFile = ''
let currentPage = 0
let currentPrefix = '/files/'

fileList.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('.file-item') as HTMLAnchorElement | null
  if (!a) return
  const name = decodeURIComponent(a.getAttribute('href')?.replace('/files/', '') || '')
  const ext = name.split('.').pop()?.toLowerCase() || ''
  // 可预览的文件拦截默认行为做本地预览；pptx 走转换流程；其他文件放行让浏览器下载
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'pptx', 'mmd'].includes(ext)) {
    e.preventDefault()
    void showDemo(name, undefined, undefined)
  }
})

function showDemo(file: string, page?: number, presenter?: string) {
  mermaidRenderGen++ // 切换任何预览都作废进行中的 mermaid 渲染，防旧 SVG 覆盖新预览
  currentFile = file
  currentPage = page ?? 0
  previewHint.style.display = 'none'
  previewImg.style.display = 'none'
  previewPdf.style.display = 'none'
  convertBtn.style.display = 'none'
  mermaidBox.style.display = 'none'

  const ext = file.split('.').pop()?.toLowerCase() || ''

  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) {
    currentPrefix = '/files/'
    previewImg.src = `/files/${encodeURIComponent(file)}`
    previewImg.style.display = 'block'
    demoControls.style.display = 'none'
  } else if (ext === 'pdf') {
    // 异步续体同样受世代守卫：HEAD 探测期间切换预览则丢弃本次提交
    const gen = mermaidRenderGen
    void (async () => {
      const head = await fetch(`/files/${encodeURIComponent(file)}`, { method: 'HEAD' }).catch(() => null)
      if (gen !== mermaidRenderGen) return
      currentPrefix = head && head.ok ? '/files/' : '/converted/'
      const pageFragment = (page ?? 0) > 0 ? `#page=${(page ?? 0) + 1}` : ''
      previewPdf.src = currentPrefix + encodeURIComponent(file) + pageFragment
      previewPdf.style.display = 'block'
      demoControls.style.display = 'flex'
      pageInfo.textContent = presenter ? `${presenter} 正在演示 · 第 ${(page ?? 0) + 1} 页` : 'PDF 预览'
    })()
  } else if (ext === 'pptx') {
    currentPrefix = '/files/'
    previewHint.textContent = `${file}（PPT · 点击转换后预览）`
    previewHint.style.display = 'block'
    convertBtn.style.display = 'inline-block'
    demoControls.style.display = 'none'
  } else if (ext === 'mmd') {
    currentPrefix = '/files/'
    demoControls.style.display = 'flex' // 保留控制栏：mmd 也要能广播同步
    void renderMermaid(file)
  } else {
    previewHint.textContent = `${file}（暂不支持预览，点击下载）`
    previewHint.style.display = 'block'
    demoControls.style.display = 'none'
  }

  if (presenter && presenter !== userName) {
    appendSystem(`${presenter} 开始演示 ${file}`)
  }
}

convertBtn.addEventListener('click', () => {
  if (!currentFile) return
  convertBtn.disabled = true
  previewHint.textContent = '转换中…（首次转换可能需要几十秒）'
  void (async () => {
    try {
      const res = await fetch('/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: currentFile }),
      })
      if (res.status === 409) {
        previewHint.textContent = '有其他转换正在进行，稍后再试'
        return
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string }
        previewHint.textContent = `转换失败: ${err.error}`
        return
      }
      const { pdf } = (await res.json()) as { pdf: string }
      void showDemo(pdf, 0, undefined)
    } finally {
      convertBtn.disabled = false
    }
  })()
})

presentBtn.addEventListener('click', () => {
  if (!currentFile) return
  ws.send(JSON.stringify({ type: MsgType.demo, payload: { file: currentFile, page: currentPage }, ts: Date.now() }))
  appendSystem('已同步给所有人')
})

prevBtn.addEventListener('click', () => {
  currentPage = Math.max(0, currentPage - 1)
  pageInfo.textContent = `第 ${currentPage + 1} 页`
  if (currentFile.endsWith('.pdf')) {
    previewPdf.src = `${currentPrefix}${encodeURIComponent(currentFile)}#page=${currentPage + 1}`
  }
})

nextBtn.addEventListener('click', () => {
  currentPage++
  pageInfo.textContent = `第 ${currentPage + 1} 页`
  if (currentFile.endsWith('.pdf')) {
    previewPdf.src = `${currentPrefix}${encodeURIComponent(currentFile)}#page=${currentPage + 1}`
  }
})

// === mermaid 流程图渲染 ===
let mermaidReady: Promise<MermaidLike> | null = null
let mermaidRenderGen = 0 // 世代计数：只允许最新一次渲染提交 DOM，防旧图覆盖新预览
// 不变量：任何异步预览提交（mermaid 渲染 / PDF HEAD 续体）在碰 DOM 前必须校验 gen === mermaidRenderGen

interface MermaidLike {
  initialize(cfg: Record<string, unknown>): void
  render(id: string, code: string): Promise<{ svg: string }>
}

function loadMermaid(): Promise<MermaidLike> {
  if (!mermaidReady) {
    mermaidReady = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = '/js/vendor/mermaid.min.js'
      s.onload = () => {
        const m = (window as unknown as { mermaid?: MermaidLike }).mermaid
        if (m) resolve(m)
        else reject(new Error('mermaid 全局对象缺失'))
      }
      s.onerror = () => reject(new Error('mermaid 脚本加载失败'))
      document.head.appendChild(s)
    })
    // 加载失败不缓存 rejected：下次调用重试
    mermaidReady.catch(() => {
      mermaidReady = null
    })
  }
  return mermaidReady
}

async function renderMermaid(file: string) {
  const gen = ++mermaidRenderGen
  try {
    const srcRes = await fetch(`/files/${encodeURIComponent(file)}`)
    if (!srcRes.ok) throw new Error('读取源文件失败')
    const code = await srcRes.text()
    if (code.length > 200_000) throw new Error('mermaid 源码过大')
    const m = await loadMermaid()
    // strict：禁用 mermaid 内的交互回调与 html 标签，防 XSS
    m.initialize({ startOnLoad: false, securityLevel: 'strict' })
    const { svg } = await m.render(`mermaid-${Date.now()}`, code)
    if (gen !== mermaidRenderGen) return // 已有更新的渲染请求，丢弃过期结果
    // mermaid securityLevel:'strict' 内部经 DOMPurify 净化其生成的 SVG；
    // 此处 innerHTML 只接受 mermaid 自身渲染产物，不含任何用户原始 HTML
    mermaidBox.innerHTML = svg
    mermaidBox.style.display = 'block'
    previewHint.style.display = 'none'
  } catch (e) {
    if (gen !== mermaidRenderGen) return
    mermaidBox.style.display = 'none'
    previewHint.textContent = `${file}（mermaid 渲染失败：${e instanceof Error ? e.message : '未知'}）`
    previewHint.style.display = 'block'
  }
}
