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

**Development**: `ws://localhost:3001/ocpp/CP-{chargePointId}`
**Production**: `wss://your-domain.com/ocpp/CP-{chargePointId}`

Example: `ws://localhost:3001/ocpp/CP-001`

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