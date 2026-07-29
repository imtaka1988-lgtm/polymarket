import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DatabasePoolService implements OnApplicationShutdown {
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://forecast:forecast@localhost:5432/forecast',
      max: positiveInteger('API_DATABASE_POOL_MAX', process.env.API_DATABASE_POOL_MAX, 10),
      statement_timeout: positiveInteger(
        'API_DATABASE_STATEMENT_TIMEOUT_MS',
        process.env.API_DATABASE_STATEMENT_TIMEOUT_MS,
        5_000,
      ),
    });
    this.pool.on('error', (error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'api_database_pool_error',
          message: error.message,
          timestamp: new Date().toISOString(),
        }),
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return parsed;
}
