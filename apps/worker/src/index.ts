import { Pool } from 'pg';
import {
  createEventsQuerySignature,
  PolymarketClobRestClient,
  PolymarketClient,
  PolymarketMarketWebSocket,
  runEventsKeysetSync,
} from '@forecast/provider-polymarket';
import { PolymarketLifecycleWorker } from './polymarket-lifecycle-worker.js';
import { PolymarketRealtimeWorker } from './polymarket-realtime-worker.js';
import { tryAcquirePostgresAdvisoryLock } from './postgres-advisory-lock.js';
import { PostgresEventsKeysetSyncStore } from './postgres-events-sync-store.js';
import { PostgresMarketPriceStore } from './postgres-market-price-store.js';
import { PostgresProviderOperationsStore } from './postgres-provider-operations-store.js';

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
const lifecycleLockPool = new Pool({
  connectionString: databaseConnectionString,
  max: 1,
});
const store = new PostgresEventsKeysetSyncStore(storePool);
const marketPriceStore = new PostgresMarketPriceStore(storePool);
const providerOperationsStore = new PostgresProviderOperationsStore(
  storePool,
  Number(process.env.POLYMARKET_FAILURE_ALERT_THRESHOLD ?? 3),
);
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
const maxRealtimeQueueSize = Number(process.env.POLYMARKET_WEBSOCKET_MAX_QUEUE_SIZE ?? 10_000);
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
let lifecycleRunning = false;
let healthCheckRunning = false;
let shuttingDown = false;
let realtimeLeadershipAttemptRunning = false;
let realtimeLock: Awaited<ReturnType<typeof tryAcquirePostgresAdvisoryLock>> = null;
let realtimeWorker: PolymarketRealtimeWorker;
let webSocketNonOpenSinceMs: number | null = null;
let previousParseWarnings = 0;
const marketWebSocket = new PolymarketMarketWebSocket({
  url:
    process.env.POLYMARKET_MARKET_WS_URL ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  onEvent: (event) => realtimeWorker.enqueueWebSocketEvent(event),
  onStateChange: (state) => {
    if (state === 'open' || state === 'idle') {
      webSocketNonOpenSinceMs = null;
    } else if (
      (state === 'connecting' || state === 'waiting_to_reconnect') &&
      webSocketNonOpenSinceMs === null
    ) {
      webSocketNonOpenSinceMs = Date.now();
    }
    log('info', 'market_websocket_state_changed', { state });
  },
  onWarning: (message) => log('warn', 'market_websocket_warning', { message }),
});
realtimeWorker = new PolymarketRealtimeWorker(marketPriceStore, clobRestClient, marketWebSocket, {
  tokenRefreshIntervalMs: Number(process.env.POLYMARKET_TOKEN_REFRESH_INTERVAL_MS ?? 60_000),
  reconciliationIntervalMs: Number(
    process.env.POLYMARKET_REST_RECONCILIATION_INTERVAL_MS ?? 60_000,
  ),
  maxEventQueueSize: maxRealtimeQueueSize,
  onLog: realtimeLog,
});
const lifecycleWorker = new PolymarketLifecycleWorker(client, providerOperationsStore, {
  limit: Number(process.env.POLYMARKET_LIFECYCLE_BATCH_SIZE ?? 100),
  lookAheadMs: Number(process.env.POLYMARKET_LIFECYCLE_LOOKAHEAD_HOURS ?? 24) * 60 * 60 * 1_000,
  recheckIntervalMs: Number(process.env.POLYMARKET_LIFECYCLE_RECHECK_INTERVAL_MS ?? 900_000),
  onLog: log,
});
let previousDroppedEvents = 0;
let previousFailedEvents = 0;
const backgroundTasks = new Set<Promise<void>>();
const intervalHandles: Array<ReturnType<typeof setInterval>> = [];

async function syncOnce(): Promise<void> {
  if (shuttingDown) return;
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
    await providerOperationsStore
      .recordCatalogSyncResult(
        new Date(),
        { ...result },
        Number(process.env.POLYMARKET_PARSE_WARNING_ALERT_THRESHOLD ?? 1),
      )
      .catch((error) =>
        log('error', 'provider_runtime_state_write_failed', {
          component: 'catalog_sync',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  } catch (error) {
    log('error', 'provider_sync_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    await recordFailureSafely('catalog_sync', error);
  } finally {
    await distributedLock?.release();
    running = false;
  }
}

async function checkLifecycleOnce(): Promise<void> {
  if (shuttingDown) return;
  if ((process.env.POLYMARKET_LIFECYCLE_ENABLED ?? 'true') !== 'true') return;
  if (lifecycleRunning) {
    log('warn', 'market_lifecycle_check_skipped', { reason: 'previous_run_still_active' });
    return;
  }
  lifecycleRunning = true;
  let lock: Awaited<ReturnType<typeof tryAcquirePostgresAdvisoryLock>> = null;
  try {
    lock = await tryAcquirePostgresAdvisoryLock(
      lifecycleLockPool,
      'polymarket:market-lifecycle:v1',
    );
    if (lock === null) {
      log('info', 'market_lifecycle_check_skipped', {
        reason: 'distributed_lock_unavailable',
      });
      return;
    }
    await lifecycleWorker.runOnce();
  } catch (error) {
    log('error', 'market_lifecycle_check_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    await recordFailureSafely('market_lifecycle', error);
  } finally {
    await lock?.release();
    lifecycleRunning = false;
  }
}

async function checkProviderHealthOnce(): Promise<void> {
  if (shuttingDown) return;
  if (healthCheckRunning) return;
  healthCheckRunning = true;
  try {
    const now = new Date();
    const staleThresholdMs = Number(process.env.POLYMARKET_PRICE_STALE_THRESHOLD_MS ?? 300_000);
    await providerOperationsStore.evaluatePriceFreshness(
      new Date(now.getTime() - staleThresholdMs),
      now,
    );

    if (realtimeLock !== null) {
      const metrics = realtimeWorker.getMetrics();
      const droppedSinceLast = Math.max(metrics.droppedEvents - previousDroppedEvents, 0);
      const failedSinceLast = Math.max(metrics.failedEvents - previousFailedEvents, 0);
      await providerOperationsStore.recordRealtimeQueueMetrics(
        metrics,
        droppedSinceLast,
        failedSinceLast,
        maxRealtimeQueueSize,
        now,
      );
      previousDroppedEvents = metrics.droppedEvents;
      previousFailedEvents = metrics.failedEvents;

      const webSocketMetrics = marketWebSocket.getMetrics();
      const parseWarningsSinceLast = Math.max(
        webSocketMetrics.parseWarnings - previousParseWarnings,
        0,
      );
      const disconnectedForMs =
        webSocketNonOpenSinceMs === null ? 0 : Math.max(now.getTime() - webSocketNonOpenSinceMs, 0);
      await providerOperationsStore.recordWebSocketHealth(
        marketWebSocket.getState(),
        webSocketMetrics,
        parseWarningsSinceLast,
        disconnectedForMs,
        Number(process.env.POLYMARKET_WEBSOCKET_DISCONNECT_ALERT_MS ?? 120_000),
        now,
      );
      previousParseWarnings = webSocketMetrics.parseWarnings;
    }
  } catch (error) {
    log('error', 'provider_health_check_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    healthCheckRunning = false;
  }
}

async function ensureRealtimeLeadership(): Promise<void> {
  if (shuttingDown) return;
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
        await recordFailureSafely('realtime_leadership', error);
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
      await recordSuccessSafely('realtime_leadership', { leader: true });
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

function realtimeLog(level: 'info' | 'warn' | 'error', event: string, details: object): void {
  log(level, event, details);
  if (event === 'market_rest_reconciliation_completed') {
    void recordSuccessSafely('realtime_rest', details as Record<string, unknown>);
  } else if (event === 'market_rest_reconciliation_failed') {
    void recordFailureSafely('realtime_rest', new Error(readMessage(details)));
  } else if (event === 'market_websocket_event_persist_failed') {
    void recordFailureSafely('realtime_persistence', new Error(readMessage(details)));
  }
}

async function recordSuccessSafely(
  component: string,
  details: Record<string, unknown>,
): Promise<void> {
  await providerOperationsStore
    .recordComponentSuccess(component, new Date(), details)
    .catch((error) =>
      log('error', 'provider_runtime_state_write_failed', {
        component,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
}

async function recordFailureSafely(component: string, error: unknown): Promise<void> {
  await providerOperationsStore
    .recordComponentFailure(component, new Date(), error)
    .catch((stateError) =>
      log('error', 'provider_runtime_state_write_failed', {
        component,
        message: stateError instanceof Error ? stateError.message : String(stateError),
      }),
    );
}

function readMessage(details: object): string {
  const message = (details as { message?: unknown }).message;
  return typeof message === 'string' ? message : 'unknown realtime failure';
}

function trackBackgroundTask(name: string, task: Promise<void>): void {
  const tracked = task
    .catch((error) => {
      log('error', 'worker_background_task_failed', {
        task: name,
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => backgroundTasks.delete(tracked));
  backgroundTasks.add(tracked);
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'worker_shutdown_started', { signal });
  for (const handle of intervalHandles) clearInterval(handle);
  await realtimeWorker.stop();
  await Promise.allSettled([...backgroundTasks]);
  await realtimeLock?.release();
  await Promise.all([
    storePool.end(),
    lockPool.end(),
    realtimeLockPool.end(),
    lifecycleLockPool.end(),
  ]);
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await syncOnce();
await ensureRealtimeLeadership().catch(async (error) => {
  log('error', 'market_realtime_leadership_failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  await recordFailureSafely('realtime_leadership', error);
});
await checkLifecycleOnce();
await checkProviderHealthOnce();
intervalHandles.push(
  setInterval(() => trackBackgroundTask('catalog_sync', syncOnce()), intervalMs),
);
intervalHandles.push(
  setInterval(
    () => trackBackgroundTask('realtime_leadership', ensureRealtimeLeadership()),
    Number(process.env.POLYMARKET_REALTIME_LEADERSHIP_INTERVAL_MS ?? 30_000),
  ),
);
intervalHandles.push(
  setInterval(
    () => trackBackgroundTask('market_lifecycle', checkLifecycleOnce()),
    Number(process.env.POLYMARKET_LIFECYCLE_INTERVAL_MS ?? 300_000),
  ),
);
intervalHandles.push(
  setInterval(
    () => trackBackgroundTask('provider_health', checkProviderHealthOnce()),
    Number(process.env.POLYMARKET_HEALTH_CHECK_INTERVAL_MS ?? 60_000),
  ),
);
