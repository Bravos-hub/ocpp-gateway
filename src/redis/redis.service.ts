import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { CircuitBreaker, CircuitOpenError } from '../resilience/circuit-breaker'

type RedisKey = string | Buffer
type RedisValue = string | number | Buffer
type RedisSetArg = string | number | Buffer | ((...args: any[]) => void)

type RedisClient = {
  get(key: RedisKey): Promise<string | null>
  set(key: RedisKey, value: RedisValue, ...args: any[]): Promise<any>
  setex(key: RedisKey, seconds: number, value: RedisValue): Promise<'OK'>
  setnx(key: RedisKey, value: RedisValue): Promise<number>
  expire(key: RedisKey, seconds: number): Promise<number>
  incr(key: RedisKey): Promise<number>
  exists(key: RedisKey): Promise<number>
  del(key: RedisKey): Promise<number>
  ping(): Promise<string>
  quit(): Promise<'OK' | void>
}

type Entry = {
  value: string
  expiresAt: number | null
}

class InMemoryRedisClient implements RedisClient {
  private readonly store = new Map<string, Entry>()

  constructor(private readonly keyPrefix: string) {}

  async get(key: RedisKey): Promise<string | null> {
    const entry = this.getEntry(key)
    return entry ? entry.value : null
  }

  async set(key: RedisKey, value: RedisValue, ...args: any[]): Promise<any> {
    let requiresNx = false
    let expiresAt: number | null = null
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i]
      if (typeof arg === 'function') {
        continue
      }
      const token = Buffer.isBuffer(arg) ? arg.toString() : String(arg)
      const normalized = token.toUpperCase()
      if (normalized === 'NX') {
        requiresNx = true
        continue
      }
      if (normalized === 'EX') {
        const secondsValue = args[i + 1]
        const seconds =
          typeof secondsValue === 'number'
            ? secondsValue
            : parseInt(
                Buffer.isBuffer(secondsValue) ? secondsValue.toString() : String(secondsValue),
                10
              )
        if (Number.isFinite(seconds) && seconds > 0) {
          expiresAt = Date.now() + seconds * 1000
        }
        i += 1
      }
    }

    if (requiresNx) {
      const existing = this.getEntry(key)
      if (existing) {
        return null
      }
    }

    this.store.set(this.fullKey(key), { value: this.normalizeValue(value), expiresAt })
    return 'OK'
  }

  async setex(key: RedisKey, seconds: number, value: RedisValue): Promise<'OK'> {
    const expiresAt = seconds > 0 ? Date.now() + seconds * 1000 : null
    this.store.set(this.fullKey(key), { value: this.normalizeValue(value), expiresAt })
    return 'OK'
  }

  async setnx(key: RedisKey, value: RedisValue): Promise<number> {
    const fullKey = this.fullKey(key)
    const entry = this.store.get(fullKey)
    if (entry && (entry.expiresAt === null || entry.expiresAt > Date.now())) {
      return 0
    }
    this.store.set(fullKey, { value: this.normalizeValue(value), expiresAt: null })
    return 1
  }

  async expire(key: RedisKey, seconds: number): Promise<number> {
    const fullKey = this.fullKey(key)
    const entry = this.store.get(fullKey)
    if (!entry) return 0
    entry.expiresAt = seconds > 0 ? Date.now() + seconds * 1000 : null
    this.store.set(fullKey, entry)
    return 1
  }

  async incr(key: RedisKey): Promise<number> {
    const fullKey = this.fullKey(key)
    const entry = this.getEntry(key)
    const current = entry ? parseInt(entry.value, 10) : 0
    const next = Number.isNaN(current) ? 1 : current + 1
    const expiresAt = entry ? entry.expiresAt : null
    this.store.set(fullKey, { value: String(next), expiresAt })
    return next
  }

  async exists(key: RedisKey): Promise<number> {
    return this.getEntry(key) ? 1 : 0
  }

  async del(key: RedisKey): Promise<number> {
    const fullKey = this.fullKey(key)
    const existed = this.store.delete(fullKey)
    return existed ? 1 : 0
  }

  async ping(): Promise<string> {
    return 'PONG'
  }

  async quit(): Promise<'OK'> {
    this.store.clear()
    return 'OK'
  }

  private fullKey(key: RedisKey): string {
    return `${this.keyPrefix}${this.normalizeKey(key)}`
  }

  private getEntry(key: RedisKey): Entry | null {
    const fullKey = this.fullKey(key)
    const entry = this.store.get(fullKey)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(fullKey)
      return null
    }
    return entry
  }

  private normalizeKey(key: RedisKey): string {
    return Buffer.isBuffer(key) ? key.toString() : key
  }

  private normalizeValue(value: RedisValue): string {
    return Buffer.isBuffer(value) ? value.toString() : String(value)
  }
}

class ResilientRedisClient implements RedisClient {
  constructor(
    private readonly client: RedisClient,
    private readonly breaker: CircuitBreaker,
    private readonly logger: Logger
  ) {}

  get(key: RedisKey): Promise<string | null> {
    return this.execute(() => this.client.get(key))
  }

  set(key: RedisKey, value: RedisValue, ...args: any[]): Promise<any> {
    return this.execute(() => this.client.set(key, value, ...args))
  }

  setex(key: RedisKey, seconds: number, value: RedisValue): Promise<'OK'> {
    return this.execute(() => this.client.setex(key, seconds, value))
  }

  setnx(key: RedisKey, value: RedisValue): Promise<number> {
    return this.execute(() => this.client.setnx(key, value))
  }

  expire(key: RedisKey, seconds: number): Promise<number> {
    return this.execute(() => this.client.expire(key, seconds))
  }

  incr(key: RedisKey): Promise<number> {
    return this.execute(() => this.client.incr(key))
  }

  exists(key: RedisKey): Promise<number> {
    return this.execute(() => this.client.exists(key))
  }

  del(key: RedisKey): Promise<number> {
    return this.execute(() => this.client.del(key))
  }

  ping(): Promise<string> {
    return this.execute(() => this.client.ping())
  }

  quit(): Promise<'OK' | void> {
    return this.client.quit()
  }

  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.breaker.execute(fn)
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        this.logger.warn('Redis circuit open; skipping command')
      }
      throw error
    }
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: RedisClient
  private readonly logger = new Logger(RedisService.name)
  private readonly enabled: boolean

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('redis.url') ?? 'redis://localhost:6379'
    const keyPrefix = this.config.get<string>('redis.prefix') || 'ocpp'
    const enabled = this.config.get<boolean>('redis.enabled') ?? true
    this.enabled = enabled
    const prefix = keyPrefix ? `${keyPrefix}:` : ''

    if (enabled) {
      const maxAttempts = parseInt(process.env.REDIS_RETRY_MAX_ATTEMPTS || '20', 10)
      const initialDelay = parseInt(process.env.REDIS_RETRY_INITIAL_DELAY_MS || '200', 10)
      const maxDelay = parseInt(process.env.REDIS_RETRY_MAX_DELAY_MS || '2000', 10)
      const connectTimeout = parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '10000', 10)
      const maxRetriesPerRequest = parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST || '20', 10)
      const client = new Redis(url, {
        keyPrefix: prefix,
        connectTimeout,
        maxRetriesPerRequest,
        retryStrategy: (times) => {
          if (times > maxAttempts) {
            return null
          }
          const delay = Math.min(initialDelay * Math.pow(2, times - 1), maxDelay)
          return delay
        },
      })
      client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`))
      const failureThreshold = parseInt(process.env.REDIS_CIRCUIT_FAILURE_THRESHOLD || '5', 10)
      const openSeconds = parseInt(process.env.REDIS_CIRCUIT_OPEN_SECONDS || '15', 10)
      const halfOpenSuccesses = parseInt(process.env.REDIS_CIRCUIT_HALF_OPEN_SUCCESS || '2', 10)
      const breaker = new CircuitBreaker({
        failureThreshold: Number.isFinite(failureThreshold) ? failureThreshold : 5,
        openDurationMs: Math.max(1, openSeconds) * 1000,
        halfOpenSuccesses: Number.isFinite(halfOpenSuccesses) ? halfOpenSuccesses : 2,
      })
      this.client = new ResilientRedisClient(client, breaker, this.logger)
    } else {
      this.logger.warn('Redis disabled; using in-memory store')
      this.client = new InMemoryRedisClient(prefix)
    }
  }

  getClient(): RedisClient {
    return this.client
  }

  isEnabled(): boolean {
    return this.enabled
  }

  async checkConnection(): Promise<{ status: 'up' | 'down' | 'disabled'; error?: string }> {
    if (!this.enabled) {
      return { status: 'disabled' }
    }
    try {
      const response = await this.client.ping()
      return { status: response === 'PONG' ? 'up' : 'down' }
    } catch (error) {
      return { status: 'down', error: (error as Error).message }
    }
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key)
    return result === 1
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.client.setex(key, seconds, value)
  }

  async set(key: string, value: string): Promise<void> {
    await this.client.set(key, value)
  }

  async setIfNotExists(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (ttlSeconds && ttlSeconds > 0) {
      const result = await (this.client as any).set(key, value, 'NX', 'EX', ttlSeconds)
      return result === 'OK'
    }
    const result = await this.client.setnx(key, value)
    return result === 1
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.expire(key, ttlSeconds)
    return result === 1
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit()
  }
}
