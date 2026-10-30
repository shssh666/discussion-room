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

test('PG 聚合路径（仅在提供 PG_DSN 时运行，CI 无 PG 自动 skip）', async (t) => {
  const dsn = process.env.PG_DSN
  if (!dsn) {
    t.skip('无 PG_DSN，跳过 PG 聚合路径')
    return
  }
  const port = nextPort()
  const app = buildApp(defaultDirs())
  await app.listen({ port, host: '127.0.0.1' })
  t.after(() => app.close())

  const res = await fetch(`http://127.0.0.1:${port}/api/pipeline`)
  assert.equal(res.status, 200)
  const data = (await res.json()) as { store: string; prs: Array<{ number: number; rounds: number }>; findingsByCategory: Array<{ category: string }> }
  assert.equal(data.store, 'pg', '提供 PG_DSN 时应走 pg 而非降级')
  assert.ok(Array.isArray(data.prs))
  assert.ok(Array.isArray(data.findingsByCategory))
  // category 不应出现 null（COALESCE 生效）
  assert.ok(data.findingsByCategory.every((c) => c.category !== null && c.category !== ''))
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
