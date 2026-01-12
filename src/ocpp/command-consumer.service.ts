import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { KafkaService } from '../kafka/kafka.service'
import { KAFKA_TOPICS } from '../contracts/kafka-topics'
import { CommandRequest } from '../contracts/commands'
import { DomainEvent } from '../contracts/events'
import { ConnectionManager } from './connection-manager.service'
import { OcppCommandDispatcher } from './command-dispatcher.service'

@Injectable()
export class CommandConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommandConsumerService.name)

  constructor(
    private readonly kafka: KafkaService,
    private readonly connections: ConnectionManager,
    private readonly dispatcher: OcppCommandDispatcher
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.kafka.isEnabled()) {
      this.logger.warn('Kafka disabled; command consumer not started')
      return
    }
    const consumer = await this.kafka.getConsumer()
    await consumer.subscribe({ topic: KAFKA_TOPICS.commandRequests })

    await consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.value?.toString() || ''
        if (!raw) return

        let command: CommandRequest
        try {
          command = JSON.parse(raw) as CommandRequest
        } catch {
          this.logger.warn('Invalid command payload')
          return
        }

        const chargePointId = command.chargePointId
        if (!chargePointId) {
          await this.publishCommandEvent(command, 'CommandFailed', 'Missing chargePointId')
          return
        }

        const connection = this.connections.getByChargePointId(chargePointId)
        const meta = this.connections.getMetaByChargePointId(chargePointId)
        if (!connection || !meta) {
          await this.publishCommandEvent(command, 'CommandFailed', 'Charge point offline')
          return
        }

        const context = {
          chargePointId,
          ocppVersion: command.ocppVersion || meta.ocppVersion,
        }

        await this.publishCommandEvent(command, 'CommandDispatched')
        const result = await this.dispatcher.dispatch(command, context, connection)

        if (result.status === 'accepted') {
          await this.publishCommandEvent(command, 'CommandAccepted', undefined, result.payload)
          return
        }

        if (result.status === 'timeout') {
          await this.publishCommandEvent(command, 'CommandTimeout', 'No response from charge point')
          return
        }

        if (result.status === 'error') {
          const errorCodes = ['UnsupportedCommand', 'SchemaMissing', 'PayloadValidationFailed']
          const eventType = errorCodes.includes(result.errorCode) ? 'CommandFailed' : 'CommandRejected'
          await this.publishCommandEvent(command, eventType, result.errorDescription, {
            errorCode: result.errorCode,
            errorDetails: result.errorDetails,
          })
        }
      },
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.kafka.onModuleDestroy()
  }

  private async publishCommandEvent(
    command: CommandRequest,
    eventType: string,
    error?: string,
    responsePayload?: unknown
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      eventType,
      source: 'ocpp-gateway',
      occurredAt: new Date().toISOString(),
      correlationId: command.commandId,
      stationId: command.stationId,
      chargePointId: command.chargePointId,
      connectorId: command.connectorId,
      ocppVersion: command.ocppVersion,
      payload: {
        commandType: command.commandType,
        error,
        response: responsePayload,
      },
    }

    await this.kafka.publish(
      KAFKA_TOPICS.commandEvents,
      JSON.stringify(event),
      command.chargePointId
    )
  }
}
