import { Controller, Get } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Controller('health')
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: this.config.get<string>('service.name'),
      time: new Date().toISOString(),
    }
  }
}
