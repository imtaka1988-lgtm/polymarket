import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { Pool } from 'pg';
import type {
  EventsSyncPageCommit,
  NormalizedPolymarketEvent,
  NormalizedPolymarketMarket,
} from '@forecast/provider-polymarket';
import { PostgresEventsKeysetSyncStore } from './postgres-events-sync-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl === undefined ? test.skip : test;
let pool: Pool | undefined;
let store: PostgresEventsKeysetSyncStore | undefined;

before(async () => {
  if (databaseUrl === undefined) return;
  pool = new Pool({ connectionString: databaseUrl, max: 2 });
  store = new PostgresEventsKeysetSyncStore(pool);
  await pool.query('SELECT 1');
});

after(async () => {
  await pool?.end();
});

beforeEach(async () => {
  if (pool === undefined) return;
  await pool.query(`TRUNCATE TABLE
    provider_sync_pages,
    provider_sync_runs,
    provider_sync_checkpoints,
    market_outcomes,
    markets,
    provider_markets,
    provider_events
    RESTART IDENTITY CASCADE`);
});

integrationTest('migration creates every table required by the keyset store', async () => {
  const database = requirePool();
  const result = await database.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [[
      'provider_events',
      'provider_markets',
      'markets',
      'market_outcomes',
      'provider_sync_checkpoints',
      'provider_sync_runs',
      'provider_sync_pages',
    ]],
  );

  assert.deepEqual(
    result.rows.map((row) => row.table_name),
    [
      'market_outcomes',
      'markets',
      'provider_events',
      'provider_markets',
      'provider_sync_checkpoints',
      'provider_sync_pages',
      'provider_sync_runs',
    ],
  );
});

integrationTest('commits a page atomically and resumes from the stored cursor', async () => {
  const database = requirePool();
  const syncStore = requireStore();
  const runId = await syncStore.startRun({
    querySignature: 'polymarket:events-keyset:v1:test-success',
    startedAt: '2026-07-29T12:00:00.000Z',
  });
  const commit = buildCommit({ runId });

  await syncStore.commitPage(commit);

  const counts = await readCoreCounts(database);
  assert.deepEqual(counts, {
    pages: 1,
    providerEvents: 1,
    providerMarkets: 1,
    markets: 1,
    outcomes: 2,
    checkpoints: 1,
  });

  const checkpoint = await syncStore.loadCheckpoint(commit.querySignature);
  assert.equal(checkpoint?.nextCursor, 'cursor-page-2');
  assert.equal(checkpoint?.pagesProcessed, 1);
  assert.equal(checkpoint?.eventsProcessed, 1);

  await syncStore.completeRun({
    runId,
    querySignature: commit.querySignature,
    completedAt: '2026-07-29T12:00:01.000Z',
    pagesProcessed: 1,
    eventsProcessed: 1,
    warningCount: 0,
    fullyDrained: false,
    nextCursor: 'cursor-page-2',
  });

  const run = await database.query<{ status: string; next_cursor: string | null }>(
    'SELECT status, next_cursor FROM provider_sync_runs WHERE id = $1',
    [runId],
  );
  assert.deepEqual(run.rows[0], { status: 'partial', next_cursor: 'cursor-page-2' });
});

integrationTest('replaying the same page is idempotent for raw and normalized records', async () => {
  const database = requirePool();
  const syncStore = requireStore();
  const runId = await syncStore.startRun({
    querySignature: 'polymarket:events-keyset:v1:test-replay',
    startedAt: '2026-07-29T12:10:00.000Z',
  });
  const commit = buildCommit({
    runId,
    querySignature: 'polymarket:events-keyset:v1:test-replay',
  });

  await syncStore.commitPage(commit);
  await syncStore.commitPage(commit);

  assert.deepEqual(await readCoreCounts(database), {
    pages: 1,
    providerEvents: 1,
    providerMarkets: 1,
    markets: 1,
    outcomes: 2,
    checkpoints: 1,
  });
});

integrationTest('rolls back the page, normalized data, and cursor when persistence fails', async () => {
  const database = requirePool();
  const syncStore = requireStore();
  const runId = await syncStore.startRun({
    querySignature: 'polymarket:events-keyset:v1:test-rollback',
    startedAt: '2026-07-29T12:20:00.000Z',
  });
  const commit = buildCommit({
    runId,
    querySignature: 'polymarket:events-keyset:v1:test-rollback',
    providerMarketId: 'x'.repeat(300),
  });

  await assert.rejects(() => syncStore.commitPage(commit), /value too long|character varying/i);

  assert.deepEqual(await readCoreCounts(database), {
    pages: 0,
    providerEvents: 0,
    providerMarkets: 0,
    markets: 0,
    outcomes: 0,
    checkpoints: 0,
  });
});

function buildCommit(input: {
  runId: string | null;
  querySignature?: string;
  providerMarketId?: string;
}): EventsSyncPageCommit {
  const querySignature = input.querySignature ?? 'polymarket:events-keyset:v1:test-success';
  const market = buildMarket(input.providerMarketId ?? 'market-1');
  const event = buildEvent(market);

  return {
    provider: 'polymarket',
    resourceType: 'events',
    querySignature,
    runId: input.runId,
    pageNumber: 1,
    page: {
      events: [event.raw],
      nextCursor: 'cursor-page-2',
      requestCursor: null,
      requestUrl: 'https://gamma-api.polymarket.com/events/keyset?limit=1',
      fetchedAt: '2026-07-29T12:00:00.500Z',
      rawPayload: { events: [event.raw], next_cursor: 'cursor-page-2' },
    },
    normalizedEvents: [event],
    warnings: [],
    cumulativePages: 1,
    cumulativeEvents: 1,
  };
}

function buildEvent(market: NormalizedPolymarketMarket): NormalizedPolymarketEvent {
  const raw = {
    id: 'event-1',
    title: 'Will the integration test pass?',
    updatedAt: '2026-07-29T11:59:00.000Z',
    markets: [market.raw],
  };

  return {
    providerEventId: 'event-1',
    slug: 'integration-test-event',
    title: raw.title,
    description: 'Database acceptance fixture.',
    resolutionSource: 'Integration test only.',
    startsAt: '2026-07-29T11:00:00.000Z',
    endsAt: '2026-07-30T11:00:00.000Z',
    sourceUpdatedAt: raw.updatedAt,
    markets: [market],
    raw,
    warnings: [],
  };
}

function buildMarket(providerMarketId: string): NormalizedPolymarketMarket {
  const raw = {
    id: providerMarketId,
    question: 'Will the integration test pass?',
    conditionId: 'condition-1',
    description: 'Yes when the automated PostgreSQL test succeeds.',
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.60","0.40"]',
    clobTokenIds: '["token-yes","token-no"]',
    active: true,
    closed: false,
    acceptingOrders: true,
    updatedAt: '2026-07-29T11:59:00.000Z',
  };

  return {
    providerMarketId,
    providerConditionId: 'condition-1',
    providerEventId: 'event-1',
    kind: 'binary',
    status: 'open',
    title: raw.question,
    rules: raw.description,
    opensAt: '2026-07-29T11:00:00.000Z',
    closesAt: '2026-07-30T11:00:00.000Z',
    sourceUpdatedAt: raw.updatedAt,
    outcomes: [
      { providerOutcomeId: 'token-yes', label: 'Yes', sortOrder: 0, indicativePrice: 0.6 },
      { providerOutcomeId: 'token-no', label: 'No', sortOrder: 1, indicativePrice: 0.4 },
    ],
    clobTokenIds: ['token-yes', 'token-no'],
    bestBid: 0.59,
    bestAsk: 0.61,
    lastTradePrice: 0.6,
    flags: {
      active: true,
      closed: false,
      archived: false,
      restricted: false,
      acceptingOrders: true,
      enableOrderBook: true,
    },
    raw,
  };
}

async function readCoreCounts(database: Pool): Promise<{
  pages: number;
  providerEvents: number;
  providerMarkets: number;
  markets: number;
  outcomes: number;
  checkpoints: number;
}> {
  const result = await database.query<{
    pages: string;
    provider_events: string;
    provider_markets: string;
    markets: string;
    outcomes: string;
    checkpoints: string;
  }>(`SELECT
    (SELECT COUNT(*) FROM provider_sync_pages) AS pages,
    (SELECT COUNT(*) FROM provider_events) AS provider_events,
    (SELECT COUNT(*) FROM provider_markets) AS provider_markets,
    (SELECT COUNT(*) FROM markets) AS markets,
    (SELECT COUNT(*) FROM market_outcomes) AS outcomes,
    (SELECT COUNT(*) FROM provider_sync_checkpoints) AS checkpoints`);
  const row = result.rows[0];
  if (row === undefined) throw new Error('count query returned no row');

  return {
    pages: Number(row.pages),
    providerEvents: Number(row.provider_events),
    providerMarkets: Number(row.provider_markets),
    markets: Number(row.markets),
    outcomes: Number(row.outcomes),
    checkpoints: Number(row.checkpoints),
  };
}

function requirePool(): Pool {
  if (pool === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests');
  return pool;
}

function requireStore(): PostgresEventsKeysetSyncStore {
  if (store === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests');
  return store;
}
