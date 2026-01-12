export const KAFKA_TOPICS = {
  commandRequests: 'cpms.command.requests',
  commandRequestsNodePrefix: 'cpms.command.requests.node',
  commandEvents: 'ocpp.command.events',
  stationEvents: 'ocpp.station.events',
  sessionEvents: 'ocpp.session.events',
  auditEvents: 'cpms.audit.events',
} as const

export const commandRequestsForNode = (nodeId: string) =>
  `${KAFKA_TOPICS.commandRequestsNodePrefix}.${nodeId}`
