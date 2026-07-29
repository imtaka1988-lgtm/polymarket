import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import type { DatabasePoolService } from './database-pool.service';
import { HealthController } from './health.controller';

test('readiness fails closed when PostgreSQL cannot answer', async () => {
  const controller = new HealthController({
    pool: {
      query: async () => {
        throw new Error('database unavailable');
      },
    },
  } as unknown as DatabasePoolService);

  await assert.rejects(controller.getReadiness(), (error: unknown) => {
    if (!(error instanceof ServiceUnavailableException)) return false;
    assert.deepEqual(error.getResponse(), {
      code: 'DATABASE_NOT_READY',
      message: 'database is not ready',
    });
    return true;
  });
});
