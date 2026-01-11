import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { RedisService } from '../../redis/redis.service'

@Injectable()
export class OcppSecurityGuard implements CanActivate {
  private readonly logger = new Logger(OcppSecurityGuard.name)
  private readonly FLOOD_CONTROL_PREFIX = 'log:flood:suspicious'
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

  constructor(private readonly redis: RedisService) {}

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

  private getClientIp(req: any): string {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress || 
           'unknown'
  }
}
