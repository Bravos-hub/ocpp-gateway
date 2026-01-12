import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisService } from '../redis/redis.service'
import { commandRequestsForNode, sessionControlForNode } from '../contracts/kafka-topics'

export type NodeInfo = {
  nodeId: string
  advertiseUrl?: string
  commandTopic: string
  sessionControlTopic: string
  startedAt: string
  lastSeenAt: string
}

@Injectable()
export class NodeDirectoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodeDirectoryService.name)
  private readonly nodeId: string
  private readonly advertiseUrl?: string
  private readonly ttlSeconds: number
  private readonly heartbeatSeconds: number
  private heartbeat?: NodeJS.Timeout

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {
    this.nodeId = process.env.NODE_ID || this.config.get<string>('service.name') || 'ocpp-gateway'
    this.advertiseUrl = process.env.NODE_ADVERTISE_URL || undefined
    this.ttlSeconds = parseInt(process.env.NODE_TTL_SECONDS || '120', 10)
    this.heartbeatSeconds = parseInt(process.env.NODE_HEARTBEAT_SECONDS || '30', 10)
  }

  async onModuleInit(): Promise<void> {
    await this.register()
    this.heartbeat = setInterval(() => {
      void this.register()
    }, this.heartbeatSeconds * 1000)
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }
  }

  async register(): Promise<void> {
    const now = new Date().toISOString()
    const info: NodeInfo = {
      nodeId: this.nodeId,
      advertiseUrl: this.advertiseUrl,
      commandTopic: commandRequestsForNode(this.nodeId),
      sessionControlTopic: sessionControlForNode(this.nodeId),
      startedAt: now,
      lastSeenAt: now,
    }
    const client = this.redis.getClient()
    await client.setex(this.key(this.nodeId), this.ttlSeconds, JSON.stringify(info))
  }

  async getNode(nodeId: string): Promise<NodeInfo | null> {
    const client = this.redis.getClient()
    const raw = await client.get(this.key(nodeId))
    if (!raw) return null
    try {
      return JSON.parse(raw) as NodeInfo
    } catch {
      this.logger.warn(`Invalid node directory entry for ${nodeId}`)
      return null
    }
  }

  private key(nodeId: string): string {
    return `nodes:${nodeId}`
  }
}
