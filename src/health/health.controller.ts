import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'
import { KafkaService } from '../kafka/kafka.service'
import { RedisService } from '../redis/redis.service'

@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly kafka: KafkaService,
    private readonly redis: RedisService
  ) {}

  @Get()
  async getHealth(@Req() req: Request) {
    this.ensureAuthorized(req)
    const [kafka, redis] = await Promise.all([
      this.kafka.checkConnection(),
      this.redis.checkConnection(),
    ])
    const hasDownstreamFailure = [kafka, redis].some((dep) => dep.status === 'down')
    const requireKafka = (process.env.REQUIRE_KAFKA ?? 'false') === 'true'
    const requireRedis = (process.env.REQUIRE_REDIS ?? 'false') === 'true'
    const requiredFailures = [
      requireKafka && kafka.status !== 'up',
      requireRedis && redis.status !== 'up',
    ].some(Boolean)

    return {
      status: requiredFailures ? 'down' : hasDownstreamFailure ? 'degraded' : 'ok',
      service: this.config.get<string>('service.name'),
      time: new Date().toISOString(),
      dependencies: {
        kafka,
        redis,
      },
      required: {
        kafka: requireKafka,
        redis: requireRedis,
      },
    }
  }

  private ensureAuthorized(req: Request): void {
    const requiredToken = process.env.HEALTH_METRICS_AUTH_TOKEN
    if (!requiredToken) {
      return
    }
    const authHeader = req.headers['authorization']
    const bearer =
      typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : Array.isArray(authHeader)
          ? authHeader[0]
          : undefined
    const rawToken = this.readHeader(req, 'x-health-token') || this.readHeader(req, 'x-metrics-token')
    const presented = bearer || rawToken
    if (!presented || presented !== requiredToken) {
      throw new UnauthorizedException()
    }
  }

  private readHeader(req: Request, header: string): string | undefined {
    const value = req.headers[header]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (Array.isArray(value) && value.length > 0) {
      return value[0].trim()
    }
    return undefined
  }
}
