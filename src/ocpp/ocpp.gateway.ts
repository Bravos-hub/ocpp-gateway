import { Logger, UseGuards } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets'
import { IncomingMessage } from 'http'
import { WebSocket } from 'ws'
import { ConnectionManager } from './connection-manager.service'
import { OcppService } from './ocpp.service'
import { OcppSecurityGuard } from './guards/ocpp-security.guard'

@UseGuards(OcppSecurityGuard)
@WebSocketGateway({ path: '/ocpp', cors: { origin: '*' } })
export class OcppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OcppGateway.name)

  constructor(
    private readonly connections: ConnectionManager,
    private readonly ocppService: OcppService
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage) {
    const context = this.parseContext(request)
    if (!context) {
      client.close(1008, 'Invalid OCPP path')
      return
    }
    this.connections.register(client, context)
    this.logger.log(`Connected ${context.chargePointId} (${context.ocppVersion})`)
  }

  handleDisconnect(client: WebSocket) {
    const meta = this.connections.getMeta(client)
    this.connections.unregister(client)
    if (meta) {
      this.logger.log(`Disconnected ${meta.chargePointId}`)
    }
  }

  @SubscribeMessage('message')
  async handleMessage(@MessageBody() data: unknown, @ConnectedSocket() client: WebSocket) {
    const meta = this.connections.getMeta(client)
    const payload = typeof data === 'string'
      ? data
      : Buffer.isBuffer(data)
        ? data.toString('utf8')
        : JSON.stringify(data)
    if (!meta) {
      this.logger.warn('Received message without connection metadata')
      return
    }
    const response = await this.ocppService.handleIncoming(payload, meta)
    if (response) {
      client.send(JSON.stringify(response))
    }
  }

  private parseContext(request: IncomingMessage) {
    const url = request.url || ''
    const path = url.split('?')[0]
    const parts = path.split('/').filter(Boolean)
    const ocppIndex = parts.indexOf('ocpp')
    const rawVersion = ocppIndex >= 0 ? parts[ocppIndex + 1] : undefined
    const rawId = ocppIndex >= 0 ? parts[ocppIndex + 2] : undefined

    if (!rawVersion || !rawId) {
      return null
    }

    const normalizedVersion = rawVersion === '1.6' ? '1.6J' : rawVersion
    const allowedVersions = new Set(['1.6', '1.6J', '2.0.1', '2.1'])
    if (!allowedVersions.has(normalizedVersion)) {
      return null
    }

    return {
      ocppVersion: normalizedVersion,
      chargePointId: rawId,
    }
  }
}
