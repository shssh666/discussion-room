import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { WebSocketServer } from 'ws'
import { Room } from './room.ts'
import uploadPlugin from './upload.ts'
import convertPlugin from './convert.ts'
import { MsgType, type WsMessage } from '../shared/protocol.ts'

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
  app.register(fastifyStatic, { root: opts.sharedDir, prefix: '/shared/', decorateReply: false })

  // mermaid UMD 产物直供（无打包器约束下的 vendor 方案）
  try {
    const req = createRequire(import.meta.url)
    const mermaidDist = path.join(path.dirname(req.resolve('mermaid/package.json')), 'dist')
    app.register(fastifyStatic, { root: mermaidDist, prefix: '/js/vendor/', decorateReply: false })
  } catch {
    /* mermaid 未安装时跳过 vendor 路由，前端降级为纯文本展示 */
  }

  // 文件上传下载（流式处理，不整体读入内存）
  app.register(uploadPlugin)
  // PPT 转换（即起即灭容器，并发=1，120s 超时）
  app.register(convertPlugin)

  app.get('/healthz', async () => ({ ok: true, ts: Date.now() }))

  // 单房间 MVP；后续 PR#7 做多房间管理
  const room = new Room('default')

  // 直接用 ws 库处理 upgrade，绕过 @fastify/websocket 封装问题
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 }) // 64KB 帧上限
  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const name = url.searchParams.get('name')?.trim() || `user-${Math.random().toString(36).slice(2, 6)}`
      let clientId: string | null = null

      room
        .join(ws, name)
        .then((client) => {
          clientId = client.id
        })
        .catch((err: Error) => {
          const msg: WsMessage = { type: MsgType.system, payload: { reason: err.message }, ts: Date.now() }
          ws.send(JSON.stringify(msg))
          ws.close()
        })

      ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        if (!clientId) return
        let parsed: WsMessage
        try {
          const str = Buffer.isBuffer(raw) ? raw.toString() : new TextDecoder().decode(raw as ArrayBuffer)
          parsed = JSON.parse(str)
        } catch {
          return // 非法 JSON 静默丢弃
        }
        // 防御：payload 为 null/非对象时不崩溃
        if (!parsed || typeof parsed !== 'object') return
        if (parsed.type === MsgType.chat && parsed.payload && typeof (parsed.payload as { text?: string }).text === 'string') {
          const text = (parsed.payload as { text: string }).text
          if (text.length > 10_000) return
          void room.sendChat(clientId, text)
        }
        if (parsed.type === MsgType.demo && parsed.payload && typeof (parsed.payload as { file?: string }).file === 'string') {
          const p = parsed.payload as { file: string; page?: number; total?: number }
          void room.sendDemo(clientId, p.file, p.page, p.total)
        }
      })

      ws.on('error', () => {
        // 协议错误静默处理，close 事件会跟进清理
      })

      ws.on('close', () => {
        if (clientId) void room.leave(clientId)
      })
    })
  })

  return app
}
