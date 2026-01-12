export type DomainEvent = {
  eventId: string
  eventType: string
  source: string
  occurredAt: string
  correlationId?: string
  stationId?: string
  tenantId?: string
  chargePointId?: string
  connectorId?: number
  ocppVersion?: string
  payload?: Record<string, unknown>
}
