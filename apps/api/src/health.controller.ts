import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { status: 'ok'; service: string; timestamp: string; version: string } {
    return {
      status: 'ok',
      service: 'forecast-api',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.2.0',
    };
  }
}
