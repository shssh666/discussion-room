import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, defaultDirs } from '../src/server/app.ts'

let portSeq = 3180
const nextPort = () => ++portSeq

// ZIP magic bytes + padding，伪装成 pptx（magic 校验只查头 4 字节）
const FAKE_PPTX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 0x41)])

async function startServer(port: number) {
  const app = buildApp(defaultDirs())
  await app.listen({ port, host: '127.0.0.1' })
  return app
}

async function uploadPptx(port: number): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([FAKE_PPTX], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), 'deck.pptx')
  const res = await fetch(`http://127.0.0.1:${port}/upload`, { method: 'POST', body: form })
  assert.equal(res.status, 200)
  return ((await res.json()) as { name: string }).name
}

test('pptx 转换并服务转换结果', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const name = await uploadPptx(port)
  const res = await fetch(`http://127.0.0.1:${port}/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  assert.equal(res.status, 200)
  const { pdf, cached } = (await res.json()) as { pdf: string; cached: boolean }
  assert.equal(cached, false)
  assert.ok(pdf.endsWith('.pdf'))

  // 二次请求命中缓存
  const res2 = await fetch(`http://127.0.0.1:${port}/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body2 = (await res2.json()) as { cached: boolean }
  assert.equal(body2.cached, true)

  // 转换结果可下载
  const dl = await fetch(`http://127.0.0.1:${port}/converted/${encodeURIComponent(pdf)}`)
  assert.equal(dl.status, 200)
  const buf = Buffer.from(await dl.arrayBuffer())
  assert.ok(buf.subarray(0, 5).toString() === '%PDF-')
})

test('非 pptx 拒绝转换', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())
  const res = await fetch(`http://127.0.0.1:${port}/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'pic.png' }),
  })
  assert.equal(res.status, 400)
})

test('路径穿越拒绝', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())
  const res = await fetch(`http://127.0.0.1:${port}/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '../../etc/passwd.pptx' }),
  })
  assert.equal(res.status, 400)
})

test('并发转换被拒（409）', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const name = await uploadPptx(port)
  const mk = () =>
    fetch(`http://127.0.0.1:${port}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  const [a, b] = await Promise.all([mk(), mk()])
  const codes = [a.status, b.status].sort()
  // 一个成功(200)，一个 409（fake delay 500ms 保证窗口）
  assert.deepEqual(codes, [200, 409], `got ${codes}`)
})

test('客户端断开 → 转换中止、串行锁释放', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const name = await uploadPptx(port)
  const client = new AbortController()
  const first = fetch(`http://127.0.0.1:${port}/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
    signal: client.signal,
  }).catch(() => null) // 客户端主动断开
  await new Promise((r) => setTimeout(r, 200))
  client.abort()
  await first
  await new Promise((r) => setTimeout(r, 300)) // 等服务端 abort 清理

  // 锁应已释放：第二次转换不再 409
  const second = await fetch(`http://127.0.0.1:${port}/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  assert.notEqual(second.status, 409, '串行锁未释放')
})
