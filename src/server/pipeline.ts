import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { config } from './config.ts'

/**
 * /api/pipeline：流水线状态的结构化 JSON（M5 度量看板的数据层）。
 * 同一份数据既喂无限画布前端，也供 AI 审查者机器读取（"AI 查看更直观"）。
 * 无 PG_DSN 或连接失败时优雅降级为空态，不阻塞应用。
 */

interface PipelineJSON {
  generatedAt: string
  store: 'pg' | 'degraded'
  stages: Array<{ id: string; name: string; status: 'ok' | 'warn' | 'fail' | 'idle'; note: string }>
  engines: Array<{ id: string; name: string; status: string; runs: number; lastRun: string | null; reviewerVersion: string | null }>
  prs: Array<{
    number: number
    merged: boolean
    reverted: boolean
    rounds: number
    findings: number
    high: number
    medium: number
    low: number
  }>
  findingsByCategory: Array<{ category: string; total: number; fixed: number; high: number }>
  guardrails: { revertRate: number | null; incidentRate: number | null }
}

/** 存量库自愈迁移（幂等）：补齐 M2 列；mode 约束 DROP 后必须 ADD 回扩展版，防新库/存量库 schema 分叉 */
async function migrate(p: import('pg').Pool): Promise<void> {
  await p.query(`ALTER TABLE findings ADD COLUMN IF NOT EXISTS category text`)
  await p.query(`ALTER TABLE findings ADD COLUMN IF NOT EXISTS m2_severity text`)
  await p.query(`ALTER TABLE review_runs DROP CONSTRAINT IF EXISTS review_runs_mode_check`)
  await p.query(`ALTER TABLE review_runs ADD CONSTRAINT review_runs_mode_check CHECK (mode IN ('quick','standard','deep','m2'))`)
}

const EMPTY: PipelineJSON = {
  generatedAt: '',
  store: 'degraded',
  stages: [
    { id: 'pre', name: 'PR 前', status: 'idle', note: 'M1 验证工具箱未部署' },
    { id: 'during', name: 'PR 中', status: 'idle', note: '审查引擎状态未知' },
    { id: 'merge', name: '合并时', status: 'idle', note: '门禁状态未知' },
    { id: 'post', name: '合并后', status: 'idle', note: '回滚监控未接入' },
  ],
  engines: [],
  prs: [],
  findingsByCategory: [],
  guardrails: { revertRate: null, incidentRate: null },
}

async function pipelinePlugin(app: FastifyInstance): Promise<void> {
  let pool: import('pg').Pool | null = null
  let poolInit: Promise<import('pg').Pool | null> | null = null // 单飞：并发请求共用一次初始化
  let lastFail = 0
  const RETRY_COOLDOWN = 30_000 // PG 短暂不可用时 30s 内不重试，避免每请求新建池

  async function getPool() {
    if (pool) return pool
    if (Date.now() - lastFail < RETRY_COOLDOWN) return null
    if (!poolInit) {
      poolInit = (async () => {
        const dsn = config.pgDsn
        if (!dsn) return null
        let p: import('pg').Pool | null = null
        try {
          const pg = (await import('pg')).default
          p = new pg.Pool({ connectionString: dsn, connectionTimeoutMillis: 2000, max: 2 })
          p.on('error', (err: Error) => {
            // idle 连接报错必须有监听，否则 Node 以 uncaughtException 崩进程
            console.error('[pg] pool error:', err.message)
          })
          await p.query('select 1')
          await migrate(p) // 存量库自愈：补齐 M2 列与 mode 约束
          pool = p
          return p
        } catch {
          if (p) await p.end().catch(() => {}) // 失败的池要 end，防连接泄漏
          pool = null
          lastFail = Date.now()
          return null
        } finally {
          poolInit = null
        }
      })()
    }
    return poolInit
  }

  app.get('/api/pipeline', async (_req: FastifyRequest, reply: FastifyReply) => {
    const p = await getPool()
    if (!p) {
      return reply.send({ ...EMPTY, generatedAt: new Date().toISOString() })
    }
    try {
      const prsQ = await p.query(`
        SELECT p.number,
               (p.merged_at IS NOT NULL) AS merged,
               p.reverted,
               COALESCE(MAX(r.round), 0) AS rounds,
               COUNT(f.id) AS findings,
               COUNT(f.id) FILTER (WHERE f.m2_severity='high') AS high,
               COUNT(f.id) FILTER (WHERE f.m2_severity='medium') AS medium,
               COUNT(f.id) FILTER (WHERE f.m2_severity='low') AS low
        FROM prs p
        LEFT JOIN review_runs r ON r.pr_id = p.id AND r.mode = 'm2'
        LEFT JOIN findings f ON f.run_id = r.id
        GROUP BY p.id, p.number, p.merged_at, p.reverted
        ORDER BY p.number`)
      const catQ = await p.query(`
        SELECT COALESCE(category, 'uncategorized') AS category,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status='fixed') AS fixed,
               COUNT(*) FILTER (WHERE m2_severity='high') AS high
        FROM findings GROUP BY COALESCE(category, 'uncategorized') ORDER BY total DESC`)
      const engQ = await p.query(`
        SELECT COUNT(*) AS runs, MAX(ts) AS last, COUNT(DISTINCT reviewer_version) AS versions,
               MAX(reviewer_version) AS version
        FROM review_runs WHERE mode='m2'`)

      const prs = prsQ.rows.map((r) => ({
        number: Number(r.number),
        merged: Boolean(r.merged),
        reverted: Boolean(r.reverted),
        rounds: Number(r.rounds),
        findings: Number(r.findings),
        high: Number(r.high),
        medium: Number(r.medium),
        low: Number(r.low),
      }))
      const eng = engQ.rows[0]
      const totalFindings = prs.reduce((s, x) => s + x.findings, 0)
      const highOpen = prs.reduce((s, x) => s + x.high, 0)

      const stages: PipelineJSON['stages'] = [
        { id: 'pre', name: 'PR 前', status: 'idle', note: 'M1 验证工具箱未部署' },
        {
          id: 'during',
          name: 'PR 中',
          status: highOpen > 0 ? 'warn' : 'ok',
          note: `M2 累计 ${totalFindings} findings（high ${highOpen}）`,
        },
        { id: 'merge', name: '合并时', status: 'ok', note: '分支保护：PR + CI 绿 + 禁 force push' },
        { id: 'post', name: '合并后', status: 'idle', note: '回滚监控未接入' },
      ]

      return reply.send({
        generatedAt: new Date().toISOString(),
        store: 'pg',
        stages,
        engines: [
          {
            id: 'm2',
            name: 'cr-m2（自研）',
            status: 'running',
            runs: Number(eng?.runs ?? 0),
            lastRun: eng?.last ? new Date(eng.last).toISOString() : null,
            reviewerVersion: eng?.version ?? null,
          },
          { id: 'dsh', name: 'DSH-action（外部）', status: 'external', runs: 0, lastRun: null, reviewerVersion: null },
        ],
        prs,
        findingsByCategory: catQ.rows.map((r) => ({
          category: r.category,
          total: Number(r.total),
          fixed: Number(r.fixed),
          high: Number(r.high),
        })),
        guardrails: { revertRate: null, incidentRate: null },
      } satisfies PipelineJSON)
    } catch {
      return reply.send({ ...EMPTY, generatedAt: new Date().toISOString(), store: 'degraded' })
    }
  })
}

export default fp(pipelinePlugin, { name: 'pipeline' })
