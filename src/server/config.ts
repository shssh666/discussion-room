function readInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

export const config = {
  port: readInt('PORT', 3000),
  host: process.env['HOST'] ?? '127.0.0.1',
}
