import Ajv, { type AnySchema, type ValidateFunction } from 'ajv'
import { Injectable, Logger } from '@nestjs/common'
import { OCPP16_SCHEMAS } from './schemas/ocpp16.schemas'
import { OCPP2_SCHEMAS } from './schemas/ocpp2.schemas'

type VersionKey = '1.6J' | '2.0.1' | '2.1'

@Injectable()
export class OcppSchemaValidator {
  private readonly logger = new Logger(OcppSchemaValidator.name)
  private readonly validators: Record<VersionKey, Record<string, ValidateFunction>> = {
    '1.6J': {},
    '2.0.1': {},
    '2.1': {},
  }

  constructor() {
    const ajv = new Ajv({ allErrors: true, strict: true })
    this.validators['1.6J'] = this.compileSchemas(ajv, OCPP16_SCHEMAS)
    this.validators['2.0.1'] = this.compileSchemas(ajv, OCPP2_SCHEMAS)
    this.validators['2.1'] = this.compileSchemas(ajv, OCPP2_SCHEMAS)
  }

  hasSchema(version: string, action: string): boolean {
    const normalizedVersion = version === '1.6' ? '1.6J' : (version as VersionKey)
    const versionValidators = this.validators[normalizedVersion] || this.validators['1.6J']
    return Boolean(versionValidators[action])
  }

  validate(version: string, action: string, payload: unknown): { valid: boolean; errors?: string[] } {
    const normalizedVersion = version === '1.6' ? '1.6J' : (version as VersionKey)
    const versionValidators = this.validators[normalizedVersion] || this.validators['1.6J']
    const validator = versionValidators[action]
    if (!validator) {
      this.logger.debug(`No schema registered for ${normalizedVersion} ${action}`)
      return { valid: false, errors: ['schema_missing'] }
    }

    const valid = validator(payload)
    if (valid) {
      return { valid: true }
    }

    const errors = (validator.errors || []).map((error) => {
      const path = error.instancePath || '/'
      const message = error.message || 'invalid'
      return `${path} ${message}`.trim()
    })

    return { valid: false, errors }
  }

  private compileSchemas(ajv: Ajv, schemas: Record<string, AnySchema>): Record<string, ValidateFunction> {
    const compiled: Record<string, ValidateFunction> = {}
    for (const [action, schema] of Object.entries(schemas)) {
      compiled[action] = ajv.compile(schema)
    }
    return compiled
  }
}
