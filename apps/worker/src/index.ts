import { Pool } from 'pg';
import {
  createEventsQuerySignature,
  PolymarketClient,
  runEventsKeysetSync,
} from '@forecast/provider-polymarket';
import { tryAcquirePostgresAdvisoryLock } from './postgres-advisory-lock.js';
import { PostgresEventsKeysetSyncStore } from './postgres-events-sync-store.js';

const client = new PolymarketClient({
  gammaBaseUrl: process.env.POLYMARKET_GAMMA_BASE_URL ?? 'https://gamma-api.polymarket.com',
  timeoutMs: Number(process.env.POLYMARKET_REQUEST_TIMEOUT_MS ?? 10_000),
  retry: {
    maxAttempts: Number(process.env.POLYMARKET_RETRY_MAX_ATTEMPTS ?? 4),
    baseDelayMs: Number(process.env.POLYMARKET_RETRY_BASE_DELAY_MS ?? 500),
    maxDelayMs: Number(process.env.POLYMARKET_RETRY_MAX_DELAY_MS ?? 8_000),
  },
});

const databaseConnectionString =
  process.env.DATABASE_URL ?? 'postgresql://forecast:forecast@localhost:5432/forecast';
const storePool = new Pool({
  connectionString: databaseConnectionString,
  max: Number(process.env.WORKER_DATABASE_POOL_SIZE ?? 5),
});
const lockPool = new Pool({
  connectionString: databaseConnectionString,
  max: 1,
});
const store = new PostgresEventsKeysetSyncStore(storePool);
const intervalMs = Number(process.env.POLYMARKET_SYNC_INTERVAL_MS ?? 60_000);
const pageSize = Number(process.env.POLYMARKET_SYNC_PAGE_SIZE ?? 100);
const maxPages = Number(process.env.POLYMARKET_SYNC_MAX_PAGES_PER_RUN ?? 5);
const order = (process.env.POLYMARKET_SYNC_ORDER ?? 'updatedAt,id')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const syncQuery = {
  limit: pageSize,
  order,
  ascending: true,
  closed: false,
  includeChildren: true,
} as const;
const syncLockName = createEventsQuerySignature(syncQuery);
let running = false;

async function syncOnce(): Promise<void> {
  if (running) {
    log('warn', 'provider_sync_skipped', { reason: 'previous_run_still_active' });
    return;
  }

  running = true;
  let distributedLock: Awaited<ReturnType<typeof tryAcquirePostgresAdvisoryLock>> = null;
  try {
    distributedLock = await tryAcquirePostgresAdvisoryLock(lockPool, syncLockName);
    if (distributedLock === null) {
      log('warn', 'provider_sync_skipped', {
        reason: 'distributed_lock_unavailable',
        querySignature: syncLockName,
      });
      return;
    }

    const result = await runEventsKeysetSync(client, store, {
      query: syncQuery,
      maxPages,
      resume: true,
      onProgress: (progress) => log('info', 'provider_sync_page_committed', progress),
    });
    log('info', 'provider_sync_completed', result);
  } catch (error) {
    log('error', 'provider_sync_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await distributedLock?.release();
    running = false;
  }
}

function log(level: 'info' | 'warn' | 'error', event: string, details: object): void {
  console.log(
    JSON.stringify({
      level,
      event,
      provider: 'polymarket',
      ...details,
      timestamp: new Date().toISOString(),
    }),
  );
}

async function shutdown(signal: string): Promise<void> {
  log('info', 'worker_shutdown_started', { signal });
  await Promise.all([storePool.end(), lockPool.end()]);
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await syncOnce();
setInterval(() => void syncOnce(), intervalMs);
