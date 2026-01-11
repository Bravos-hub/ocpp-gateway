export type CommandRequest = {
  commandId: string
  commandType: string
  stationId?: string
  chargePointId?: string
  connectorId?: number
  ocppVersion?: '1.6J' | '2.0.1' | '2.1'
  requestedBy?: {
    userId?: string
    role?: string
    orgId?: string
  }
  payload?: Record<string, unknown>
  requestedAt: string
  timeoutSec?: number
}
