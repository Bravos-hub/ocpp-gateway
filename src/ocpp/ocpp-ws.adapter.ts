import { WsAdapter } from '@nestjs/platform-ws'
import { constants } from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import { Socket } from 'net'
import type { SecureVersion } from 'tls'

export class OcppWsAdapter extends WsAdapter {
  protected ensureHttpServerExists(
    port: number,
    httpServer: http.Server = this.createServer()
  ): http.Server {
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
    const tlsEnabled = (process.env.OCPP_TLS_ENABLED ?? 'false') === 'true'
    const tlsRequired = this.isTlsRequired()
    if (tlsRequired && !tlsEnabled) {
      throw new Error('OCPP_TLS_ENABLED must be true when TLS is required')
    }
    if (!tlsEnabled) {
      return http.createServer()
    }

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
    const minVersion = this.resolveMinVersion(process.env.OCPP_TLS_MIN_VERSION)
    const ciphers =
      process.env.OCPP_TLS_CIPHERS ||
      'TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:' +
        'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:' +
        'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256'

    return https.createServer({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ca: fs.readFileSync(caPath),
      crl: crlPath ? fs.readFileSync(crlPath) : undefined,
      requestCert,
      rejectUnauthorized: requestCert,
      minVersion,
      ciphers,
      honorCipherOrder: true,
      secureOptions: constants.SSL_OP_NO_RENEGOTIATION,
    })
  }

  private resolveMinVersion(value?: string): SecureVersion {
    if (!value) return 'TLSv1.2'
    if (value === 'TLSv1.3') return 'TLSv1.3'
    return 'TLSv1.2'
  }

  private isTlsRequired(): boolean {
    const explicit = (process.env.OCPP_TLS_REQUIRED || '').toLowerCase()
    if (explicit === 'true') return true
    if (explicit === 'false') return false
    return (process.env.NODE_ENV || '').toLowerCase() === 'production'
  }
}
