import { MsgType } from '../shared/protocol.ts'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app missing')

app.innerHTML = `
  <header class="topbar">
    <h1>讨论室</h1>
    <span id="conn" class="badge">未连接</span>
  </header>
  <main class="layout">
    <section class="panel" id="chat-panel">
      <h2>聊天</h2>
      <p class="hint">消息收发 · PR#2 接入</p>
    </section>
    <section class="panel" id="demo-panel">
      <h2>演示区</h2>
      <p class="hint">图片 / PDF / PPT 展示 · PR#4 接入</p>
    </section>
  </main>
`

// PR#2 起接入 WebSocket；此处先确认协议常量可用
console.log('protocol types:', Object.keys(MsgType).join(', '))
