import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common'
import { Request } from 'express'
import { MetricsService } from './metrics.service'

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  getMetrics(@Req() req: Request) {
    this.ensureAuthorized(req)
    return this.metrics.snapshot()
  }

  private ensureAuthorized(req: Request): void {
    const requiredToken = process.env.HEALTH_METRICS_AUTH_TOKEN
    if (!requiredToken) {
      return
    }
    const authHeader = req.headers['authorization']
    const bearer =
      typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : Array.isArray(authHeader)
          ? authHeader[0]
          : undefined
    const rawToken = this.readHeader(req, 'x-metrics-token') || this.readHeader(req, 'x-health-token')
    const presented = bearer || rawToken
    if (!presented || presented !== requiredToken) {
      throw new UnauthorizedException()
    }
  }

  private readHeader(req: Request, header: string): string | undefined {
    const value = req.headers[header]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (Array.isArray(value) && value.length > 0) {
      return value[0].trim()
    }
    return undefined
  }
}
