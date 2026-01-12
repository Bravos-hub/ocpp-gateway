import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { KafkaService } from '../kafka/kafka.service'
import { sessionControlForNode } from '../contracts/kafka-topics'
import { SessionControlMessage } from '../contracts/session-control'
import { NodeDirectoryService } from './node-directory.service'

@Injectable()
export class SessionControlPublisher {
  private readonly nodeId: string

  constructor(
    private readonly kafka: KafkaService,
    private readonly nodes: NodeDirectoryService,
    private readonly config: ConfigService
  ) {
    this.nodeId = process.env.NODE_ID || this.config.get<string>('service.name') || 'ocpp-gateway'
  }

  async forceDisconnect(
    ownerNodeId: string,
    chargePointId: string,
    newEpoch: number,
    reason?: string
  ): Promise<void> {
    const nodeInfo = await this.nodes.getNode(ownerNodeId)
    const topic = nodeInfo?.sessionControlTopic || sessionControlForNode(ownerNodeId)
    const message: SessionControlMessage = {
      type: 'ForceDisconnect',
      chargePointId,
      requestedAt: new Date().toISOString(),
      reason,
      ownerNodeId,
      requesterNodeId: this.nodeId,
      newOwnerNodeId: this.nodeId,
      newEpoch,
    }
    await this.kafka.publish(topic, JSON.stringify(message), chargePointId)
  }
}
