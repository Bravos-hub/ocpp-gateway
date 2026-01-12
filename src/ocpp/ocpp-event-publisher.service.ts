import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { KAFKA_TOPICS } from '../contracts/kafka-topics'
import { DomainEvent } from '../contracts/events'
import { KafkaService } from '../kafka/kafka.service'
import { OcppContext } from './versions/ocpp-adapter.interface'

@Injectable()
export class OcppEventPublisher {
  constructor(private readonly kafka: KafkaService) {}

  async publishStationEvent(
    eventType: string,
    context: OcppContext,
    payload?: Record<string, unknown>
  ): Promise<void> {
    const event = this.buildEvent(eventType, context, payload)
    await this.kafka.publish(KAFKA_TOPICS.stationEvents, JSON.stringify(event), event.stationId || event.chargePointId)
  }

  async publishSessionEvent(
    eventType: string,
    context: OcppContext,
    payload?: Record<string, unknown>
  ): Promise<void> {
    const event = this.buildEvent(eventType, context, payload)
    await this.kafka.publish(KAFKA_TOPICS.sessionEvents, JSON.stringify(event), event.stationId || event.chargePointId)
  }

  private buildEvent(
    eventType: string,
    context: OcppContext,
    payload?: Record<string, unknown>
  ): DomainEvent {
    return {
      eventId: randomUUID(),
      eventType,
      source: 'ocpp-gateway',
      occurredAt: new Date().toISOString(),
      stationId: context.stationId,
      tenantId: context.tenantId,
      chargePointId: context.chargePointId,
      ocppVersion: context.ocppVersion,
      payload,
    }
  }
}
