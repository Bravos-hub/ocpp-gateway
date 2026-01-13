import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { KafkaService } from '../kafka/kafka.service'
import { KAFKA_TOPICS, commandRequestsForNode } from '../contracts/kafka-topics'
import { CommandRequest } from '../contracts/commands'
import { DomainEvent } from '../contracts/events'
import { MetricsService } from '../metrics/metrics.service'
import { ConnectionManager } from './connection-manager.service'
import { OcppCommandDispatcher } from './command-dispatcher.service'
import { CommandIdempotencyService } from './command-idempotency.service'
import { SessionDirectoryService } from './session-directory.service'
import { NodeDirectoryService } from './node-directory.service'

@Injectable()
export class CommandConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommandConsumerService.name)
  private nodeId = ''
  private nodeGroupId = ''

  constructor(
    private readonly kafka: KafkaService,
    private readonly connections: ConnectionManager,
    private readonly dispatcher: OcppCommandDispatcher,
    private readonly sessions: SessionDirectoryService,
    private readonly nodes: NodeDirectoryService,
    private readonly config: ConfigService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly metrics: MetricsService
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.kafka.isEnabled()) {
      this.logger.warn('Kafka disabled; command consumer not started')
      return
    }
    this.nodeId = process.env.NODE_ID || this.config.get<string>('service.name') || 'ocpp-gateway'
    const baseGroupId = this.config.get<string>('kafka.groupId') || 'ocpp-gateway'
    this.nodeGroupId = `${baseGroupId}-${this.nodeId}`

    const sharedConsumer = await this.kafka.getConsumer()
    await sharedConsumer.subscribe({ topic: KAFKA_TOPICS.commandRequests })
    await sharedConsumer.run({
      eachMessage: async ({ message }) => {
        await this.handleMessage(message.value?.toString() || '', 'shared')
      },
    })

    const nodeConsumer = await this.kafka.getConsumer(this.nodeGroupId)
    await nodeConsumer.subscribe({ topic: commandRequestsForNode(this.nodeId) })
    await nodeConsumer.run({
      eachMessage: async ({ message }) => {
        await this.handleMessage(message.value?.toString() || '', 'node')
      },
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.kafka.onModuleDestroy()
  }

  private async handleMessage(raw: string, source: 'shared' | 'node'): Promise<void> {
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

    const ownerNodeId = await this.sessions.getOwnerNodeId(chargePointId)
    if (ownerNodeId && ownerNodeId !== this.nodeId) {
      if (source === 'shared') {
        await this.routeToOwner(command, ownerNodeId)
        return
      }
      await this.routeToOwner(command, ownerNodeId)
      return
    }

    const claimed = await this.idempotency.claim(command.commandId)
    if (!claimed) {
      this.logger.warn(`Duplicate command ${command.commandId} ignored`)
      this.metrics.increment('ocpp_command_duplicates_total')
      this.metrics.observeRate('ocpp_command_duplicates_rate_per_sec')
      await this.publishCommandEvent(command, 'CommandDuplicate', 'Duplicate commandId')
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
      stationId: meta.stationId,
      tenantId: meta.tenantId,
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
  }

  private async routeToOwner(command: CommandRequest, ownerNodeId: string): Promise<void> {
    const nodeInfo = await this.nodes.getNode(ownerNodeId)
    const topic = nodeInfo?.commandTopic || commandRequestsForNode(ownerNodeId)
    await this.kafka.publish(topic, JSON.stringify(command), command.chargePointId)
    await this.publishCommandEvent(command, 'CommandRouted', undefined, {
      ownerNodeId,
      topic,
    })
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
