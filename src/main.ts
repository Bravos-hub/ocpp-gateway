import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { WsAdapter } from '@nestjs/platform-ws'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.useWebSocketAdapter(new WsAdapter(app))
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001
  await app.listen(port)
}

bootstrap()
