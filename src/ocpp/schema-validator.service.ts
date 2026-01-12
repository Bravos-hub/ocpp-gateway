import Ajv, { type AnySchema, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { OCPP16_SCHEMAS } from './schemas/ocpp16.schemas'
import { OCPP16_RESPONSES } from './schemas/ocpp16.responses'
import { OCPP2_SCHEMAS } from './schemas/ocpp2.schemas'
import { OCPP2_RESPONSES } from './schemas/ocpp2.responses'
import { loadOcpp21Schemas } from './schemas/ocpp21.schemas'

type VersionKey = '1.6J' | '2.0.1' | '2.1'

@Injectable()
export class OcppSchemaValidator implements OnModuleInit {
  private readonly logger = new Logger(OcppSchemaValidator.name)
  private readonly requestValidators: Record<VersionKey, Record<string, ValidateFunction>> = {
    '1.6J': {},
    '2.0.1': {},
    '2.1': {},
  }
  private readonly responseValidators: Record<VersionKey, Record<string, ValidateFunction>> = {
    '1.6J': {},
    '2.0.1': {},
    '2.1': {},
  }
  private readonly allowAdditionalActions: Set<string>
  private initialized = false

  constructor() {
    const rawAllowList = process.env.OCPP_SCHEMA_ALLOW_ADDITIONAL_ACTIONS || 'DataTransfer'
    this.allowAdditionalActions = new Set(
      rawAllowList
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    )
  }

  async onModuleInit(): Promise<void> {
    const ajv = new Ajv({
      allErrors: true,
      strict: true,
      strictSchema: false,
      strictTypes: false,
    })
    const draft6MetaSchema = require('ajv/dist/refs/json-schema-draft-06.json') as any
    ajv.addMetaSchema(draft6MetaSchema as any)
    ajv.addKeyword({ keyword: 'javaType', schemaType: 'string' })
    addFormats(ajv)

    const ocpp21 = await loadOcpp21Schemas()
    this.requestValidators['1.6J'] = this.compileSchemas(ajv, OCPP16_SCHEMAS)
    this.requestValidators['2.0.1'] = this.compileSchemas(ajv, OCPP2_SCHEMAS)
    this.requestValidators['2.1'] = this.compileSchemas(ajv, ocpp21.requests)
    this.responseValidators['1.6J'] = this.compileSchemas(ajv, OCPP16_RESPONSES)
    this.responseValidators['2.0.1'] = this.compileSchemas(ajv, OCPP2_RESPONSES)
    this.responseValidators['2.1'] = this.compileSchemas(ajv, ocpp21.responses)
    this.initialized = true
  }

  hasSchema(version: string, action: string): boolean {
    if (!this.initialized) {
      this.logger.warn('Schema validator not initialized')
      return false
    }
    const normalizedVersion = version === '1.6' ? '1.6J' : (version as VersionKey)
    const versionValidators = this.requestValidators[normalizedVersion] || this.requestValidators['1.6J']
    return Boolean(versionValidators[action])
  }

  hasResponseSchema(version: string, action: string): boolean {
    if (!this.initialized) {
      this.logger.warn('Schema validator not initialized')
      return false
    }
    const normalizedVersion = version === '1.6' ? '1.6J' : (version as VersionKey)
    const versionValidators = this.responseValidators[normalizedVersion] || this.responseValidators['1.6J']
    return Boolean(versionValidators[action])
  }

  validate(version: string, action: string, payload: unknown): { valid: boolean; errors?: string[] } {
    if (!this.initialized) {
      return { valid: false, errors: ['schema_not_ready'] }
    }
    const normalizedVersion = version === '1.6' ? '1.6J' : (version as VersionKey)
    const versionValidators = this.requestValidators[normalizedVersion] || this.requestValidators['1.6J']
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

  validateResponse(version: string, action: string, payload: unknown): { valid: boolean; errors?: string[] } {
    if (!this.initialized) {
      return { valid: false, errors: ['schema_not_ready'] }
    }
    const normalizedVersion = version === '1.6' ? '1.6J' : (version as VersionKey)
    const versionValidators = this.responseValidators[normalizedVersion] || this.responseValidators['1.6J']
    const validator = versionValidators[action]
    if (!validator) {
      this.logger.debug(`No response schema registered for ${normalizedVersion} ${action}`)
      return { valid: false, errors: ['response_schema_missing'] }
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
      const allowAdditional = this.allowAdditionalActions.has(action)
      const normalizedSchema = this.applyAdditionalPropertiesDefaults(schema, allowAdditional)
      compiled[action] = ajv.compile(normalizedSchema)
    }
    return compiled
  }

  private applyAdditionalPropertiesDefaults(schema: AnySchema, allowAdditional: boolean): AnySchema {
    if (allowAdditional) {
      return schema
    }

    const clone = this.cloneSchema(schema)
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(visit)
        return
      }

      const hasObjectShape =
        node.type === 'object' ||
        (Array.isArray(node.type) && node.type.includes('object')) ||
        node.properties ||
        node.patternProperties

      if (hasObjectShape && node.additionalProperties === undefined) {
        node.additionalProperties = false
      }

      if (node.properties) {
        Object.values(node.properties).forEach(visit)
      }
      if (node.patternProperties) {
        Object.values(node.patternProperties).forEach(visit)
      }
      if (node.additionalProperties && typeof node.additionalProperties === 'object') {
        visit(node.additionalProperties)
      }
      if (node.items) {
        visit(node.items)
      }
      if (node.prefixItems) {
        visit(node.prefixItems)
      }
      if (node.contains) {
        visit(node.contains)
      }
      if (node.anyOf) {
        node.anyOf.forEach(visit)
      }
      if (node.oneOf) {
        node.oneOf.forEach(visit)
      }
      if (node.allOf) {
        node.allOf.forEach(visit)
      }
      if (node.not) {
        visit(node.not)
      }
      if (node.if) {
        visit(node.if)
      }
      if (node.then) {
        visit(node.then)
      }
      if (node.else) {
        visit(node.else)
      }
      if (node.definitions) {
        Object.values(node.definitions).forEach(visit)
      }
      if (node.$defs) {
        Object.values(node.$defs).forEach(visit)
      }
      if (node.dependentSchemas) {
        Object.values(node.dependentSchemas).forEach(visit)
      }
      if (node.propertyNames) {
        visit(node.propertyNames)
      }
      if (node.unevaluatedProperties) {
        visit(node.unevaluatedProperties)
      }
      if (node.unevaluatedItems) {
        visit(node.unevaluatedItems)
      }
    }

    visit(clone)
    return clone
  }

  private cloneSchema(schema: AnySchema): AnySchema {
    if (typeof structuredClone === 'function') {
      return structuredClone(schema)
    }
    return JSON.parse(JSON.stringify(schema)) as AnySchema
  }
}
