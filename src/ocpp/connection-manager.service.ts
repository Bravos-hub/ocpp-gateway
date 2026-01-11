import { Injectable } from '@nestjs/common'
import { WebSocket } from 'ws'

export type ConnectionMeta = {
  chargePointId: string
  ocppVersion: string
}

@Injectable()
export class ConnectionManager {
  private readonly byClient = new Map<WebSocket, ConnectionMeta>()
  private readonly byChargePointId = new Map<string, WebSocket>()

  register(client: WebSocket, meta: ConnectionMeta) {
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
}
