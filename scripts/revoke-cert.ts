import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { ChargerIdentityProvisioner, ProvisioningActor } from '../src/ocpp/charger-identity-provisioner.service'

async function main() {
  const fingerprint = process.argv[2]
  if (!fingerprint) {
    throw new Error('Usage: ts-node scripts/revoke-cert.ts <fingerprint>')
  }

  const actor: ProvisioningActor = {
    actorId: process.env.PROVISION_ACTOR_ID || 'unknown',
    actorType: process.env.PROVISION_ACTOR_TYPE || 'system',
    ip: process.env.PROVISION_ACTOR_IP,
    reason: process.env.PROVISION_REASON || 'manual-revoke',
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const provisioner = app.get(ChargerIdentityProvisioner)
  await provisioner.revokeCertificate(fingerprint, actor)
  await app.close()
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
