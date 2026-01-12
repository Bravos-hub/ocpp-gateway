import { Module } from '@nestjs/common'
import { KafkaModule } from '../kafka/kafka.module'
import { RedisModule } from '../redis/redis.module'
import { HealthController } from './health.controller'

@Module({
  imports: [KafkaModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
