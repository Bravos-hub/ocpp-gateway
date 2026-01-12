import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, timingSafeEqual } from 'crypto'
import { IncomingMessage } from 'http'
import { RedisService } from '../redis/redis.service'

export type ChargerIdentityAuthType = 'basic' | 'token' | 'mtls'

type ExtractedCertInfo = {
  fingerprint: string
  subject: string
  serialNumber: string
  altNames: string[]
  expired?: boolean
}

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
  certificates?: ChargerCertificateBinding[]
  revokedFingerprints?: string[]
}

export type ChargerCertificateBinding = {
  fingerprint?: string
  subject?: string
  subjectAltName?: string
  serialNumber?: string
  validFrom?: string
  validTo?: string
  status?: 'active' | 'revoked'
  chargePointId?: string
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
  private readonly revokedPrefix: string
  private readonly requireExplicitCertBinding: boolean
  private readonly defaultAuthMode: ChargerIdentityAuthType
  private readonly allowPlaintextSecrets: boolean

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {
    this.keyPrefix = this.config.get<string>('auth.identityPrefix') || 'chargers'
    this.revokedPrefix = this.config.get<string>('auth.revokedPrefix') || 'revoked-certs'
    this.requireExplicitCertBinding = this.config.get<boolean>('auth.requireCertBinding') ?? true
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
      const normalized = this.normalizeVersion(ocppVersion).toUpperCase()
      if (!allowed.includes(normalized)) {
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
        return (await this.verifyMtls(request, identity)) ? identity : null
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

  private async verifyMtls(request: IncomingMessage, identity: ChargerIdentity): Promise<boolean> {
    const socket: any = request.socket
    if (!socket || typeof socket.getPeerCertificate !== 'function') {
      return false
    }

    if (!socket.encrypted || !socket.authorized) {
      return false
    }

    const cert = socket.getPeerCertificate(true)
    if (!cert) return false

    const certInfo = this.extractCertInfo(cert)
    if (!certInfo.fingerprint) {
      return false
    }
    if (certInfo.expired) {
      return false
    }

    if (await this.isRevokedFingerprint(certInfo.fingerprint, identity)) {
      return false
    }

    const bindings = this.resolveBindings(identity)
    if (bindings.length === 0 && this.requireExplicitCertBinding) {
      this.logger.warn(`No cert bindings configured for ${identity.chargePointId}`)
      return false
    }

    if (bindings.length === 0) {
      return this.matchesFallback(certInfo, identity)
    }

    return this.matchesBinding(certInfo, bindings, identity.chargePointId)
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

  private resolveBindings(identity: ChargerIdentity): ChargerCertificateBinding[] {
    const auth = identity.auth || {}
    const bindings: ChargerCertificateBinding[] = []

    if (Array.isArray(auth.certificates)) {
      bindings.push(...auth.certificates)
    }

    if (auth.fingerprint || auth.subject) {
      bindings.push({
        fingerprint: auth.fingerprint,
        subject: auth.subject,
        status: 'active',
      })
    }

    return bindings
  }

  private matchesBinding(
    certInfo: ExtractedCertInfo,
    bindings: ChargerCertificateBinding[],
    chargePointId: string
  ): boolean {
    const now = Date.now()
    return bindings.some((binding) => {
      if (binding.status === 'revoked') return false
      if (binding.chargePointId && binding.chargePointId !== chargePointId) {
        return false
      }
      if (!this.isWithinWindow(binding.validFrom, binding.validTo, now)) {
        return false
      }

      const fingerprintMatch = binding.fingerprint
        ? this.normalizeFingerprint(binding.fingerprint) === certInfo.fingerprint
        : false
      const subjectMatch = binding.subject
        ? binding.subject === certInfo.subject
        : false
      const altMatch = binding.subjectAltName
        ? certInfo.altNames.includes(binding.subjectAltName)
        : false
      const serialMatch = binding.serialNumber
        ? binding.serialNumber === certInfo.serialNumber
        : false

      return fingerprintMatch || subjectMatch || altMatch || serialMatch
    })
  }

  private matchesFallback(certInfo: ExtractedCertInfo, identity: ChargerIdentity): boolean {
    if (identity.auth?.subject && certInfo.subject) {
      return identity.auth.subject === certInfo.subject
    }
    if (identity.auth?.fingerprint && certInfo.fingerprint) {
      return this.normalizeFingerprint(identity.auth.fingerprint) === certInfo.fingerprint
    }
    return false
  }

  private async isRevokedFingerprint(fingerprint: string, identity: ChargerIdentity): Promise<boolean> {
    const normalized = this.normalizeFingerprint(fingerprint)
    const revokedList = identity.auth?.revokedFingerprints || []
    if (revokedList.map((entry) => this.normalizeFingerprint(entry)).includes(normalized)) {
      return true
    }

    const client = this.redis.getClient()
    const key = `${this.revokedPrefix}:${normalized}`
    const exists = await client.exists(key)
    return exists === 1
  }

  private normalizeFingerprint(value: string): string {
    return value.replace(/:/g, '').toUpperCase()
  }

  private extractCertInfo(cert: any): ExtractedCertInfo {
    const subject = cert.subject?.CN || ''
    const serialNumber = cert.serialNumber || ''
    const fingerprintRaw = cert.fingerprint256 || cert.fingerprint || ''
    const fingerprint = fingerprintRaw ? this.normalizeFingerprint(fingerprintRaw) : ''
    const altNames = this.parseAltNames(cert.subjectaltname || '')
    const now = Date.now()

    if (cert.valid_from && cert.valid_to) {
      if (!this.isWithinWindow(cert.valid_from, cert.valid_to, now)) {
        return { fingerprint, subject, serialNumber, altNames, expired: true }
      }
    }

    return { fingerprint, subject, serialNumber, altNames }
  }

  private parseAltNames(subjectAltName: string): string[] {
    if (!subjectAltName) return []
    return subjectAltName
      .split(',')
      .map((entry: string) => entry.trim())
      .filter(Boolean)
  }

  private isWithinWindow(from?: string, to?: string, now: number = Date.now()): boolean {
    const fromTs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY
    const toTs = to ? Date.parse(to) : Number.POSITIVE_INFINITY
    if (Number.isNaN(fromTs) || Number.isNaN(toTs)) {
      return false
    }
    return now >= fromTs && now <= toTs
  }

  private normalizeVersion(version: string): string {
    if (version.toLowerCase() === '1.6' || version.toLowerCase() === '1.6j') {
      return '1.6J'
    }
    return version
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
