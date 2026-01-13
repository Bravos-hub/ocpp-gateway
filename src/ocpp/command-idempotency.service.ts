import { Injectable, Logger } from '@nestjs/common'
import { RedisService } from '../redis/redis.service'

@Injectable()
export class CommandIdempotencyService {
  private readonly logger = new Logger(CommandIdempotencyService.name)
  private readonly ttlSeconds: number

  constructor(private readonly redis: RedisService) {
    const auditFallback = parseInt(process.env.COMMAND_AUDIT_TTL_SECONDS || '86400', 10)
    const raw = process.env.COMMAND_IDEMPOTENCY_TTL_SECONDS
    const parsed = raw ? parseInt(raw, 10) : NaN
    const resolved = Number.isFinite(parsed) && parsed > 0 ? parsed : auditFallback
    this.ttlSeconds = Number.isFinite(resolved) && resolved > 0 ? resolved : 86400
  }

  async claim(commandId: string): Promise<boolean> {
    if (!commandId || this.ttlSeconds <= 0) {
      return true
    }
    try {
      return await this.redis.setIfNotExists(this.key(commandId), new Date().toISOString(), this.ttlSeconds)
    } catch (error) {
      this.logger.warn(`Failed to claim idempotency for ${commandId}: ${(error as Error).message}`)
      return true
    }
  }

  private key(commandId: string): string {
    return `command-idempotency:${commandId}`
  }
}
