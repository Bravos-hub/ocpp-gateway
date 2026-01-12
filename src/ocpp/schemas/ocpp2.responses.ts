import type { AnySchema } from 'ajv'
import { Ocpp20Schemas } from 'ocpp-standard-schema'
import { buildResponseSchemaMap } from './schema-utils'

export const OCPP2_RESPONSES: Record<string, AnySchema> = buildResponseSchemaMap(
  Ocpp20Schemas as Record<string, AnySchema>
)
