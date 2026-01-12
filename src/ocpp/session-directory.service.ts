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
  connectedAtMs: number
  lastSeenAt: string
  lastSeenAtMs: number
  epoch: number
}

export type SessionClaim = {
  accepted: boolean
  ownerNodeId?: string
  entry?: SessionEntry
  takeover?: boolean
}

@Injectable()
export class SessionDirectoryService {
  private readonly logger = new Logger(SessionDirectoryService.name)
  private readonly ttlSeconds: number
  private readonly staleMs: number
  private readonly nodeId: string
  private readonly claimScript = `
local key = KEYS[1]
local nodeId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local staleMs = tonumber(ARGV[3])
local ttlSec = tonumber(ARGV[4])
local newEntryJson = ARGV[5]

local newEntry = cjson.decode(newEntryJson)

local current = redis.call('GET', key)
if not current then
  newEntry.epoch = 1
  newEntry.lastSeenAtMs = nowMs
  redis.call('SET', key, cjson.encode(newEntry), 'EX', ttlSec)
  return {1, '', tostring(newEntry.epoch)}
end

local ok, entry = pcall(cjson.decode, current)
if not ok or type(entry) ~= 'table' then
  newEntry.epoch = 1
  newEntry.lastSeenAtMs = nowMs
  redis.call('SET', key, cjson.encode(newEntry), 'EX', ttlSec)
  return {1, '', tostring(newEntry.epoch)}
end

if entry.nodeId == nodeId then
  newEntry.epoch = tonumber(entry.epoch) or 1
  newEntry.lastSeenAtMs = nowMs
  redis.call('SET', key, cjson.encode(newEntry), 'EX', ttlSec)
  return {1, entry.nodeId, tostring(newEntry.epoch)}
end

local lastSeen = tonumber(entry.lastSeenAtMs) or 0
if staleMs > 0 and (nowMs - lastSeen) > staleMs then
  newEntry.epoch = (tonumber(entry.epoch) or 0) + 1
  newEntry.lastSeenAtMs = nowMs
  redis.call('SET', key, cjson.encode(newEntry), 'EX', ttlSec)
  return {2, entry.nodeId or '', tostring(newEntry.epoch)}
end

return {0, entry.nodeId or '', tostring(entry.epoch or 0)}
`

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {
    this.ttlSeconds = parseInt(process.env.SESSION_TTL_SECONDS || '300', 10)
    this.nodeId = process.env.NODE_ID || this.config.get<string>('service.name') || 'ocpp-gateway'
    this.staleMs = parseInt(process.env.SESSION_STALE_SECONDS || '0', 10) * 1000
  }

  async register(context: OcppContext): Promise<SessionClaim> {
    return this.claim(context)
  }

  async claim(context: OcppContext): Promise<SessionClaim> {
    const client = this.redis.getClient()
    const now = new Date().toISOString()
    const nowMs = Date.now()
    const entry: SessionEntry = {
      chargePointId: context.chargePointId,
      ocppVersion: context.ocppVersion,
      nodeId: this.nodeId,
      stationId: context.stationId,
      tenantId: context.tenantId,
      connectedAt: now,
      connectedAtMs: nowMs,
      lastSeenAt: now,
      lastSeenAtMs: nowMs,
      epoch: 0,
    }

    const result = await this.evalClaim(client, entry)
    const status = result.status
    const ownerNodeId = result.ownerNodeId || undefined
    if (status === 1) {
      entry.epoch = result.epoch
      return { accepted: true, ownerNodeId, entry }
    }
    if (status === 2) {
      entry.epoch = result.epoch
      return { accepted: true, ownerNodeId, entry, takeover: true }
    }
    return { accepted: false, ownerNodeId, entry: result.existing }
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
    entry.lastSeenAtMs = Date.now()
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
      const parsed = JSON.parse(raw) as SessionEntry
      if (!parsed.lastSeenAtMs && parsed.lastSeenAt) {
        const parsedMs = Date.parse(parsed.lastSeenAt)
        parsed.lastSeenAtMs = Number.isNaN(parsedMs) ? 0 : parsedMs
      }
      if (!parsed.connectedAtMs && parsed.connectedAt) {
        const parsedMs = Date.parse(parsed.connectedAt)
        parsed.connectedAtMs = Number.isNaN(parsedMs) ? 0 : parsedMs
      }
      return parsed
    } catch {
      return null
    }
  }

  private async evalClaim(
    client: any,
    entry: SessionEntry
  ): Promise<{ status: number; ownerNodeId?: string; epoch: number; existing?: SessionEntry | null }> {
    if (typeof client.eval === 'function') {
      const rawResult = await client.eval(
        this.claimScript,
        1,
        this.key(entry.chargePointId),
        this.nodeId,
        entry.lastSeenAtMs,
        this.staleMs,
        this.ttlSeconds,
        JSON.stringify(entry)
      )

      const [statusRaw, ownerRaw, epochRaw] = Array.isArray(rawResult) ? rawResult : []
      const status = parseInt(String(statusRaw || 0), 10)
      const epoch = parseInt(String(epochRaw || 0), 10)
      const ownerNodeId = ownerRaw ? String(ownerRaw) : undefined
      return { status, ownerNodeId, epoch }
    }

    const key = this.key(entry.chargePointId)
    const existingRaw = await client.get(key)
    const existing = this.parseEntry(existingRaw)
    if (!existing) {
      entry.epoch = 1
      await client.setex(key, this.ttlSeconds, JSON.stringify(entry))
      return { status: 1, epoch: entry.epoch }
    }

    if (existing.nodeId === this.nodeId) {
      entry.epoch = existing.epoch || 1
      await client.setex(key, this.ttlSeconds, JSON.stringify(entry))
      return { status: 1, ownerNodeId: existing.nodeId, epoch: entry.epoch }
    }

    const stale = this.staleMs > 0 && (entry.lastSeenAtMs - (existing.lastSeenAtMs || 0) > this.staleMs)
    if (stale) {
      entry.epoch = (existing.epoch || 0) + 1
      await client.setex(key, this.ttlSeconds, JSON.stringify(entry))
      return { status: 2, ownerNodeId: existing.nodeId, epoch: entry.epoch }
    }

    return { status: 0, ownerNodeId: existing.nodeId, epoch: existing.epoch || 0, existing }
  }
}
