import { Injectable } from '@nestjs/common'
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

@Injectable()
export class SessionDirectoryService {
  private readonly ttlSeconds: number
  private readonly nodeId: string

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {
    this.ttlSeconds = parseInt(process.env.SESSION_TTL_SECONDS || '300', 10)
    this.nodeId = process.env.NODE_ID || this.config.get<string>('service.name') || 'ocpp-gateway'
  }

  async register(context: OcppContext): Promise<void> {
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

    await client.setex(this.key(context.chargePointId), this.ttlSeconds, JSON.stringify(entry))
  }

  async touch(chargePointId: string): Promise<void> {
    const client = this.redis.getClient()
    const key = this.key(chargePointId)
    const current = await client.get(key)
    if (!current) return

    let entry: SessionEntry | null = null
    try {
      entry = JSON.parse(current) as SessionEntry
    } catch {
      entry = null
    }
    if (!entry) return

    entry.lastSeenAt = new Date().toISOString()
    await client.setex(key, this.ttlSeconds, JSON.stringify(entry))
  }

  async unregister(chargePointId: string): Promise<void> {
    const client = this.redis.getClient()
    await client.del(this.key(chargePointId))
  }

  private key(chargePointId: string): string {
    return `sessions:${chargePointId}`
  }
}
