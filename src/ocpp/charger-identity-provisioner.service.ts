import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { KafkaService } from '../kafka/kafka.service'
import { KAFKA_TOPICS } from '../contracts/kafka-topics'
import { DomainEvent } from '../contracts/events'
import { RedisService } from '../redis/redis.service'
import { ChargerIdentity } from './charger-identity.service'

export type ProvisioningActor = {
  actorId: string
  actorType?: string
  ip?: string
  reason?: string
}

@Injectable()
export class ChargerIdentityProvisioner {
  private readonly identityPrefix: string
  private readonly revokedPrefix: string
  private readonly revokedTtlSeconds: number

  constructor(
    private readonly redis: RedisService,
    private readonly kafka: KafkaService,
    private readonly config: ConfigService
  ) {
    this.identityPrefix = this.config.get<string>('auth.identityPrefix') || 'chargers'
    this.revokedPrefix = this.config.get<string>('auth.revokedPrefix') || 'revoked-certs'
    this.revokedTtlSeconds = parseInt(process.env.OCPP_REVOKED_TTL_SECONDS || '0', 10)
  }

  async upsertIdentity(identity: ChargerIdentity, actor: ProvisioningActor): Promise<void> {
    const chargePointId = identity.chargePointId
    if (!chargePointId) {
      throw new Error('chargePointId is required')
    }
    if (!identity.stationId || !identity.tenantId) {
      throw new Error('stationId and tenantId are required')
    }

    const payload = {
      ...identity,
      updatedAt: new Date().toISOString(),
    }

    const client = this.redis.getClient()
    await client.set(this.identityKey(chargePointId), JSON.stringify(payload))
    await this.publishAudit('ChargerIdentityUpserted', actor, {
      chargePointId,
      stationId: identity.stationId,
      tenantId: identity.tenantId,
      status: identity.status || 'active',
    })
  }

  async revokeCertificate(fingerprint: string, actor: ProvisioningActor): Promise<void> {
    const normalized = fingerprint.replace(/:/g, '').toUpperCase()
    const client = this.redis.getClient()
    const key = this.revokedKey(normalized)
    if (this.revokedTtlSeconds > 0) {
      await client.setex(key, this.revokedTtlSeconds, '1')
    } else {
      await client.set(key, '1')
    }

    await this.publishAudit('ChargerCertificateRevoked', actor, {
      fingerprint: normalized,
    })
  }

  private identityKey(chargePointId: string): string {
    return `${this.identityPrefix}:${chargePointId}`
  }

  private revokedKey(fingerprint: string): string {
    return `${this.revokedPrefix}:${fingerprint}`
  }

  private async publishAudit(
    eventType: string,
    actor: ProvisioningActor,
    payload: Record<string, unknown>
  ): Promise<void> {
    const event: DomainEvent = {
      eventId: randomUUID(),
      eventType,
      source: 'ocpp-gateway',
      occurredAt: new Date().toISOString(),
      payload: {
        actorId: actor.actorId,
        actorType: actor.actorType,
        ip: actor.ip,
        reason: actor.reason,
        ...payload,
      },
    }

    await this.kafka.publish(KAFKA_TOPICS.auditEvents, JSON.stringify(event))
  }
}
