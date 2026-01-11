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
  | { messageTypeId: 4; uniqueId: string; errorCode: string; errorDescription: string; errorDetails: Record<string, unknown> }

export function parseEnvelope(message: unknown): OcppEnvelope | null {
  if (!Array.isArray(message) || message.length < 3) {
    return null
  }

  const [messageTypeId, uniqueId] = message
  if (typeof messageTypeId !== 'number' || typeof uniqueId !== 'string') {
    return null
  }

  if (messageTypeId === OCPP_MESSAGE_TYPES.CALL) {
    const action = message[2]
    if (typeof action !== 'string') {
      return null
    }
    return {
      messageTypeId: 2,
      uniqueId,
      action,
      payload: message[3],
    }
  }

  if (messageTypeId === OCPP_MESSAGE_TYPES.CALLRESULT) {
    return {
      messageTypeId: 3,
      uniqueId,
      payload: message[2],
    }
  }

  if (messageTypeId === OCPP_MESSAGE_TYPES.CALLERROR) {
    const errorCode = message[2]
    const errorDescription = message[3]
    const errorDetails = message[4]
    if (typeof errorCode !== 'string' || typeof errorDescription !== 'string' || typeof errorDetails !== 'object') {
      return null
    }
    return {
      messageTypeId: 4,
      uniqueId,
      errorCode,
      errorDescription,
      errorDetails: errorDetails as Record<string, unknown>,
    }
  }

  return null
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
