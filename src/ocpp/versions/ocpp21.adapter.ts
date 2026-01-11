import { Injectable, Logger } from '@nestjs/common'
import { OcppEventPublisher } from '../ocpp-event-publisher.service'
import { OcppAdapter, OcppContext, OcppHandlerResult } from './ocpp-adapter.interface'

@Injectable()
export class Ocpp21Adapter implements OcppAdapter {
  readonly version = '2.1'
  private readonly logger = new Logger(Ocpp21Adapter.name)

  constructor(private readonly publisher: OcppEventPublisher) {}

  async handleCall(action: string, payload: unknown, context: OcppContext): Promise<OcppHandlerResult> {
    switch (action) {
      case 'BootNotification': {
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
        await this.publisher.publishStationEvent('ConnectorStatusChanged', context, {
          action,
          payload,
        })
        return { response: {} }
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
        await this.publisher.publishSessionEvent('SessionEvent', context, {
          action,
          payload,
        })
        return {
          response: {
            idTokenInfo: { status: 'Accepted' },
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
