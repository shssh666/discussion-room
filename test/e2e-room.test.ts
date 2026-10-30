import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import WebSocket from 'ws'
import { buildApp, defaultDirs } from '../src/server/app.ts'
import { MsgType, type ChatPayload, type WsMessage } from '../src/shared/protocol.ts'

let portSeq = 3200
const nextPort = () => ++portSeq

async function startServer(port: number) {
  const app = buildApp(defaultDirs())
  await app.listen({ port, host: '127.0.0.1' })
  return app
}

function connect(port: number, name: string, room = 'default'): Promise<{ ws: WebSocket; messages: WsMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}&name=${encodeURIComponent(name)}`)
    const messages: WsMessage[] = []
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const str = Buffer.isBuffer(data) ? data.toString() : new TextDecoder().decode(data as ArrayBuffer)
        messages.push(JSON.parse(str))
      } catch {
        /* ignore */
      }
    })
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('error', reject)
  })
}

function waitFor(messages: WsMessage[], type: MsgType, timeoutMs = 2000): Promise<WsMessage> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = messages.find((m) => m.type === type)
      if (found) return resolve(found)
      if (Date.now() > deadline) return reject(new Error(`timeout waiting ${type}`))
      setTimeout(check, 20)
    }
    check()
  })
}

/** 轮询直到条件成立或超时，替代固定 sleep，降低 CI 时序脆弱性 */
async function waitUntil(fn: () => Promise<boolean>, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

test('不同房间消息隔离', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const a = await connect(port, 'alice', 'roomA')
  const b = await connect(port, 'bob', 'roomB')
  const c = await connect(port, 'carol', 'roomA')
  await waitFor(a.messages, MsgType.presence)
  await waitFor(c.messages, MsgType.presence)

  a.ws.send(JSON.stringify({ type: MsgType.chat, payload: { text: 'hello A' }, ts: Date.now() }))
  // c 同房间应收到
  const got = await waitFor(c.messages, MsgType.chat)
  assert.equal((got.payload as ChatPayload).text, 'hello A')
  // b 不同房间不应收到
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(b.messages.filter((m) => m.type === MsgType.chat).length, 0)

  a.ws.close()
  b.ws.close()
  c.ws.close()
})

test('每房间独立 4 人上限', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const inA: Array<{ ws: WebSocket }> = []
  for (let i = 0; i < 4; i++) inA.push(await connect(port, `a${i}`, 'capA'))
  // 第 5 个进 capA 被拒
  const fifth = await connect(port, 'overflow', 'capA')
  const sys = await waitFor(fifth.messages, MsgType.system)
  assert.match((sys.payload as { reason: string }).reason, /full/)
  await once(fifth.ws, 'close')
  // 但 capB 还能进
  const b0 = await connect(port, 'b0', 'capB')
  await waitFor(b0.messages, MsgType.presence)

  for (const c of inA) c.ws.close()
  b0.ws.close()
})

test('/rooms 列出房间及人数', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const a = await connect(port, 'x', 'listRoom')
  const b = await connect(port, 'y', 'listRoom')
  await waitFor(b.messages, MsgType.presence)

  const res = await fetch(`http://127.0.0.1:${port}/rooms`)
  const rooms = (await res.json()) as Array<{ id: string; users: number }>
  const target = rooms.find((r) => r.id === 'listRoom')
  assert.ok(target, 'listRoom 应出现在列表')
  assert.equal(target!.users, 2)

  a.ws.close()
  b.ws.close()
})

test('空房延迟回收（真验证回收发生）', async (t) => {
  const port = nextPort()
  // 注入短回收延迟，真正验证"空房被删"而非仅"延迟内还在"
  const app = buildApp({ ...defaultDirs(), gcDelayMs: 300 })
  await app.listen({ port, host: '127.0.0.1' })
  t.after(() => app.close())

  const a = await connect(port, 'solo', 'gcRoom')
  await waitFor(a.messages, MsgType.presence)
  a.ws.close()

  // 延迟内：房间还在（users=0）
  await new Promise((r) => setTimeout(r, 100))
  const rooms = (await (await fetch(`http://127.0.0.1:${port}/rooms`)).json()) as Array<{ id: string; users: number }>
  assert.ok(rooms.some((r) => r.id === 'gcRoom'), '延迟期内房间应仍存在')

  // 超过 gcDelay：轮询等待回收发生（避免固定 sleep 的时序脆弱）
  const gone = await waitUntil(async () => {
    const rs = (await (await fetch(`http://127.0.0.1:${port}/rooms`)).json()) as Array<{ id: string }>
    return !rs.some((r) => r.id === 'gcRoom')
  }, 3000)
  assert.ok(gone, '超过 gcDelay 后空房应被回收')
})
