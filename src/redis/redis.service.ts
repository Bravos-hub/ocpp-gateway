import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

type RedisClient = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<'OK'>
  setex(key: string, seconds: number, value: string): Promise<'OK'>
  setnx(key: string, value: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  exists(key: string): Promise<number>
  del(key: string): Promise<number>
  quit(): Promise<'OK' | void>
}

type Entry = {
  value: string
  expiresAt: number | null
}

class InMemoryRedisClient implements RedisClient {
  private readonly store = new Map<string, Entry>()

  constructor(private readonly keyPrefix: string) {}

  async get(key: string): Promise<string | null> {
    const entry = this.getEntry(key)
    return entry ? entry.value : null
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(this.fullKey(key), { value, expiresAt: null })
    return 'OK'
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    const expiresAt = seconds > 0 ? Date.now() + seconds * 1000 : null
    this.store.set(this.fullKey(key), { value, expiresAt })
    return 'OK'
  }

  async setnx(key: string, value: string): Promise<number> {
    const fullKey = this.fullKey(key)
    const entry = this.store.get(fullKey)
    if (entry && (entry.expiresAt === null || entry.expiresAt > Date.now())) {
      return 0
    }
    this.store.set(fullKey, { value, expiresAt: null })
    return 1
  }

  async expire(key: string, seconds: number): Promise<number> {
    const fullKey = this.fullKey(key)
    const entry = this.store.get(fullKey)
    if (!entry) return 0
    entry.expiresAt = seconds > 0 ? Date.now() + seconds * 1000 : null
    this.store.set(fullKey, entry)
    return 1
  }

  async exists(key: string): Promise<number> {
    return this.getEntry(key) ? 1 : 0
  }

  async del(key: string): Promise<number> {
    const fullKey = this.fullKey(key)
    const existed = this.store.delete(fullKey)
    return existed ? 1 : 0
  }

  async quit(): Promise<'OK'> {
    this.store.clear()
    return 'OK'
  }

  private fullKey(key: string): string {
    return `${this.keyPrefix}${key}`
  }

  private getEntry(key: string): Entry | null {
    const fullKey = this.fullKey(key)
    const entry = this.store.get(fullKey)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(fullKey)
      return null
    }
    return entry
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: RedisClient
  private readonly logger = new Logger(RedisService.name)

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('redis.url') ?? 'redis://localhost:6379'
    const keyPrefix = this.config.get<string>('redis.prefix') || 'ocpp'
    const enabled = this.config.get<boolean>('redis.enabled') ?? true
    const prefix = keyPrefix ? `${keyPrefix}:` : ''

    if (enabled) {
      const client = new Redis(url, { keyPrefix: prefix })
      client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`))
      this.client = client
    } else {
      this.logger.warn('Redis disabled; using in-memory store')
      this.client = new InMemoryRedisClient(prefix)
    }
  }

  getClient(): RedisClient {
    return this.client
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
