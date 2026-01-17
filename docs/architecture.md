OCPP Gateway Architecture

Purpose
- Device plane for charger connectivity (OCPP 1.6J, 2.0.1, 2.1).
- Protocol validation, session ownership, and command routing.

Core Responsibilities
- WebSocket connection management and authentication.
- Strict schema validation and state machine enforcement.
- Publish station/session/command events to Kafka.
- Consume command requests and send OCPP CALLs to chargers.

Dependencies
- Redis: session ownership, idempotency, rate limits.
- Kafka: command requests in, events out.

Event Contracts
- Consumes: `cpms.command.requests` and `cpms.command.requests.node.{nodeId}`.
- Publishes: `ocpp.station.events`, `ocpp.session.events`, `ocpp.command.events`.

Session Ownership
- Session claims stored in Redis keys `sessions:{chargePointId}` with `nodeId`.
- Duplicate connections are rejected unless the session is stale.
- Commands are routed to the owning node via node-specific topics.

Security
- mTLS supported with certificate allowlists and revocations.
- Optional token or basic auth for chargers.
- IP allowlists with optional trusted proxy headers.

Failure Handling
- Circuit breakers for Kafka and Redis.
- Command audit persistence in Redis for replay and tracing.
