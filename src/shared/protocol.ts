export const MsgType = {
  chat: 'chat',
  presence: 'presence',
  demo: 'demo',
  system: 'system',
} as const

export type MsgType = (typeof MsgType)[keyof typeof MsgType]

/** 所有 WebSocket 消息的统一信封（见 CLAUDE.md 约定） */
export interface WsMessage {
  type: MsgType
  payload: unknown
  ts: number
}

export interface ChatPayload {
  id: string
  from: string
  text: string
}

export interface PresencePayload {
  users: string[]
  max: number
}

export interface SystemPayload {
  reason: string
  detail?: string
}

export interface DemoPayload {
  file: string
  page?: number
  total?: number
  presenter?: string
}

/** 房间 ID 清洗：服务端与前端共用单一实现，防规则漂移 */
export function sanitizeRoomId(raw: string | null | undefined): string {
  return (raw || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default'
}
