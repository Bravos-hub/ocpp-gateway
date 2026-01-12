import { WebSocket } from 'ws'
import { randomUUID } from 'crypto'

type Pending = {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

class OcppTestClient {
  private readonly ws: WebSocket
  private readonly pending = new Map<string, Pending>()

  constructor(private readonly url: string, protocol: string) {
    this.ws = new WebSocket(url, protocol)
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve())
      this.ws.once('error', (err) => reject(err))
    })

    this.ws.on('message', (data) => {
      const raw = data.toString()
      let message: unknown
      try {
        message = JSON.parse(raw)
      } catch {
        return
      }

      if (!Array.isArray(message) || message.length < 2) return
      const uniqueId = message[1]
      if (typeof uniqueId !== 'string') return
      const pending = this.pending.get(uniqueId)
      if (!pending) return

      clearTimeout(pending.timeout)
      this.pending.delete(uniqueId)
      pending.resolve(message)
    })
  }

  async close(): Promise<void> {
    this.ws.close()
  }

  async call(action: string, payload: unknown, timeoutMs = 5000): Promise<unknown> {
    const uniqueId = randomUUID()
    const message = [2, uniqueId, action, payload]

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(uniqueId)
        reject(new Error(`Timeout waiting for ${action}`))
      }, timeoutMs)

      this.pending.set(uniqueId, { resolve, reject, timeout })
      this.ws.send(JSON.stringify(message))
    })
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function isCallResult(message: unknown): message is [number, string, unknown] {
  return Array.isArray(message) && message[0] === 3
}

function isCallError(message: unknown): message is [number, string, string, string, unknown] {
  return Array.isArray(message) && message[0] === 4
}

async function runOcpp16(url: string) {
  const protocol = process.env.OCPP16_PROTOCOL || 'ocpp1.6'
  const client = new OcppTestClient(url, protocol)
  await client.connect()

  const boot = await client.call('BootNotification', {
    chargePointVendor: 'EVZONE',
    chargePointModel: 'EVZ-1',
  })
  assert(isCallResult(boot), 'BootNotification should return CALLRESULT')

  const heartbeat = await client.call('Heartbeat', {})
  assert(isCallResult(heartbeat), 'Heartbeat should return CALLRESULT')

  const status = await client.call('StatusNotification', {
    connectorId: 1,
    errorCode: 'NoError',
    status: 'Available',
  })
  assert(isCallResult(status), 'StatusNotification should return CALLRESULT')

  const invalid = await client.call('BootNotification', { chargePointVendor: 'EVZONE' })
  assert(isCallError(invalid), 'Invalid BootNotification should return CALLERROR')

  await client.close()
}

async function runOcpp2(url: string) {
  const protocol = process.env.OCPP2_PROTOCOL || 'ocpp2.0.1'
  const client = new OcppTestClient(url, protocol)
  await client.connect()

  const boot = await client.call('BootNotification', {
    reason: 'PowerUp',
    chargingStation: { vendorName: 'EVZONE', model: 'EVZ-2' },
  })
  assert(isCallResult(boot), 'BootNotification should return CALLRESULT')

  const heartbeat = await client.call('Heartbeat', {})
  assert(isCallResult(heartbeat), 'Heartbeat should return CALLRESULT')

  const securityEvent = await client.call('SecurityEventNotification', {
    type: 'SecurityEvent',
    timestamp: new Date().toISOString(),
  })
  assert(isCallResult(securityEvent), 'SecurityEventNotification should return CALLRESULT')

  const notifyEvent = await client.call('NotifyEvent', {
    generatedAt: new Date().toISOString(),
    seqNo: 1,
    eventData: [
      {
        eventId: 1,
        timestamp: new Date().toISOString(),
        trigger: 'Alerting',
      },
    ],
  })
  assert(isCallResult(notifyEvent), 'NotifyEvent should return CALLRESULT')

  const invalid = await client.call('BootNotification', { reason: 'PowerUp' })
  assert(isCallError(invalid), 'Invalid BootNotification should return CALLERROR')

  await client.close()
}

async function main() {
  const ocpp16Url = process.env.OCPP16_URL || 'ws://localhost:3001/ocpp/1.6/CP-TEST-001'
  const ocpp2Url = process.env.OCPP2_URL || 'ws://localhost:3001/ocpp/2.0.1/CP-TEST-002'

  await runOcpp16(ocpp16Url)
  await runOcpp2(ocpp2Url)

  console.log('OCPP smoke tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
