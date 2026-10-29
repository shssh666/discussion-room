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
      <p class="hint">图片 / PDF / PPT 展示 · PR#4 接入</p>
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
