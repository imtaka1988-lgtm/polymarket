import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { Pool } from 'pg';
import { integrationTestDatabaseUrl } from './integration-test-environment.js';
import { PostgresMarketPriceStore, type MarketPriceUpdate } from './postgres-market-price-store.js';

const databaseUrl = integrationTestDatabaseUrl();
const integrationTest = databaseUrl === undefined ? test.skip : test;
let pool: Pool | undefined;
let store: PostgresMarketPriceStore | undefined;

before(async () => {
  if (databaseUrl === undefined) return;
  pool = new Pool({ connectionString: databaseUrl, max: 2 });
  store = new PostgresMarketPriceStore(pool);
  await pool.query('SELECT 1');
});

after(async () => {
  await pool?.end();
});

beforeEach(async () => {
  if (pool === undefined) return;
  await pool.query(`TRUNCATE TABLE
    market_current_prices,
    market_price_snapshots,
    market_outcomes,
    markets,
    provider_markets,
    provider_events
    RESTART IDENTITY CASCADE`);
  await seedMarket(pool, 'open-market', 'open');
  await seedMarket(pool, 'closed-market', 'closed');
});

integrationTest('loads only open Polymarket outcomes as subscription tokens', async () => {
  const tokens = await requireStore().loadSubscribableTokens();
  assert.deepEqual(
    tokens.map((token) => token.tokenId),
    ['token-open-market-no', 'token-open-market-yes'],
  );
});

integrationTest(
  'persists snapshots idempotently and prevents old events from regressing current fields',
  async () => {
    const database = requirePool();
    const priceStore = requireStore();
    const initial = update({
      sourceEventKey: 'rest:initial',
      capturedAt: '2026-07-29T12:00:00.000Z',
      bid: '0.40',
      ask: '0.60',
      midpoint: '0.50',
      lastTrade: '0.49',
    });

    assert.equal((await priceStore.persistPriceUpdate(initial)).status, 'inserted');
    assert.equal((await priceStore.persistPriceUpdate(initial)).status, 'duplicate');
    assert.equal(
      (
        await priceStore.persistPriceUpdate(
          update({
            source: 'clob_websocket',
            sourceEventKey: 'ws:new-trade',
            capturedAt: '2026-07-29T12:01:00.000Z',
            bid: null,
            ask: null,
            midpoint: null,
            lastTrade: '0.51',
          }),
        )
      ).status,
      'inserted',
    );
    assert.equal(
      (
        await priceStore.persistPriceUpdate(
          update({
            source: 'clob_websocket',
            sourceEventKey: 'ws:old-book',
            capturedAt: '2026-07-29T11:59:00.000Z',
            bid: '0.30',
            ask: '0.70',
            midpoint: '0.50',
            lastTrade: null,
          }),
        )
      ).status,
      'inserted',
    );

    const current = await database.query<{
      bid: string | null;
      ask: string | null;
      last_trade: string | null;
      bid_captured_at: Date | null;
      last_trade_captured_at: Date | null;
      latest_source_at: Date;
    }>(
      `SELECT bid, ask, last_trade, bid_captured_at, last_trade_captured_at, latest_source_at
     FROM market_current_prices`,
    );
    assert.deepEqual(current.rows[0], {
      bid: '0.4000000000',
      ask: '0.6000000000',
      last_trade: '0.5100000000',
      bid_captured_at: new Date('2026-07-29T12:00:00.000Z'),
      last_trade_captured_at: new Date('2026-07-29T12:01:00.000Z'),
      latest_source_at: new Date('2026-07-29T12:01:00.000Z'),
    });

    const snapshots = await database.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM market_price_snapshots',
    );
    assert.equal(Number(snapshots.rows[0]?.count), 3);
  },
);

integrationTest('does not create orphan snapshots for an unknown token', async () => {
  const result = await requireStore().persistPriceUpdate({
    ...update({ sourceEventKey: 'rest:unknown' }),
    tokenId: 'unknown-token',
  });
  assert.deepEqual(result, { status: 'unmatched_token', snapshotId: null });
  const snapshots = await requirePool().query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM market_price_snapshots',
  );
  assert.equal(Number(snapshots.rows[0]?.count), 0);
});

function update(overrides: Partial<MarketPriceUpdate> = {}): MarketPriceUpdate {
  return {
    tokenId: 'token-open-market-yes',
    source: 'clob_rest',
    sourceEventKey: 'rest:default',
    sourceHash: 'hash',
    metadata: {},
    capturedAt: '2026-07-29T12:00:00.000Z',
    observedAt: '2026-07-29T12:00:01.000Z',
    bid: '0.40',
    ask: '0.60',
    midpoint: '0.50',
    lastTrade: '0.49',
    ...overrides,
  };
}

async function seedMarket(
  database: Pool,
  suffix: string,
  status: 'open' | 'closed',
): Promise<void> {
  const event = await database.query<{ id: string }>(
    `INSERT INTO provider_events (provider, provider_event_id, raw_payload)
     VALUES ('polymarket', $1, '{}')
     RETURNING id`,
    [`event-${suffix}`],
  );
  const providerMarket = await database.query<{ id: string }>(
    `INSERT INTO provider_markets (
       provider_event_id, provider, provider_market_id, provider_condition_id, raw_payload
     ) VALUES ($1, 'polymarket', $2, $3, '{}')
     RETURNING id`,
    [event.rows[0]?.id, `provider-${suffix}`, `condition-${suffix}`],
  );
  const market = await database.query<{ id: string }>(
    `INSERT INTO markets (
       provider_market_id, kind, status, source_type, original_title, title
     ) VALUES ($1, 'binary', $2, 'provider', $3, $3)
     RETURNING id`,
    [providerMarket.rows[0]?.id, status, `Market ${suffix}`],
  );
  await database.query(
    `INSERT INTO market_outcomes (market_id, provider_outcome_id, label, sort_order)
     VALUES
       ($1, $2, 'Yes', 0),
       ($1, $3, 'No', 1)`,
    [market.rows[0]?.id, `token-${suffix}-yes`, `token-${suffix}-no`],
  );
}

function requirePool(): Pool {
  if (pool === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests');
  return pool;
}

function requireStore(): PostgresMarketPriceStore {
  if (store === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests');
  return store;
}
