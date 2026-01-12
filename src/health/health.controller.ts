import { Controller, Get } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
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
  async getHealth() {
    const [kafka, redis] = await Promise.all([
      this.kafka.checkConnection(),
      this.redis.checkConnection(),
    ])
    const hasDownstreamFailure = [kafka, redis].some((dep) => dep.status === 'down')

    return {
      status: hasDownstreamFailure ? 'degraded' : 'ok',
      service: this.config.get<string>('service.name'),
      time: new Date().toISOString(),
      dependencies: {
        kafka,
        redis,
      },
    }
  }
}
