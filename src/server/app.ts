import { existsSync } from 'node:fs'
import path from 'node:path'
import fastify from 'fastify'
import fastifyStatic from '@fastify/static'

export interface AppOptions {
  publicDir: string
  webDir: string
}

/** 构建产物存在用 dist，否则回退源码目录（dev 模式页面需先 build 一次） */
export function defaultDirs(): AppOptions {
  const distPublic = path.resolve('dist/public')
  const distWeb = path.resolve('dist/web')
  return {
    publicDir: existsSync(distPublic) ? distPublic : path.resolve('public'),
    webDir: existsSync(distWeb) ? distWeb : path.resolve('src/web'),
  }
}

export function buildApp(opts: AppOptions) {
  const app = fastify({ logger: false })

  app.register(fastifyStatic, { root: opts.publicDir, prefix: '/' })
  app.register(fastifyStatic, {
    root: opts.webDir,
    prefix: '/js/',
    decorateReply: false,
  })

  app.get('/healthz', async () => ({ ok: true, ts: Date.now() }))

  return app
}
