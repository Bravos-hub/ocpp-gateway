import type { AnySchema } from 'ajv'

const stringRequired = { type: 'string', minLength: 1 }
const integerNonNeg = { type: 'integer', minimum: 0 }

const sampledValue: AnySchema = {
  type: 'object',
  required: ['value'],
  properties: {
    value: { type: 'string' },
    context: { type: 'string' },
    measurand: { type: 'string' },
    phase: { type: 'string' },
    location: { type: 'string' },
    unitOfMeasure: { type: 'object' },
  },
  additionalProperties: true,
}

const meterValue: AnySchema = {
  type: 'object',
  required: ['timestamp', 'sampledValue'],
  properties: {
    timestamp: { type: 'string' },
    sampledValue: {
      type: 'array',
      minItems: 1,
      items: sampledValue,
    },
  },
  additionalProperties: true,
}

export const OCPP2_SCHEMAS: Record<string, AnySchema> = {
  BootNotification: {
    type: 'object',
    required: ['reason', 'chargingStation'],
    properties: {
      reason: stringRequired,
      chargingStation: {
        type: 'object',
        required: ['vendorName', 'model'],
        properties: {
          vendorName: stringRequired,
          model: stringRequired,
          serialNumber: { type: 'string' },
          firmwareVersion: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  Heartbeat: {
    type: 'object',
    additionalProperties: true,
  },
  StatusNotification: {
    type: 'object',
    required: ['timestamp', 'connectorStatus', 'evseId'],
    properties: {
      timestamp: stringRequired,
      connectorStatus: stringRequired,
      evseId: integerNonNeg,
      connectorId: integerNonNeg,
    },
    additionalProperties: true,
  },
  TransactionEvent: {
    type: 'object',
    required: ['eventType', 'timestamp', 'triggerReason', 'seqNo'],
    properties: {
      eventType: stringRequired,
      timestamp: stringRequired,
      triggerReason: stringRequired,
      seqNo: integerNonNeg,
      transactionInfo: { type: 'object' },
      idToken: { type: 'object' },
      meterValue: {
        type: 'array',
        minItems: 1,
        items: meterValue,
      },
    },
    additionalProperties: true,
  },
  RequestStartTransaction: {
    type: 'object',
    required: ['idToken'],
    properties: {
      idToken: { type: 'object' },
      remoteStartId: integerNonNeg,
      evseId: integerNonNeg,
      connectorId: integerNonNeg,
      chargingProfile: { type: 'object' },
    },
    additionalProperties: true,
  },
  RequestStopTransaction: {
    type: 'object',
    required: ['transactionId'],
    properties: {
      transactionId: stringRequired,
    },
    additionalProperties: true,
  },
  Reset: {
    type: 'object',
    required: ['type'],
    properties: {
      type: stringRequired,
      evseId: integerNonNeg,
    },
    additionalProperties: true,
  },
  UpdateFirmware: {
    type: 'object',
    required: ['requestId', 'firmware'],
    properties: {
      requestId: integerNonNeg,
      firmware: {
        type: 'object',
        required: ['location'],
        properties: {
          location: stringRequired,
          retrieveDateTime: { type: 'string' },
          installDateTime: { type: 'string' },
          signingCertificate: { type: 'string' },
          signature: { type: 'string' },
        },
        additionalProperties: true,
      },
      retries: integerNonNeg,
      retryInterval: integerNonNeg,
    },
    additionalProperties: true,
  },
  FirmwareStatusNotification: {
    type: 'object',
    required: ['status'],
    properties: {
      status: stringRequired,
      requestId: integerNonNeg,
    },
    additionalProperties: true,
  },
  LogStatusNotification: {
    type: 'object',
    required: ['status'],
    properties: {
      status: stringRequired,
      requestId: integerNonNeg,
    },
    additionalProperties: true,
  },
  DataTransfer: {
    type: 'object',
    required: ['vendorId'],
    properties: {
      vendorId: stringRequired,
      messageId: { type: 'string' },
      data: {},
    },
    additionalProperties: true,
  },
}
