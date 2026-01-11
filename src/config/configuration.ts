export default () => ({
  service: {
    name: process.env.SERVICE_NAME || 'ocpp-gateway',
  },
  http: {
    port: parseInt(process.env.PORT || '3001', 10),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean),
    clientId: process.env.KAFKA_CLIENT_ID || 'ocpp-gateway',
    groupId: process.env.KAFKA_GROUP_ID || 'ocpp-gateway',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    prefix: process.env.REDIS_PREFIX || 'ocpp',
  },
})
