import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { KafkaService } from '../kafka/kafka.service'
import { sessionControlForNode } from '../contracts/kafka-topics'
import { SessionControlMessage } from '../contracts/session-control'
import { ConnectionManager } from './connection-manager.service'

@Injectable()
export class SessionControlConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionControlConsumerService.name)
  private readonly nodeId: string
  private readonly groupId: string

  constructor(
    private readonly kafka: KafkaService,
    private readonly connections: ConnectionManager,
    private readonly config: ConfigService
  ) {
    this.nodeId = process.env.NODE_ID || this.config.get<string>('service.name') || 'ocpp-gateway'
    const baseGroupId = this.config.get<string>('kafka.groupId') || 'ocpp-gateway'
    this.groupId = `${baseGroupId}-session-control-${this.nodeId}`
  }

  async onModuleInit(): Promise<void> {
    if (!this.kafka.isEnabled()) {
      this.logger.warn('Kafka disabled; session control consumer not started')
      return
    }
    const consumer = await this.kafka.getConsumer(this.groupId)
    await consumer.subscribe({ topic: sessionControlForNode(this.nodeId) })
    await consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.value?.toString() || ''
        if (!raw) return
        let payload: SessionControlMessage
        try {
          payload = JSON.parse(raw) as SessionControlMessage
        } catch {
          this.logger.warn('Invalid session control payload')
          return
        }
        if (payload.type !== 'ForceDisconnect') return
        this.forceDisconnect(payload)
      },
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.kafka.onModuleDestroy()
  }

  private forceDisconnect(payload: SessionControlMessage): void {
    const socket = this.connections.getByChargePointId(payload.chargePointId)
    if (!socket) return
    const meta = this.connections.getMeta(socket)
    if (payload.newEpoch && meta?.sessionEpoch && meta.sessionEpoch >= payload.newEpoch) {
      return
    }
    try {
      socket.close(1012, 'Session ownership transferred')
    } catch (error) {
      this.logger.warn(`Failed to close socket for ${payload.chargePointId}`)
    }
  }
}
