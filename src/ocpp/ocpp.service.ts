import { Injectable, Logger } from '@nestjs/common'
import { buildCallError, buildCallResult, parseEnvelope } from './ocpp-envelope'
import { OcppSchemaValidator } from './schema-validator.service'
import { OcppAdapter, OcppContext } from './versions/ocpp-adapter.interface'
import { Ocpp16Adapter } from './versions/ocpp16.adapter'
import { Ocpp201Adapter } from './versions/ocpp201.adapter'
import { Ocpp21Adapter } from './versions/ocpp21.adapter'

@Injectable()
export class OcppService {
  private readonly logger = new Logger(OcppService.name)
  private readonly adapters: Record<string, OcppAdapter>

  constructor(
    ocpp16: Ocpp16Adapter,
    ocpp201: Ocpp201Adapter,
    ocpp21: Ocpp21Adapter,
    private readonly validator: OcppSchemaValidator
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

    const envelope = parseEnvelope(message)
    if (!envelope) {
      this.logger.warn('Unexpected OCPP envelope')
      return null
    }

    const adapter = this.adapters[context.ocppVersion] || this.adapters['1.6J']

    if (envelope.messageTypeId !== 2) {
      this.logger.debug(`Ignoring non-call message ${envelope.messageTypeId}`)
      return null
    }

    if (!this.validator.hasSchema(context.ocppVersion, envelope.action)) {
      return buildCallError(
        envelope.uniqueId,
        'NotImplemented',
        `Action ${envelope.action} not supported`,
        {}
      )
    }

    const validation = this.validator.validate(context.ocppVersion, envelope.action, envelope.payload)
    if (!validation.valid) {
      const code = context.ocppVersion === '1.6J' ? 'FormationViolation' : 'FormatViolation'
      return buildCallError(envelope.uniqueId, code, 'Payload validation failed', {
        errors: validation.errors || [],
      })
    }

    const result = await adapter.handleCall(envelope.action, envelope.payload, context)

    if (result.error) {
      return buildCallError(
        envelope.uniqueId,
        result.error.code,
        result.error.description,
        result.error.details || {}
      )
    }

    if (!this.validator.hasResponseSchema(context.ocppVersion, envelope.action)) {
      return buildCallError(
        envelope.uniqueId,
        'InternalError',
        `No response schema for ${envelope.action}`,
        {}
      )
    }

    const responsePayload = result.response || {}
    const responseValidation = this.validator.validateResponse(
      context.ocppVersion,
      envelope.action,
      responsePayload
    )

    if (!responseValidation.valid) {
      return buildCallError(envelope.uniqueId, 'InternalError', 'Response validation failed', {
        errors: responseValidation.errors || [],
      })
    }

    return buildCallResult(envelope.uniqueId, responsePayload)
  }
}
