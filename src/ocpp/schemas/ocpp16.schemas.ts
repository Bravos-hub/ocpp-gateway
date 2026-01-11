import type { AnySchema } from 'ajv'

const stringRequired = { type: 'string', minLength: 1 }
const integerNonNeg = { type: 'integer', minimum: 0 }
const numberNonNeg = { type: 'number', minimum: 0 }

const sampledValue: AnySchema = {
  type: 'object',
  required: ['value'],
  properties: {
    value: { type: 'string' },
    context: { type: 'string' },
    format: { type: 'string' },
    measurand: { type: 'string' },
    phase: { type: 'string' },
    location: { type: 'string' },
    unit: { type: 'string' },
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

export const OCPP16_SCHEMAS: Record<string, AnySchema> = {
  BootNotification: {
    type: 'object',
    required: ['chargePointVendor', 'chargePointModel'],
    properties: {
      chargePointVendor: stringRequired,
      chargePointModel: stringRequired,
      chargePointSerialNumber: { type: 'string' },
      chargeBoxSerialNumber: { type: 'string' },
      firmwareVersion: { type: 'string' },
      iccid: { type: 'string' },
      imsi: { type: 'string' },
      meterSerialNumber: { type: 'string' },
      meterType: { type: 'string' },
    },
    additionalProperties: true,
  },
  Heartbeat: {
    type: 'object',
    additionalProperties: true,
  },
  DiagnosticsStatusNotification: {
    type: 'object',
    required: ['status'],
    properties: {
      status: stringRequired,
    },
    additionalProperties: true,
  },
  FirmwareStatusNotification: {
    type: 'object',
    required: ['status'],
    properties: {
      status: stringRequired,
    },
    additionalProperties: true,
  },
  StatusNotification: {
    type: 'object',
    required: ['connectorId', 'errorCode', 'status'],
    properties: {
      connectorId: integerNonNeg,
      errorCode: stringRequired,
      status: stringRequired,
      info: { type: 'string' },
      vendorId: { type: 'string' },
      vendorErrorCode: { type: 'string' },
      timestamp: { type: 'string' },
    },
    additionalProperties: true,
  },
  Authorize: {
    type: 'object',
    required: ['idTag'],
    properties: {
      idTag: stringRequired,
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
  StartTransaction: {
    type: 'object',
    required: ['connectorId', 'idTag', 'meterStart', 'timestamp'],
    properties: {
      connectorId: integerNonNeg,
      idTag: stringRequired,
      meterStart: numberNonNeg,
      timestamp: stringRequired,
      reservationId: integerNonNeg,
    },
    additionalProperties: true,
  },
  StopTransaction: {
    type: 'object',
    required: ['transactionId', 'meterStop', 'timestamp'],
    properties: {
      transactionId: integerNonNeg,
      meterStop: numberNonNeg,
      timestamp: stringRequired,
      idTag: { type: 'string' },
      reason: { type: 'string' },
      transactionData: { type: 'array' },
    },
    additionalProperties: true,
  },
  MeterValues: {
    type: 'object',
    required: ['connectorId', 'meterValue'],
    properties: {
      connectorId: integerNonNeg,
      transactionId: integerNonNeg,
      meterValue: {
        type: 'array',
        minItems: 1,
        items: meterValue,
      },
    },
    additionalProperties: true,
  },
  RemoteStartTransaction: {
    type: 'object',
    required: ['idTag'],
    properties: {
      connectorId: integerNonNeg,
      idTag: stringRequired,
      chargingProfile: { type: 'object' },
    },
    additionalProperties: true,
  },
  RemoteStopTransaction: {
    type: 'object',
    required: ['transactionId'],
    properties: {
      transactionId: integerNonNeg,
    },
    additionalProperties: true,
  },
  Reset: {
    type: 'object',
    required: ['type'],
    properties: {
      type: stringRequired,
    },
    additionalProperties: true,
  },
  UnlockConnector: {
    type: 'object',
    required: ['connectorId'],
    properties: {
      connectorId: integerNonNeg,
    },
    additionalProperties: true,
  },
  ChangeConfiguration: {
    type: 'object',
    required: ['key', 'value'],
    properties: {
      key: stringRequired,
      value: stringRequired,
    },
    additionalProperties: true,
  },
  GetConfiguration: {
    type: 'object',
    properties: {
      key: {
        type: 'array',
        items: stringRequired,
      },
    },
    additionalProperties: true,
  },
  UpdateFirmware: {
    type: 'object',
    required: ['location', 'retrieveDate'],
    properties: {
      location: stringRequired,
      retrieveDate: stringRequired,
      retries: integerNonNeg,
      retryInterval: integerNonNeg,
    },
    additionalProperties: true,
  },
  TriggerMessage: {
    type: 'object',
    required: ['requestedMessage'],
    properties: {
      requestedMessage: stringRequired,
      connectorId: integerNonNeg,
    },
    additionalProperties: true,
  },
}
