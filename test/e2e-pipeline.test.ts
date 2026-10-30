import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, defaultDirs } from '../src/server/app.ts'

let portSeq = 3220
const nextPort = () => ++portSeq

async function startServer(port: number) {
  const app = buildApp(defaultDirs())
  await app.listen({ port, host: '127.0.0.1' })
  return app
}

test('/api/pipeline 返回合法结构（无 PG 时降级）', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const res = await fetch(`http://127.0.0.1:${port}/api/pipeline`)
  assert.equal(res.status, 200)
  const data = (await res.json()) as {
    store: string
    stages: unknown[]
    engines: unknown[]
    prs: unknown[]
    findingsByCategory: unknown[]
    guardrails: { revertRate: number | null }
  }
  assert.ok(['pg', 'degraded'].includes(data.store))
  assert.equal(data.stages.length, 4)
  assert.ok(Array.isArray(data.engines))
  assert.ok(Array.isArray(data.prs))
  assert.ok(Array.isArray(data.findingsByCategory))
  assert.equal(data.guardrails.revertRate, null)
})

test('/canvas.html 与资源可访问', async (t) => {
  const port = nextPort()
  const app = await startServer(port)
  t.after(() => app.close())

  const html = await fetch(`http://127.0.0.1:${port}/canvas.html`)
  assert.equal(html.status, 200)
  assert.match(await html.text(), /viewport/)

  const css = await fetch(`http://127.0.0.1:${port}/canvas.css`)
  assert.equal(css.status, 200)

  const js = await fetch(`http://127.0.0.1:${port}/js/canvas.js`)
  assert.equal(js.status, 200)
})
