import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createHash, randomBytes } from 'crypto'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { ChargerIdentityProvisioner, ProvisioningActor } from '../src/ocpp/charger-identity-provisioner.service'
import { ChargerIdentity, ChargerIdentityAuthType } from '../src/ocpp/charger-identity.service'

type MutableAuth = NonNullable<ChargerIdentity['auth']>

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    throw new Error('Usage: ts-node scripts/provision-charger.ts <identity.json>')
  }

  const resolved = resolve(process.cwd(), inputPath)
  const raw = readFileSync(resolved, 'utf8')
  const identity = JSON.parse(raw) as ChargerIdentity
  applyProvisioningDefaults(identity)

  const actor: ProvisioningActor = {
    actorId: process.env.PROVISION_ACTOR_ID || 'unknown',
    actorType: process.env.PROVISION_ACTOR_TYPE || 'system',
    ip: process.env.PROVISION_ACTOR_IP,
    reason: process.env.PROVISION_REASON || 'manual-provision',
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const provisioner = app.get(ChargerIdentityProvisioner)
  await provisioner.upsertIdentity(identity, actor)
  await app.close()
}

function applyProvisioningDefaults(identity: ChargerIdentity): void {
  if (!identity.allowedProtocols || identity.allowedProtocols.length === 0) {
    const allowed = parseList(process.env.PROVISION_ALLOWED_PROTOCOLS)
    if (allowed.length > 0) {
      identity.allowedProtocols = allowed
    }
  }

  const authType = (identity.auth?.type || process.env.PROVISION_AUTH_TYPE) as
    | ChargerIdentityAuthType
    | undefined
  if (authType) {
    if (!identity.auth) {
      identity.auth = { type: authType }
    } else {
      identity.auth.type = authType
    }
  }

  if (!identity.auth) return

  if (identity.auth.type === 'basic') {
    ensureSaltedHash(identity.auth, 'secret', 'secretHash', process.env.PROVISION_SECRET)
  }
  if (identity.auth.type === 'token') {
    ensureSaltedHash(identity.auth, 'token', 'tokenHash', process.env.PROVISION_TOKEN)
  }

  delete (identity.auth as MutableAuth).secret
  delete (identity.auth as MutableAuth).token
}

function parseList(value?: string): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function ensureSaltedHash(
  auth: MutableAuth,
  secretField: 'secret' | 'token',
  hashField: 'secretHash' | 'tokenHash',
  envSecret?: string
): void {
  if (auth[hashField]) return
  const secret = auth[secretField] || envSecret
  if (!secret) return

  const salt = auth.secretSalt || process.env.PROVISION_SECRET_SALT || randomBytes(16).toString('hex')
  const hash = createHash('sha256')
  hash.update(salt)
  hash.update(secret)
  auth.secretSalt = salt
  auth[hashField] = hash.digest('hex')
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
