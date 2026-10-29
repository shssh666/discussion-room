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
