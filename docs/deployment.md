OCPP Gateway Deployment

Runtime
- Node.js service (NestJS + WebSocket).
- Stateless pods, scale horizontally.

Ports and Health
- HTTP port: `PORT` (default 3001).
- OCPP WS port: `WEBSOCKET_OCPP_PORT` (default 8080).
- Health: `GET /health`, Metrics: `GET /metrics` (optional auth).

Required Environment Variables
- `KAFKA_BROKERS`
- `REDIS_URL`
- `WEBSOCKET_OCPP_PORT`
- TLS variables when mTLS is enabled.

Load Balancing
- Use L4 TCP/TLS passthrough for WebSocket stability.
- No sticky sessions required due to Redis ownership, but L4 is preferred.

TLS and mTLS
- Enable `OCPP_TLS_ENABLED=true`.
- Provide `OCPP_TLS_KEY_PATH`, `OCPP_TLS_CERT_PATH`, and `OCPP_TLS_CA_PATH`.
- Rotate certs with reload timers.

Scaling Guidelines
- Scale by active WS connections and message throughput.
- Tune rate limits for `MeterValues` and `StatusNotification` to avoid overload.

Operational Notes
- Use rolling upgrades with connection draining.
- Monitor command latency and rejection rates.
