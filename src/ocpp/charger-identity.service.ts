import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, timingSafeEqual } from 'crypto'
import { IncomingMessage } from 'http'
import { RedisService } from '../redis/redis.service'

export type ChargerIdentityAuthType = 'basic' | 'token' | 'mtls'

export type ChargerIdentityAuth = {
  type?: ChargerIdentityAuthType
  username?: string
  secretHash?: string
  secretSalt?: string
  secret?: string
  tokenHash?: string
  token?: string
  subject?: string
  fingerprint?: string
}

export type ChargerIdentity = {
  chargePointId: string
  stationId: string
  tenantId: string
  status?: 'active' | 'disabled'
  allowedProtocols?: string[]
  auth?: ChargerIdentityAuth
}

@Injectable()
export class ChargerIdentityService {
  private readonly logger = new Logger(ChargerIdentityService.name)
  private readonly keyPrefix: string
  private readonly defaultAuthMode: ChargerIdentityAuthType
  private readonly allowPlaintextSecrets: boolean

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {
    this.keyPrefix = this.config.get<string>('auth.identityPrefix') || 'chargers'
    this.defaultAuthMode = (this.config.get<string>('auth.mode') || 'basic') as ChargerIdentityAuthType
    this.allowPlaintextSecrets = this.config.get<boolean>('auth.allowPlaintextSecrets') ?? false
  }

  async authenticate(
    request: IncomingMessage,
    chargePointId: string,
    ocppVersion: string
  ): Promise<ChargerIdentity | null> {
    const identity = await this.getIdentity(chargePointId)
    if (!identity) {
      return null
    }

    if (identity.status && identity.status !== 'active') {
      return null
    }

    if (identity.allowedProtocols && identity.allowedProtocols.length > 0) {
      const allowed = identity.allowedProtocols.map((version) => version.toUpperCase())
      if (!allowed.includes(ocppVersion.toUpperCase())) {
        return null
      }
    }

    const authMode = (identity.auth?.type || this.defaultAuthMode) as ChargerIdentityAuthType
    switch (authMode) {
      case 'basic':
        return this.verifyBasic(request, identity) ? identity : null
      case 'token':
        return this.verifyToken(request, identity) ? identity : null
      case 'mtls':
        return this.verifyMtls(request, identity) ? identity : null
      default:
        return null
    }
  }

  async getIdentity(chargePointId: string): Promise<ChargerIdentity | null> {
    const client = this.redis.getClient()
    const raw = await client.get(this.key(chargePointId))
    if (!raw) return null

    let parsed: ChargerIdentity | null = null
    try {
      parsed = JSON.parse(raw) as ChargerIdentity
    } catch {
      parsed = null
    }

    if (!parsed || !parsed.stationId || !parsed.tenantId) {
      this.logger.warn(`Identity for ${chargePointId} is missing station/tenant mapping`)
      return null
    }

    if (parsed.chargePointId && parsed.chargePointId !== chargePointId) {
      this.logger.warn(`Identity mismatch for ${chargePointId} (stored ${parsed.chargePointId})`)
      return null
    }

    return { ...parsed, chargePointId }
  }

  private verifyBasic(request: IncomingMessage, identity: ChargerIdentity): boolean {
    const header = request.headers['authorization'] || ''
    if (typeof header !== 'string' || !header.startsWith('Basic ')) {
      return false
    }

    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator < 0) return false

    const username = decoded.slice(0, separator)
    const password = decoded.slice(separator + 1)
    const expectedUsername = identity.auth?.username || identity.chargePointId
    if (username !== expectedUsername) {
      return false
    }

    return this.verifySecret(password, identity)
  }

  private verifyToken(request: IncomingMessage, identity: ChargerIdentity): boolean {
    const header = request.headers['authorization']
    const apiKey = request.headers['x-api-key']
    let token = ''

    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      token = header.slice(7)
    } else if (typeof apiKey === 'string') {
      token = apiKey
    }

    if (!token) return false
    return this.verifyTokenValue(token, identity)
  }

  private verifyMtls(request: IncomingMessage, identity: ChargerIdentity): boolean {
    const socket: any = request.socket
    if (!socket || typeof socket.getPeerCertificate !== 'function') {
      return false
    }

    if (!socket.authorized) {
      return false
    }

    const cert = socket.getPeerCertificate()
    if (!cert) return false

    if (identity.auth?.subject && cert.subject?.CN !== identity.auth.subject) {
      return false
    }

    if (identity.auth?.fingerprint) {
      const fingerprint = cert.fingerprint256 || cert.fingerprint
      if (!fingerprint || fingerprint !== identity.auth.fingerprint) {
        return false
      }
    }

    return true
  }

  private verifySecret(password: string, identity: ChargerIdentity): boolean {
    const auth = identity.auth || {}

    if (auth.secretHash) {
      const hash = this.hashSecret(password, auth.secretSalt)
      return this.safeEqual(hash, auth.secretHash)
    }

    if (auth.secret && this.allowPlaintextSecrets) {
      return this.safeEqual(password, auth.secret)
    }

    return false
  }

  private verifyTokenValue(token: string, identity: ChargerIdentity): boolean {
    const auth = identity.auth || {}
    if (auth.tokenHash) {
      const hash = this.hashSecret(token, auth.secretSalt)
      return this.safeEqual(hash, auth.tokenHash)
    }

    if (auth.token && this.allowPlaintextSecrets) {
      return this.safeEqual(token, auth.token)
    }

    return false
  }

  private hashSecret(secret: string, salt?: string): string {
    const hash = createHash('sha256')
    if (salt) {
      hash.update(salt)
    }
    hash.update(secret)
    return hash.digest('hex')
  }

  private safeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a)
    const bBuf = Buffer.from(b)
    if (aBuf.length !== bBuf.length) return false
    return timingSafeEqual(aBuf, bBuf)
  }

  private key(chargePointId: string): string {
    return `${this.keyPrefix}:${chargePointId}`
  }
}
