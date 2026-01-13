import { Injectable, LoggerService } from '@nestjs/common'
import { LogContextService } from './log-context.service'

@Injectable()
export class JsonLogger implements LoggerService {
  constructor(private readonly context: LogContextService) {}

  log(message: any, context?: string): void {
    this.write('info', message, context)
  }

  error(message: any, trace?: string, context?: string): void {
    this.write('error', message, context, trace)
  }

  warn(message: any, context?: string): void {
    this.write('warn', message, context)
  }

  debug(message: any, context?: string): void {
    this.write('debug', message, context)
  }

  verbose(message: any, context?: string): void {
    this.write('verbose', message, context)
  }

  private write(level: string, message: any, context?: string, trace?: string): void {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      ...this.context.getContext(),
    }

    const formatted = this.formatMessage(message)
    entry.message = formatted.message
    if (formatted.data !== undefined) {
      entry.data = formatted.data
    }
    if (context) {
      entry.context = context
    }
    if (trace) {
      entry.trace = trace
    }

    const output = JSON.stringify(entry)
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(output)
      return
    }
    // eslint-disable-next-line no-console
    console.log(output)
  }

  private formatMessage(message: any): { message: string; data?: unknown } {
    if (message instanceof Error) {
      return {
        message: message.message || 'Error',
        data: { stack: message.stack },
      }
    }
    if (typeof message === 'string') {
      return { message }
    }
    if (message && typeof message === 'object') {
      if (typeof message.message === 'string') {
        return { message: message.message, data: message }
      }
      return { message: 'log', data: message }
    }
    return { message: String(message) }
  }
}
