import type { AnySchema } from 'ajv'
import { Ocpp20Schemas } from 'ocpp-standard-schema'
import { buildRequestSchemaMap } from './schema-utils'

export const OCPP2_SCHEMAS: Record<string, AnySchema> = buildRequestSchemaMap(
  Ocpp20Schemas as Record<string, AnySchema>
)
