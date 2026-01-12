import type { AnySchema } from 'ajv'
import { Ocpp16Schemas } from 'ocpp-standard-schema'
import { buildResponseSchemaMap } from './schema-utils'

export const OCPP16_RESPONSES: Record<string, AnySchema> = buildResponseSchemaMap(
  Ocpp16Schemas as Record<string, AnySchema>
)
