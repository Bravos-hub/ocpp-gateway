import { Injectable, Logger } from '@nestjs/common'
import { RedisService } from '../redis/redis.service'
import { OcppContext, OcppError } from './versions/ocpp-adapter.interface'

type RateLimitResult = {
  allowed: boolean
  error?: OcppError
}

@Injectable()
export class OcppRateLimiter {
  private readonly logger = new Logger(OcppRateLimiter.name)
  private readonly windowSeconds: number
  private readonly perChargePointLimit: number
  private readonly globalLimit: number
  private readonly limitedActions = new Set(['MeterValues', 'StatusNotification'])

  constructor(private readonly redis: RedisService) {
    this.windowSeconds = parseInt(process.env.OCPP_RATE_LIMIT_WINDOW_SECONDS || '60', 10)
    this.perChargePointLimit = parseInt(process.env.OCPP_RATE_LIMIT_PER_CP || '0', 10)
    this.globalLimit = parseInt(process.env.OCPP_RATE_LIMIT_GLOBAL || '0', 10)
  }

  async check(context: OcppContext, action: string): Promise<RateLimitResult> {
    if (!this.limitedActions.has(action)) {
      return { allowed: true }
    }

    if (this.windowSeconds <= 0) {
      return { allowed: true }
    }

    const limitDetails = {
      action,
      windowSeconds: this.windowSeconds,
      chargePointId: context.chargePointId,
    }

    if (this.perChargePointLimit > 0) {
      const count = await this.increment(
        `rate:${action}:cp:${context.chargePointId}`,
        this.windowSeconds
      )
      if (count > this.perChargePointLimit) {
        this.logger.warn(`Rate limit exceeded for ${context.chargePointId} (${action})`)
        return {
          allowed: false,
          error: {
            code: 'OccurrenceConstraintViolation',
            description: 'Rate limit exceeded',
            details: {
              ...limitDetails,
              scope: 'chargePoint',
              limit: this.perChargePointLimit,
            },
          },
        }
      }
    }

    if (this.globalLimit > 0) {
      const count = await this.increment(`rate:${action}:global`, this.windowSeconds)
      if (count > this.globalLimit) {
        this.logger.warn(`Global rate limit exceeded (${action})`)
        return {
          allowed: false,
          error: {
            code: 'OccurrenceConstraintViolation',
            description: 'Rate limit exceeded',
            details: {
              ...limitDetails,
              scope: 'global',
              limit: this.globalLimit,
            },
          },
        }
      }
    }

    return { allowed: true }
  }

  private async increment(key: string, ttlSeconds: number): Promise<number> {
    const client = this.redis.getClient()
    const count = await client.incr(key)
    if (count === 1 && ttlSeconds > 0) {
      await client.expire(key, ttlSeconds)
    }
    return count
  }
}
