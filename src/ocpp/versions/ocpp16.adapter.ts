import { Injectable, Logger } from '@nestjs/common'
import { randomInt } from 'crypto'
import { OcppEventPublisher } from '../ocpp-event-publisher.service'
import { OcppAdapter, OcppContext, OcppHandlerResult } from './ocpp-adapter.interface'

@Injectable()
export class Ocpp16Adapter implements OcppAdapter {
  readonly version = '1.6J'
  private readonly logger = new Logger(Ocpp16Adapter.name)

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
      case 'Authorize': {
        return {
          response: {
            idTagInfo: { status: 'Accepted' },
          },
        }
      }
      case 'StartTransaction': {
        await this.publisher.publishSessionEvent('SessionStarted', context, {
          action,
          payload,
        })
        return {
          response: {
            transactionId: randomInt(100000, 999999),
            idTagInfo: { status: 'Accepted' },
          },
        }
      }
      case 'StopTransaction': {
        await this.publisher.publishSessionEvent('SessionStopped', context, {
          action,
          payload,
        })
        return {
          response: {
            idTagInfo: { status: 'Accepted' },
          },
        }
      }
      case 'MeterValues': {
        await this.publisher.publishSessionEvent('MeterValuesReceived', context, {
          action,
          payload,
        })
        return { response: {} }
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
