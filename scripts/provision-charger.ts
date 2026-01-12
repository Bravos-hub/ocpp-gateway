import { readFileSync } from 'fs'
import { resolve } from 'path'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { ChargerIdentityProvisioner, ProvisioningActor } from '../src/ocpp/charger-identity-provisioner.service'
import { ChargerIdentity } from '../src/ocpp/charger-identity.service'

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    throw new Error('Usage: ts-node scripts/provision-charger.ts <identity.json>')
  }

  const resolved = resolve(process.cwd(), inputPath)
  const raw = readFileSync(resolved, 'utf8')
  const identity = JSON.parse(raw) as ChargerIdentity

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

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
