import type { Pool, PoolClient } from 'pg';

export interface SubscribableMarketToken {
  marketId: string;
  outcomeId: string;
  tokenId: string;
}

export interface MarketPriceUpdate {
  tokenId: string;
  source: 'clob_rest' | 'clob_websocket';
  sourceEventKey: string;
  sourceHash: string | null;
  metadata: Record<string, unknown>;
  capturedAt: string;
  observedAt: string;
  bid: string | null;
  ask: string | null;
  midpoint: string | null;
  lastTrade: string | null;
}

export interface PersistPriceUpdateResult {
  status: 'inserted' | 'duplicate' | 'unmatched_token';
  snapshotId: string | null;
}

export class PostgresMarketPriceStore {
  constructor(private readonly pool: Pool) {}

  async loadSubscribableTokens(): Promise<SubscribableMarketToken[]> {
    const result = await this.pool.query<{
      market_id: string;
      outcome_id: string;
      token_id: string;
    }>(
      `SELECT m.id AS market_id, mo.id AS outcome_id, mo.provider_outcome_id AS token_id
       FROM markets m
       JOIN market_outcomes mo ON mo.market_id = m.id
       JOIN provider_markets pm ON pm.id = m.provider_market_id
       WHERE pm.provider = 'polymarket'
         AND m.status = 'open'
         AND mo.provider_outcome_id IS NOT NULL
         AND BTRIM(mo.provider_outcome_id) <> ''
       ORDER BY mo.provider_outcome_id`,
    );
    return result.rows.map((row) => ({
      marketId: row.market_id,
      outcomeId: row.outcome_id,
      tokenId: row.token_id,
    }));
  }

  async persistPriceUpdate(input: MarketPriceUpdate): Promise<PersistPriceUpdateResult> {
    validatePriceUpdate(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await findOutcomeIdentity(client, input.tokenId);
      if (identity === null) {
        await client.query('ROLLBACK');
        return { status: 'unmatched_token', snapshotId: null };
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO market_price_snapshots (
           market_id, outcome_id, bid, ask, midpoint, last_trade, source,
           source_event_key, source_hash, metadata, captured_at, observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (source_event_key) DO NOTHING
         RETURNING id`,
        [
          identity.marketId,
          identity.outcomeId,
          input.bid,
          input.ask,
          input.midpoint,
          input.lastTrade,
          input.source,
          input.sourceEventKey,
          input.sourceHash,
          input.metadata,
          input.capturedAt,
          input.observedAt,
        ],
      );
      const snapshotId = inserted.rows[0]?.id;
      if (snapshotId === undefined) {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM market_price_snapshots WHERE source_event_key = $1',
          [input.sourceEventKey],
        );
        await client.query('COMMIT');
        return { status: 'duplicate', snapshotId: existing.rows[0]?.id ?? null };
      }

      await upsertCurrentPrice(client, identity, snapshotId, input);
      await client.query('COMMIT');
      return { status: 'inserted', snapshotId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function findOutcomeIdentity(
  client: PoolClient,
  tokenId: string,
): Promise<{ marketId: string; outcomeId: string } | null> {
  const result = await client.query<{ market_id: string; outcome_id: string }>(
    `SELECT mo.market_id, mo.id AS outcome_id
     FROM market_outcomes mo
     JOIN markets m ON m.id = mo.market_id
     JOIN provider_markets pm ON pm.id = m.provider_market_id
     WHERE pm.provider = 'polymarket'
       AND mo.provider_outcome_id = $1
     LIMIT 2`,
    [tokenId],
  );
  if (result.rows.length > 1) {
    throw new Error(`Polymarket token ${tokenId} matched more than one local outcome`);
  }
  const row = result.rows[0];
  return row === undefined ? null : { marketId: row.market_id, outcomeId: row.outcome_id };
}

async function upsertCurrentPrice(
  client: PoolClient,
  identity: { marketId: string; outcomeId: string },
  snapshotId: string,
  input: MarketPriceUpdate,
): Promise<void> {
  await client.query(
    `INSERT INTO market_current_prices (
       outcome_id, market_id, bid, ask, midpoint, last_trade,
       bid_captured_at, ask_captured_at, midpoint_captured_at, last_trade_captured_at,
       latest_source, latest_source_at, latest_snapshot_id, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       CASE WHEN $3::numeric IS NULL THEN NULL ELSE $7::timestamptz END,
       CASE WHEN $4::numeric IS NULL THEN NULL ELSE $7::timestamptz END,
       CASE WHEN $5::numeric IS NULL THEN NULL ELSE $7::timestamptz END,
       CASE WHEN $6::numeric IS NULL THEN NULL ELSE $7::timestamptz END,
       $8, $7, $9, NOW()
     )
     ON CONFLICT (outcome_id) DO UPDATE SET
       market_id = EXCLUDED.market_id,
       bid = CASE
         WHEN EXCLUDED.bid IS NOT NULL
          AND (market_current_prices.bid_captured_at IS NULL
            OR EXCLUDED.bid_captured_at >= market_current_prices.bid_captured_at)
         THEN EXCLUDED.bid ELSE market_current_prices.bid END,
       bid_captured_at = CASE
         WHEN EXCLUDED.bid IS NOT NULL
          AND (market_current_prices.bid_captured_at IS NULL
            OR EXCLUDED.bid_captured_at >= market_current_prices.bid_captured_at)
         THEN EXCLUDED.bid_captured_at ELSE market_current_prices.bid_captured_at END,
       ask = CASE
         WHEN EXCLUDED.ask IS NOT NULL
          AND (market_current_prices.ask_captured_at IS NULL
            OR EXCLUDED.ask_captured_at >= market_current_prices.ask_captured_at)
         THEN EXCLUDED.ask ELSE market_current_prices.ask END,
       ask_captured_at = CASE
         WHEN EXCLUDED.ask IS NOT NULL
          AND (market_current_prices.ask_captured_at IS NULL
            OR EXCLUDED.ask_captured_at >= market_current_prices.ask_captured_at)
         THEN EXCLUDED.ask_captured_at ELSE market_current_prices.ask_captured_at END,
       midpoint = CASE
         WHEN EXCLUDED.midpoint IS NOT NULL
          AND (market_current_prices.midpoint_captured_at IS NULL
            OR EXCLUDED.midpoint_captured_at >= market_current_prices.midpoint_captured_at)
         THEN EXCLUDED.midpoint ELSE market_current_prices.midpoint END,
       midpoint_captured_at = CASE
         WHEN EXCLUDED.midpoint IS NOT NULL
          AND (market_current_prices.midpoint_captured_at IS NULL
            OR EXCLUDED.midpoint_captured_at >= market_current_prices.midpoint_captured_at)
         THEN EXCLUDED.midpoint_captured_at ELSE market_current_prices.midpoint_captured_at END,
       last_trade = CASE
         WHEN EXCLUDED.last_trade IS NOT NULL
          AND (market_current_prices.last_trade_captured_at IS NULL
            OR EXCLUDED.last_trade_captured_at >= market_current_prices.last_trade_captured_at)
         THEN EXCLUDED.last_trade ELSE market_current_prices.last_trade END,
       last_trade_captured_at = CASE
         WHEN EXCLUDED.last_trade IS NOT NULL
          AND (market_current_prices.last_trade_captured_at IS NULL
            OR EXCLUDED.last_trade_captured_at >= market_current_prices.last_trade_captured_at)
         THEN EXCLUDED.last_trade_captured_at ELSE market_current_prices.last_trade_captured_at END,
       latest_source = CASE
         WHEN EXCLUDED.latest_source_at >= market_current_prices.latest_source_at
         THEN EXCLUDED.latest_source ELSE market_current_prices.latest_source END,
       latest_source_at = GREATEST(EXCLUDED.latest_source_at, market_current_prices.latest_source_at),
       latest_snapshot_id = CASE
         WHEN EXCLUDED.latest_source_at >= market_current_prices.latest_source_at
         THEN EXCLUDED.latest_snapshot_id ELSE market_current_prices.latest_snapshot_id END,
       updated_at = NOW()`,
    [
      identity.outcomeId,
      identity.marketId,
      input.bid,
      input.ask,
      input.midpoint,
      input.lastTrade,
      input.capturedAt,
      input.source,
      snapshotId,
    ],
  );
}

function validatePriceUpdate(input: MarketPriceUpdate): void {
  if (input.tokenId.trim().length === 0) throw new RangeError('tokenId must not be empty');
  if (input.sourceEventKey.trim().length === 0 || input.sourceEventKey.length > 255) {
    throw new RangeError('sourceEventKey must contain 1 to 255 characters');
  }
  for (const [field, value] of [
    ['bid', input.bid],
    ['ask', input.ask],
    ['midpoint', input.midpoint],
    ['lastTrade', input.lastTrade],
  ] as const) {
    if (value === null) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
      throw new RangeError(`${field} must be a decimal from 0 to 1`);
    }
  }
  if (
    input.bid === null &&
    input.ask === null &&
    input.midpoint === null &&
    input.lastTrade === null
  ) {
    throw new RangeError('price update must contain at least one price');
  }
  for (const [field, value] of [
    ['capturedAt', input.capturedAt],
    ['observedAt', input.observedAt],
  ] as const) {
    if (Number.isNaN(Date.parse(value))) throw new RangeError(`${field} must be an ISO timestamp`);
  }
}
