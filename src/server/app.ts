import { existsSync } from 'node:fs'
import path from 'node:path'
import fastify from 'fastify'
import fastifyStatic from '@fastify/static'

export interface AppOptions {
  publicDir: string
  webDir: string
  sharedDir: string
}

/** 构建产物存在用 dist，否则回退源码目录（dev 模式页面需先 build 一次） */
export function defaultDirs(): AppOptions {
  const useDist = existsSync(path.resolve('dist'))
  return {
    publicDir: useDist ? path.resolve('dist/public') : path.resolve('public'),
    webDir: useDist ? path.resolve('dist/web') : path.resolve('src/web'),
    sharedDir: useDist ? path.resolve('dist/shared') : path.resolve('src/shared'),
  }
}

export function buildApp(opts: AppOptions) {
  const app = fastify({ logger: false })

  app.register(fastifyStatic, { root: opts.publicDir, prefix: '/' })
  app.register(fastifyStatic, { root: opts.webDir, prefix: '/js/', decorateReply: false })
  // 前端模块图完整性：web 代码 import 的 shared 模块必须可被浏览器解析
  app.register(fastifyStatic, {
    root: opts.sharedDir,
    prefix: '/shared/',
    decorateReply: false,
  })

  app.get('/healthz', async () => ({ ok: true, ts: Date.now() }))

  return app
}
