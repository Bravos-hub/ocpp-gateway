import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OcppContext } from './versions/ocpp-adapter.interface'

type ConnectorState = {
  connectorId: number
  status?: string
  errorCode?: string
  lastStatusAt?: string
}

type TransactionState16 = {
  transactionId: number
  connectorId: number
  idTag: string
  meterStart: number
  timestamp: string
  status: 'active' | 'stopped'
  stop?: {
    meterStop: number
    timestamp: string
    idTag?: string
    reason?: string
  }
}

type TransactionState2 = {
  transactionId: string
  evseId?: number
  connectorId?: number
  idToken?: string
  startedAt?: string
  status: 'active' | 'ended'
  lastSeqNo?: number
}

type ChargePointState = {
  chargePointId: string
  ocppVersion: string
  stationId?: string
  tenantId?: string
  lastBootedAt?: string
  lastHeartbeatAt?: string
  connectors: Map<number, ConnectorState>
  transactionCounter: number
  transactions16: Map<number, TransactionState16>
  transactions2: Map<string, TransactionState2>
  activeByConnector: Map<number, number | string>
}

export type StateError = {
  code: string
  description: string
  details?: Record<string, unknown>
}

export type StartTransactionResult = {
  transactionId: number
  idTagInfo: { status: string }
  idempotent?: boolean
  error?: StateError
}

export type StopTransactionResult = {
  idTagInfo: { status: string }
  idempotent?: boolean
  error?: StateError
}

export type TransactionEventResult = {
  idTokenInfo: { status: string }
  idempotent?: boolean
  error?: StateError
}

@Injectable()
export class OcppStateService {
  private readonly logger = new Logger(OcppStateService.name)
  private readonly strict: boolean
  private readonly states = new Map<string, ChargePointState>()

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get<string>('OCPP_STATE_STRICT') ?? 'true'
    this.strict = configured !== 'false'
  }

  recordBoot(context: OcppContext): void {
    const state = this.getState(context)
    state.lastBootedAt = new Date().toISOString()
  }

  recordHeartbeat(context: OcppContext): void {
    const state = this.getState(context)
    state.lastHeartbeatAt = new Date().toISOString()
  }

  updateStatus16(context: OcppContext, connectorId: number, status: string, errorCode: string): void {
    const state = this.getState(context)
    const connector = this.getConnector(state, connectorId)
    connector.status = status
    connector.errorCode = errorCode
    connector.lastStatusAt = new Date().toISOString()
  }

  updateStatus2(context: OcppContext, evseId: number, connectorId: number | undefined, status: string): void {
    const state = this.getState(context)
    const connectorKey = connectorId ?? evseId
    const connector = this.getConnector(state, connectorKey)
    connector.status = status
    connector.lastStatusAt = new Date().toISOString()
  }

  authorize16(): { status: string } {
    return { status: 'Accepted' }
  }

  authorize2(): { status: string } {
    return { status: 'Accepted' }
  }

  startTransaction16(context: OcppContext, payload: any): StartTransactionResult {
    const state = this.getState(context)
    const connectorId = payload.connectorId as number
    const existingId = state.activeByConnector.get(connectorId)
    if (existingId !== undefined) {
      const existing = state.transactions16.get(existingId as number)
      if (existing && this.isSameStart(existing, payload)) {
        return {
          transactionId: existing.transactionId,
          idTagInfo: { status: 'Accepted' },
          idempotent: true,
        }
      }
      return {
        transactionId: existingId as number,
        idTagInfo: { status: 'Rejected' },
        error: this.stateViolation(context, 'Connector already has an active transaction'),
      }
    }

    const transactionId = ++state.transactionCounter
    const tx: TransactionState16 = {
      transactionId,
      connectorId,
      idTag: payload.idTag as string,
      meterStart: payload.meterStart as number,
      timestamp: payload.timestamp as string,
      status: 'active',
    }
    state.transactions16.set(transactionId, tx)
    state.activeByConnector.set(connectorId, transactionId)

    return {
      transactionId,
      idTagInfo: { status: 'Accepted' },
    }
  }

  stopTransaction16(context: OcppContext, payload: any): StopTransactionResult {
    const state = this.getState(context)
    const transactionId = payload.transactionId as number
    const tx = state.transactions16.get(transactionId)
    if (!tx) {
      return {
        idTagInfo: { status: 'Rejected' },
        error: this.stateViolation(context, 'Unknown transaction'),
      }
    }

    if (tx.status === 'stopped') {
      const stop = tx.stop
      if (stop && stop.meterStop === payload.meterStop && stop.timestamp === payload.timestamp) {
        return { idTagInfo: { status: 'Accepted' }, idempotent: true }
      }
      return {
        idTagInfo: { status: 'Rejected' },
        error: this.stateViolation(context, 'Transaction already stopped'),
      }
    }

    tx.status = 'stopped'
    tx.stop = {
      meterStop: payload.meterStop as number,
      timestamp: payload.timestamp as string,
      idTag: payload.idTag as string | undefined,
      reason: payload.reason as string | undefined,
    }
    state.activeByConnector.delete(tx.connectorId)
    return { idTagInfo: { status: 'Accepted' } }
  }

  handleMeterValues16(context: OcppContext, payload: any): { orphaned?: boolean } {
    const transactionId = payload.transactionId as number | undefined
    if (!transactionId) {
      return {}
    }
    const state = this.getState(context)
    const tx = state.transactions16.get(transactionId)
    if (!tx) {
      if (this.strict) {
        throw this.stateViolation(context, 'MeterValues for unknown transaction')
      }
      return { orphaned: true }
    }
    return {}
  }

  handleTransactionEvent(context: OcppContext, payload: any): TransactionEventResult {
    const state = this.getState(context)
    const eventType = String(payload.eventType || '').toLowerCase()
    const seqNo = payload.seqNo as number | undefined
    const transactionId = this.extractTransactionId(payload)
    if (!transactionId) {
      return { idTokenInfo: { status: 'Rejected' }, error: this.formatViolation(context, 'Missing transactionId') }
    }

    const existing = state.transactions2.get(transactionId)
    if (!existing && eventType !== 'started') {
      if (this.strict) {
        return { idTokenInfo: { status: 'Rejected' }, error: this.stateViolation(context, 'Unknown transaction') }
      }
    }

    if (existing && seqNo !== undefined && existing.lastSeqNo !== undefined && seqNo <= existing.lastSeqNo) {
      return { idTokenInfo: { status: 'Accepted' }, idempotent: true }
    }

    if (eventType === 'started') {
      if (existing) {
        return { idTokenInfo: { status: 'Accepted' }, idempotent: true }
      }
      const tx: TransactionState2 = {
        transactionId,
        evseId: this.extractEvseId(payload),
        connectorId: this.extractConnectorId(payload),
        idToken: this.extractIdToken(payload),
        startedAt: payload.timestamp as string,
        status: 'active',
        lastSeqNo: seqNo,
      }
      state.transactions2.set(transactionId, tx)
      if (tx.connectorId !== undefined) {
        state.activeByConnector.set(tx.connectorId, transactionId)
      }
      return { idTokenInfo: { status: 'Accepted' } }
    }

    if (!existing) {
      return { idTokenInfo: { status: 'Rejected' }, error: this.stateViolation(context, 'Unknown transaction') }
    }

    existing.lastSeqNo = seqNo ?? existing.lastSeqNo

    if (eventType === 'ended') {
      existing.status = 'ended'
      if (existing.connectorId !== undefined) {
        state.activeByConnector.delete(existing.connectorId)
      }
    }

    return { idTokenInfo: { status: 'Accepted' } }
  }

  private extractTransactionId(payload: any): string | null {
    const info = payload.transactionInfo || {}
    const id = info.transactionId
    if (!id) return null
    return String(id)
  }

  private extractEvseId(payload: any): number | undefined {
    if (payload.evse && typeof payload.evse === 'object' && payload.evse.id !== undefined) {
      return Number(payload.evse.id)
    }
    if (payload.evseId !== undefined) {
      return Number(payload.evseId)
    }
    return undefined
  }

  private extractConnectorId(payload: any): number | undefined {
    if (payload.evse && typeof payload.evse === 'object' && payload.evse.connectorId !== undefined) {
      return Number(payload.evse.connectorId)
    }
    if (payload.connectorId !== undefined) {
      return Number(payload.connectorId)
    }
    return undefined
  }

  private extractIdToken(payload: any): string | undefined {
    if (payload.idToken && typeof payload.idToken === 'object') {
      return payload.idToken.idToken ? String(payload.idToken.idToken) : undefined
    }
    return undefined
  }

  private getState(context: OcppContext): ChargePointState {
    const key = context.chargePointId
    let state = this.states.get(key)
    if (!state) {
      state = {
        chargePointId: context.chargePointId,
        ocppVersion: context.ocppVersion,
        stationId: context.stationId,
        tenantId: context.tenantId,
        connectors: new Map(),
        transactionCounter: 0,
        transactions16: new Map(),
        transactions2: new Map(),
        activeByConnector: new Map(),
      }
      this.states.set(key, state)
    }
    return state
  }

  private getConnector(state: ChargePointState, connectorId: number): ConnectorState {
    let connector = state.connectors.get(connectorId)
    if (!connector) {
      connector = { connectorId }
      state.connectors.set(connectorId, connector)
    }
    return connector
  }

  private isSameStart(tx: TransactionState16, payload: any): boolean {
    return (
      tx.connectorId === payload.connectorId &&
      tx.idTag === payload.idTag &&
      tx.meterStart === payload.meterStart &&
      tx.timestamp === payload.timestamp
    )
  }

  private stateViolation(context: OcppContext, message: string): StateError {
    return {
      code: 'OccurrenceConstraintViolation',
      description: message,
      details: { chargePointId: context.chargePointId },
    }
  }

  private formatViolation(context: OcppContext, message: string): StateError {
    const code = context.ocppVersion === '1.6J' ? 'FormationViolation' : 'FormatViolation'
    return {
      code,
      description: message,
      details: { chargePointId: context.chargePointId },
    }
  }
}
