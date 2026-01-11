import type { AnySchema } from 'ajv'

const stringRequired = { type: 'string', minLength: 1 }
const integerNonNeg = { type: 'integer', minimum: 0 }

const idTokenInfo: AnySchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: stringRequired,
    cacheExpiryDateTime: { type: 'string' },
    chargingPriority: { type: 'integer' },
    language1: { type: 'string' },
    language2: { type: 'string' },
    personalMessage: { type: 'string' },
  },
  additionalProperties: true,
}

export const OCPP2_RESPONSES: Record<string, AnySchema> = {
  BootNotification: {
    type: 'object',
    required: ['status', 'currentTime', 'interval'],
    properties: {
      status: stringRequired,
      currentTime: stringRequired,
      interval: integerNonNeg,
    },
    additionalProperties: true,
  },
  Heartbeat: {
    type: 'object',
    required: ['currentTime'],
    properties: {
      currentTime: stringRequired,
    },
    additionalProperties: true,
  },
  StatusNotification: {
    type: 'object',
    additionalProperties: true,
  },
  TransactionEvent: {
    type: 'object',
    properties: {
      idTokenInfo,
    },
    additionalProperties: true,
  },
  SecurityEventNotification: {
    type: 'object',
    additionalProperties: true,
  },
  NotifyEvent: {
    type: 'object',
    additionalProperties: true,
  },
  FirmwareStatusNotification: {
    type: 'object',
    additionalProperties: true,
  },
  LogStatusNotification: {
    type: 'object',
    additionalProperties: true,
  },
  DataTransfer: {
    type: 'object',
    required: ['status'],
    properties: {
      status: stringRequired,
      data: {},
    },
    additionalProperties: true,
  },
}
