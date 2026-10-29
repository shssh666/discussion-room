import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, defaultDirs } from '../src/server/app.ts'

const PORT = 3170

async function startServer() {
  const app = buildApp(defaultDirs())
  await app.listen({ port: PORT, host: '127.0.0.1' })
  return app
}

// Minimal valid PNG (1x1 pixel)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
)

test('正常上传 PNG 并下载', async (t) => {
  const app = await startServer()
  t.after(() => app.close())

  // Upload
  const form = new FormData()
  form.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'test.png')
  const uploadRes = await fetch(`http://127.0.0.1:${PORT}/upload`, { method: 'POST', body: form })
  assert.equal(uploadRes.status, 200)
  const uploaded = (await uploadRes.json()) as { name: string; size: number }
  assert.ok(uploaded.name.endsWith('.png'))
  assert.equal(uploaded.size, TINY_PNG.length)

  // Download
  const dlRes = await fetch(`http://127.0.0.1:${PORT}/files/${uploaded.name}`)
  assert.equal(dlRes.status, 200)
  const buf = Buffer.from(await dlRes.arrayBuffer())
  assert.deepEqual(buf, TINY_PNG)
})

test('超大文件被拒绝', async (t) => {
  const app = await startServer()
  t.after(() => app.close())

  // Create an 11MB buffer
  const big = Buffer.alloc(11 * 1024 * 1024, 0x41)
  const form = new FormData()
  form.append('file', new Blob([big], { type: 'image/png' }), 'big.png')
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/upload`, { method: 'POST', body: form })
    // 如果收到响应，应该是 413 或 400
    assert.ok(res.status === 413 || res.status === 400, `expected 413/400, got ${res.status}`)
  } catch (err) {
    // 服务端可能提前断开连接（EPIPE），这也是有效的拒绝
    assert.ok(err instanceof TypeError || (err as Error).message?.includes('EPIPE'), 'expected connection error')
  }
})

test('非法扩展名被拒绝', async (t) => {
  const app = await startServer()
  t.after(() => app.close())

  const form = new FormData()
  form.append('file', new Blob(['evil'], { type: 'application/x-executable' }), 'malware.exe')
  const res = await fetch(`http://127.0.0.1:${PORT}/upload`, { method: 'POST', body: form })
  assert.equal(res.status, 415)
})

test('路径穿越被拒绝', async (t) => {
  const app = await startServer()
  t.after(() => app.close())

  const res = await fetch(`http://127.0.0.1:${PORT}/files/../../../etc/passwd`)
  assert.ok(res.status === 400 || res.status === 404, `expected 400/404, got ${res.status}`)
})

test('MIME 伪装被拒绝（PNG 扩展名但内容是文本）', async (t) => {
  const app = await startServer()
  t.after(() => app.close())

  const form = new FormData()
  form.append('file', new Blob(['not a real png'], { type: 'image/png' }), 'fake.png')
  const res = await fetch(`http://127.0.0.1:${PORT}/upload`, { method: 'POST', body: form })
  assert.equal(res.status, 415)
})
