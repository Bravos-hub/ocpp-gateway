import { Injectable, Logger } from '@nestjs/common'
import { OcppSchemaValidator } from './schema-validator.service'
import { OcppContext } from './versions/ocpp-adapter.interface'

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
}

@Injectable()
export class OcppRequestTracker {
  private readonly logger = new Logger(OcppRequestTracker.name)
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly validator: OcppSchemaValidator) {}

  register(
    uniqueId: string,
    action: string,
    context: OcppContext,
    timeoutMs: number
  ): Promise<OutboundResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(uniqueId)
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
      pending.resolve({
        status: 'error',
        errorCode: 'ResponseValidationFailed',
        errorDescription: 'Invalid response payload',
        errorDetails: { errors: validation.errors || [] },
      })
      return
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
