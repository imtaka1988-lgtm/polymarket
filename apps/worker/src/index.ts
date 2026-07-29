import { Pool } from 'pg';
import {
  createEventsQuerySignature,
  PolymarketClobRestClient,
  PolymarketClient,
  PolymarketMarketWebSocket,
  runEventsKeysetSync,
} from '@forecast/provider-polymarket';
import { PolymarketRealtimeWorker } from './polymarket-realtime-worker.js';
import { tryAcquirePostgresAdvisoryLock } from './postgres-advisory-lock.js';
import { PostgresEventsKeysetSyncStore } from './postgres-events-sync-store.js';
import { PostgresMarketPriceStore } from './postgres-market-price-store.js';

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
const realtimeLockPool = new Pool({
  connectionString: databaseConnectionString,
  max: 1,
});
const store = new PostgresEventsKeysetSyncStore(storePool);
const marketPriceStore = new PostgresMarketPriceStore(storePool);
const clobRestClient = new PolymarketClobRestClient({
  baseUrl: process.env.POLYMARKET_CLOB_BASE_URL ?? 'https://clob.polymarket.com',
  timeoutMs: Number(process.env.POLYMARKET_REQUEST_TIMEOUT_MS ?? 10_000),
  maxTokensPerRequest: Number(process.env.POLYMARKET_CLOB_REST_BATCH_SIZE ?? 500),
  retry: {
    maxAttempts: Number(process.env.POLYMARKET_RETRY_MAX_ATTEMPTS ?? 4),
    baseDelayMs: Number(process.env.POLYMARKET_RETRY_BASE_DELAY_MS ?? 500),
    maxDelayMs: Number(process.env.POLYMARKET_RETRY_MAX_DELAY_MS ?? 8_000),
  },
});
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
let realtimeLeadershipAttemptRunning = false;
let realtimeLock: Awaited<ReturnType<typeof tryAcquirePostgresAdvisoryLock>> = null;
let realtimeWorker: PolymarketRealtimeWorker;
const marketWebSocket = new PolymarketMarketWebSocket({
  url:
    process.env.POLYMARKET_MARKET_WS_URL ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  onEvent: (event) => realtimeWorker.enqueueWebSocketEvent(event),
  onStateChange: (state) => log('info', 'market_websocket_state_changed', { state }),
  onWarning: (message) => log('warn', 'market_websocket_warning', { message }),
});
realtimeWorker = new PolymarketRealtimeWorker(marketPriceStore, clobRestClient, marketWebSocket, {
  tokenRefreshIntervalMs: Number(process.env.POLYMARKET_TOKEN_REFRESH_INTERVAL_MS ?? 60_000),
  reconciliationIntervalMs: Number(
    process.env.POLYMARKET_REST_RECONCILIATION_INTERVAL_MS ?? 60_000,
  ),
  maxEventQueueSize: Number(process.env.POLYMARKET_WEBSOCKET_MAX_QUEUE_SIZE ?? 10_000),
  onLog: log,
});

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

async function ensureRealtimeLeadership(): Promise<void> {
  if ((process.env.POLYMARKET_REALTIME_ENABLED ?? 'true') !== 'true') return;
  if (realtimeLeadershipAttemptRunning) return;
  realtimeLeadershipAttemptRunning = true;
  try {
    if (realtimeLock !== null) {
      try {
        await realtimeLock.healthCheck();
        return;
      } catch (error) {
        log('error', 'market_realtime_leadership_lost', {
          message: error instanceof Error ? error.message : String(error),
        });
        await realtimeWorker.stop();
        await realtimeLock.release().catch(() => undefined);
        realtimeLock = null;
      }
    }

    const acquired = await tryAcquirePostgresAdvisoryLock(
      realtimeLockPool,
      'polymarket:market-realtime:v1',
    );
    if (acquired === null) {
      log('info', 'market_realtime_leadership_skipped', {
        reason: 'distributed_lock_unavailable',
      });
      return;
    }

    realtimeLock = acquired;
    try {
      await realtimeWorker.start();
      log('info', 'market_realtime_leadership_acquired', {});
    } catch (error) {
      await realtimeLock.release().catch(() => undefined);
      realtimeLock = null;
      throw error;
    }
  } finally {
    realtimeLeadershipAttemptRunning = false;
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
  await realtimeWorker.stop();
  await realtimeLock?.release();
  await Promise.all([storePool.end(), lockPool.end(), realtimeLockPool.end()]);
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await syncOnce();
await ensureRealtimeLeadership();
setInterval(() => void syncOnce(), intervalMs);
setInterval(
  () =>
    void ensureRealtimeLeadership().catch((error) => {
      log('error', 'market_realtime_leadership_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }),
  Number(process.env.POLYMARKET_REALTIME_LEADERSHIP_INTERVAL_MS ?? 30_000),
);
