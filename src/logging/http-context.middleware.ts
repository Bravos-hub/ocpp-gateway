import { Injectable, NestMiddleware } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Request, Response, NextFunction } from 'express'
import { LogContextService } from './log-context.service'

@Injectable()
export class HttpContextMiddleware implements NestMiddleware {
  constructor(private readonly context: LogContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = this.extractRequestId(req)
    const ip = this.extractIp(req)
    const path = req.originalUrl || req.url

    this.context.runWithContext(
      {
        correlationId: requestId,
        ip,
        path,
        method: req.method,
      },
      () => {
        res.setHeader('x-request-id', requestId)
        next()
      }
    )
  }

  private extractRequestId(req: Request): string {
    const header = req.headers['x-request-id']
    if (typeof header === 'string' && header.trim()) {
      return header.trim()
    }
    if (Array.isArray(header) && header.length > 0) {
      return header[0].trim()
    }
    return randomUUID()
  }

  private extractIp(req: Request): string {
    const trustProxy = (process.env.OCPP_TRUST_PROXY ?? 'false') === 'true'
    if (trustProxy) {
      const forwarded = req.headers['x-forwarded-for']
      if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim()
      }
    }
    return req.socket?.remoteAddress || 'unknown'
  }
}
