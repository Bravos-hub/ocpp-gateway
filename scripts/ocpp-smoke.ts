import 'dotenv/config'
import { readFileSync } from 'fs'
import { WebSocket, type ClientOptions } from 'ws'
import { randomUUID } from 'crypto'

type Pending = {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

class OcppTestClient {
  private readonly ws: WebSocket
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly url: string,
    protocol: string,
    headers?: Record<string, string>
  ) {
    const options = buildClientOptions(url, headers)
    this.ws = new WebSocket(url, protocol, options)
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

function buildClientOptions(url: string, headers?: Record<string, string>): ClientOptions {
  const options: ClientOptions = headers ? { headers } : {}
  if (!url.startsWith('wss://')) {
    return options
  }

  const certPath = process.env.OCPP_CLIENT_CERT_PATH
  const keyPath = process.env.OCPP_CLIENT_KEY_PATH
  const caPath = process.env.OCPP_CLIENT_CA_PATH
  if (certPath && keyPath) {
    options.cert = readFileSync(certPath)
    options.key = readFileSync(keyPath)
  }
  if (caPath) {
    options.ca = readFileSync(caPath)
  }

  const rejectUnauthorized = process.env.OCPP_CLIENT_REJECT_UNAUTHORIZED
  if (rejectUnauthorized) {
    options.rejectUnauthorized = rejectUnauthorized !== 'false'
  }

  return options
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

async function runOcpp16(url: string, authHeader?: string) {
  const protocol = process.env.OCPP16_PROTOCOL || 'ocpp1.6'
  const client = new OcppTestClient(url, protocol, authHeader ? { Authorization: authHeader } : undefined)
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

  const startPayload = {
    connectorId: 1,
    idTag: 'TAG-001',
    meterStart: 100,
    timestamp: new Date().toISOString(),
  }
  const start1 = await client.call('StartTransaction', startPayload)
  assert(isCallResult(start1), 'StartTransaction should return CALLRESULT')
  const transactionId = (start1 as [number, string, any])[2].transactionId as number
  const start2 = await client.call('StartTransaction', startPayload)
  assert(isCallResult(start2), 'Duplicate StartTransaction should return CALLRESULT')
  assert(
    (start2 as [number, string, any])[2].transactionId === transactionId,
    'Duplicate StartTransaction should return same transactionId'
  )

  const stopPayload = {
    transactionId,
    meterStop: 110,
    timestamp: new Date().toISOString(),
  }
  const stop1 = await client.call('StopTransaction', stopPayload)
  assert(isCallResult(stop1), 'StopTransaction should return CALLRESULT')
  const stop2 = await client.call('StopTransaction', stopPayload)
  assert(isCallResult(stop2), 'Duplicate StopTransaction should return CALLRESULT')

  const unknownStop = await client.call('StopTransaction', {
    transactionId: transactionId + 999,
    meterStop: 120,
    timestamp: new Date().toISOString(),
  })
  assert(isCallError(unknownStop), 'Unknown StopTransaction should return CALLERROR')

  await client.close()
}

async function runOcpp2(url: string, authHeader?: string) {
  const protocol = process.env.OCPP2_PROTOCOL || 'ocpp2.0.1'
  const client = new OcppTestClient(url, protocol, authHeader ? { Authorization: authHeader } : undefined)
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

  const invalid = await client.call('BootNotification', { reason: 'PowerUp' })
  assert(isCallError(invalid), 'Invalid BootNotification should return CALLERROR')

  const transactionId = `TX-${randomUUID().slice(0, 8)}`
  const startedPayload = {
    eventType: 'Started',
    timestamp: new Date().toISOString(),
    triggerReason: 'Authorized',
    seqNo: 1,
    transactionInfo: {
      transactionId,
    },
  }
  const started1 = await client.call('TransactionEvent', startedPayload)
  assert(isCallResult(started1), 'TransactionEvent Started should return CALLRESULT')
  const started2 = await client.call('TransactionEvent', startedPayload)
  assert(isCallResult(started2), 'Duplicate TransactionEvent Started should return CALLRESULT')

  const updatedPayload = {
    eventType: 'Updated',
    timestamp: new Date().toISOString(),
    triggerReason: 'MeterValuePeriodic',
    seqNo: 2,
    transactionInfo: {
      transactionId,
    },
  }
  const updated1 = await client.call('TransactionEvent', updatedPayload)
  assert(isCallResult(updated1), 'TransactionEvent Updated should return CALLRESULT')
  const updated2 = await client.call('TransactionEvent', updatedPayload)
  assert(isCallResult(updated2), 'Duplicate TransactionEvent Updated should return CALLRESULT')

  const unknownTx = await client.call('TransactionEvent', {
    eventType: 'Updated',
    timestamp: new Date().toISOString(),
    triggerReason: 'Trigger',
    seqNo: 1,
    transactionInfo: {
      transactionId: 'TX-UNKNOWN',
    },
  })
  assert(isCallError(unknownTx), 'Unknown TransactionEvent should return CALLERROR')

  await client.close()
}

async function main() {
  const ocpp16Url = process.env.OCPP16_URL || 'ws://localhost:3001/ocpp/1.6/CP-TEST-001'
  const ocpp2Url = process.env.OCPP2_URL || 'ws://localhost:3001/ocpp/2.0.1/CP-TEST-002'

  const ocpp16Auth = process.env.OCPP16_AUTH
  const ocpp2Auth = process.env.OCPP2_AUTH

  await runOcpp16(ocpp16Url, ocpp16Auth)
  await runOcpp2(ocpp2Url, ocpp2Auth)

  console.log('OCPP smoke tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
