const parseList = (value?: string): string[] => {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export default () => {
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production'

  return {
    service: {
      name: process.env.SERVICE_NAME || 'ocpp-gateway',
    },
    http: {
      port: parseInt(process.env.PORT || '3001', 10),
    },
    kafka: {
      enabled:
        (process.env.KAFKA_ENABLED ?? 'true') !== 'false' &&
        (process.env.KAFKA_BROKERS ?? 'localhost:9092')
          .split(',')
          .map((broker) => broker.trim())
          .filter(Boolean).length > 0,
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092')
        .split(',')
        .map((broker) => broker.trim())
        .filter(Boolean),
      clientId: process.env.KAFKA_CLIENT_ID || 'ocpp-gateway',
      groupId: process.env.KAFKA_GROUP_ID || 'ocpp-gateway',
    },
    redis: {
      enabled:
        (process.env.REDIS_ENABLED ?? 'true') !== 'false' &&
        (process.env.REDIS_URL ?? 'redis://localhost:6379').length > 0,
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      prefix: process.env.REDIS_PREFIX || 'ocpp',
    },
    auth: {
      mode: process.env.OCPP_AUTH_MODE || 'basic',
      identityPrefix: process.env.OCPP_IDENTITY_PREFIX || 'chargers',
      revokedPrefix: process.env.OCPP_REVOKED_PREFIX || 'revoked-certs',
      requireCertBinding: (process.env.OCPP_REQUIRE_CERT_BINDING ?? 'true') === 'true',
      allowPlaintextSecrets: (process.env.OCPP_ALLOW_PLAINTEXT_SECRETS ?? 'false') === 'true',
      trustProxy: (process.env.OCPP_TRUST_PROXY ?? 'false') === 'true',
      allowedIps: parseList(process.env.OCPP_ALLOWED_IPS),
      allowedCidrs: parseList(process.env.OCPP_ALLOWED_CIDRS),
      allowBasic:
        (process.env.OCPP_AUTH_ALLOW_BASIC ?? (isProd ? 'false' : 'true')) === 'true',
      requireAllowedProtocols:
        (process.env.OCPP_AUTH_REQUIRE_ALLOWED_PROTOCOLS ?? (isProd ? 'true' : 'false')) === 'true',
      requireSecretSalt:
        (process.env.OCPP_AUTH_REQUIRE_SECRET_SALT ?? 'true') === 'true',
      minSecretHashLength: parseInt(process.env.OCPP_AUTH_MIN_SECRET_HASH_LENGTH || '64', 10),
      minSaltLength: parseInt(process.env.OCPP_AUTH_MIN_SALT_LENGTH || '8', 10),
    },
  }
}
