import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('redis.url') || 'redis://localhost:6379'
    const keyPrefix = this.config.get<string>('redis.prefix') || 'ocpp'
    this.client = new Redis(url, { keyPrefix: `${keyPrefix}:` })
  }

  getClient(): Redis {
    return this.client
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key)
    return result === 1
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.client.setex(key, seconds, value)
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit()
  }
}
