import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, defaultDirs } from '../src/server/app.ts'

let portSeq = 3190
const nextPort = () => ++portSeq

const MMD_SRC = 'graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[结束]\n'

async function startServer(port: number) {
  const app = buildApp(defaultDirs())
  await app.listen({ port, host: '127.0.0.1' })
  return app
}

test('上传 mermaid 源码并可取回', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const form = new FormData()
  form.append('file', new Blob([MMD_SRC], { type: 'text/plain' }), 'flow.mmd')
  const up = await fetch(`http://127.0.0.1:${port}/upload`, { method: 'POST', body: form })
  assert.equal(up.status, 200)
  const { name } = (await up.json()) as { name: string }
  assert.ok(name.endsWith('.mmd'))

  const dl = await fetch(`http://127.0.0.1:${port}/files/${encodeURIComponent(name)}`)
  assert.equal(dl.status, 200)
  assert.equal(await dl.text(), MMD_SRC)
})

test('mermaid vendor 脚本可访问', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const res = await fetch(`http://127.0.0.1:${port}/js/vendor/mermaid.min.js`)
  assert.equal(res.status, 200)
  const body = await res.text()
  assert.ok(body.length > 100_000, 'mermaid.min.js 应为一个较大的 bundle')
})

test('mmd 出现在文件列表', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const form = new FormData()
  form.append('file', new Blob([MMD_SRC], { type: 'text/plain' }), 'list.mmd')
  await fetch(`http://127.0.0.1:${port}/upload`, { method: 'POST', body: form })

  const list = (await (await fetch(`http://127.0.0.1:${port}/files`)).json()) as Array<{ name: string }>
  assert.ok(list.some((f) => f.name.endsWith('.mmd')))
})
