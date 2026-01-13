import { Injectable, Logger } from '@nestjs/common'
import { RedisService } from '../redis/redis.service'
import { OcppContext } from './versions/ocpp-adapter.interface'

type CacheEntry = {
  response: unknown
  expiresAt: number
}

@Injectable()
export class OcppResponseCache {
  private readonly logger = new Logger(OcppResponseCache.name)
  private readonly ttlSeconds: number
  private readonly ttlMs: number
  private readonly useRedis: boolean
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly redis: RedisService) {
    const parsed = parseInt(process.env.OCPP_RESPONSE_CACHE_TTL_SECONDS || '300', 10)
    this.ttlSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    this.ttlMs = this.ttlSeconds > 0 ? this.ttlSeconds * 1000 : 0
    this.useRedis =
      (process.env.OCPP_RESPONSE_CACHE_REDIS ?? 'true') === 'true' && this.redis.isEnabled()
  }

  async get(context: OcppContext, uniqueId: string): Promise<unknown | null> {
    if (this.ttlSeconds <= 0) {
      return null
    }
    const key = this.buildKey(context.chargePointId, uniqueId)
    const entry = this.cache.get(key)
    if (entry) {
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key)
      } else {
        return entry.response
      }
    }

    if (!this.useRedis) {
      return null
    }

    try {
      const raw = await this.redis.getClient().get(key)
      if (!raw) {
        return null
      }
      const parsed = JSON.parse(raw) as unknown
      this.cache.set(key, { response: parsed, expiresAt: Date.now() + this.ttlMs })
      return parsed
    } catch (error) {
      this.logger.warn(`Failed to read response cache for ${key}: ${(error as Error).message}`)
      return null
    }
  }

  async set(context: OcppContext, uniqueId: string, response: unknown): Promise<void> {
    if (this.ttlSeconds <= 0) {
      return
    }
    const key = this.buildKey(context.chargePointId, uniqueId)
    this.cache.set(key, { response, expiresAt: Date.now() + this.ttlMs })
    if (!this.useRedis) {
      return
    }
    try {
      await this.redis.getClient().setex(key, this.ttlSeconds, JSON.stringify(response))
    } catch (error) {
      this.logger.warn(`Failed to persist response cache for ${key}: ${(error as Error).message}`)
    }
  }

  private buildKey(chargePointId: string, uniqueId: string): string {
    return `${chargePointId}:${uniqueId}`
  }
}
