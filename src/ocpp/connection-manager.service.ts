import { Injectable } from '@nestjs/common'
import { WebSocket } from 'ws'

export type ConnectionMeta = {
  connectionId: string
  chargePointId: string
  ocppVersion: string
  stationId?: string
  tenantId?: string
  sessionEpoch?: number
  ip?: string
}

@Injectable()
export class ConnectionManager {
  private readonly byClient = new Map<WebSocket, ConnectionMeta>()
  private readonly byChargePointId = new Map<string, WebSocket>()

  register(client: WebSocket, meta: ConnectionMeta) {
    const existing = this.byChargePointId.get(meta.chargePointId)
    if (existing && existing !== client) {
      try {
        existing.close(1008, 'Replaced by new connection')
      } catch {
        // ignore close errors
      }
      this.byClient.delete(existing)
    }
    this.byClient.set(client, meta)
    this.byChargePointId.set(meta.chargePointId, client)
  }

  unregister(client: WebSocket) {
    const meta = this.byClient.get(client)
    if (meta) {
      this.byChargePointId.delete(meta.chargePointId)
    }
    this.byClient.delete(client)
  }

  getMeta(client: WebSocket): ConnectionMeta | undefined {
    return this.byClient.get(client)
  }

  getByChargePointId(chargePointId: string): WebSocket | undefined {
    return this.byChargePointId.get(chargePointId)
  }

  getMetaByChargePointId(chargePointId: string): ConnectionMeta | undefined {
    const socket = this.byChargePointId.get(chargePointId)
    if (!socket) return undefined
    return this.byClient.get(socket)
  }

  getConnectionCount(): number {
    return this.byClient.size
  }
}
