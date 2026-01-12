import { Injectable, Logger } from '@nestjs/common'
import { OcppEventPublisher } from '../ocpp-event-publisher.service'
import { OcppStateService } from '../ocpp-state.service'
import { OcppAdapter, OcppContext, OcppHandlerResult } from './ocpp-adapter.interface'

@Injectable()
export class Ocpp201Adapter implements OcppAdapter {
  readonly version = '2.0.1'
  private readonly logger = new Logger(Ocpp201Adapter.name)

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
        const typed = payload as { evseId: number; connectorId?: number; connectorStatus: string }
        this.state.updateStatus2(context, typed.evseId, typed.connectorId, typed.connectorStatus)
        await this.publisher.publishStationEvent('ConnectorStatusChanged', context, {
          action,
          payload,
        })
        return { response: {} }
      }
      case 'Authorize': {
        const idTokenInfo = this.state.authorize2()
        return {
          response: {
            idTokenInfo,
          },
        }
      }
      case 'SecurityEventNotification': {
        await this.publisher.publishStationEvent('SecurityEventNotification', context, {
          action,
          payload,
        })
        return { response: {} }
      }
      case 'NotifyEvent': {
        await this.publisher.publishStationEvent('NotifyEvent', context, {
          action,
          payload,
        })
        return { response: {} }
      }
      case 'TransactionEvent': {
        const result = this.state.handleTransactionEvent(context, payload)
        if (result.error) {
          return { error: result.error }
        }
        await this.publisher.publishSessionEvent('SessionEvent', context, {
          action,
          payload,
          idempotent: result.idempotent,
        })
        return {
          response: {
            idTokenInfo: result.idTokenInfo,
          },
        }
      }
      case 'FirmwareStatusNotification': {
        await this.publisher.publishStationEvent('FirmwareStatusNotification', context, {
          action,
          payload,
        })
        return { response: {} }
      }
      case 'LogStatusNotification': {
        await this.publisher.publishStationEvent('LogStatusNotification', context, {
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
