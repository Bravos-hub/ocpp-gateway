import { Injectable } from '@nestjs/common'
import { AsyncLocalStorage } from 'async_hooks'

export type LogContext = {
  correlationId?: string
  connectionId?: string
  chargePointId?: string
  stationId?: string
  tenantId?: string
  ocppVersion?: string
  action?: string
  messageId?: string
  ip?: string
  path?: string
  method?: string
}

@Injectable()
export class LogContextService {
  private static storage = new AsyncLocalStorage<LogContext>()

  runWithContext<T>(context: LogContext, fn: () => T): T {
    const current = this.getContext()
    return LogContextService.storage.run({ ...current, ...context }, fn)
  }

  setContext(context: LogContext): void {
    const current = this.getContext()
    LogContextService.storage.enterWith({ ...current, ...context })
  }

  getContext(): LogContext {
    return LogContextService.storage.getStore() || {}
  }
}
