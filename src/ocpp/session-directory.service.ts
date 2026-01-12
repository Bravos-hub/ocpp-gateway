import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisService } from '../redis/redis.service'
import { OcppContext } from './versions/ocpp-adapter.interface'

type SessionEntry = {
  chargePointId: string
  ocppVersion: string
  nodeId: string
  stationId?: string
  tenantId?: string
  connectedAt: string
  lastSeenAt: string
}

export type SessionClaim = {
  accepted: boolean
  ownerNodeId?: string
  entry?: SessionEntry
}

@Injectable()
export class SessionDirectoryService {
  private readonly logger = new Logger(SessionDirectoryService.name)
  private readonly ttlSeconds: number
  private readonly nodeId: string

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {
    this.ttlSeconds = parseInt(process.env.SESSION_TTL_SECONDS || '300', 10)
    this.nodeId = process.env.NODE_ID || this.config.get<string>('service.name') || 'ocpp-gateway'
  }

  async register(context: OcppContext): Promise<SessionClaim> {
    return this.claim(context)
  }

  async claim(context: OcppContext): Promise<SessionClaim> {
    const client = this.redis.getClient()
    const now = new Date().toISOString()
    const entry: SessionEntry = {
      chargePointId: context.chargePointId,
      ocppVersion: context.ocppVersion,
      nodeId: this.nodeId,
      stationId: context.stationId,
      tenantId: context.tenantId,
      connectedAt: now,
      lastSeenAt: now,
    }

    const key = this.key(context.chargePointId)
    const claimed = await this.redis.setIfNotExists(key, JSON.stringify(entry), this.ttlSeconds)
    if (claimed) {
      return { accepted: true, ownerNodeId: this.nodeId, entry }
    }

    const existingRaw = await client.get(key)
    const existing = this.parseEntry(existingRaw)
    if (!existing) {
      return { accepted: false }
    }

    if (existing.nodeId === this.nodeId) {
      existing.lastSeenAt = now
      await client.setex(key, this.ttlSeconds, JSON.stringify(existing))
      return { accepted: true, ownerNodeId: this.nodeId, entry: existing }
    }

    return { accepted: false, ownerNodeId: existing.nodeId, entry: existing }
  }

  async touch(chargePointId: string): Promise<void> {
    const client = this.redis.getClient()
    const key = this.key(chargePointId)
    const current = await client.get(key)
    if (!current) return

    const entry = this.parseEntry(current)
    if (!entry) return
    if (entry.nodeId !== this.nodeId) {
      this.logger.warn(`Session ${chargePointId} owned by ${entry.nodeId}; skipping touch`)
      return
    }

    entry.lastSeenAt = new Date().toISOString()
    await client.setex(key, this.ttlSeconds, JSON.stringify(entry))
  }

  async unregister(chargePointId: string): Promise<void> {
    const client = this.redis.getClient()
    const key = this.key(chargePointId)
    const current = await client.get(key)
    const entry = this.parseEntry(current)
    if (!entry) {
      return
    }
    if (entry.nodeId !== this.nodeId) {
      this.logger.warn(`Skip unregister ${chargePointId}; owned by ${entry.nodeId}`)
      return
    }
    await client.del(key)
  }

  async getOwnerNodeId(chargePointId: string): Promise<string | null> {
    const client = this.redis.getClient()
    const current = await client.get(this.key(chargePointId))
    const entry = this.parseEntry(current)
    return entry?.nodeId || null
  }

  async getSession(chargePointId: string): Promise<SessionEntry | null> {
    const client = this.redis.getClient()
    const current = await client.get(this.key(chargePointId))
    return this.parseEntry(current)
  }

  private key(chargePointId: string): string {
    return `sessions:${chargePointId}`
  }

  private parseEntry(raw: string | null): SessionEntry | null {
    if (!raw) return null
    try {
      return JSON.parse(raw) as SessionEntry
    } catch {
      return null
    }
  }
}
