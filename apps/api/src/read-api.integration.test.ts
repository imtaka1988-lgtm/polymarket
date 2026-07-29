import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { createApiApplication } from './application';

const databaseUrl = integrationTestDatabaseUrl();
const integrationTest = databaseUrl === undefined ? test.skip : test;
let pool: Pool | undefined;
let app: INestApplication | undefined;
let baseUrl = '';
let newestMarketId = '';

before(async () => {
  if (databaseUrl === undefined) return;
  process.env.DATABASE_URL = databaseUrl;
  pool = new Pool({ connectionString: databaseUrl, max: 2 });
  await resetDatabase(pool);
  const older = await seedMarket(pool, {
    suffix: 'api-older',
    title: 'Older visible market',
    status: 'closed',
    updatedAt: '2026-07-29T12:00:00.000Z',
    withPrice: false,
  });
  const newer = await seedMarket(pool, {
    suffix: 'api-newer',
    title: 'Newest visible market',
    status: 'open',
    updatedAt: '2026-07-29T13:00:00.000Z',
    withPrice: true,
  });
  newestMarketId = newer;
  await seedMarket(pool, {
    suffix: 'api-draft',
    title: 'Draft must stay private',
    status: 'draft',
    updatedAt: '2026-07-29T14:00:00.000Z',
    withPrice: false,
  });
  assert.notEqual(older, newer);
  await seedHealthyRuntimeState(pool);

  app = await createApiApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
  await pool?.end();
});

integrationTest(
  'serves stable market pagination, detail, prices, errors, and data status',
  async () => {
    const legacyHealthResponse = await fetch(`${baseUrl}/api/v1/health`);
    const legacyHealth = await readJson<HealthResponse>(legacyHealthResponse);
    assert.equal(legacyHealthResponse.status, 200);
    assert.equal(legacyHealth.status, 'ok');

    const livenessResponse = await fetch(`${baseUrl}/api/v1/health/live`);
    const liveness = await readJson<HealthResponse>(livenessResponse);
    assert.equal(livenessResponse.status, 200);
    assert.equal(liveness.status, 'ok');

    const readinessResponse = await fetch(`${baseUrl}/api/v1/health/ready`);
    const readiness = await readJson<HealthResponse>(readinessResponse);
    assert.equal(readinessResponse.status, 200);
    assert.equal(readiness.status, 'ready');

    const firstResponse = await fetch(`${baseUrl}/api/v1/markets?status=all&limit=1`, {
      headers: { 'x-request-id': 'api-contract-test' },
    });
    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.headers.get('x-request-id'), 'api-contract-test');
    const first = await readJson<MarketListResponse>(firstResponse);
    assert.equal(first.data.length, 1);
    assert.equal(first.data[0]?.id, newestMarketId);
    assert.equal(first.data[0]?.outcomes[0]?.price?.midpoint, '0.5000000000');
    assert.equal(first.pagination.hasNextPage, true);
    assert.equal(first.meta.apiVersion, 'v1');
    assert.equal(first.meta.requestId, 'api-contract-test');

    const secondResponse = await fetch(
      `${baseUrl}/api/v1/markets?status=all&limit=1&cursor=${encodeURIComponent(
        first.pagination.nextCursor ?? '',
      )}`,
    );
    const second = await readJson<MarketListResponse>(secondResponse);
    assert.equal(second.data.length, 1);
    assert.equal(second.data[0]?.title, 'Older visible market');
    assert.equal(second.pagination.hasNextPage, false);
    assert.equal(second.pagination.nextCursor, null);

    const detailResponse = await fetch(`${baseUrl}/api/v1/markets/${newestMarketId}`);
    const detail = await readJson<MarketDetailResponse>(detailResponse);
    assert.equal(detailResponse.status, 200);
    assert.equal(detail.data.provider.marketId, 'provider-api-newer');
    assert.equal(detail.data.rules, 'Rules for api-newer');
    assert.equal(detail.data.schemaVersion, 1);

    const pricesResponse = await fetch(`${baseUrl}/api/v1/markets/${newestMarketId}/prices`);
    const prices = await readJson<PriceResponse>(pricesResponse);
    assert.equal(pricesResponse.status, 200);
    assert.equal(prices.data.marketId, newestMarketId);
    assert.equal(prices.data.outcomes[0]?.price?.latestSource, 'clob_rest');
    assert.equal(prices.data.asOf, '2026-07-29T12:59:00.000Z');

    const invalidResponse = await fetch(`${baseUrl}/api/v1/markets?cursor=invalid`);
    const invalid = await readJson<ErrorResponse>(invalidResponse);
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalid.error.code, 'INVALID_CURSOR');
    assert.equal(invalid.meta.requestId, invalidResponse.headers.get('x-request-id'));

    const missingResponse = await fetch(
      `${baseUrl}/api/v1/markets/99999999-9999-4999-8999-999999999999`,
    );
    const missing = await readJson<ErrorResponse>(missingResponse);
    assert.equal(missingResponse.status, 404);
    assert.equal(missing.error.code, 'MARKET_NOT_FOUND');

    const healthyResponse = await fetch(`${baseUrl}/api/v1/platform/data-status`);
    const healthy = await readJson<DataStatusResponse>(healthyResponse);
    assert.equal(healthy.data.status, 'healthy');
    assert.equal(healthy.data.readOnly, false);
    assert.equal(healthy.data.components.length, 2);
    assert.deepEqual(healthy.data.openAlerts, []);

    await degradeMarketData(requirePool());
    const degradedResponse = await fetch(`${baseUrl}/api/v1/platform/data-status`);
    const degraded = await readJson<DataStatusResponse>(degradedResponse);
    assert.equal(degraded.data.status, 'degraded');
    assert.equal(degraded.data.readOnly, true);
    assert.deepEqual(
      degraded.data.openAlerts.map((alert) => alert.code),
      ['stale_prices'],
    );
    assert.equal('message' in degraded.data.openAlerts[0]!, false);
    assert.equal('details' in degraded.data.openAlerts[0]!, false);

    await requirePool().query(
      `DELETE FROM provider_alerts;
       DELETE FROM provider_runtime_states`,
    );
    const unavailableResponse = await fetch(`${baseUrl}/api/v1/platform/data-status`);
    const unavailable = await readJson<DataStatusResponse>(unavailableResponse);
    assert.equal(unavailable.data.status, 'unavailable');
    assert.equal(unavailable.data.readOnly, true);
  },
);

integrationTest('uses the public feed index for large keyset pagination', async () => {
  const database = requirePool();
  await database.query(
    `INSERT INTO markets (
       kind, status, source_type, original_title, title, updated_at
     )
     SELECT
       'binary',
       'open',
       'provider',
       'Performance market ' || series,
       'Performance market ' || series,
       TIMESTAMPTZ '2026-07-01T00:00:00.000Z' + series * INTERVAL '1 millisecond'
     FROM generate_series(1, 20000) AS series`,
  );
  await database.query('ANALYZE markets');

  const plan = await database.query<{ 'QUERY PLAN': unknown }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
     SELECT id, updated_at
     FROM markets
     WHERE status = ANY($1::market_status[])
     ORDER BY updated_at DESC NULLS LAST, id DESC NULLS LAST
     LIMIT $2`,
    [['open'], 101],
  );
  assert.match(JSON.stringify(plan.rows[0]?.['QUERY PLAN']), /markets_public_feed_idx/);

  const firstResponse = await fetch(`${baseUrl}/api/v1/markets?status=open&limit=100`);
  const first = await readJson<MarketListResponse>(firstResponse);
  assert.equal(firstResponse.status, 200);
  assert.equal(first.data.length, 100);
  assert.equal(first.pagination.hasNextPage, true);
  assert.notEqual(first.pagination.nextCursor, null);

  const secondResponse = await fetch(
    `${baseUrl}/api/v1/markets?status=open&limit=100&cursor=${encodeURIComponent(
      first.pagination.nextCursor ?? '',
    )}`,
  );
  const second = await readJson<MarketListResponse>(secondResponse);
  assert.equal(secondResponse.status, 200);
  assert.equal(second.data.length, 100);
  assert.equal(second.pagination.hasNextPage, true);

  const firstIds = new Set(first.data.map((market) => market.id));
  assert.equal(
    second.data.some((market) => firstIds.has(market.id)),
    false,
  );
  const combined = [...first.data, ...second.data];
  assert.deepEqual(
    combined.map((market) => market.updatedAt),
    combined
      .map((market) => market.updatedAt)
      .toSorted()
      .reverse(),
  );
});

async function resetDatabase(database: Pool): Promise<void> {
  await database.query(`TRUNCATE TABLE
    provider_alerts,
    provider_runtime_states,
    market_resolution_candidates,
    market_lifecycle_observations,
    market_current_prices,
    market_price_snapshots,
    market_outcomes,
    markets,
    provider_markets,
    provider_events
    RESTART IDENTITY CASCADE`);
}

async function seedMarket(
  database: Pool,
  input: {
    suffix: string;
    title: string;
    status: 'open' | 'closed' | 'draft';
    updatedAt: string;
    withPrice: boolean;
  },
): Promise<string> {
  const event = await database.query<{ id: string }>(
    `INSERT INTO provider_events (provider, provider_event_id, raw_payload)
     VALUES ('polymarket', $1, '{}')
     RETURNING id`,
    [`event-${input.suffix}`],
  );
  const providerMarket = await database.query<{ id: string }>(
    `INSERT INTO provider_markets (
       provider_event_id, provider, provider_market_id, provider_condition_id, raw_payload
     ) VALUES ($1, 'polymarket', $2, $3, '{}')
     RETURNING id`,
    [event.rows[0]?.id, `provider-${input.suffix}`, `condition-${input.suffix}`],
  );
  const market = await database.query<{ id: string }>(
    `INSERT INTO markets (
       provider_market_id, kind, status, source_type, original_title, title,
       original_rules, updated_at
     ) VALUES ($1, 'binary', $2, 'provider', $3, $3, $4, $5)
     RETURNING id`,
    [
      providerMarket.rows[0]?.id,
      input.status,
      input.title,
      `Rules for ${input.suffix}`,
      input.updatedAt,
    ],
  );
  const marketId = requireValue(market.rows[0]?.id, 'market id');
  const outcomes = await database.query<{ id: string; sort_order: number }>(
    `INSERT INTO market_outcomes (market_id, provider_outcome_id, label, sort_order)
     VALUES
       ($1, $2, 'Yes', 0),
       ($1, $3, 'No', 1)
     RETURNING id, sort_order`,
    [marketId, `token-${input.suffix}-yes`, `token-${input.suffix}-no`],
  );

  if (input.withPrice) {
    const yesOutcome = requireValue(
      outcomes.rows.find((row) => row.sort_order === 0)?.id,
      'yes outcome id',
    );
    const snapshot = await database.query<{ id: string }>(
      `INSERT INTO market_price_snapshots (
         market_id, outcome_id, bid, ask, midpoint, last_trade, source,
         source_event_key, captured_at, observed_at
       ) VALUES ($1, $2, '0.4', '0.6', '0.5', '0.51', 'clob_rest', $3, $4, $4)
       RETURNING id`,
      [marketId, yesOutcome, `api:${input.suffix}`, '2026-07-29T12:59:00.000Z'],
    );
    await database.query(
      `INSERT INTO market_current_prices (
         outcome_id, market_id, bid, ask, midpoint, last_trade,
         bid_captured_at, ask_captured_at, midpoint_captured_at, last_trade_captured_at,
         latest_source, latest_source_at, latest_snapshot_id
       ) VALUES ($1, $2, '0.4', '0.6', '0.5', '0.51', $3, $3, $3, $3, 'clob_rest', $3, $4)`,
      [yesOutcome, marketId, '2026-07-29T12:59:00.000Z', snapshot.rows[0]?.id],
    );
  }
  return marketId;
}

async function seedHealthyRuntimeState(database: Pool): Promise<void> {
  await database.query(
    `INSERT INTO provider_runtime_states (
       provider, component, status, consecutive_failures, last_attempt_at,
       last_succeeded_at, details, updated_at
     ) VALUES
       ('polymarket', 'catalog_sync', 'healthy', 0, $1, $1, '{}', $1),
       ('polymarket', 'market_data', 'healthy', 0, $1, $1, '{}', $1)`,
    ['2026-07-29T13:05:00.000Z'],
  );
}

async function degradeMarketData(database: Pool): Promise<void> {
  await database.query(
    `UPDATE provider_runtime_states
     SET status = 'degraded', updated_at = $1
     WHERE provider = 'polymarket' AND component = 'market_data'`,
    ['2026-07-29T13:06:00.000Z'],
  );
  await database.query(
    `INSERT INTO provider_alerts (
       provider, component, alert_code, severity, status, dedup_key, message,
       details, first_seen_at, last_seen_at
     ) VALUES (
       'polymarket', 'market_data', 'stale_prices', 'warning', 'open',
       'market_data:stale_prices', 'internal message must not be public',
       '{"private":"value"}', $1, $1
     )`,
    ['2026-07-29T13:06:00.000Z'],
  );
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function requirePool(): Pool {
  if (pool === undefined) throw new Error('test pool was not initialized');
  return pool;
}

function requireValue(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} was not returned`);
  return value;
}

interface MarketListResponse {
  data: Array<{
    id: string;
    title: string;
    updatedAt: string;
    outcomes: Array<{ price: { midpoint: string } | null }>;
  }>;
  pagination: {
    hasNextPage: boolean;
    nextCursor: string | null;
  };
  meta: { apiVersion: string; requestId: string };
}

interface HealthResponse {
  status: string;
}

interface MarketDetailResponse {
  data: {
    provider: { marketId: string };
    rules: string;
    schemaVersion: number;
  };
}

interface PriceResponse {
  data: {
    marketId: string;
    asOf: string | null;
    outcomes: Array<{ price: { latestSource: string } | null }>;
  };
}

interface ErrorResponse {
  error: { code: string };
  meta: { requestId: string };
}

interface DataStatusResponse {
  data: {
    status: string;
    readOnly: boolean;
    components: unknown[];
    openAlerts: Array<{ code: string }>;
  };
}

function integrationTestDatabaseUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL;
  if (process.env.REQUIRE_TEST_DATABASE === 'true' && value === undefined) {
    throw new Error('TEST_DATABASE_URL is required when REQUIRE_TEST_DATABASE=true');
  }
  return value;
}
