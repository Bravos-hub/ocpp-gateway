import type { AnySchema } from 'ajv'

export type SchemaMap = Record<string, AnySchema>

export function buildRequestSchemaMap(moduleExports: Record<string, unknown>): SchemaMap {
  return buildSchemaMap(moduleExports, 'Request')
}

export function buildResponseSchemaMap(moduleExports: Record<string, unknown>): SchemaMap {
  return buildSchemaMap(moduleExports, 'Response')
}

function buildSchemaMap(moduleExports: Record<string, unknown>, suffix: 'Request' | 'Response'): SchemaMap {
  const map: SchemaMap = {}
  for (const [key, value] of Object.entries(moduleExports)) {
    if (!key.endsWith(suffix)) continue
    if (!value || typeof value !== 'object') continue
    const action = key.slice(0, -suffix.length)
    map[action] = value as AnySchema
  }
  return map
}
