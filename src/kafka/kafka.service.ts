import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Consumer, Kafka, Producer } from 'kafkajs'

@Injectable()
export class KafkaService implements OnModuleDestroy {
  private readonly kafka: Kafka
  private producer: Producer | null = null
  private consumer: Consumer | null = null
  private readonly logger = new Logger(KafkaService.name)

  constructor(private readonly config: ConfigService) {
    const brokers = this.config.get<string[]>('kafka.brokers') || []
    const clientId = this.config.get<string>('kafka.clientId') || 'ocpp-gateway'
    this.kafka = new Kafka({ clientId, brokers })
  }

  async getProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer()
      await this.producer.connect()
      this.logger.log('Kafka producer connected')
    }
    return this.producer
  }

  async getConsumer(groupId?: string): Promise<Consumer> {
    if (!this.consumer) {
      this.consumer = this.kafka.consumer({ groupId: groupId || 'ocpp-gateway' })
      await this.consumer.connect()
      this.logger.log('Kafka consumer connected')
    }
    return this.consumer
  }

  async publish(topic: string, message: string, key?: string): Promise<void> {
    const producer = await this.getProducer()
    await producer.send({ topic, messages: [{ key, value: message }] })
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect()
    }
    if (this.producer) {
      await this.producer.disconnect()
    }
  }
}
