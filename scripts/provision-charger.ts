import 'dotenv/config'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createHash, randomBytes, scryptSync } from 'crypto'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { ChargerIdentityProvisioner, ProvisioningActor } from '../src/ocpp/charger-identity-provisioner.service'
import { ChargerIdentity, ChargerIdentityAuthType } from '../src/ocpp/charger-identity.service'

type MutableAuth = NonNullable<ChargerIdentity['auth']>
type HashAlgorithm = 'sha256' | 'scrypt'

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
  const algorithm = resolveHashAlgorithm(auth)
  const hash = deriveHash(secret, salt, algorithm)
  auth.secretSalt = salt
  auth.hashAlgorithm = normalizeHashAlgorithm(auth.hashAlgorithm) || algorithm
  auth[hashField] = hash
}

function resolveHashAlgorithm(auth: MutableAuth): HashAlgorithm {
  const fromAuth = normalizeHashAlgorithm(auth.hashAlgorithm)
  if (fromAuth) return fromAuth
  const fromEnv = normalizeHashAlgorithm(
    process.env.PROVISION_HASH_ALGORITHM || process.env.OCPP_AUTH_HASH_ALGORITHM
  )
  return fromEnv || 'sha256'
}

function normalizeHashAlgorithm(value?: string): HashAlgorithm | null {
  if (!value) return null
  const normalized = value.toLowerCase()
  if (normalized === 'sha256' || normalized === 'scrypt') {
    return normalized as HashAlgorithm
  }
  return null
}

function deriveHash(secret: string, salt: string, algorithm: HashAlgorithm): string {
  if (algorithm === 'scrypt') {
    const params = getScryptParams()
    const derived = scryptSync(secret, salt, params.keyLen, {
      N: params.N,
      r: params.r,
      p: params.p,
    }) as Buffer
    return derived.toString('hex')
  }

  const hash = createHash('sha256')
  hash.update(salt)
  hash.update(secret)
  return hash.digest('hex')
}

function getScryptParams(): { N: number; r: number; p: number; keyLen: number } {
  return {
    N: parseIntValue(process.env.PROVISION_SCRYPT_N || process.env.OCPP_AUTH_SCRYPT_N, 16384),
    r: parseIntValue(process.env.PROVISION_SCRYPT_R || process.env.OCPP_AUTH_SCRYPT_R, 8),
    p: parseIntValue(process.env.PROVISION_SCRYPT_P || process.env.OCPP_AUTH_SCRYPT_P, 1),
    keyLen: parseIntValue(process.env.PROVISION_SCRYPT_KEYLEN || process.env.OCPP_AUTH_SCRYPT_KEYLEN, 32),
  }
}

function parseIntValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
