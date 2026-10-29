import { MsgType, type ChatPayload, type DemoPayload, type PresencePayload, type SystemPayload, type WsMessage } from '../shared/protocol.ts'

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
        <input type="file" id="file-input" accept=".png,.jpg,.jpeg,.gif,.pdf,.pptx,.svg" />
        <button id="upload-btn" disabled>上传</button>
        <span id="upload-status" class="hint"></span>
      </div>
      <div id="file-list" class="file-list"></div>
      <div id="preview-area" class="preview-area">
        <p class="hint" id="preview-hint">选择文件开始演示</p>
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
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
const ws = new WebSocket(`${protocol}://${location.host}/ws?name=${encodeURIComponent(userName)}`)

ws.addEventListener('open', () => {
  connBadge.textContent = '在线'
  connBadge.classList.add('online')
  input.disabled = false
  sendBtn.disabled = false
  uploadBtn.disabled = false
  input.focus()
})

ws.addEventListener('close', () => {
  connBadge.textContent = '已断开'
  connBadge.classList.remove('online')
  input.disabled = true
  sendBtn.disabled = true
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

let currentFile = ''
let currentPage = 0

fileList.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('.file-item') as HTMLAnchorElement | null
  if (!a) return
  e.preventDefault()
  const name = decodeURIComponent(a.getAttribute('href')?.replace('/files/', '') || '')
  showDemo(name, undefined, undefined)
})

function showDemo(file: string, page?: number, presenter?: string) {
  currentFile = file
  currentPage = page ?? 0
  previewHint.style.display = 'none'
  previewImg.style.display = 'none'
  previewPdf.style.display = 'none'

  const ext = file.split('.').pop()?.toLowerCase() || ''
  const url = `/files/${encodeURIComponent(file)}`

  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) {
    previewImg.src = url
    previewImg.style.display = 'block'
    demoControls.style.display = 'none'
  } else if (ext === 'pdf') {
    previewPdf.src = url
    previewPdf.style.display = 'block'
    demoControls.style.display = 'flex'
    pageInfo.textContent = presenter ? `${presenter} 正在演示` : 'PDF 预览'
  } else {
    previewHint.textContent = `${file}（暂不支持预览，点击下载）`
    previewHint.style.display = 'block'
    demoControls.style.display = 'none'
  }

  if (presenter && presenter !== userName) {
    appendSystem(`${presenter} 开始演示 ${file}`)
  }
}

presentBtn.addEventListener('click', () => {
  if (!currentFile) return
  ws.send(JSON.stringify({ type: MsgType.demo, payload: { file: currentFile, page: currentPage }, ts: Date.now() }))
  appendSystem('已同步给所有人')
})

prevBtn.addEventListener('click', () => {
  currentPage = Math.max(0, currentPage - 1)
  pageInfo.textContent = `第 ${currentPage + 1} 页`
})

nextBtn.addEventListener('click', () => {
  currentPage++
  pageInfo.textContent = `第 ${currentPage + 1} 页`
})
