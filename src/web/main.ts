import { MsgType, type ChatPayload, type PresencePayload, type SystemPayload, type WsMessage } from '../shared/protocol.ts'

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
        <p class="hint">选择文件预览 · PR#4 接入完整展示</p>
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
