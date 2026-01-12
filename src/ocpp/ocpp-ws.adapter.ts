import { WsAdapter } from '@nestjs/platform-ws'
import { constants } from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import { Socket } from 'net'

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

  private createServer(): http.Server {
    const tlsEnabled = (process.env.OCPP_TLS_ENABLED ?? 'false') === 'true'
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
    const minVersion = process.env.OCPP_TLS_MIN_VERSION || 'TLSv1.2'
    const ciphers =
      process.env.OCPP_TLS_CIPHERS ||
      'TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:' +
        'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:' +
        'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256'

    return https.createServer({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ca: caPath ? fs.readFileSync(caPath) : undefined,
      crl: crlPath ? fs.readFileSync(crlPath) : undefined,
      requestCert,
      rejectUnauthorized: requestCert,
      minVersion,
      ciphers,
      honorCipherOrder: true,
      secureOptions: constants.SSL_OP_NO_RENEGOTIATION,
    })
  }
}
