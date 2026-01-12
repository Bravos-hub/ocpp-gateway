import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { OcppWsAdapter } from './ocpp/ocpp-ws.adapter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.useWebSocketAdapter(new OcppWsAdapter(app))
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001
  await app.listen(port)
}

bootstrap()
