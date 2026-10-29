import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import WebSocket from 'ws'
import { buildApp, defaultDirs } from '../src/server/app.ts'
import { MsgType, type ChatPayload, type PresencePayload, type SystemPayload, type WsMessage } from '../src/shared/protocol.ts'

async function startServer(port: number) {
  const app = buildApp(defaultDirs())
  await app.listen({ port, host: '127.0.0.1' })
  return app
}

function connect(port: number, name: string): Promise<{ ws: WebSocket; messages: WsMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=${encodeURIComponent(name)}`)
    const messages: WsMessage[] = []
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const str = Buffer.isBuffer(data) ? data.toString() : new TextDecoder().decode(data as ArrayBuffer)
        messages.push(JSON.parse(str))
      } catch {
        /* ignore non-json */
      }
    })
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('error', reject)
  })
}

function waitForMessage(messages: WsMessage[], type: MsgType, timeoutMs = 2000): Promise<WsMessage> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = messages.find((m) => m.type === type)
      if (found) return resolve(found)
      if (Date.now() > deadline) return reject(new Error(`timeout waiting for ${type}`))
      setTimeout(check, 20)
    }
    check()
  })
}

const PORT = 3130

test('两个客户端互发消息', async (t) => {
  const app = await startServer(PORT)
  t.after(() => app.close())

  const a = await connect(PORT, 'alice')
  const b = await connect(PORT, 'bob')

  // 双方都应收到 presence
  await waitForMessage(a.messages, MsgType.presence)
  await waitForMessage(b.messages, MsgType.presence)

  // alice 发一条，bob 应收到
  const chatMsg: WsMessage = { type: MsgType.chat, payload: { text: 'hi bob' }, ts: Date.now() }
  a.ws.send(JSON.stringify(chatMsg))
  const received = await waitForMessage(b.messages, MsgType.chat)
  const payload = received.payload as ChatPayload
  assert.equal(payload.from, 'alice')
  assert.equal(payload.text, 'hi bob')

  a.ws.close()
  b.ws.close()
})

test('4 人上限：第 5 个被拒', async (t) => {
  const app = await startServer(PORT + 1)
  t.after(() => app.close())

  const clients: Array<{ ws: WebSocket; messages: WsMessage[] }> = []
  for (let i = 0; i < 4; i++) {
    clients.push(await connect(PORT + 1, `u${i}`))
  }

  // 第 5 个应收到 system 拒绝并被关闭
  const fifth = await connect(PORT + 1, 'overflow')
  const sys = await waitForMessage(fifth.messages, MsgType.system)
  assert.match((sys.payload as SystemPayload).reason, /full/)
  // socket 应已关闭
  await once(fifth.ws, 'close')

  for (const c of clients) c.ws.close()
})

test('断线后自动 leave，presence 更新', async (t) => {
  const app = await startServer(PORT + 2)
  t.after(() => app.close())

  const a = await connect(PORT + 2, 'alice')
  const b = await connect(PORT + 2, 'bob')
  await waitForMessage(b.messages, MsgType.presence)

  // alice 断线
  a.ws.close()

  // bob 应收到新的 presence（只剩 bob）+ system "alice left"
  const sys = await waitForMessage(b.messages, MsgType.system)
  assert.match((sys.payload as SystemPayload).reason, /left/)
  // 最后一条 presence 应只有 bob
  const presences = b.messages.filter((m) => m.type === MsgType.presence)
  const last = presences[presences.length - 1]!.payload as PresencePayload
  assert.deepEqual(last.users, ['bob'])

  b.ws.close()
})
