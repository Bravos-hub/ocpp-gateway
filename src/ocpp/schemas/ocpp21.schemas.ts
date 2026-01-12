import type { AnySchema } from 'ajv'
import { buildRequestSchemaMap, buildResponseSchemaMap, type SchemaMap } from './schema-utils'

export type Ocpp21SchemaBundle = {
  requests: SchemaMap
  responses: SchemaMap
}

export async function loadOcpp21Schemas(): Promise<Ocpp21SchemaBundle> {
  const importer = new Function(
    'modulePath',
    'return import(modulePath)'
  ) as (modulePath: string) => Promise<Record<string, AnySchema>>
  const moduleExports = await importer('typed-ocpp/dist/ocpp21/schemas.js')
  return {
    requests: buildRequestSchemaMap(moduleExports),
    responses: buildResponseSchemaMap(moduleExports),
  }
}
