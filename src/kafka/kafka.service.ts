import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Consumer, Kafka, Producer } from 'kafkajs'

@Injectable()
export class KafkaService implements OnModuleDestroy {
  private readonly kafka: Kafka | null
  private readonly enabled: boolean
  private producer: Producer | null = null
  private readonly consumers = new Map<string, Consumer>()
  private readonly logger = new Logger(KafkaService.name)
  private warnedDisabled = false
  private readonly defaultGroupId: string

  constructor(private readonly config: ConfigService) {
    const brokers = this.config.get<string[]>('kafka.brokers') || []
    const clientId = this.config.get<string>('kafka.clientId') || 'ocpp-gateway'
    this.defaultGroupId = this.config.get<string>('kafka.groupId') || 'ocpp-gateway'
    const enabled = this.config.get<boolean>('kafka.enabled')
    this.enabled = enabled ?? brokers.length > 0
    this.kafka = this.enabled ? new Kafka({ clientId, brokers }) : null
  }

  isEnabled(): boolean {
    return this.enabled
  }

  async getProducer(): Promise<Producer> {
    const kafka = this.getKafkaClient()
    if (!this.producer) {
      this.producer = kafka.producer()
      await this.producer.connect()
      this.logger.log('Kafka producer connected')
    }
    return this.producer
  }

  async getConsumer(groupId?: string): Promise<Consumer> {
    const kafka = this.getKafkaClient()
    const resolvedGroupId = groupId || this.defaultGroupId
    const existing = this.consumers.get(resolvedGroupId)
    if (existing) {
      return existing
    }

    const consumer = kafka.consumer({ groupId: resolvedGroupId })
    await consumer.connect()
    this.logger.log(`Kafka consumer connected (${resolvedGroupId})`)
    this.consumers.set(resolvedGroupId, consumer)
    return consumer
  }

  async publish(topic: string, message: string, key?: string): Promise<void> {
    if (!this.enabled) {
      this.logDisabledOnce()
      return
    }
    const producer = await this.getProducer()
    await producer.send({ topic, messages: [{ key, value: message }] })
  }

  async onModuleDestroy(): Promise<void> {
    for (const consumer of this.consumers.values()) {
      await consumer.disconnect()
    }
    if (this.producer) {
      await this.producer.disconnect()
    }
  }

  private getKafkaClient(): Kafka {
    if (!this.kafka) {
      this.logDisabledOnce()
      throw new Error('Kafka is disabled')
    }
    return this.kafka
  }

  private logDisabledOnce(): void {
    if (this.warnedDisabled) return
    this.warnedDisabled = true
    this.logger.warn('Kafka disabled; skipping broker interactions')
  }
}
