import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { buildApp } from '../src/server/app.ts'

function makeApp() {
  return buildApp({ publicDir: path.resolve('public'), webDir: path.resolve('src/web') })
}

test('GET /healthz 返回 ok', async () => {
  const app = makeApp()
  const res = await app.inject({ method: 'GET', url: '/healthz' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().ok, true)
})

test('GET / 返回首页 HTML', async () => {
  const app = makeApp()
  const res = await app.inject({ method: 'GET', url: '/' })
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /讨论室/)
})
