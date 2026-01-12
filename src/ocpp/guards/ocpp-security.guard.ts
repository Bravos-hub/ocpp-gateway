import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { RedisService } from '../../redis/redis.service'
import { ChargerIdentityService } from '../charger-identity.service'

@Injectable()
export class OcppSecurityGuard implements CanActivate {
  private readonly logger = new Logger(OcppSecurityGuard.name)
  private readonly FLOOD_CONTROL_PREFIX = 'log:flood:suspicious'
  private readonly UNAUTHORIZED_PREFIX = 'log:flood:unauthorized'
  private readonly FLOOD_LOG_COOLDOWN = parseInt(process.env.FLOOD_LOG_COOLDOWN || '300')
  
  private readonly suspiciousPatterns = [
    /\.env/i,
    /\/etc\/passwd/i,
    /admin/i,
    /login/i,
    /\/wp-admin/i,
    /\/phpmyadmin/i,
    /xmlrpc/i,
    /select.*from/i,
    /\.\./,
  ]
  
  private readonly validCpPathRegex = /^\/ocpp\/(1\.6|1\.6j|2\.0\.1|2\.1)\/[\w-]{3,}$/i

  constructor(
    private readonly redis: RedisService,
    private readonly identity: ChargerIdentityService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient()
    const request = client.upgradeReq || client._socket?.parser?.incoming
    
    if (!request) return false
    
    const ip = this.getClientIp(request)
    const path = request.url?.toLowerCase() || ''
    
    const isSuspicious = this.suspiciousPatterns.some(p => p.test(path))
    const isInvalid = !this.validCpPathRegex.test(path)
    
    if (isSuspicious || isInvalid) {
      await this.logSuspiciousActivity(ip, path, request)
      return false
    }

    const parsed = this.parsePath(request.url || '')
    if (!parsed) {
      await this.logSuspiciousActivity(ip, path, request)
      return false
    }

    const identity = await this.identity.authenticate(request, parsed.chargePointId, parsed.ocppVersion)
    if (!identity) {
      await this.logUnauthorized(ip, parsed.chargePointId)
      return false
    }

    const wsClient = client as any
    wsClient.ocppIdentity = identity
    wsClient.ocppVersion = parsed.ocppVersion
    return true
  }

  private async logSuspiciousActivity(ip: string, path: string, req: any) {
    const client = this.redis.getClient()
    const floodKey = `${this.FLOOD_CONTROL_PREFIX}:${ip}`
    const exists = await client.exists(floodKey)
    
    if (!exists) {
      const userAgent = req.headers['user-agent'] || 'unknown'
      this.logger.error(`[OCPP][REJECTED] Path: ${path} | IP: ${ip} | UA: ${userAgent}`)
      await client.setex(floodKey, this.FLOOD_LOG_COOLDOWN, '1')
    }
  }

  private async logUnauthorized(ip: string, chargePointId: string) {
    const client = this.redis.getClient()
    const floodKey = `${this.UNAUTHORIZED_PREFIX}:${ip}`
    const exists = await client.exists(floodKey)
    if (!exists) {
      this.logger.warn(`[OCPP][UNAUTHORIZED] chargePointId=${chargePointId} ip=${ip}`)
      await client.setex(floodKey, this.FLOOD_LOG_COOLDOWN, '1')
    }
  }

  private parsePath(url: string): { ocppVersion: string; chargePointId: string } | null {
    const path = url.split('?')[0]
    const parts = path.split('/').filter(Boolean)
    const ocppIndex = parts.findIndex((part) => part.toLowerCase() === 'ocpp')
    const rawVersion = ocppIndex >= 0 ? parts[ocppIndex + 1] : undefined
    const rawId = ocppIndex >= 0 ? parts[ocppIndex + 2] : undefined

    if (!rawVersion || !rawId) {
      return null
    }

    const normalizedVersion = rawVersion.toLowerCase() === '1.6' || rawVersion.toLowerCase() === '1.6j'
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

  private getClientIp(req: any): string {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress || 
           'unknown'
  }
}
