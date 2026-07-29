import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DatabasePoolService } from './database-pool.service';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabasePoolService)
    private readonly database: DatabasePoolService,
  ) {}

  @Get()
  getHealth(): HealthResponse {
    return this.liveness();
  }

  @Get('live')
  getLiveness(): HealthResponse {
    return this.liveness();
  }

  @Get('ready')
  async getReadiness(): Promise<HealthResponse> {
    try {
      await this.database.pool.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_NOT_READY',
        message: 'database is not ready',
      });
    }
    return this.healthResponse('ready');
  }

  private liveness(): HealthResponse {
    return this.healthResponse('ok');
  }

  private healthResponse(status: HealthResponse['status']): HealthResponse {
    return {
      status,
      service: 'forecast-api',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.2.0',
    };
  }
}

interface HealthResponse {
  status: 'ok' | 'ready';
  service: string;
  timestamp: string;
  version: string;
}
