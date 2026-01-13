import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { constants } from 'crypto'
import * as fs from 'fs'
import type { SecureVersion } from 'tls'
import { AppModule } from './app.module'
import { MetricsService } from './metrics/metrics.service'
import { OcppWsAdapter } from './ocpp/ocpp-ws.adapter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, buildHttpsOptions())
  app.useWebSocketAdapter(new OcppWsAdapter(app))
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
  app.get(MetricsService).setGauge('ocpp_connections_active', 0)

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001
  await app.listen(port)
}

bootstrap()

function buildHttpsOptions(): { httpsOptions?: Record<string, unknown> } {
  const tlsEnabled = (process.env.OCPP_TLS_ENABLED ?? 'false') === 'true'
  if (!tlsEnabled) {
    return {}
  }

  const keyPath = process.env.OCPP_TLS_KEY_PATH
  const certPath = process.env.OCPP_TLS_CERT_PATH
  if (!keyPath || !certPath) {
    throw new Error('OCPP_TLS_KEY_PATH and OCPP_TLS_CERT_PATH are required when TLS is enabled')
  }

  const caPath = process.env.OCPP_TLS_CA_PATH
  const crlPath = process.env.OCPP_TLS_CRL_PATH
  const requestCert = (process.env.OCPP_TLS_CLIENT_AUTH ?? 'true') === 'true'
  if (!requestCert) {
    throw new Error('OCPP_TLS_CLIENT_AUTH must be true to enforce mTLS')
  }
  if (!caPath) {
    throw new Error('OCPP_TLS_CA_PATH is required when mTLS is enabled')
  }

  return {
    httpsOptions: {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ca: fs.readFileSync(caPath),
      crl: crlPath ? fs.readFileSync(crlPath) : undefined,
      requestCert,
      rejectUnauthorized: requestCert,
      minVersion: resolveMinVersion(process.env.OCPP_TLS_MIN_VERSION),
      ciphers:
        process.env.OCPP_TLS_CIPHERS ||
        'TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:' +
          'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:' +
          'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256',
      honorCipherOrder: true,
      secureOptions: constants.SSL_OP_NO_RENEGOTIATION,
    },
  }
}

function resolveMinVersion(value?: string): SecureVersion {
  if (!value) return 'TLSv1.2'
  if (value === 'TLSv1.3') return 'TLSv1.3'
  return 'TLSv1.2'
}
