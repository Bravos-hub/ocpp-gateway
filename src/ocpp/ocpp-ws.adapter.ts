import { Logger } from '@nestjs/common'
import { WsAdapter } from '@nestjs/platform-ws'
import { constants } from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import { Socket } from 'net'
import type { SecureContextOptions, SecureVersion } from 'tls'

type TlsConfig = {
  keyPath: string
  certPath: string
  caPath: string
  crlPath?: string
  requestCert: boolean
  minVersion: SecureVersion
  ciphers: string
}

export class OcppWsAdapter extends WsAdapter {
  private static readonly tlsReloadMarker = Symbol('ocppTlsReload')
  private readonly adapterLogger = new Logger(OcppWsAdapter.name)

  protected ensureHttpServerExists(
    port: number,
    httpServer: http.Server = this.createServer()
  ): http.Server {
    this.assertTlsRequirement(httpServer)
    this.configureTlsReload(httpServer)
    if (this.httpServersRegistry.has(port)) {
      return this.httpServersRegistry.get(port) as http.Server
    }

    this.httpServersRegistry.set(port, httpServer)
    httpServer.on('upgrade', (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
      try {
        const baseUrl = `ws://${request.headers.host || 'localhost'}/`
        const pathname = new URL(request.url || '', baseUrl).pathname
        const expectedProtocols = this.expectedProtocolsFromPath(pathname)
        const offeredProtocols = this.parseProtocols(request.headers['sec-websocket-protocol'])

        if (!expectedProtocols || expectedProtocols.length === 0 || offeredProtocols.length === 0) {
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\nMissing Sec-WebSocket-Protocol')
          return
        }

        const matchedProtocol = expectedProtocols.find((protocol) =>
          offeredProtocols.includes(protocol)
        )
        if (!matchedProtocol) {
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\nInvalid Sec-WebSocket-Protocol')
          return
        }

        request.headers['sec-websocket-protocol'] = matchedProtocol
        const wsServersCollection = this.wsServersRegistry.get(port) ?? []
        let isRequestDelegated = false

        for (const wsServer of wsServersCollection) {
          if (this.isPathMatch(pathname, wsServer.path)) {
            wsServer.handleUpgrade(request, socket, head, (ws: unknown) => {
              wsServer.emit('connection', ws, request)
            })
            isRequestDelegated = true
            break
          }
        }

        if (!isRequestDelegated) {
          socket.destroy()
        }
      } catch (err) {
        socket.end('HTTP/1.1 400\r\n' + (err as Error).message)
      }
    })

    return httpServer
  }

  // Allow dynamic segments under the gateway path (e.g. /ocpp/1.6/CP-1).
  private isPathMatch(pathname: string, wsPath: string): boolean {
    return pathname === wsPath || pathname.startsWith(`${wsPath}/`)
  }

  private expectedProtocolsFromPath(pathname: string): string[] | null {
    const parts = pathname.split('/').filter(Boolean)
    const ocppIndex = parts.findIndex((part) => part.toLowerCase() === 'ocpp')
    const rawVersion = ocppIndex >= 0 ? parts[ocppIndex + 1] : undefined
    if (!rawVersion) return null

    const version = rawVersion.toLowerCase()
    if (version === '1.6' || version === '1.6j') {
      return ['ocpp1.6', 'ocpp1.6j']
    }
    if (version === '2.0.1') {
      return ['ocpp2.0.1']
    }
    if (version === '2.1') {
      return ['ocpp2.1']
    }
    return null
  }

  private parseProtocols(header: string | string[] | undefined): string[] {
    if (!header) return []
    const raw = Array.isArray(header) ? header.join(',') : header
    return raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  }

  private createServer(): http.Server {
    const tlsEnabled = this.isTlsEnabled()
    const tlsRequired = this.isTlsRequired()
    if (tlsRequired && !tlsEnabled) {
      throw new Error('OCPP_TLS_ENABLED must be true when TLS is required')
    }
    if (!tlsEnabled) {
      return http.createServer()
    }

    const tlsConfig = this.resolveTlsConfig()
    const secureContext = this.buildSecureContext(tlsConfig)
    const server = https.createServer({
      ...secureContext,
      requestCert: tlsConfig.requestCert,
      rejectUnauthorized: tlsConfig.requestCert,
    })
    this.setupTlsReload(server, tlsConfig)
    ;(server as https.Server & { [OcppWsAdapter.tlsReloadMarker]?: boolean })[
      OcppWsAdapter.tlsReloadMarker
    ] = true
    return server
  }

  private resolveMinVersion(value?: string): SecureVersion {
    if (!value) return 'TLSv1.2'
    if (value === 'TLSv1.3') return 'TLSv1.3'
    return 'TLSv1.2'
  }

  private buildSecureContext(config: TlsConfig): SecureContextOptions {
    return {
      key: fs.readFileSync(config.keyPath),
      cert: fs.readFileSync(config.certPath),
      ca: fs.readFileSync(config.caPath),
      crl: config.crlPath ? fs.readFileSync(config.crlPath) : undefined,
      minVersion: config.minVersion,
      ciphers: config.ciphers,
      honorCipherOrder: true,
      secureOptions: constants.SSL_OP_NO_RENEGOTIATION,
    }
  }

  private resolveTlsConfig(): TlsConfig {
    const keyPath = process.env.OCPP_TLS_KEY_PATH
    const certPath = process.env.OCPP_TLS_CERT_PATH
    if (!keyPath || !certPath) {
      throw new Error('OCPP_TLS_KEY_PATH and OCPP_TLS_CERT_PATH are required when TLS is enabled')
    }

    const caPath = process.env.OCPP_TLS_CA_PATH
    const crlPath = process.env.OCPP_TLS_CRL_PATH
    const requestCert = (process.env.OCPP_TLS_CLIENT_AUTH ?? 'true') === 'true'
    if (!requestCert) {
      throw new Error('OCPP_TLS_CLIENT_AUTH must be true to enforce mTLS')
    }
    if (!caPath) {
      throw new Error('OCPP_TLS_CA_PATH is required when mTLS is enabled')
    }

    return {
      keyPath,
      certPath,
      caPath,
      crlPath,
      requestCert,
      minVersion: this.resolveMinVersion(process.env.OCPP_TLS_MIN_VERSION),
      ciphers:
        process.env.OCPP_TLS_CIPHERS ||
        'TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:' +
          'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:' +
          'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256',
    }
  }

  private setupTlsReload(server: https.Server, config: TlsConfig): void {
    const reloadSeconds = this.parseInterval(process.env.OCPP_TLS_RELOAD_SECONDS)
    const crlReloadSeconds = this.parseInterval(process.env.OCPP_TLS_CRL_RELOAD_SECONDS)
    if (reloadSeconds <= 0 && crlReloadSeconds <= 0) {
      return
    }

    if (reloadSeconds > 0) {
      this.adapterLogger.log(`TLS reload enabled (every ${reloadSeconds}s)`)
      setInterval(() => this.reloadTlsContext(server, config, 'tls'), reloadSeconds * 1000).unref()
    }

    if (crlReloadSeconds > 0) {
      if (!config.crlPath) {
        this.adapterLogger.warn('OCPP_TLS_CRL_RELOAD_SECONDS set but OCPP_TLS_CRL_PATH is empty')
      } else {
        this.adapterLogger.log(`CRL reload enabled (every ${crlReloadSeconds}s)`)
      }
      setInterval(() => this.reloadTlsContext(server, config, 'crl'), crlReloadSeconds * 1000).unref()
    }
  }

  private reloadTlsContext(server: https.Server, config: TlsConfig, label: string): void {
    try {
      const secureContext = this.buildSecureContext(config)
      server.setSecureContext(secureContext)
      this.adapterLogger.log(`Reloaded TLS ${label} context`)
    } catch (error) {
      this.adapterLogger.error(
        `Failed to reload TLS ${label} context`,
        (error as Error).stack || (error as Error).message
      )
    }
  }

  private parseInterval(value?: string): number {
    if (!value) return 0
    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  private configureTlsReload(server: http.Server): void {
    if (!this.isTlsEnabled()) {
      return
    }
    if (!(server instanceof https.Server)) {
      return
    }
    const marker = server as https.Server & { [OcppWsAdapter.tlsReloadMarker]?: boolean }
    if (marker[OcppWsAdapter.tlsReloadMarker]) {
      return
    }
    marker[OcppWsAdapter.tlsReloadMarker] = true
    const config = this.resolveTlsConfig()
    this.setupTlsReload(server, config)
  }

  private isTlsEnabled(): boolean {
    return (process.env.OCPP_TLS_ENABLED ?? 'false') === 'true'
  }

  private isTlsRequired(): boolean {
    const explicit = (process.env.OCPP_TLS_REQUIRED || '').toLowerCase()
    if (explicit === 'true') return true
    if (explicit === 'false') return false
    return (process.env.NODE_ENV || '').toLowerCase() === 'production'
  }

  private assertTlsRequirement(server: http.Server): void {
    const tlsEnabled = (process.env.OCPP_TLS_ENABLED ?? 'false') === 'true'
    const tlsRequired = this.isTlsRequired()
    const isTlsServer = server instanceof https.Server
    if ((tlsRequired || tlsEnabled) && !isTlsServer) {
      throw new Error('TLS is required; provide an HTTPS server to NestFactory')
    }
  }
}
