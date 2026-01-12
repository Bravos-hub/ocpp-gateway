import { Logger, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets'
import { IncomingMessage } from 'http'
import { WebSocket, type RawData } from 'ws'
import { ConnectionManager } from './connection-manager.service'
import { buildCallError, parseEnvelope } from './ocpp-envelope'
import { OcppRateLimiter } from './ocpp-rate-limiter.service'
import { OcppService } from './ocpp.service'
import { OcppSecurityGuard } from './guards/ocpp-security.guard'
import { OcppResponseCache } from './response-cache.service'
import { SessionDirectoryService } from './session-directory.service'
import { SessionControlPublisher } from './session-control-publisher.service'
import { ChargerIdentityService } from './charger-identity.service'
import { MetricsService } from '../metrics/metrics.service'

@UseGuards(OcppSecurityGuard)
@WebSocketGateway({ path: '/ocpp', cors: { origin: '*' } })
export class OcppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OcppGateway.name)
  private readonly nodeId: string
  private readonly maxPayloadBytes: number

  constructor(
    private readonly connections: ConnectionManager,
    private readonly ocppService: OcppService,
    private readonly responseCache: OcppResponseCache,
    private readonly sessions: SessionDirectoryService,
    private readonly sessionControl: SessionControlPublisher,
    private readonly config: ConfigService,
    private readonly identityService: ChargerIdentityService,
    private readonly rateLimiter: OcppRateLimiter,
    private readonly metrics: MetricsService
  ) {
    this.nodeId = process.env.NODE_ID || this.config.get<string>('service.name') || 'ocpp-gateway'
    const parsed = parseInt(process.env.OCPP_MAX_PAYLOAD_BYTES || '262144', 10)
    this.maxPayloadBytes = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    const pending: RawData[] = []
    const handleQueued = (data: RawData) => {
      const meta = this.connections.getMeta(client)
      if (!meta) {
        pending.push(data)
        return
      }
      void this.handleMessage(data, client)
    }
    client.on('message', handleQueued)

    const parsed = this.parsePath(request)
    if (!parsed) {
      client.close(1008, 'Invalid OCPP path')
      return
    }
    const identity =
      (client as any).ocppIdentity ||
      (await this.identityService.authenticate(request, parsed.chargePointId, parsed.ocppVersion))
    if (!identity) {
      client.close(1008, 'Unauthorized')
      return
    }
    ;(client as any).ocppIdentity = identity
    const context = {
      ocppVersion: parsed.ocppVersion,
      chargePointId: parsed.chargePointId,
      stationId: identity.stationId,
      tenantId: identity.tenantId,
    }
    const claim = await this.sessions.claim(context)
    if (!claim.accepted) {
      const owner = claim.ownerNodeId ? `owned by ${claim.ownerNodeId}` : 'already claimed'
      this.logger.warn(`Rejecting ${context.chargePointId}; ${owner}`)
      client.close(1013, 'Charge point already connected')
      return
    }
    if (claim.takeover && claim.ownerNodeId && claim.ownerNodeId !== this.nodeId) {
      await this.sessionControl.forceDisconnect(
        claim.ownerNodeId,
        context.chargePointId,
        claim.entry?.epoch || 0,
        'Session taken over'
      )
    }
    const meta = {
      ...context,
      sessionEpoch: claim.entry?.epoch,
    }
    this.connections.register(client, meta)
    if (pending.length > 0) {
      for (const data of pending.splice(0, pending.length)) {
        void this.handleMessage(data, client)
      }
    }
    this.logger.log(`Connected ${context.chargePointId} (${context.ocppVersion})`)
    this.metrics.setGauge('ocpp_connections_active', this.connections.getConnectionCount())
  }

  async handleDisconnect(client: WebSocket) {
    const meta = this.connections.getMeta(client)
    this.connections.unregister(client)
    if (meta) {
      await this.sessions.unregister(meta.chargePointId)
      this.logger.log(`Disconnected ${meta.chargePointId}`)
    }
    this.metrics.setGauge('ocpp_connections_active', this.connections.getConnectionCount())
  }

  private async handleMessage(data: RawData, client: WebSocket) {
    const meta = this.connections.getMeta(client)
    if (!meta) {
      this.logger.warn('Received message without connection metadata')
      return
    }

    const payloadSize = this.getPayloadSize(data)
    if (this.maxPayloadBytes > 0 && payloadSize > this.maxPayloadBytes) {
      this.metrics.increment('ocpp_payload_too_large_total')
      this.logger.warn('Payload exceeds configured size limit')
      client.close(1009, 'Payload too large')
      return
    }

    const payload = typeof data === 'string'
      ? data
      : Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString('utf8')
            : JSON.stringify(data)

    this.metrics.increment('ocpp_inbound_total')
    this.metrics.observeRate('ocpp_inbound_rate_per_sec')
    await this.sessions.touch(meta.chargePointId)

    const envelope = this.tryParseEnvelope(payload)
    if (envelope && envelope.messageTypeId === 2) {
      const cached = this.responseCache.get(meta, envelope.uniqueId)
      if (cached) {
        client.send(JSON.stringify(cached))
        this.metrics.increment('ocpp_outbound_total')
        this.metrics.observeRate('ocpp_outbound_rate_per_sec')
        return
      }
      const limit = await this.rateLimiter.check(meta, envelope.action)
      if (!limit.allowed) {
        this.metrics.increment('ocpp_rate_limited_total', { action: envelope.action })
        if (limit.error) {
          this.metrics.increment('ocpp_error_codes_total', {
            code: limit.error.code,
            direction: 'inbound',
          })
          const error = buildCallError(
            envelope.uniqueId,
            limit.error.code,
            limit.error.description,
            limit.error.details || {}
          )
          client.send(JSON.stringify(error))
          this.metrics.increment('ocpp_outbound_total')
          this.metrics.observeRate('ocpp_outbound_rate_per_sec')
        }
        return
      }
    }

    const response = await this.ocppService.handleIncoming(payload, meta)
    if (response) {
      client.send(JSON.stringify(response))
      this.metrics.increment('ocpp_outbound_total')
      this.metrics.observeRate('ocpp_outbound_rate_per_sec')
    }
  }

  private getPayloadSize(data: RawData): number {
    if (typeof data === 'string') {
      return Buffer.byteLength(data, 'utf8')
    }
    if (Buffer.isBuffer(data)) {
      return data.length
    }
    if (Array.isArray(data)) {
      return data.reduce((sum, chunk) => sum + chunk.length, 0)
    }
    if (data instanceof ArrayBuffer) {
      return data.byteLength
    }
    return 0
  }

  private tryParseEnvelope(payload: string) {
    try {
      const parsed = parseEnvelope(JSON.parse(payload))
      return parsed.ok ? parsed.envelope : null
    } catch {
      return null
    }
  }

  private parsePath(request: IncomingMessage): { ocppVersion: string; chargePointId: string } | null {
    const url = request.url || ''
    const path = url.split('?')[0]
    const parts = path.split('/').filter(Boolean)
    const ocppIndex = parts.findIndex((part) => part.toLowerCase() === 'ocpp')
    const rawVersion = ocppIndex >= 0 ? parts[ocppIndex + 1] : undefined
    const rawId = ocppIndex >= 0 ? parts[ocppIndex + 2] : undefined

    if (!rawVersion || !rawId) {
      return null
    }

    const normalizedVersion =
      rawVersion.toLowerCase() === '1.6' || rawVersion.toLowerCase() === '1.6j'
        ? '1.6J'
        : rawVersion
    const allowedVersions = new Set(['1.6J', '2.0.1', '2.1'])
    if (!allowedVersions.has(normalizedVersion)) {
      return null
    }

    return {
      ocppVersion: normalizedVersion,
      chargePointId: rawId,
    }
  }
}
