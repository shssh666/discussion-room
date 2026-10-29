import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, defaultDirs } from '../src/server/app.ts'

// 依赖 dist 产物，由 npm test 脚本先执行 build
const app = buildApp(defaultDirs())

test('GET /healthz 返回 ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/healthz' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().ok, true)
})

test('GET / 返回首页 HTML', async () => {
  const res = await app.inject({ method: 'GET', url: '/' })
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /讨论室/)
})

test('GET /js/main.js 可访问', async () => {
  const res = await app.inject({ method: 'GET', url: '/js/main.js' })
  assert.equal(res.statusCode, 200)
})

test('GET /shared/protocol.js 可访问（前端模块图完整性）', async () => {
  const res = await app.inject({ method: 'GET', url: '/shared/protocol.js' })
  assert.equal(res.statusCode, 200)
})
