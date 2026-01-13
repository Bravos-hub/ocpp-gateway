import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, timingSafeEqual } from 'crypto'
import { IncomingMessage } from 'http'
import { isIP } from 'net'
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
  allowedTypes?: ChargerIdentityAuthType[]
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
  allowedIps?: string[]
  allowedCidrs?: string[]
  auth?: ChargerIdentityAuth
}

@Injectable()
export class ChargerIdentityService {
  private readonly logger = new Logger(ChargerIdentityService.name)
  private readonly keyPrefix: string
  private readonly revokedPrefix: string
  private readonly requireExplicitCertBinding: boolean
  private readonly defaultAuthMode: ChargerIdentityAuthType
  private readonly allowBasicAuth: boolean
  private readonly requireAllowedProtocols: boolean
  private readonly requireSecretSalt: boolean
  private readonly minSecretHashLength: number
  private readonly minSaltLength: number
  private readonly allowPlaintextSecrets: boolean
  private readonly trustProxy: boolean
  private readonly globalAllowedIps: string[]
  private readonly globalAllowedCidrs: string[]

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production'
    this.keyPrefix = this.config.get<string>('auth.identityPrefix') || 'chargers'
    this.revokedPrefix = this.config.get<string>('auth.revokedPrefix') || 'revoked-certs'
    this.requireExplicitCertBinding = this.config.get<boolean>('auth.requireCertBinding') ?? true
    this.defaultAuthMode = (this.config.get<string>('auth.mode') || 'basic') as ChargerIdentityAuthType
    this.allowBasicAuth = this.config.get<boolean>('auth.allowBasic') ?? !isProd
    this.requireAllowedProtocols = this.config.get<boolean>('auth.requireAllowedProtocols') ?? isProd
    this.requireSecretSalt = this.config.get<boolean>('auth.requireSecretSalt') ?? true
    this.minSecretHashLength = this.config.get<number>('auth.minSecretHashLength') || 64
    this.minSaltLength = this.config.get<number>('auth.minSaltLength') || 8
    this.trustProxy = this.config.get<boolean>('auth.trustProxy') ?? false
    this.globalAllowedIps = this.normalizeList(this.config.get<string[]>('auth.allowedIps'))
    this.globalAllowedCidrs = this.normalizeList(this.config.get<string[]>('auth.allowedCidrs'))
    const allowPlaintextSecrets = this.config.get<boolean>('auth.allowPlaintextSecrets') ?? false
    if (allowPlaintextSecrets) {
      this.logger.warn('Plaintext secrets are disabled and will be ignored')
    }
    this.allowPlaintextSecrets = false
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

    const allowed = this.normalizeAllowedProtocols(identity.allowedProtocols)
    if (this.requireAllowedProtocols && allowed.length === 0) {
      this.logger.warn(`Missing allowedProtocols for ${identity.chargePointId}`)
      return null
    }
    if (allowed.length > 0) {
      const normalized = this.normalizeVersion(ocppVersion)
      if (!allowed.includes(normalized)) {
        return null
      }
    }

    const clientIp = this.extractClientIp(request)
    if (!this.isIpAllowed(clientIp, identity)) {
      const ipLabel = clientIp || 'unknown'
      this.logger.warn(`IP ${ipLabel} not allowed for ${identity.chargePointId}`)
      return null
    }

    const authMode = this.resolveAuthMode(identity)
    if (!authMode) {
      return null
    }
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

  getClientIp(request: IncomingMessage): string {
    return this.extractClientIp(request) || 'unknown'
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
    if (!this.validateBasicConfig(identity)) {
      return false
    }
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
    if (!this.validateTokenConfig(identity)) {
      return false
    }
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

    return false
  }

  private verifyTokenValue(token: string, identity: ChargerIdentity): boolean {
    const auth = identity.auth || {}
    if (auth.tokenHash) {
      const hash = this.hashSecret(token, auth.secretSalt)
      return this.safeEqual(hash, auth.tokenHash)
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
    const trimmed = version.trim()
    const normalized = trimmed.toLowerCase()
    if (normalized === '1.6' || normalized === '1.6j') {
      return '1.6J'
    }
    return trimmed
  }

  private normalizeAllowedProtocols(values?: string[]): string[] {
    if (!values || values.length === 0) return []
    const normalized = values
      .map((value) => this.normalizeAllowedProtocol(value))
      .filter((value): value is string => Boolean(value))
    return Array.from(new Set(normalized))
  }

  private resolveAuthMode(identity: ChargerIdentity): ChargerIdentityAuthType | null {
    const rawMode = identity.auth?.type || this.defaultAuthMode
    const authMode = this.normalizeAuthType(rawMode)
    if (!authMode) {
      this.logger.warn(`Unsupported auth mode for ${identity.chargePointId}`)
      return null
    }

    const allowedRaw = identity.auth?.allowedTypes
    const allowed = this.normalizeAuthTypes(allowedRaw)
    if (allowedRaw && allowed.length === 0) {
      this.logger.warn(`Invalid allowedTypes for ${identity.chargePointId}`)
      return null
    }
    if (allowed.length > 0 && !allowed.includes(authMode)) {
      this.logger.warn(`Auth mode ${authMode} not allowed for ${identity.chargePointId}`)
      return null
    }

    return authMode
  }

  private normalizeAuthTypes(values?: ChargerIdentityAuthType[]): ChargerIdentityAuthType[] {
    if (!values || values.length === 0) return []
    const normalized = values
      .map((value) => this.normalizeAuthType(value))
      .filter((value): value is ChargerIdentityAuthType => Boolean(value))
    return Array.from(new Set(normalized))
  }

  private normalizeAuthType(value?: string): ChargerIdentityAuthType | null {
    if (!value || typeof value !== 'string') return null
    const normalized = value.toLowerCase()
    if (normalized === 'basic' || normalized === 'token' || normalized === 'mtls') {
      return normalized as ChargerIdentityAuthType
    }
    return null
  }

  private extractClientIp(request: IncomingMessage): string | null {
    const forwarded = this.trustProxy ? this.extractForwardedFor(request) : null
    const direct =
      request.socket?.remoteAddress ||
      (request as any).connection?.remoteAddress ||
      (request as any).connection?.socket?.remoteAddress ||
      null
    const candidate = forwarded || direct
    return this.normalizeIp(candidate)
  }

  private extractForwardedFor(request: IncomingMessage): string | null {
    const header = request.headers['x-forwarded-for']
    if (typeof header === 'string' && header.trim()) {
      return header.split(',')[0].trim()
    }
    if (Array.isArray(header) && header.length > 0) {
      return header[0].split(',')[0].trim()
    }
    const forwarded = request.headers['forwarded']
    if (typeof forwarded === 'string') {
      const match = forwarded.split(',')[0].match(/for=([^;]+)/i)
      if (match) {
        return match[1].trim().replace(/^"|"$/g, '')
      }
    }
    return null
  }

  private normalizeIp(value: string | null): string | null {
    if (!value) return null
    let ip = value.trim()
    if (!ip) return null

    if (ip.startsWith('[')) {
      const end = ip.indexOf(']')
      if (end > 0) {
        ip = ip.slice(1, end)
      }
    }

    const zoneIndex = ip.indexOf('%')
    if (zoneIndex >= 0) {
      ip = ip.slice(0, zoneIndex)
    }

    if (ip.includes('.') && ip.lastIndexOf(':') > ip.lastIndexOf('.')) {
      ip = ip.slice(0, ip.lastIndexOf(':'))
    }

    if (ip.startsWith('::ffff:')) {
      ip = ip.slice(7)
    }

    return isIP(ip) ? ip : null
  }

  private isIpAllowed(ip: string | null, identity: ChargerIdentity): boolean {
    const globalIps = this.globalAllowedIps
    const globalCidrs = this.globalAllowedCidrs
    const identityIps = this.normalizeList(identity.allowedIps)
    const identityCidrs = this.normalizeList(identity.allowedCidrs)
    const hasGlobal = globalIps.length > 0 || globalCidrs.length > 0
    const hasIdentity = identityIps.length > 0 || identityCidrs.length > 0

    if (!hasGlobal && !hasIdentity) {
      return true
    }
    if (!ip) {
      return false
    }

    if (hasGlobal && !this.isIpInAllowlist(ip, globalIps, globalCidrs)) {
      return false
    }
    if (hasIdentity && !this.isIpInAllowlist(ip, identityIps, identityCidrs)) {
      return false
    }

    return true
  }

  private isIpInAllowlist(ip: string, ips: string[], cidrs: string[]): boolean {
    const normalizedIp = this.normalizeIp(ip)
    if (!normalizedIp) return false

    const normalizedIps = ips
      .map((entry) => this.normalizeIp(entry))
      .filter((entry): entry is string => Boolean(entry))
    if (normalizedIps.includes(normalizedIp)) {
      return true
    }

    return this.isIpInCidrs(normalizedIp, cidrs)
  }

  private isIpInCidrs(ip: string, cidrs: string[]): boolean {
    if (cidrs.length === 0) return false
    const ipVersion = isIP(ip)
    for (const entry of cidrs) {
      const trimmed = entry.trim()
      if (!trimmed) continue
      const [rangeRaw, prefixRaw] = trimmed.split('/')
      if (!rangeRaw || prefixRaw === undefined) continue
      const range = this.normalizeIp(rangeRaw)
      if (!range) continue

      const rangeVersion = isIP(range)
      if (rangeVersion !== ipVersion) continue

      const prefix = parseInt(prefixRaw, 10)
      if (Number.isNaN(prefix)) continue

      if (rangeVersion === 4) {
        if (prefix < 0 || prefix > 32) continue
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
        const ipInt = this.ipv4ToInt(ip)
        const rangeInt = this.ipv4ToInt(range)
        if ((ipInt & mask) === (rangeInt & mask)) {
          return true
        }
      } else if (rangeVersion === 6) {
        if (prefix < 0 || prefix > 128) continue
        const ipInt = this.ipv6ToBigInt(ip)
        const rangeInt = this.ipv6ToBigInt(range)
        if (ipInt === null || rangeInt === null) continue

        const all = (1n << 128n) - 1n
        const shift = BigInt(128 - prefix)
        const mask = prefix === 0 ? 0n : (all << shift) & all
        if ((ipInt & mask) === (rangeInt & mask)) {
          return true
        }
      }
    }

    return false
  }

  private ipv4ToInt(ip: string): number {
    return ip
      .split('.')
      .map((value) => parseInt(value, 10))
      .reduce((acc, value) => ((acc << 8) + value) >>> 0, 0)
  }

  private ipv6ToBigInt(ip: string): bigint | null {
    const parts = ip.split('::')
    if (parts.length > 2) return null

    const head = parts[0] ? parts[0].split(':').filter(Boolean) : []
    const tail = parts[1] ? parts[1].split(':').filter(Boolean) : []
    const missing = parts.length === 2 ? 8 - (head.length + tail.length) : 0
    if (missing < 0) return null

    const hextets = parts.length === 2 ? [...head, ...Array(missing).fill('0'), ...tail] : head
    if (hextets.length !== 8) return null

    let result = 0n
    for (const hextet of hextets) {
      const value = parseInt(hextet, 16)
      if (Number.isNaN(value) || value < 0 || value > 0xffff) {
        return null
      }
      result = (result << 16n) + BigInt(value)
    }
    return result
  }

  private normalizeList(values?: string[]): string[] {
    if (!values || values.length === 0) return []
    return values.map((entry) => entry.trim()).filter(Boolean)
  }

  private normalizeAllowedProtocol(value: string): string | null {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) return null
    const withoutPrefix = trimmed.startsWith('ocpp') ? trimmed.slice(4) : trimmed
    if (withoutPrefix === '1.6' || withoutPrefix === '1.6j') {
      return '1.6J'
    }
    if (withoutPrefix === '2.0.1') {
      return '2.0.1'
    }
    if (withoutPrefix === '2.1') {
      return '2.1'
    }
    return null
  }

  private validateBasicConfig(identity: ChargerIdentity): boolean {
    if (!this.allowBasicAuth) {
      this.logger.warn(`Basic auth disabled for ${identity.chargePointId}`)
      return false
    }
    const auth = identity.auth || {}
    if (!auth.secretHash || !this.isHashStrong(auth.secretHash)) {
      this.logger.warn(`Basic auth requires a strong secretHash for ${identity.chargePointId}`)
      return false
    }
    if (this.requireSecretSalt && !this.isSaltStrong(auth.secretSalt)) {
      this.logger.warn(`Basic auth requires secretSalt for ${identity.chargePointId}`)
      return false
    }
    return true
  }

  private validateTokenConfig(identity: ChargerIdentity): boolean {
    const auth = identity.auth || {}
    if (!auth.tokenHash || !this.isHashStrong(auth.tokenHash)) {
      this.logger.warn(`Token auth requires a strong tokenHash for ${identity.chargePointId}`)
      return false
    }
    if (this.requireSecretSalt && !this.isSaltStrong(auth.secretSalt)) {
      this.logger.warn(`Token auth requires secretSalt for ${identity.chargePointId}`)
      return false
    }
    return true
  }

  private isHashStrong(value?: string): boolean {
    if (!value) return false
    return value.length >= this.minSecretHashLength
  }

  private isSaltStrong(value?: string): boolean {
    if (!value) return false
    return value.length >= this.minSaltLength
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
