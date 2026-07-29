import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { Pool } from 'pg';
import type { PolymarketMarketLifecycleSnapshot } from '@forecast/provider-polymarket';
import { integrationTestDatabaseUrl } from './integration-test-environment.js';
import { PostgresProviderOperationsStore } from './postgres-provider-operations-store.js';

const databaseUrl = integrationTestDatabaseUrl();
const integrationTest = databaseUrl === undefined ? test.skip : test;
let pool: Pool | undefined;
let store: PostgresProviderOperationsStore | undefined;

before(async () => {
  if (databaseUrl === undefined) return;
  pool = new Pool({ connectionString: databaseUrl, max: 2 });
  store = new PostgresProviderOperationsStore(pool, 3);
  await pool.query('SELECT 1');
});

after(async () => {
  await pool?.end();
});

beforeEach(async () => {
  if (pool === undefined) return;
  await pool.query(`TRUNCATE TABLE
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
});

integrationTest(
  'persists lifecycle evidence idempotently and creates a review candidate without settling',
  async () => {
    const database = requirePool();
    const operations = requireStore();
    const identity = await seedMarket(database, {
      status: 'open',
      closesAt: '2026-07-29T11:00:00.000Z',
    });

    const candidates = await operations.loadLifecycleCheckCandidates(
      new Date('2026-07-29T13:00:00.000Z'),
      new Date('2026-07-29T11:45:00.000Z'),
      100,
    );
    assert.deepEqual(candidates, [
      { marketId: identity.marketId, providerMarketId: 'provider-market-1' },
    ]);

    const snapshot = lifecycleFixture(true);
    const first = await operations.applyLifecycleObservation(
      snapshot,
      new Date('2026-07-29T12:00:00.000Z'),
    );
    const duplicate = await operations.applyLifecycleObservation(
      snapshot,
      new Date('2026-07-29T12:01:00.000Z'),
    );

    assert.equal(first.status, 'inserted');
    assert.equal(first.localStatus, 'closed');
    assert.equal(first.resolutionCandidateCreated, true);
    assert.equal(duplicate.status, 'duplicate');
    assert.deepEqual(
      await operations.loadLifecycleCheckCandidates(
        new Date('2026-07-29T13:00:00.000Z'),
        new Date('2026-07-29T11:59:59.000Z'),
        100,
      ),
      [],
    );

    const market = await database.query<{ status: string; resolved_at: Date | null }>(
      'SELECT status, resolved_at FROM markets WHERE id = $1',
      [identity.marketId],
    );
    assert.deepEqual(market.rows[0], { status: 'closed', resolved_at: null });

    const evidence = await database.query<{
      observations: number;
      candidates: number;
      winner_id: string | null;
      outcome_marked_winner: boolean | null;
      candidate_status: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM market_lifecycle_observations) AS observations,
         (SELECT COUNT(*)::int FROM market_resolution_candidates) AS candidates,
         mrc.winning_outcome_id AS winner_id,
         mo.is_winning_outcome AS outcome_marked_winner,
         mrc.status AS candidate_status
       FROM market_resolution_candidates mrc
       LEFT JOIN market_outcomes mo ON mo.id = mrc.winning_outcome_id`,
    );
    assert.deepEqual(evidence.rows[0], {
      observations: 1,
      candidates: 1,
      winner_id: identity.yesOutcomeId,
      outcome_marked_winner: null,
      candidate_status: 'pending_review',
    });
  },
);

integrationTest('opens an alert after repeated failures and resolves it on recovery', async () => {
  const database = requirePool();
  const operations = requireStore();
  const at = new Date('2026-07-29T12:00:00.000Z');

  assert.equal(await operations.recordComponentFailure('catalog_sync', at, 'one'), 1);
  assert.equal(await operations.recordComponentFailure('catalog_sync', at, 'two'), 2);
  assert.equal(await operations.recordComponentFailure('catalog_sync', at, 'three'), 3);

  const degraded = await database.query<{
    status: string;
    consecutive_failures: number;
    alert_status: string;
  }>(
    `SELECT prs.status, prs.consecutive_failures, pa.status AS alert_status
     FROM provider_runtime_states prs
     JOIN provider_alerts pa
       ON pa.provider = prs.provider AND pa.dedup_key = 'catalog_sync:consecutive_failures'
     WHERE prs.provider = 'polymarket' AND prs.component = 'catalog_sync'`,
  );
  assert.deepEqual(degraded.rows[0], {
    status: 'degraded',
    consecutive_failures: 3,
    alert_status: 'open',
  });

  await operations.recordComponentSuccess('catalog_sync', at, { pages: 2 });
  const recovered = await database.query<{
    status: string;
    consecutive_failures: number;
    alert_status: string;
  }>(
    `SELECT prs.status, prs.consecutive_failures, pa.status AS alert_status
     FROM provider_runtime_states prs
     JOIN provider_alerts pa
       ON pa.provider = prs.provider AND pa.dedup_key = 'catalog_sync:consecutive_failures'
     WHERE prs.provider = 'polymarket' AND prs.component = 'catalog_sync'`,
  );
  assert.deepEqual(recovered.rows[0], {
    status: 'healthy',
    consecutive_failures: 0,
    alert_status: 'resolved',
  });

  await operations.recordCatalogSyncResult(at, { warningCount: 2 }, 1);
  await operations.recordCatalogSyncResult(at, { warningCount: 0 }, 1);
  const warning = await database.query<{ status: string }>(
    `SELECT status
     FROM provider_alerts
     WHERE provider = 'polymarket' AND dedup_key = 'catalog_sync:parse_warnings'`,
  );
  assert.equal(warning.rows[0]?.status, 'resolved');
});

integrationTest('opens and resolves prolonged WebSocket disconnect alerts', async () => {
  const database = requirePool();
  const operations = requireStore();
  const metrics = {
    connectionAttempts: 4,
    connectionsOpened: 2,
    reconnectsScheduled: 3,
    messagesReceived: 20,
    parseWarnings: 0,
    lastConnectedAt: '2026-07-29T11:50:00.000Z',
    lastDisconnectedAt: '2026-07-29T11:55:00.000Z',
    lastMessageAt: '2026-07-29T11:54:59.000Z',
    lastPongAt: '2026-07-29T11:54:58.000Z',
  };
  const at = new Date('2026-07-29T12:00:00.000Z');

  await operations.recordWebSocketHealth('waiting_to_reconnect', metrics, 0, 180_000, 120_000, at);
  await operations.recordWebSocketHealth('open', metrics, 0, 0, 120_000, at);

  const result = await database.query<{ runtime_status: string; alert_status: string }>(
    `SELECT prs.status AS runtime_status, pa.status AS alert_status
     FROM provider_runtime_states prs
     JOIN provider_alerts pa
       ON pa.provider = prs.provider
      AND pa.dedup_key = 'market_websocket:prolonged_disconnect'
     WHERE prs.provider = 'polymarket' AND prs.component = 'market_websocket'`,
  );
  assert.deepEqual(result.rows[0], {
    runtime_status: 'healthy',
    alert_status: 'resolved',
  });
});

integrationTest(
  'marks missing or stale open-market prices degraded and recovers when fresh',
  async () => {
    const database = requirePool();
    const operations = requireStore();
    const identity = await seedMarket(database, {
      status: 'open',
      closesAt: '2026-08-01T12:00:00.000Z',
    });
    const at = new Date('2026-07-29T12:00:00.000Z');

    const missing = await operations.evaluatePriceFreshness(
      new Date('2026-07-29T11:55:00.000Z'),
      at,
    );
    assert.equal(missing.missingPrices, 2);

    for (const [outcomeId, suffix] of [
      [identity.yesOutcomeId, 'yes'],
      [identity.noOutcomeId, 'no'],
    ] as const) {
      const snapshot = await database.query<{ id: string }>(
        `INSERT INTO market_price_snapshots (
         market_id, outcome_id, bid, ask, midpoint, source, source_event_key,
         captured_at, observed_at
       ) VALUES ($1, $2, 0.4, 0.6, 0.5, 'clob_rest', $3, $4, $4)
       RETURNING id`,
        [identity.marketId, outcomeId, `fresh-${suffix}`, at],
      );
      await database.query(
        `INSERT INTO market_current_prices (
         outcome_id, market_id, bid, ask, midpoint, bid_captured_at, ask_captured_at,
         midpoint_captured_at, latest_source, latest_source_at, latest_snapshot_id
       ) VALUES ($1, $2, 0.4, 0.6, 0.5, $3, $3, $3, 'clob_rest', $3, $4)`,
        [outcomeId, identity.marketId, at, snapshot.rows[0]?.id],
      );
    }

    const fresh = await operations.evaluatePriceFreshness(new Date('2026-07-29T11:55:00.000Z'), at);
    assert.equal(fresh.missingPrices, 0);
    assert.equal(fresh.stalePrices, 0);
    const state = await database.query<{ status: string; alert_status: string }>(
      `SELECT prs.status, pa.status AS alert_status
     FROM provider_runtime_states prs
     JOIN provider_alerts pa
       ON pa.provider = prs.provider AND pa.dedup_key = 'market_data:stale_prices'
     WHERE prs.provider = 'polymarket' AND prs.component = 'market_data'`,
    );
    assert.deepEqual(state.rows[0], { status: 'healthy', alert_status: 'resolved' });
  },
);

async function seedMarket(
  database: Pool,
  input: { status: string; closesAt: string },
): Promise<{ marketId: string; yesOutcomeId: string; noOutcomeId: string }> {
  const event = await database.query<{ id: string }>(
    `INSERT INTO provider_events (provider, provider_event_id, raw_payload)
     VALUES ('polymarket', 'provider-event-1', '{}')
     RETURNING id`,
  );
  const providerMarket = await database.query<{ id: string }>(
    `INSERT INTO provider_markets (
       provider_event_id, provider, provider_market_id, raw_payload, imported_at
     ) VALUES ($1, 'polymarket', 'provider-market-1', '{}', '2026-07-28T10:00:00.000Z')
     RETURNING id`,
    [event.rows[0]?.id],
  );
  const market = await database.query<{ id: string }>(
    `INSERT INTO markets (
       provider_market_id, kind, status, original_title, title, closes_at
     ) VALUES ($1, 'binary', $2, 'Question?', 'Question?', $3)
     RETURNING id`,
    [providerMarket.rows[0]?.id, input.status, input.closesAt],
  );
  const outcomes = await database.query<{ id: string; sort_order: number }>(
    `INSERT INTO market_outcomes (market_id, provider_outcome_id, label, sort_order)
     VALUES
       ($1, 'token-yes', 'Yes', 0),
       ($1, 'token-no', 'No', 1)
     RETURNING id, sort_order`,
    [market.rows[0]?.id],
  );
  const yes = outcomes.rows.find((row) => row.sort_order === 0);
  const no = outcomes.rows.find((row) => row.sort_order === 1);
  if (market.rows[0] === undefined || yes === undefined || no === undefined) {
    throw new Error('failed to seed lifecycle test market');
  }
  return {
    marketId: market.rows[0].id,
    yesOutcomeId: yes.id,
    noOutcomeId: no.id,
  };
}

function lifecycleFixture(closed: boolean): PolymarketMarketLifecycleSnapshot {
  return {
    providerMarketId: 'provider-market-1',
    question: 'Question?',
    active: !closed,
    closed,
    archived: false,
    acceptingOrders: !closed,
    closedAt: closed ? '2026-07-29T11:59:00.000Z' : null,
    sourceUpdatedAt: '2026-07-29T12:00:00.000Z',
    providerResolutionStatus: closed ? 'resolved' : null,
    outcomes: [
      { label: 'Yes', price: closed ? '1' : '0.5', tokenId: 'token-yes' },
      { label: 'No', price: closed ? '0' : '0.5', tokenId: 'token-no' },
    ],
    winningTokenId: closed ? 'token-yes' : null,
    raw: {
      id: 'provider-market-1',
      question: 'Question?',
      outcomes: '["Yes","No"]',
      outcomePrices: closed ? '["1","0"]' : '["0.5","0.5"]',
      clobTokenIds: '["token-yes","token-no"]',
      closed,
      updatedAt: '2026-07-29T12:00:00.000Z',
    },
  };
}

function requirePool(): Pool {
  if (pool === undefined) throw new Error('integration pool unavailable');
  return pool;
}

function requireStore(): PostgresProviderOperationsStore {
  if (store === undefined) throw new Error('operations store unavailable');
  return store;
}
