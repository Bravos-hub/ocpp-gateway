import { Injectable, Logger } from '@nestjs/common'
import { OcppEventPublisher } from '../ocpp-event-publisher.service'
import { OcppStateService } from '../ocpp-state.service'
import { OcppAdapter, OcppContext, OcppHandlerResult } from './ocpp-adapter.interface'

@Injectable()
export class Ocpp16Adapter implements OcppAdapter {
  readonly version = '1.6J'
  private readonly logger = new Logger(Ocpp16Adapter.name)

  constructor(
    private readonly publisher: OcppEventPublisher,
    private readonly state: OcppStateService
  ) {}

  async handleCall(action: string, payload: unknown, context: OcppContext): Promise<OcppHandlerResult> {
    switch (action) {
      case 'BootNotification': {
        this.state.recordBoot(context)
        await this.publisher.publishStationEvent('StationBooted', context, {
          action,
          payload,
        })
        return {
          response: {
            status: 'Accepted',
            currentTime: new Date().toISOString(),
            interval: 300,
          },
        }
      }
      case 'Heartbeat': {
        this.state.recordHeartbeat(context)
        await this.publisher.publishStationEvent('StationHeartbeat', context, {
          action,
          payload,
        })
        return {
          response: {
            currentTime: new Date().toISOString(),
          },
        }
      }
      case 'StatusNotification': {
        const typed = payload as { connectorId: number; status: string; errorCode: string }
        this.state.updateStatus16(context, typed.connectorId, typed.status, typed.errorCode)
        await this.publisher.publishStationEvent('ConnectorStatusChanged', context, {
          action,
          payload,
        })
        return { response: {} }
      }
      case 'Authorize': {
        const idTagInfo = this.state.authorize16()
        return {
          response: {
            idTagInfo,
          },
        }
      }
      case 'StartTransaction': {
        const result = this.state.startTransaction16(context, payload)
        if (result.error) {
          return { error: result.error }
        }
        await this.publisher.publishSessionEvent('SessionStarted', context, {
          action,
          payload,
          transactionId: result.transactionId,
          idempotent: result.idempotent,
        })
        return {
          response: {
            transactionId: result.transactionId,
            idTagInfo: result.idTagInfo,
          },
        }
      }
      case 'StopTransaction': {
        const result = this.state.stopTransaction16(context, payload)
        if (result.error) {
          return { error: result.error }
        }
        await this.publisher.publishSessionEvent('SessionStopped', context, {
          action,
          payload,
          idempotent: result.idempotent,
        })
        return {
          response: {
            idTagInfo: result.idTagInfo,
          },
        }
      }
      case 'MeterValues': {
        try {
          const meterResult = this.state.handleMeterValues16(context, payload)
          await this.publisher.publishSessionEvent('MeterValuesReceived', context, {
            action,
            payload,
            orphaned: meterResult.orphaned,
          })
        } catch (error) {
          return { error: error as { code: string; description: string; details?: Record<string, unknown> } }
        }
        return { response: {} }
      }
      case 'DiagnosticsStatusNotification': {
        await this.publisher.publishStationEvent('DiagnosticsStatusNotification', context, {
          action,
          payload,
        })
        return { response: {} }
      }
      case 'FirmwareStatusNotification': {
        await this.publisher.publishStationEvent('FirmwareStatusNotification', context, {
          action,
          payload,
        })
        return { response: {} }
      }
      case 'DataTransfer': {
        await this.publisher.publishStationEvent('DataTransferReceived', context, {
          action,
          payload,
        })
        return {
          response: {
            status: 'Accepted',
          },
        }
      }
      default: {
        this.logger.debug(`Unsupported action ${action}`)
        return {
          error: {
            code: 'NotImplemented',
            description: `Action ${action} not supported`,
          },
        }
      }
    }
  }
}
