import { Injectable, Logger } from '@nestjs/common'
import { OcppEventPublisher } from '../ocpp-event-publisher.service'
import { OcppAdapter, OcppContext, OcppHandlerResult } from './ocpp-adapter.interface'

@Injectable()
export class Ocpp201Adapter implements OcppAdapter {
  readonly version = '2.0.1'
  private readonly logger = new Logger(Ocpp201Adapter.name)

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
