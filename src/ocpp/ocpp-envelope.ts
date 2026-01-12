export const OCPP_MESSAGE_TYPES = {
  CALL: 2,
  CALLRESULT: 3,
  CALLERROR: 4,
} as const

export type OcppCall = [2, string, string, unknown]
export type OcppCallResult = [3, string, unknown]
export type OcppCallError = [4, string, string, string, Record<string, unknown>]

export type OcppEnvelope =
  | { messageTypeId: 2; uniqueId: string; action: string; payload: unknown }
  | { messageTypeId: 3; uniqueId: string; payload: unknown }
  | {
      messageTypeId: 4
      uniqueId: string
      errorCode: string
      errorDescription: string
      errorDetails: Record<string, unknown>
    }

export type EnvelopeParseError = {
  messageTypeId?: number
  uniqueId?: string
  reason: string
}

export type EnvelopeParseResult =
  | { ok: true; envelope: OcppEnvelope }
  | { ok: false; error: EnvelopeParseError }

export function parseEnvelope(message: unknown): EnvelopeParseResult {
  if (!Array.isArray(message)) {
    return { ok: false, error: { reason: 'Message must be a JSON array' } }
  }

  if (message.length < 3) {
    const uniqueId = typeof message[1] === 'string' ? message[1] : undefined
    const messageTypeId = typeof message[0] === 'number' ? message[0] : undefined
    return { ok: false, error: { reason: 'Message array is too short', uniqueId, messageTypeId } }
  }

  const [messageTypeId, uniqueId] = message
  const parsedUniqueId = typeof uniqueId === 'string' ? uniqueId : undefined
  if (typeof messageTypeId !== 'number') {
    return { ok: false, error: { reason: 'Invalid message type id', uniqueId: parsedUniqueId } }
  }

  if (typeof uniqueId !== 'string') {
    return { ok: false, error: { reason: 'Missing uniqueId', messageTypeId } }
  }

  if (messageTypeId === OCPP_MESSAGE_TYPES.CALL) {
    const action = message[2]
    if (typeof action !== 'string') {
      return {
        ok: false,
        error: { reason: 'Missing action', messageTypeId, uniqueId },
      }
    }
    return {
      ok: true,
      envelope: {
        messageTypeId: 2,
        uniqueId,
        action,
        payload: message[3],
      },
    }
  }

  if (messageTypeId === OCPP_MESSAGE_TYPES.CALLRESULT) {
    return {
      ok: true,
      envelope: {
        messageTypeId: 3,
        uniqueId,
        payload: message[2],
      },
    }
  }

  if (messageTypeId === OCPP_MESSAGE_TYPES.CALLERROR) {
    const errorCode = message[2]
    const errorDescription = message[3]
    const errorDetails = message[4]
    if (typeof errorCode !== 'string' || typeof errorDescription !== 'string' || typeof errorDetails !== 'object') {
      return {
        ok: false,
        error: { reason: 'Invalid CallError payload', messageTypeId, uniqueId },
      }
    }
    return {
      ok: true,
      envelope: {
        messageTypeId: 4,
        uniqueId,
        errorCode,
        errorDescription,
        errorDetails: errorDetails as Record<string, unknown>,
      },
    }
  }

  return {
    ok: false,
    error: { reason: `Unsupported message type ${messageTypeId}`, messageTypeId, uniqueId },
  }
}

export function buildCallResult(uniqueId: string, payload: unknown): OcppCallResult {
  return [OCPP_MESSAGE_TYPES.CALLRESULT, uniqueId, payload]
}

export function buildCallError(
  uniqueId: string,
  errorCode: string,
  errorDescription: string,
  errorDetails: Record<string, unknown> = {}
): OcppCallError {
  return [OCPP_MESSAGE_TYPES.CALLERROR, uniqueId, errorCode, errorDescription, errorDetails]
}
