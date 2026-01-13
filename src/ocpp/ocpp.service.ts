import { Injectable, Logger } from '@nestjs/common'
import { buildCallError, buildCallResult, OCPP_MESSAGE_TYPES, parseEnvelope } from './ocpp-envelope'
import { OcppResponseCache } from './response-cache.service'
import { OcppRequestTracker } from './request-tracker.service'
import { OcppSchemaValidator } from './schema-validator.service'
import { OcppAdapter, OcppContext } from './versions/ocpp-adapter.interface'
import { Ocpp16Adapter } from './versions/ocpp16.adapter'
import { Ocpp201Adapter } from './versions/ocpp201.adapter'
import { Ocpp21Adapter } from './versions/ocpp21.adapter'
import { MetricsService } from '../metrics/metrics.service'

@Injectable()
export class OcppService {
  private readonly logger = new Logger(OcppService.name)
  private readonly adapters: Record<string, OcppAdapter>

  constructor(
    ocpp16: Ocpp16Adapter,
    ocpp201: Ocpp201Adapter,
    ocpp21: Ocpp21Adapter,
    private readonly validator: OcppSchemaValidator,
    private readonly responseCache: OcppResponseCache,
    private readonly requestTracker: OcppRequestTracker,
    private readonly metrics: MetricsService
  ) {
    this.adapters = {
      '1.6J': ocpp16,
      '2.0.1': ocpp201,
      '2.1': ocpp21,
    }
  }

  async handleIncoming(raw: string, context: OcppContext) {
    let message: unknown
    try {
      message = JSON.parse(raw)
    } catch {
      this.logger.warn('Invalid JSON payload')
      return null
    }

    const parsed = parseEnvelope(message)
    if (!parsed.ok) {
      this.logger.warn(`Unexpected OCPP envelope: ${parsed.error.reason}`)
      if (parsed.error.messageTypeId === OCPP_MESSAGE_TYPES.CALL && parsed.error.uniqueId) {
        const code = context.ocppVersion === '1.6J' ? 'FormationViolation' : 'FormatViolation'
        this.metrics.increment('ocpp_schema_failures_total', {
          direction: 'inbound',
          phase: 'request',
          version: context.ocppVersion,
          reason: 'envelope_invalid',
        })
        this.metrics.increment('ocpp_error_codes_total', { code, direction: 'inbound' })
        this.metrics.observeRate('ocpp_error_rate_per_sec', { code, direction: 'inbound' })
        return buildCallError(parsed.error.uniqueId, code, parsed.error.reason, {
          reason: parsed.error.reason,
        })
      }
      return null
    }
    const envelope = parsed.envelope

    const adapter = this.adapters[context.ocppVersion] || this.adapters['1.6J']

    if (envelope.messageTypeId === 3) {
      this.requestTracker.handleCallResult(envelope.uniqueId, envelope.payload)
      return null
    }
    if (envelope.messageTypeId === 4) {
      this.requestTracker.handleCallError(
        envelope.uniqueId,
        envelope.errorCode,
        envelope.errorDescription,
        envelope.errorDetails
      )
      return null
    }

    // At this point only CALL messages remain.

    const cached = await this.responseCache.get(context, envelope.uniqueId)
    if (cached) {
      return cached
    }

    if (!this.validator.hasSchema(context.ocppVersion, envelope.action)) {
      this.metrics.increment('ocpp_schema_failures_total', {
        direction: 'inbound',
        phase: 'request',
        action: envelope.action,
        version: context.ocppVersion,
        reason: 'schema_missing',
      })
      const error = buildCallError(
        envelope.uniqueId,
        'NotImplemented',
        `Action ${envelope.action} not supported`,
        {}
      )
      this.metrics.increment('ocpp_error_codes_total', {
        code: 'NotImplemented',
        direction: 'inbound',
        action: envelope.action,
      })
      this.metrics.observeRate('ocpp_error_rate_per_sec', {
        code: 'NotImplemented',
        direction: 'inbound',
        action: envelope.action,
      })
      await this.responseCache.set(context, envelope.uniqueId, error)
      return error
    }

    const validation = this.validator.validate(context.ocppVersion, envelope.action, envelope.payload)
    if (!validation.valid) {
      this.metrics.increment('ocpp_schema_failures_total', {
        direction: 'inbound',
        phase: 'request',
        action: envelope.action,
        version: context.ocppVersion,
        reason: 'validation_failed',
      })
      const code = context.ocppVersion === '1.6J' ? 'FormationViolation' : 'FormatViolation'
      const error = buildCallError(envelope.uniqueId, code, 'Payload validation failed', {
        errors: validation.errors || [],
      })
      this.metrics.increment('ocpp_error_codes_total', {
        code,
        direction: 'inbound',
        action: envelope.action,
      })
      this.metrics.observeRate('ocpp_error_rate_per_sec', {
        code,
        direction: 'inbound',
        action: envelope.action,
      })
      await this.responseCache.set(context, envelope.uniqueId, error)
      return error
    }

    const result = await adapter.handleCall(envelope.action, envelope.payload, context)

    if (result.error) {
      this.metrics.increment('ocpp_error_codes_total', {
        code: result.error.code,
        direction: 'inbound',
        action: envelope.action,
      })
      this.metrics.observeRate('ocpp_error_rate_per_sec', {
        code: result.error.code,
        direction: 'inbound',
        action: envelope.action,
      })
      const error = buildCallError(
        envelope.uniqueId,
        result.error.code,
        result.error.description,
        result.error.details || {}
      )
      await this.responseCache.set(context, envelope.uniqueId, error)
      return error
    }

    if (!this.validator.hasResponseSchema(context.ocppVersion, envelope.action)) {
      this.metrics.increment('ocpp_schema_failures_total', {
        direction: 'inbound',
        phase: 'response',
        action: envelope.action,
        version: context.ocppVersion,
        reason: 'response_schema_missing',
      })
      const error = buildCallError(
        envelope.uniqueId,
        'InternalError',
        `No response schema for ${envelope.action}`,
        {}
      )
      this.metrics.increment('ocpp_error_codes_total', {
        code: 'InternalError',
        direction: 'inbound',
        action: envelope.action,
      })
      this.metrics.observeRate('ocpp_error_rate_per_sec', {
        code: 'InternalError',
        direction: 'inbound',
        action: envelope.action,
      })
      await this.responseCache.set(context, envelope.uniqueId, error)
      return error
    }

    const responsePayload = result.response || {}
    const responseValidation = this.validator.validateResponse(
      context.ocppVersion,
      envelope.action,
      responsePayload
    )

    if (!responseValidation.valid) {
      this.metrics.increment('ocpp_schema_failures_total', {
        direction: 'inbound',
        phase: 'response',
        action: envelope.action,
        version: context.ocppVersion,
        reason: 'response_validation_failed',
      })
      const error = buildCallError(envelope.uniqueId, 'InternalError', 'Response validation failed', {
        errors: responseValidation.errors || [],
      })
      this.metrics.increment('ocpp_error_codes_total', {
        code: 'InternalError',
        direction: 'inbound',
        action: envelope.action,
      })
      this.metrics.observeRate('ocpp_error_rate_per_sec', {
        code: 'InternalError',
        direction: 'inbound',
        action: envelope.action,
      })
      await this.responseCache.set(context, envelope.uniqueId, error)
      return error
    }

    const callResult = buildCallResult(envelope.uniqueId, responsePayload)
    await this.responseCache.set(context, envelope.uniqueId, callResult)
    return callResult
  }
}
