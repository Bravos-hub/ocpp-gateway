import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisService } from '../redis/redis.service'
import { CommandRequest } from '../contracts/commands'
import { OcppContext } from './versions/ocpp-adapter.interface'

type CommandAuditStatus = 'Sent' | 'Accepted' | 'Rejected' | 'Failed' | 'Timeout'

export type CommandAuditRecord = {
  commandId: string
  commandType: string
  action: string
  chargePointId?: string
  stationId?: string
  tenantId?: string
  connectorId?: number
  ocppVersion?: string
  nodeId?: string
  uniqueId: string
  status: CommandAuditStatus
  sentAt: string
  responseAt?: string
  requestPayload?: unknown
  responsePayload?: unknown
  error?: {
    code?: string
    description?: string
    details?: Record<string, unknown>
  }
}

@Injectable()
export class CommandAuditService {
  private readonly logger = new Logger(CommandAuditService.name)
  private readonly ttlSeconds: number
  private readonly nodeId: string

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {
    this.ttlSeconds = parseInt(process.env.COMMAND_AUDIT_TTL_SECONDS || '86400', 10)
    this.nodeId = process.env.NODE_ID || this.config.get<string>('service.name') || 'ocpp-gateway'
  }

  async recordDispatch(
    command: CommandRequest,
    context: OcppContext,
    action: string,
    uniqueId: string,
    requestPayload: unknown
  ): Promise<void> {
    try {
      const record: CommandAuditRecord = {
        commandId: command.commandId,
        commandType: command.commandType,
        action,
        chargePointId: command.chargePointId || context.chargePointId,
        stationId: command.stationId || context.stationId,
      tenantId: context.tenantId,
        connectorId: command.connectorId,
        ocppVersion: command.ocppVersion || context.ocppVersion,
        nodeId: this.nodeId,
        uniqueId,
        status: 'Sent',
        sentAt: new Date().toISOString(),
        requestPayload,
      }

      await this.persist(record)
      await this.persistUniqueMapping(uniqueId, command.commandId)
    } catch (error) {
      this.logger.warn(`Failed to persist command audit for ${command.commandId}: ${(error as Error).message}`)
    }
  }

  async recordAccepted(uniqueId: string, responsePayload: unknown): Promise<void> {
    try {
      await this.updateByUniqueId(uniqueId, {
        status: 'Accepted',
        responseAt: new Date().toISOString(),
        responsePayload,
      })
    } catch (error) {
      this.logger.warn(`Failed to update command audit for ${uniqueId}: ${(error as Error).message}`)
    }
  }

  async recordRejected(
    uniqueId: string,
    errorCode: string,
    errorDescription: string,
    errorDetails: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.updateByUniqueId(uniqueId, {
        status: 'Rejected',
        responseAt: new Date().toISOString(),
        error: {
          code: errorCode,
          description: errorDescription,
          details: errorDetails,
        },
      })
    } catch (error) {
      this.logger.warn(`Failed to update command audit for ${uniqueId}: ${(error as Error).message}`)
    }
  }

  async recordTimeout(uniqueId: string): Promise<void> {
    try {
      await this.updateByUniqueId(uniqueId, {
        status: 'Timeout',
        responseAt: new Date().toISOString(),
        error: {
          code: 'Timeout',
          description: 'No response from charge point',
        },
      })
    } catch (error) {
      this.logger.warn(`Failed to update command audit for ${uniqueId}: ${(error as Error).message}`)
    }
  }

  private async updateByUniqueId(uniqueId: string, updates: Partial<CommandAuditRecord>): Promise<void> {
    const commandId = await this.getCommandIdByUniqueId(uniqueId)
    if (!commandId) {
      this.logger.warn(`Missing audit mapping for uniqueId ${uniqueId}`)
      return
    }
    await this.updateRecord(commandId, updates)
  }

  private async updateRecord(commandId: string, updates: Partial<CommandAuditRecord>): Promise<void> {
    const client = this.redis.getClient()
    const key = this.commandKey(commandId)
    const raw = await client.get(key)
    let record: CommandAuditRecord | null = null
    if (raw) {
      try {
        record = JSON.parse(raw) as CommandAuditRecord
      } catch {
        record = null
      }
    }

    const next = {
      ...(record || { commandId }),
      ...updates,
    } as CommandAuditRecord

    await this.persist(next)
  }

  private async persist(record: CommandAuditRecord): Promise<void> {
    const client = this.redis.getClient()
    const payload = JSON.stringify(record)
    const key = this.commandKey(record.commandId)
    if (this.ttlSeconds > 0) {
      await client.setex(key, this.ttlSeconds, payload)
    } else {
      await client.set(key, payload)
    }
  }

  private async persistUniqueMapping(uniqueId: string, commandId: string): Promise<void> {
    const client = this.redis.getClient()
    const key = this.uniqueKey(uniqueId)
    if (this.ttlSeconds > 0) {
      await client.setex(key, this.ttlSeconds, commandId)
    } else {
      await client.set(key, commandId)
    }
  }

  private async getCommandIdByUniqueId(uniqueId: string): Promise<string | null> {
    const client = this.redis.getClient()
    const raw = await client.get(this.uniqueKey(uniqueId))
    return raw || null
  }

  private commandKey(commandId: string): string {
    return `command-audit:${commandId}`
  }

  private uniqueKey(uniqueId: string): string {
    return `command-audit:unique:${uniqueId}`
  }
}
