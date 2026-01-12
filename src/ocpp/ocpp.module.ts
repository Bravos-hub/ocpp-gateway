import { Module } from '@nestjs/common'
import { KafkaModule } from '../kafka/kafka.module'
import { RedisModule } from '../redis/redis.module'
import { OcppGateway } from './ocpp.gateway'
import { OcppService } from './ocpp.service'
import { ConnectionManager } from './connection-manager.service'
import { CommandConsumerService } from './command-consumer.service'
import { OcppCommandDispatcher } from './command-dispatcher.service'
import { OcppEventPublisher } from './ocpp-event-publisher.service'
import { OcppResponseCache } from './response-cache.service'
import { OcppRequestTracker } from './request-tracker.service'
import { OcppSchemaValidator } from './schema-validator.service'
import { SessionDirectoryService } from './session-directory.service'
import { Ocpp16Adapter } from './versions/ocpp16.adapter'
import { Ocpp201Adapter } from './versions/ocpp201.adapter'
import { Ocpp21Adapter } from './versions/ocpp21.adapter'
import { OcppSecurityGuard } from './guards/ocpp-security.guard'
import { ChargerIdentityService } from './charger-identity.service'

@Module({
  imports: [KafkaModule, RedisModule],
  providers: [
    OcppGateway,
    OcppService,
    ConnectionManager,
    CommandConsumerService,
    OcppCommandDispatcher,
    OcppEventPublisher,
    OcppResponseCache,
    OcppRequestTracker,
    OcppSchemaValidator,
    SessionDirectoryService,
    Ocpp16Adapter,
    Ocpp201Adapter,
    Ocpp21Adapter,
    OcppSecurityGuard,
    ChargerIdentityService,
  ],
})
export class OcppModule {}
