import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { Pool } from 'pg';
import { createEventsQuerySignature, runEventsKeysetSync } from '@forecast/provider-polymarket';
import { integrationTestDatabaseUrl } from './integration-test-environment.js';
import { tryAcquirePostgresAdvisoryLock } from './postgres-advisory-lock.js';
import { PostgresEventsKeysetSyncStore } from './postgres-events-sync-store.js';

const databaseUrl = integrationTestDatabaseUrl();
const integrationTest = databaseUrl === undefined ? test.skip : test;
let firstPool: Pool | undefined;
let secondPool: Pool | undefined;

before(async () => {
  if (databaseUrl === undefined) return;
  firstPool = new Pool({ connectionString: databaseUrl, max: 1 });
  secondPool = new Pool({ connectionString: databaseUrl, max: 1 });
  await Promise.all([firstPool.query('SELECT 1'), secondPool.query('SELECT 1')]);
});

after(async () => {
  await Promise.all([firstPool?.end(), secondPool?.end()]);
});

integrationTest('allows only one worker session to hold a query lock', async () => {
  const lockName = 'polymarket:events-keyset:v1:integration-lock';
  const firstLock = await tryAcquirePostgresAdvisoryLock(requirePool(firstPool), lockName);
  assert.notEqual(firstLock, null);
  if (firstLock === null) throw new Error('first advisory lock was not acquired');

  const competingLock = await tryAcquirePostgresAdvisoryLock(requirePool(secondPool), lockName);
  assert.equal(competingLock, null);

  await firstLock.healthCheck();
  await firstLock.release();
  await assert.rejects(() => firstLock.healthCheck(), /already been released/);

  const lockAfterRelease = await tryAcquirePostgresAdvisoryLock(requirePool(secondPool), lockName);
  assert.notEqual(lockAfterRelease, null);
  await lockAfterRelease?.release();
});

integrationTest(
  'completes a full sync with a one-connection store pool while the lock uses its own pool',
  { timeout: 5_000 },
  async () => {
    const connectionString = requireDatabaseUrl();
    const storePool = new Pool({ connectionString, max: 1 });
    const lockPool = new Pool({ connectionString, max: 1 });
    const query = { limit: 1, closed: false } as const;
    const lockName = createEventsQuerySignature(query);

    try {
      await clearSyncRecords(storePool, lockName);
      const lock = await tryAcquirePostgresAdvisoryLock(lockPool, lockName);
      assert.notEqual(lock, null);

      try {
        const result = await runEventsKeysetSync(
          {
            listEventsKeyset: async () => ({
              events: [],
              nextCursor: null,
              requestCursor: null,
              requestUrl: 'https://example.test/events/keyset?limit=1',
              fetchedAt: new Date().toISOString(),
              rawPayload: { events: [] },
            }),
          } as never,
          new PostgresEventsKeysetSyncStore(storePool),
          { query, maxPages: 1 },
        );

        assert.equal(result.fullyDrained, true);
        assert.equal(result.pagesProcessed, 1);
      } finally {
        await lock?.release();
      }
    } finally {
      await Promise.all([storePool.end(), lockPool.end()]);
    }
  },
);

function requirePool(value: Pool | undefined): Pool {
  if (value === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests');
  return value;
}

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined)
    throw new Error('TEST_DATABASE_URL is required for integration tests');
  return databaseUrl;
}

async function clearSyncRecords(pool: Pool, querySignature: string): Promise<void> {
  await pool.query('DELETE FROM provider_sync_pages WHERE query_signature = $1', [querySignature]);
  await pool.query('DELETE FROM provider_sync_runs WHERE query_signature = $1', [querySignature]);
  await pool.query('DELETE FROM provider_sync_checkpoints WHERE query_signature = $1', [
    querySignature,
  ]);
}
