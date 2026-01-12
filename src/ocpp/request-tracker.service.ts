import { Injectable, Logger } from '@nestjs/common'
import { OcppSchemaValidator } from './schema-validator.service'
import { CommandAuditService } from './command-audit.service'
import { OcppContext } from './versions/ocpp-adapter.interface'
import { MetricsService } from '../metrics/metrics.service'

export type OutboundResult =
  | { status: 'accepted'; payload: unknown }
  | { status: 'error'; errorCode: string; errorDescription: string; errorDetails: Record<string, unknown> }

type PendingRequest = {
  uniqueId: string
  action: string
  context: OcppContext
  createdAt: number
  timeout: NodeJS.Timeout
  resolve: (result: OutboundResult) => void
  reject: (error: Error) => void
  auditCommandId?: string
}

@Injectable()
export class OcppRequestTracker {
  private readonly logger = new Logger(OcppRequestTracker.name)
  private readonly pending = new Map<string, PendingRequest>()

  constructor(
    private readonly validator: OcppSchemaValidator,
    private readonly audit: CommandAuditService,
    private readonly metrics: MetricsService
  ) {}

  register(
    uniqueId: string,
    action: string,
    context: OcppContext,
    timeoutMs: number,
    auditCommandId?: string
  ): Promise<OutboundResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(uniqueId)
        if (auditCommandId) {
          void this.audit.recordTimeout(uniqueId)
        }
        this.metrics.increment('ocpp_timeouts_total', {
          direction: 'outbound',
          action,
        })
        reject(new Error('timeout'))
      }, timeoutMs)

      this.pending.set(uniqueId, {
        uniqueId,
        action,
        context,
        createdAt: Date.now(),
        timeout,
        resolve,
        reject,
        auditCommandId,
      })
    })
  }

  handleCallResult(uniqueId: string, payload: unknown): void {
    const pending = this.pending.get(uniqueId)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pending.delete(uniqueId)

    const validation = this.validator.validateResponse(
      pending.context.ocppVersion,
      pending.action,
      payload
    )

    if (!validation.valid) {
      this.metrics.increment('ocpp_schema_failures_total', {
        direction: 'outbound',
        phase: 'response',
        action: pending.action,
        version: pending.context.ocppVersion,
        reason: 'response_validation_failed',
      })
      if (pending.auditCommandId) {
        void this.audit.recordRejected(uniqueId, 'ResponseValidationFailed', 'Invalid response payload', {
          errors: validation.errors || [],
        })
      }
      this.metrics.increment('ocpp_error_codes_total', {
        code: 'ResponseValidationFailed',
        direction: 'outbound',
      })
      pending.resolve({
        status: 'error',
        errorCode: 'ResponseValidationFailed',
        errorDescription: 'Invalid response payload',
        errorDetails: { errors: validation.errors || [] },
      })
      return
    }

    if (pending.auditCommandId) {
      void this.audit.recordAccepted(uniqueId, payload)
    }
    pending.resolve({ status: 'accepted', payload })
  }

  handleCallError(
    uniqueId: string,
    errorCode: string,
    errorDescription: string,
    errorDetails: Record<string, unknown>
  ): void {
    const pending = this.pending.get(uniqueId)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pending.delete(uniqueId)
    if (pending.auditCommandId) {
      void this.audit.recordRejected(uniqueId, errorCode, errorDescription, errorDetails)
    }
    this.metrics.increment('ocpp_error_codes_total', { code: errorCode, direction: 'outbound' })
    pending.resolve({
      status: 'error',
      errorCode,
      errorDescription,
      errorDetails,
    })
  }

  hasPending(uniqueId: string): boolean {
    return this.pending.has(uniqueId)
  }
}
