export type SessionControlMessage = {
  type: 'ForceDisconnect'
  chargePointId: string
  requestedAt: string
  reason?: string
  ownerNodeId?: string
  requesterNodeId?: string
  newOwnerNodeId?: string
  newEpoch?: number
}
