import { WsAdapter } from '@nestjs/platform-ws'
import * as http from 'http'
import { Socket } from 'net'

export class OcppWsAdapter extends WsAdapter {
  protected ensureHttpServerExists(
    port: number,
    httpServer: http.Server = http.createServer()
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
}
