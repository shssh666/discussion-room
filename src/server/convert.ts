import { existsSync, mkdirSync, statSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import path from 'node:path'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'

export const CONVERT_DIR = path.resolve('data/converted')
const MAX_INPUT = 50 * 1024 * 1024 // 50MB
const TIMEOUT_MS = 120_000
const CACHE_MAX_FILES = 100

export interface Converter {
  convert(src: string, dest: string, signal: AbortSignal): Promise<void>
}

/** 即起即灭的 LibreOffice 容器（hermes 1.9G 内存约束：禁止常驻） */
export const dockerConverter: Converter = {
  convert(src, dest, signal) {
    return new Promise<void>((resolve, reject) => {
      const cname = `cr-conv-${crypto.randomUUID().slice(0, 8)}`
      const tmpDir = path.join(path.dirname(dest), `.tmp-${cname}`)
      mkdirSync(tmpDir, { recursive: true })
      const child = spawn('docker', [
        'run', '--name', cname, '--network', 'none', '--memory', '512m', '--cpus', '1',
        '-v', `${path.dirname(src)}:/in:ro`,
        '-v', `${tmpDir}:/out`,
        'libreoffice-headless:latest',
        '--headless', '--convert-to', 'pdf', '--outdir', '/out', `/in/${path.basename(src)}`,
      ])
      // 杀 CLI 不等于停容器：显式 docker rm -f 保证清理（幂等）
      const cleanupContainer = () => {
        spawn('docker', ['rm', '-f', cname]).on('error', () => {})
      }
      const fail = (err: Error) => {
        rmSync(tmpDir, { recursive: true, force: true })
        cleanupContainer()
        reject(err)
      }
      const onAbort = () => {
        cleanupContainer()
        child.kill('SIGKILL')
      }
      signal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => {
        cleanupContainer()
        child.kill('SIGKILL')
      }, TIMEOUT_MS)
      child.on('error', (err) => {
        clearTimeout(timer)
        fail(err)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        const tmpFile = path.join(tmpDir, `${path.basename(src, '.pptx')}.pdf`)
        if (code === 0 && existsSync(tmpFile)) {
          // 先写 tmp 再原子 rename，失败/被杀不留半写文件冒充缓存
          renameSync(tmpFile, dest)
          rmSync(tmpDir, { recursive: true, force: true })
          cleanupContainer()
          resolve()
        } else {
          fail(new Error(`convert exited ${code}`))
        }
      })
    })
  },
}

/** e2e 用假转换器 */
export const fakeConverter: Converter = {
  async convert(_src, dest) {
    const delay = Number(process.env.CR_FAKE_DELAY || 0)
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    writeFileSync(dest, '%PDF-1.4\n% fake converted\n')
  },
}

export function getConverter(): Converter {
  return process.env.CR_CONVERT_MODE === 'fake' ? fakeConverter : dockerConverter
}

let converting = false // 并发=1：转换是 CPU/内存密集，串行化

/** 缓存上限：超过 CACHE_MAX_FILES 按 mtime 删最旧，防 data/converted 无限增长 */
function pruneCache(): void {
  try {
    const entries = readdirSync(CONVERT_DIR)
      .filter((f) => f.endsWith('.pdf'))
      .map((f) => ({ f, m: statSync(path.join(CONVERT_DIR, f)).mtimeMs }))
      .sort((a, b) => a.m - b.m)
    while (entries.length > CACHE_MAX_FILES) {
      const oldest = entries.shift()
      if (oldest) rmSync(path.join(CONVERT_DIR, oldest.f), { force: true })
    }
  } catch {
    /* 清理失败不阻断转换 */
  }
}

async function convertPlugin(app: FastifyInstance): Promise<void> {
  if (!existsSync(CONVERT_DIR)) mkdirSync(CONVERT_DIR, { recursive: true })
  const uploadDir = path.resolve('data/files')

  app.post('/convert', async (req: FastifyRequest<{ Body: { name?: string } }>, reply: FastifyReply) => {
    const rawName = req.body?.name
    if (typeof rawName !== 'string') return reply.status(400).send({ error: 'name required' })
    const name = path.basename(rawName)
    if (name !== rawName || name.includes('..')) return reply.status(400).send({ error: 'invalid filename' })
    if (!name.endsWith('.pptx')) return reply.status(400).send({ error: 'only .pptx supported' })

    const src = path.join(uploadDir, name)
    if (!existsSync(src)) return reply.status(404).send({ error: 'source not found' })
    if (statSync(src).size > MAX_INPUT) return reply.status(413).send({ error: 'file too large to convert' })

    const outName = `${path.basename(name, '.pptx')}.pdf`
    const dest = path.join(CONVERT_DIR, outName)
    if (existsSync(dest)) return reply.send({ pdf: outName, cached: true }) // 缓存命中

    if (converting) return reply.status(409).send({ error: 'another conversion in progress' })
    converting = true
    pruneCache()
    const ac = new AbortController()
    try {
      await getConverter().convert(src, dest, ac.signal)
      return reply.send({ pdf: outName, cached: false })
    } catch (err) {
      return reply.status(500).send({ error: `convert failed: ${(err as Error).message}` })
    } finally {
      converting = false
    }
  })

  app.get('/converted/:name', async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const name = path.basename(req.params.name)
    if (name !== req.params.name || name.includes('..')) return reply.status(400).send({ error: 'invalid filename' })
    if (!name.endsWith('.pdf')) return reply.status(400).send({ error: 'only pdf served here' })
    const filePath = path.join(CONVERT_DIR, name)
    if (!existsSync(filePath)) return reply.status(404).send({ error: 'not found' })
    return reply.sendFile(name, CONVERT_DIR)
  })
}

export default fp(convertPlugin, { name: 'convert' })
