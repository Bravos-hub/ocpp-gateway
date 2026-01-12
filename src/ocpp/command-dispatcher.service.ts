import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { WebSocket } from 'ws'
import { CommandRequest } from '../contracts/commands'
import { OcppSchemaValidator } from './schema-validator.service'
import { OcppContext } from './versions/ocpp-adapter.interface'
import { OcppRequestTracker, OutboundResult } from './request-tracker.service'
import { CommandAuditService } from './command-audit.service'

type DispatchResult = OutboundResult | { status: 'timeout' }

@Injectable()
export class OcppCommandDispatcher {
  private readonly defaultTimeoutMs = 15000

  constructor(
    private readonly validator: OcppSchemaValidator,
    private readonly tracker: OcppRequestTracker,
    private readonly audit: CommandAuditService
  ) {}

  async dispatch(
    command: CommandRequest,
    context: OcppContext,
    socket: WebSocket
  ): Promise<DispatchResult> {
    const action = this.mapCommandToAction(command, context.ocppVersion)
    if (!action) {
      return {
        status: 'error',
        errorCode: 'UnsupportedCommand',
        errorDescription: `Command ${command.commandType} not supported`,
        errorDetails: {},
      }
    }

    const payload = this.normalizePayload(command, action, context.ocppVersion)
    if (!this.validator.hasSchema(context.ocppVersion, action)) {
      return {
        status: 'error',
        errorCode: 'SchemaMissing',
        errorDescription: `No schema for ${action}`,
        errorDetails: {},
      }
    }

    const validation = this.validator.validate(context.ocppVersion, action, payload)
    if (!validation.valid) {
      return {
        status: 'error',
        errorCode: 'PayloadValidationFailed',
        errorDescription: `Payload invalid for ${action}`,
        errorDetails: { errors: validation.errors || [] },
      }
    }

    const uniqueId = randomUUID()
    const message = [2, uniqueId, action, payload]
    const timeoutMs = (command.timeoutSec || 0) > 0
      ? (command.timeoutSec as number) * 1000
      : this.defaultTimeoutMs

    try {
      await this.audit.recordDispatch(command, context, action, uniqueId, payload)
    } catch {
      // Audit failures should not block command delivery.
    }

    const pending = this.tracker.register(uniqueId, action, context, timeoutMs, command.commandId)
    socket.send(JSON.stringify(message))

    try {
      return await pending
    } catch {
      return { status: 'timeout' }
    }
  }

  private mapCommandToAction(command: CommandRequest, version: string): string | null {
    const normalizedVersion = version === '1.6' ? '1.6J' : version
    switch (command.commandType) {
      case 'Reset':
        return 'Reset'
      case 'RemoteStart':
        return normalizedVersion === '1.6J' ? 'RemoteStartTransaction' : 'RequestStartTransaction'
      case 'RemoteStop':
        return normalizedVersion === '1.6J' ? 'RemoteStopTransaction' : 'RequestStopTransaction'
      case 'UnlockConnector':
        return 'UnlockConnector'
      case 'ChangeConfiguration':
        return normalizedVersion === '1.6J' ? 'ChangeConfiguration' : null
      case 'TriggerMessage':
        return normalizedVersion === '1.6J' ? 'TriggerMessage' : null
      case 'UpdateFirmware':
        return 'UpdateFirmware'
      default:
        return null
    }
  }

  private normalizePayload(command: CommandRequest, action: string, version: string): Record<string, unknown> {
    const payload = (command.payload || {}) as Record<string, unknown>
    if (action === 'RemoteStopTransaction' && payload.transactionId === undefined && payload.sessionId !== undefined) {
      payload.transactionId = payload.sessionId
      delete payload.sessionId
    }
    if (action === 'RequestStopTransaction' && payload.transactionId === undefined && payload.sessionId !== undefined) {
      payload.transactionId = String(payload.sessionId)
      delete payload.sessionId
    }
    if (version !== '1.6J' && action === 'RequestStartTransaction') {
      if (!payload.idToken && payload.idTag) {
        payload.idToken = { idToken: payload.idTag, type: 'Central' }
        delete payload.idTag
      }
    }
    return payload
  }
}
