import * as fs from 'fs'

type IntBounds = { min?: number; max?: number }

export function validateEnvOrThrow(env: NodeJS.ProcessEnv = process.env): void {
  const issues: string[] = []
  const isProd = (env.NODE_ENV || '').toLowerCase() === 'production'

  readInt(env, 'PORT', 3001, { min: 1, max: 65535 }, issues)

  const kafkaEnabled = (env.KAFKA_ENABLED ?? 'true') !== 'false'
  const requireKafka = readBool(env, 'REQUIRE_KAFKA', false, issues)
  const brokers = parseList(env.KAFKA_BROKERS ?? 'localhost:9092')
  if (kafkaEnabled) {
    if (brokers.length === 0) {
      issues.push('KAFKA_BROKERS is required when KAFKA_ENABLED is true')
    } else {
      brokers.forEach((broker) => {
        const error = validateBroker(broker)
        if (error) {
          issues.push(`KAFKA_BROKERS entry "${broker}" is invalid: ${error}`)
        }
      })
    }
  }
  if (requireKafka && !kafkaEnabled) {
    issues.push('REQUIRE_KAFKA cannot be true when KAFKA_ENABLED is false')
  }
  readInt(env, 'KAFKA_RETRY_MAX_RETRIES', 5, { min: 0 }, issues)
  const kafkaInitialRetry = readInt(env, 'KAFKA_RETRY_INITIAL_MS', 300, { min: 0 }, issues)
  const kafkaMaxRetry = readInt(env, 'KAFKA_RETRY_MAX_MS', 30000, { min: 0 }, issues)
  readFloat(env, 'KAFKA_RETRY_FACTOR', 0.2, { min: 0 }, issues)
  readInt(env, 'KAFKA_CONNECTION_TIMEOUT_MS', 10000, { min: 1 }, issues)
  readInt(env, 'KAFKA_REQUEST_TIMEOUT_MS', 30000, { min: 1 }, issues)
  readInt(env, 'KAFKA_CIRCUIT_FAILURE_THRESHOLD', 5, { min: 1 }, issues)
  readInt(env, 'KAFKA_CIRCUIT_OPEN_SECONDS', 15, { min: 1 }, issues)
  readInt(env, 'KAFKA_CIRCUIT_HALF_OPEN_SUCCESS', 2, { min: 1 }, issues)
  if (kafkaMaxRetry < kafkaInitialRetry) {
    issues.push('KAFKA_RETRY_MAX_MS must be >= KAFKA_RETRY_INITIAL_MS')
  }

  const redisEnabled = (env.REDIS_ENABLED ?? 'true') !== 'false'
  const requireRedis = readBool(env, 'REQUIRE_REDIS', false, issues)
  const redisUrl = env.REDIS_URL ?? 'redis://localhost:6379'
  if (redisEnabled) {
    if (!redisUrl) {
      issues.push('REDIS_URL is required when REDIS_ENABLED is true')
    } else if (!/^rediss?:\/\//i.test(redisUrl)) {
      issues.push('REDIS_URL must start with redis:// or rediss://')
    }
  }
  if (requireRedis && !redisEnabled) {
    issues.push('REQUIRE_REDIS cannot be true when REDIS_ENABLED is false')
  }
  readInt(env, 'REDIS_RETRY_MAX_ATTEMPTS', 20, { min: 0 }, issues)
  const redisInitialDelay = readInt(env, 'REDIS_RETRY_INITIAL_DELAY_MS', 200, { min: 0 }, issues)
  const redisMaxDelay = readInt(env, 'REDIS_RETRY_MAX_DELAY_MS', 2000, { min: 0 }, issues)
  readInt(env, 'REDIS_CONNECT_TIMEOUT_MS', 10000, { min: 1 }, issues)
  readInt(env, 'REDIS_MAX_RETRIES_PER_REQUEST', 20, { min: 0 }, issues)
  readInt(env, 'REDIS_CIRCUIT_FAILURE_THRESHOLD', 5, { min: 1 }, issues)
  readInt(env, 'REDIS_CIRCUIT_OPEN_SECONDS', 15, { min: 1 }, issues)
  readInt(env, 'REDIS_CIRCUIT_HALF_OPEN_SUCCESS', 2, { min: 1 }, issues)
  if (redisMaxDelay < redisInitialDelay) {
    issues.push('REDIS_RETRY_MAX_DELAY_MS must be >= REDIS_RETRY_INITIAL_DELAY_MS')
  }

  const tlsEnabled = (env.OCPP_TLS_ENABLED ?? 'false') === 'true'
  const tlsRequiredFlag = (env.OCPP_TLS_REQUIRED || '').toLowerCase()
  const tlsRequired =
    tlsRequiredFlag === 'true' || (tlsRequiredFlag !== 'false' && isProd)

  if (tlsRequired && !tlsEnabled) {
    issues.push('OCPP_TLS_ENABLED must be true when TLS is required')
  }

  if (tlsEnabled) {
    const keyPath = env.OCPP_TLS_KEY_PATH
    const certPath = env.OCPP_TLS_CERT_PATH
    const caPath = env.OCPP_TLS_CA_PATH
    const crlPath = env.OCPP_TLS_CRL_PATH
    const requestCert = (env.OCPP_TLS_CLIENT_AUTH ?? 'true') === 'true'

    if (!keyPath) {
      issues.push('OCPP_TLS_KEY_PATH is required when TLS is enabled')
    } else if (!fs.existsSync(keyPath)) {
      issues.push(`OCPP_TLS_KEY_PATH not found: ${keyPath}`)
    }

    if (!certPath) {
      issues.push('OCPP_TLS_CERT_PATH is required when TLS is enabled')
    } else if (!fs.existsSync(certPath)) {
      issues.push(`OCPP_TLS_CERT_PATH not found: ${certPath}`)
    }

    if (!caPath) {
      issues.push('OCPP_TLS_CA_PATH is required when TLS is enabled')
    } else if (!fs.existsSync(caPath)) {
      issues.push(`OCPP_TLS_CA_PATH not found: ${caPath}`)
    }

    if (!requestCert) {
      issues.push('OCPP_TLS_CLIENT_AUTH must be true to enforce mTLS')
    }

    if (crlPath) {
      if (!fs.existsSync(crlPath)) {
        issues.push(`OCPP_TLS_CRL_PATH not found: ${crlPath}`)
      }
    }

    const minVersion = env.OCPP_TLS_MIN_VERSION
    if (minVersion && minVersion !== 'TLSv1.2' && minVersion !== 'TLSv1.3') {
      issues.push('OCPP_TLS_MIN_VERSION must be TLSv1.2 or TLSv1.3')
    }
  }

  readInt(env, 'OCPP_TLS_RELOAD_SECONDS', 0, { min: 0 }, issues)
  readInt(env, 'OCPP_TLS_CRL_RELOAD_SECONDS', 0, { min: 0 }, issues)

  readInt(env, 'OCPP_MAX_PAYLOAD_BYTES', 262144, { min: 0 }, issues)
  readInt(env, 'OCPP_RESPONSE_CACHE_TTL_SECONDS', 300, { min: 0 }, issues)
  readBool(env, 'OCPP_RESPONSE_CACHE_REDIS', true, issues)
  readInt(env, 'OCPP_PENDING_MESSAGE_LIMIT', 100, { min: 0 }, issues)

  const windowSeconds = readInt(env, 'OCPP_RATE_LIMIT_WINDOW_SECONDS', 60, { min: 0 }, issues)
  const perChargePoint = readInt(env, 'OCPP_RATE_LIMIT_PER_CP', 0, { min: 0 }, issues)
  const globalLimit = readInt(env, 'OCPP_RATE_LIMIT_GLOBAL', 0, { min: 0 }, issues)
  if ((perChargePoint > 0 || globalLimit > 0) && windowSeconds <= 0) {
    issues.push('OCPP_RATE_LIMIT_WINDOW_SECONDS must be > 0 when rate limits are enabled')
  }

  const auditTtl = readInt(env, 'COMMAND_AUDIT_TTL_SECONDS', 86400, { min: 1 }, issues)
  const idempotencyTtl = readInt(env, 'COMMAND_IDEMPOTENCY_TTL_SECONDS', auditTtl, { min: 1 }, issues)
  if (idempotencyTtl > auditTtl) {
    issues.push('COMMAND_IDEMPOTENCY_TTL_SECONDS must be <= COMMAND_AUDIT_TTL_SECONDS')
  }
  readInt(env, 'SESSION_TTL_SECONDS', 300, { min: 1 }, issues)
  readInt(env, 'SESSION_STALE_SECONDS', 0, { min: 0 }, issues)
  readInt(env, 'NODE_TTL_SECONDS', 120, { min: 1 }, issues)
  readInt(env, 'NODE_HEARTBEAT_SECONDS', 30, { min: 1 }, issues)
  readInt(env, 'FLOOD_LOG_COOLDOWN', 300, { min: 1 }, issues)
  readInt(env, 'METRICS_RATE_WINDOW_SECONDS', 60, { min: 1 }, issues)
  readFloat(env, 'METRICS_ALERT_RATE_LIMITED_PER_SEC', 0, { min: 0 }, issues)
  readFloat(env, 'METRICS_ALERT_AUTH_FAILURES_PER_SEC', 0, { min: 0 }, issues)
  readFloat(env, 'METRICS_ALERT_ERROR_PER_SEC', 0, { min: 0 }, issues)
  readInt(env, 'OCPP_REVOKED_TTL_SECONDS', 0, { min: 0 }, issues)
  readInt(env, 'OCPP_AUTH_MIN_SECRET_HASH_LENGTH', 64, { min: 1 }, issues)
  readInt(env, 'OCPP_AUTH_MIN_SALT_LENGTH', 8, { min: 1 }, issues)

  const authMode = (env.OCPP_AUTH_MODE || 'basic').toLowerCase()
  if (!['basic', 'token', 'mtls'].includes(authMode)) {
    issues.push('OCPP_AUTH_MODE must be basic, token, or mtls')
  }

  const hashAlgorithm = normalizeHashAlgorithm(env.OCPP_AUTH_HASH_ALGORITHM || 'sha256')
  if (!hashAlgorithm) {
    issues.push('OCPP_AUTH_HASH_ALGORITHM must be sha256 or scrypt')
  } else if (hashAlgorithm === 'scrypt') {
    const n = readInt(env, 'OCPP_AUTH_SCRYPT_N', 16384, { min: 2 }, issues)
    if (!isPowerOfTwo(n)) {
      issues.push('OCPP_AUTH_SCRYPT_N must be a power of two')
    }
    readInt(env, 'OCPP_AUTH_SCRYPT_R', 8, { min: 1 }, issues)
    readInt(env, 'OCPP_AUTH_SCRYPT_P', 1, { min: 1 }, issues)
    readInt(env, 'OCPP_AUTH_SCRYPT_KEYLEN', 32, { min: 16 }, issues)
  }

  if (issues.length > 0) {
    const message = ['Invalid configuration:', ...issues.map((issue) => `- ${issue}`)].join('\n')
    throw new Error(message)
  }
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  bounds: IntBounds,
  issues: string[]
): number {
  const raw = env[key]
  if (raw !== undefined && raw.trim() === '') {
    issues.push(`${key} must not be empty`)
    return fallback
  }
  const parsed = raw !== undefined ? parseInt(raw, 10) : fallback
  if (!Number.isFinite(parsed)) {
    issues.push(`${key} must be a valid integer`)
    return fallback
  }
  if (bounds.min !== undefined && parsed < bounds.min) {
    issues.push(`${key} must be >= ${bounds.min}`)
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    issues.push(`${key} must be <= ${bounds.max}`)
  }
  return parsed
}

function readFloat(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  bounds: IntBounds,
  issues: string[]
): number {
  const raw = env[key]
  if (raw !== undefined && raw.trim() === '') {
    issues.push(`${key} must not be empty`)
    return fallback
  }
  const parsed = raw !== undefined ? parseFloat(raw) : fallback
  if (!Number.isFinite(parsed)) {
    issues.push(`${key} must be a valid number`)
    return fallback
  }
  if (bounds.min !== undefined && parsed < bounds.min) {
    issues.push(`${key} must be >= ${bounds.min}`)
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    issues.push(`${key} must be <= ${bounds.max}`)
  }
  return parsed
}

function readBool(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
  issues: string[]
): boolean {
  const raw = env[key]
  if (raw !== undefined && raw.trim() === '') {
    issues.push(`${key} must not be empty`)
    return fallback
  }
  if (raw === undefined) {
    return fallback
  }
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  issues.push(`${key} must be true or false`)
  return fallback
}

function parseList(value?: string): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function validateBroker(broker: string): string | null {
  const trimmed = broker.trim()
  if (!trimmed) return 'empty broker'

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end < 0) return 'invalid IPv6 format'
    const rest = trimmed.slice(end + 1)
    if (!rest.startsWith(':')) return 'missing port'
    const portValue = rest.slice(1)
    return validatePort(portValue)
  }

  const idx = trimmed.lastIndexOf(':')
  if (idx <= 0) return 'missing host or port'
  const portValue = trimmed.slice(idx + 1)
  return validatePort(portValue)
}

function validatePort(value: string): string | null {
  if (!value) return 'missing port'
  const port = parseInt(value, 10)
  if (!Number.isFinite(port)) return 'invalid port'
  if (port < 1 || port > 65535) return 'port out of range'
  return null
}

function normalizeHashAlgorithm(value?: string): 'sha256' | 'scrypt' | null {
  if (!value) return null
  const normalized = value.toLowerCase()
  if (normalized === 'sha256' || normalized === 'scrypt') {
    return normalized as 'sha256' | 'scrypt'
  }
  return null
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0
}
