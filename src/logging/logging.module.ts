import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { HttpContextMiddleware } from './http-context.middleware'
import { JsonLogger } from './json-logger.service'
import { LogContextService } from './log-context.service'

@Global()
@Module({
  providers: [LogContextService, JsonLogger, HttpContextMiddleware],
  exports: [LogContextService, JsonLogger],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpContextMiddleware).forRoutes('*')
  }
}
