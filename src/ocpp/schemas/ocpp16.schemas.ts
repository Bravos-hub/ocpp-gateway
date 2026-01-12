import type { AnySchema } from 'ajv'
import { Ocpp16Schemas } from 'ocpp-standard-schema'
import { buildRequestSchemaMap } from './schema-utils'

export const OCPP16_SCHEMAS: Record<string, AnySchema> = buildRequestSchemaMap(
  Ocpp16Schemas as Record<string, AnySchema>
)
