import type { AnySchema } from 'ajv'

const stringRequired = { type: 'string', minLength: 1 }
const integerNonNeg = { type: 'integer', minimum: 0 }

const idTagInfo: AnySchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: stringRequired,
    expiryDate: { type: 'string' },
    parentIdTag: { type: 'string' },
  },
  additionalProperties: true,
}

export const OCPP16_RESPONSES: Record<string, AnySchema> = {
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
  Authorize: {
    type: 'object',
    required: ['idTagInfo'],
    properties: {
      idTagInfo,
    },
    additionalProperties: true,
  },
  StartTransaction: {
    type: 'object',
    required: ['transactionId', 'idTagInfo'],
    properties: {
      transactionId: integerNonNeg,
      idTagInfo,
    },
    additionalProperties: true,
  },
  StopTransaction: {
    type: 'object',
    properties: {
      idTagInfo,
    },
    additionalProperties: true,
  },
  MeterValues: {
    type: 'object',
    additionalProperties: true,
  },
  DiagnosticsStatusNotification: {
    type: 'object',
    additionalProperties: true,
  },
  FirmwareStatusNotification: {
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
