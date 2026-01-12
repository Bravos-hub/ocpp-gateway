import { Logger, UseGuards } from '@nestjs/common'
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets'
import { IncomingMessage } from 'http'
import { WebSocket, type RawData } from 'ws'
import { ConnectionManager } from './connection-manager.service'
import { OcppService } from './ocpp.service'
import { OcppSecurityGuard } from './guards/ocpp-security.guard'
import { SessionDirectoryService } from './session-directory.service'

@UseGuards(OcppSecurityGuard)
@WebSocketGateway({ path: '/ocpp', cors: { origin: '*' } })
export class OcppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OcppGateway.name)

  constructor(
    private readonly connections: ConnectionManager,
    private readonly ocppService: OcppService,
    private readonly sessions: SessionDirectoryService
  ) {}

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    const context = this.parseContext(request)
    if (!context) {
      client.close(1008, 'Invalid OCPP path')
      return
    }
    this.connections.register(client, context)
    client.on('message', (data) => {
      void this.handleMessage(data, client)
    })
    await this.sessions.register(context)
    this.logger.log(`Connected ${context.chargePointId} (${context.ocppVersion})`)
  }

  async handleDisconnect(client: WebSocket) {
    const meta = this.connections.getMeta(client)
    this.connections.unregister(client)
    if (meta) {
      await this.sessions.unregister(meta.chargePointId)
      this.logger.log(`Disconnected ${meta.chargePointId}`)
    }
  }

  private async handleMessage(data: RawData, client: WebSocket) {
    const meta = this.connections.getMeta(client)
    const payload = typeof data === 'string'
      ? data
      : Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString('utf8')
            : JSON.stringify(data)
    if (!meta) {
      this.logger.warn('Received message without connection metadata')
      return
    }
    await this.sessions.touch(meta.chargePointId)
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
