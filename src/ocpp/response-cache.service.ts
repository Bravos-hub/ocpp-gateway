import { Injectable } from '@nestjs/common'
import { OcppContext } from './versions/ocpp-adapter.interface'

type CacheEntry = {
  response: unknown
  expiresAt: number
}

@Injectable()
export class OcppResponseCache {
  private readonly ttlMs = 5 * 60 * 1000
  private readonly cache = new Map<string, CacheEntry>()

  get(context: OcppContext, uniqueId: string): unknown | null {
    const key = this.buildKey(context.chargePointId, uniqueId)
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.response
  }

  set(context: OcppContext, uniqueId: string, response: unknown): void {
    const key = this.buildKey(context.chargePointId, uniqueId)
    this.cache.set(key, { response, expiresAt: Date.now() + this.ttlMs })
  }

  private buildKey(chargePointId: string, uniqueId: string): string {
    return `${chargePointId}:${uniqueId}`
  }
}
