# OCPP Gateway

A secure WebSocket gateway for OCPP (Open Charge Point Protocol) built with NestJS and TypeScript.

## Features

- **Multi-version OCPP support** (1.6J, 2.0.1, 2.1)
- **Security validation** with suspicious pattern detection
- **Flood control** to prevent spam attacks
- **Redis integration** for session management
- **Kafka messaging** for event streaming
- **Connection management** with automatic cleanup

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run start:dev

# Build for production
npm run build
npm start
```

## Environment Variables

```env
SERVICE_NAME=ocpp-gateway
PORT=3001
KAFKA_BROKERS=localhost:9092
REDIS_URL=redis://localhost:6379
FLOOD_LOG_COOLDOWN=300
WEBSOCKET_OCPP_PORT=8080
```

## WebSocket Endpoint

**Development**: `ws://localhost:3001/ocpp/{version}/{chargePointId}`
**Production**: `wss://your-domain.com/ocpp/{version}/{chargePointId}`

Example: `ws://localhost:3001/ocpp/1.6/CP-001`

Subprotocols are required and must match the version:
- `ocpp1.6` (alias: `ocpp1.6j`)
- `ocpp2.0.1`
- `ocpp2.1`

## Schema validation

- Uses official schemas for OCPP 1.6J/2.0.1/2.1.
- `additionalProperties` defaults to `false` for strict validation.
- Set `OCPP_SCHEMA_ALLOW_ADDITIONAL_ACTIONS` to allow extra fields for specific actions (default: `DataTransfer`).

## Multi-node routing

- Each charge point session is claimed in Redis (`sessions:{chargePointId}`) with a `nodeId`.
- New connections are rejected if another node already owns the session.
- Commands are routed to the owning node via Kafka topic `cpms.command.requests.node.{nodeId}`.
- Stale sessions can be taken over if `SESSION_STALE_SECONDS` is exceeded; a force-disconnect is sent to the previous owner via `ocpp.session.control.node.{nodeId}`.

## Charger Identity & Auth

The gateway authenticates chargers against a Redis-backed identity record:

Key: `chargers:{chargePointId}`

```json
{
  "chargePointId": "CP-001",
  "stationId": "station-123",
  "tenantId": "tenant-abc",
  "status": "active",
  "allowedProtocols": ["1.6J", "2.0.1", "2.1"],
  "auth": {
    "type": "mtls",
    "certificates": [
      {
        "fingerprint": "AA:BB:CC:DD:EE",
        "subject": "CN=CP-001",
        "validFrom": "2026-01-01T00:00:00Z",
        "validTo": "2027-01-01T00:00:00Z"
      }
    ]
  }
}
```

Auth modes:
- `basic`: `Authorization: Basic base64(username:password)`
- `token`: `Authorization: Bearer <token>` or `x-api-key: <token>`
- `mtls`: charger certificate subject/fingerprint must match the identity record

Certificate rotation:
- Add multiple `certificates` entries with overlapping `validFrom`/`validTo` windows.

Revocation (denylist):
- Set `revoked-certs:{fingerprint}` in Redis (fingerprint normalized without `:`) to block a certificate immediately.
- You can also list `revokedFingerprints` on the identity record.
- `OCPP_REQUIRE_CERT_BINDING=true` enforces explicit `certificates` bindings for mTLS.

Provisioning audit:
- Use `npm run provision:charger <identity.json>` and `npm run revoke:cert <fingerprint>` to write identities and revocations.
- Each write emits an audit event to `cpms.audit.events` with actor metadata.
  - Set `PROVISION_ACTOR_ID`, `PROVISION_ACTOR_TYPE`, `PROVISION_ACTOR_IP`, `PROVISION_REASON`.

## TLS / mTLS settings

Configure TLS in `.env` to enable mTLS on the gateway:

```env
OCPP_TLS_ENABLED=true
OCPP_TLS_CLIENT_AUTH=true
OCPP_TLS_KEY_PATH=path/to/server.key
OCPP_TLS_CERT_PATH=path/to/server.crt
OCPP_TLS_CA_PATH=path/to/ca.pem
OCPP_TLS_CRL_PATH=path/to/crl.pem
OCPP_TLS_MIN_VERSION=TLSv1.2
```

If your PKI provides CRLs, set `OCPP_TLS_CRL_PATH` to enforce revocation at handshake.

## Security

- Validates charge point ID format (`CP-xxx`)
- Blocks suspicious paths (admin, login, etc.)
- Rate limiting with Redis-based flood control
- IP-based connection tracking

## Architecture

- **Gateway**: WebSocket connection handler
- **Service**: OCPP message processing
- **Adapters**: Version-specific protocol handlers
- **Guards**: Security validation layer
- **Managers**: Connection state management
