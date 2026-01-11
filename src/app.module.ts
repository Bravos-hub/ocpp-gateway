import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import configuration from './config/configuration'
import { HealthModule } from './health/health.module'
import { KafkaModule } from './kafka/kafka.module'
import { OcppModule } from './ocpp/ocpp.module'
import { RedisModule } from './redis/redis.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    KafkaModule,
    RedisModule,
    OcppModule,
    HealthModule,
  ],
})
export class AppModule {}
