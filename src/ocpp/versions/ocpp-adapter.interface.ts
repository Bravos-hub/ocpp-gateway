export type OcppContext = {
  chargePointId: string
  ocppVersion: string
}

export type OcppError = {
  code: string
  description: string
  details?: Record<string, unknown>
}

export type OcppHandlerResult = {
  response?: Record<string, unknown>
  error?: OcppError
}

export interface OcppAdapter {
  version: string
  handleCall(action: string, payload: unknown, context: OcppContext): Promise<OcppHandlerResult>
}
