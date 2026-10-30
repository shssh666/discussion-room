import type { WebSocket } from 'ws'
import { MsgType, type ChatPayload, type DemoPayload, type PresencePayload, type WsMessage } from '../shared/protocol.ts'

const MAX_USERS = 4

interface Client {
  id: string
  name: string
  socket: WebSocket
}

/**
 * Room：封装单个讨论室的状态与广播。
 * 所有状态变更通过 queue 串行化，避免 join/leave/broadcast 并发竞态（REVIEW.md 头号审查点）。
 */
export class Room {
  private clients = new Map<string, Client>()
  private pending: Array<() => Promise<void>> = []
  private draining = false
  readonly id: string
  readonly maxUsers: number

  constructor(id: string, maxUsers: number = MAX_USERS) {
    this.id = id
    this.maxUsers = maxUsers
  }

  get userCount(): number {
    return this.clients.size
  }

  getUsers(): string[] {
    return [...this.clients.values()].map((c) => c.name)
  }

  /** 加入房间；满员或重名抛错，由调用方转成 system 消息 */
  async join(socket: WebSocket, name: string): Promise<Client> {
    return this.enqueue(async () => {
      if (this.clients.size >= this.maxUsers) {
        throw new Error(`room full (${this.maxUsers})`)
      }
      const taken = [...this.clients.values()].some((c) => c.name === name)
      if (taken) throw new Error('name taken')
      const id = crypto.randomUUID()
      const client: Client = { id, name, socket }
      this.clients.set(id, client)
      this.broadcastPresence()
      this.broadcastSystem(`${name} joined`, { exclude: id })
      return client
    })
  }

  async leave(clientId: string): Promise<void> {
    await this.enqueue(async () => {
      const client = this.clients.get(clientId)
      if (!client) return
      this.clients.delete(clientId)
      this.broadcastPresence()
      this.broadcastSystem(`${client.name} left`)
    })
  }

  async sendChat(fromId: string, text: string): Promise<void> {
    await this.enqueue(async () => {
      const from = this.clients.get(fromId)
      if (!from) return
      const payload: ChatPayload = { id: crypto.randomUUID(), from: from.name, text }
      const msg: WsMessage = { type: MsgType.chat, payload, ts: Date.now() }
      this.sendToAll(msg)
    })
  }

  async sendDemo(fromId: string, file: string, page?: number, total?: number): Promise<void> {
    await this.enqueue(async () => {
      const from = this.clients.get(fromId)
      if (!from) return
      const payload: DemoPayload = { file, page, total, presenter: from.name }
      const msg: WsMessage = { type: MsgType.demo, payload, ts: Date.now() }
      this.sendToAll(msg)
    })
  }

  /** 把任意消息推给房间内所有人（用于外部事件，如演示翻页） */
  broadcast(msg: WsMessage): void {
    this.sendToAll(msg)
  }

  private broadcastPresence(): void {
    const payload: PresencePayload = { users: this.getUsers(), max: this.maxUsers }
    this.sendToAll({ type: MsgType.presence, payload, ts: Date.now() })
  }

  private broadcastSystem(reason: string, opts?: { exclude?: string }): void {
    const msg: WsMessage = { type: MsgType.system, payload: { reason }, ts: Date.now() }
    for (const [id, client] of this.clients) {
      if (opts?.exclude === id) continue
      safeSend(client.socket, msg)
    }
  }

  private sendToAll(msg: WsMessage): void {
    for (const client of this.clients.values()) {
      safeSend(client.socket, msg)
    }
  }

  /** 简易串行队列：保证同一时刻只有一个状态变更在执行 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push(async () => {
        try {
          resolve(await fn())
        } catch (err) {
          reject(err)
        }
      })
      if (!this.draining) void this.drain()
    })
  }

  private async drain(): Promise<void> {
    this.draining = true
    while (this.pending.length > 0) {
      const task = this.pending.shift()!
      await task()
    }
    this.draining = false
  }
}

function safeSend(socket: WebSocket, msg: WsMessage): void {
  if (socket.readyState !== 1 /* OPEN */) return
  try {
    socket.send(JSON.stringify(msg))
  } catch {
    // swallow — client already gone
  }
}

/**
 * RoomRegistry：多房间管理。房间按需创建，空房间延迟回收。
 * 回收走串行队列外的简单 setTimeout（房间无状态，回收只是删 Map 条目）。
 */
export class RoomRegistry {
  private rooms = new Map<string, Room>()
  private gcTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly gcDelayMs: number

  constructor(gcDelayMs = 60_000) {
    this.gcDelayMs = gcDelayMs
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id)
  }

  getOrCreate(id: string, maxUsers?: number): Room {
    let room = this.rooms.get(id)
    if (!room) {
      room = new Room(id, maxUsers)
      this.rooms.set(id, room)
    }
    // 有人进来就取消回收
    const t = this.gcTimers.get(id)
    if (t) {
      clearTimeout(t)
      this.gcTimers.delete(id)
    }
    return room
  }

  /** 房间空了之后安排回收；gcDelay 内有人进来则取消 */
  scheduleGC(id: string): void {
    if (this.gcTimers.has(id)) return
    const t = setTimeout(() => {
      const room = this.rooms.get(id)
      if (room && room.userCount === 0) {
        this.rooms.delete(id)
      }
      this.gcTimers.delete(id)
    }, this.gcDelayMs)
    // 不阻塞进程退出
    if (typeof t === 'object' && 'unref' in t) t.unref()
    this.gcTimers.set(id, t)
  }

  list(): Array<{ id: string; users: number }> {
    return [...this.rooms.entries()].map(([id, r]) => ({ id, users: r.userCount }))
  }
}
