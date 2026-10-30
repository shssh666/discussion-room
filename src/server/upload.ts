import { createWriteStream, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import multipart from '@fastify/multipart'
import fp from 'fastify-plugin'

const UPLOAD_DIR = path.resolve('data/files')
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.pptx', '.svg', '.mmd'])

const MAGIC: Array<{ ext: string; bytes: number[] }> = [
  { ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: '.jpeg', bytes: [0xff, 0xd8, 0xff] },
  { ext: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: '.pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { ext: '.pptx', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { ext: '.svg', bytes: [] },
  { ext: '.mmd', bytes: [] }, // 纯文本 mermaid 源码，跳过 magic 校验
]

async function uploadPlugin(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE, files: 1 } })

  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })

  app.post('/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const file = await req.file()
    if (!file) return reply.status(400).send({ error: 'no file' })

    const ext = path.extname(file.filename).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      await file.toBuffer().catch(() => null)
      return reply.status(415).send({ error: `extension ${ext} not allowed` })
    }

    const chunks: Buffer[] = []
    let totalSize = 0
    const savedName = `${crypto.randomUUID()}${ext}`
    const dest = path.join(UPLOAD_DIR, savedName)
    const ws = createWriteStream(dest)

    let sizeExceeded = false
    try {
      for await (const chunk of file.file) {
        totalSize += chunk.length
        if (totalSize > MAX_FILE_SIZE) {
          sizeExceeded = true
          ws.destroy()
          break
        }
        chunks.push(chunk)
        ws.write(chunk)
      }
      if (!sizeExceeded) {
        await new Promise<void>((resolve, reject) => {
          ws.end(() => resolve())
          ws.on('error', reject)
        })
      }
    } catch (err) {
      ws.destroy()
      // multipart 超限也会抛错，统一归为 413
      const msg = (err as Error).message || ''
      if (msg.includes('limit') || msg.includes('size')) {
        return reply.status(413).send({ error: 'file too large' })
      }
      return reply.status(500).send({ error: 'upload failed' })
    }

    if (sizeExceeded) {
      // 清理半写文件
      try { unlinkSync(dest) } catch { /* ignore */ }
      return reply.status(413).send({ error: 'file too large' })
    }

    if (chunks.length > 0) {
      const head = Buffer.concat(chunks.slice(0, 1))
      const magicMatch = MAGIC.find((m) => m.ext === ext)
      if (magicMatch && magicMatch.bytes.length > 0) {
        const ok = magicMatch.bytes.every((b, i) => head[i] === b)
        if (!ok) {
          try { unlinkSync(dest) } catch { /* ignore */ }
          return reply.status(415).send({ error: 'MIME mismatch' })
        }
      }
    }

    return reply.send({ name: savedName, size: totalSize })
  })

  app.get('/files/:name', async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const name = path.basename(req.params.name)
    if (name !== req.params.name || name.includes('..')) {
      return reply.status(400).send({ error: 'invalid filename' })
    }
    const filePath = path.join(UPLOAD_DIR, name)
    if (!existsSync(filePath)) return reply.status(404).send({ error: 'not found' })
    // SVG 强制下载，防止存储型 XSS（同源 inline 会执行内嵌脚本）
    if (name.endsWith('.svg')) {
      reply.header('Content-Disposition', `attachment; filename="${name}"`)
    }
    return reply.sendFile(name, UPLOAD_DIR)
  })

  app.get('/files', async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!existsSync(UPLOAD_DIR)) return reply.send([])
    const files = readdirSync(UPLOAD_DIR)
      .filter((f) => !f.startsWith('.'))
      .map((n) => {
        const st = statSync(path.join(UPLOAD_DIR, n))
        return { name: n, size: st.size, uploadedAt: st.mtime.toISOString() }
      })
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    return reply.send(files)
  })
}

export default fp(uploadPlugin, { name: 'upload' })
