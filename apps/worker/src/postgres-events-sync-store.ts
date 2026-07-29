import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  EventsKeysetSyncStore,
  EventsSyncCheckpoint,
  EventsSyncPageCommit,
  NormalizedPolymarketEvent,
  NormalizedPolymarketMarket,
} from '@forecast/provider-polymarket';

export class PostgresEventsKeysetSyncStore implements EventsKeysetSyncStore {
  constructor(private readonly pool: Pool) {}

  async loadCheckpoint(querySignature: string): Promise<EventsSyncCheckpoint | null> {
    const result = await this.pool.query<{
      query_signature: string;
      next_cursor: string | null;
      pages_processed: number;
      events_processed: number;
      updated_at: Date;
    }>(
      `SELECT query_signature, next_cursor, pages_processed, events_processed, updated_at
       FROM provider_sync_checkpoints
       WHERE provider = 'polymarket' AND resource_type = 'events' AND query_signature = $1`,
      [querySignature],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      querySignature: row.query_signature,
      nextCursor: row.next_cursor,
      pagesProcessed: row.pages_processed,
      eventsProcessed: row.events_processed,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async startRun(input: { querySignature: string; startedAt: string }): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO provider_sync_runs (provider, resource_type, query_signature, status, started_at)
       VALUES ('polymarket', 'events', $1, 'running', $2)
       RETURNING id`,
      [input.querySignature, input.startedAt],
    );
    return result.rows[0]?.id ?? null;
  }

  async commitPage(input: EventsSyncPageCommit): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pageKey = createPageKey(input);
      await client.query(
        `INSERT INTO provider_sync_pages (
           run_id, provider, resource_type, query_signature, page_key, page_number,
           request_cursor, response_cursor, event_count, warning_count, request_url, raw_payload, fetched_at
         ) VALUES ($1, 'polymarket', 'events', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (page_key) DO NOTHING`,
        [
          input.runId,
          input.querySignature,
          pageKey,
          input.pageNumber,
          input.page.requestCursor,
          input.page.nextCursor,
          input.page.events.length,
          input.warnings.length,
          input.page.requestUrl,
          input.page.rawPayload,
          input.page.fetchedAt,
        ],
      );

      for (const event of input.normalizedEvents) await persistEvent(client, event);

      await client.query(
        `INSERT INTO provider_sync_checkpoints (
           provider, resource_type, query_signature, next_cursor, pages_processed, events_processed,
           last_started_at, last_succeeded_at, last_error, updated_at
         ) VALUES ('polymarket', 'events', $1, $2, $3, $4, $5, $5, NULL, $5)
         ON CONFLICT (provider, resource_type, query_signature)
         DO UPDATE SET
           next_cursor = EXCLUDED.next_cursor,
           pages_processed = EXCLUDED.pages_processed,
           events_processed = EXCLUDED.events_processed,
           last_succeeded_at = EXCLUDED.last_succeeded_at,
           last_error = NULL,
           updated_at = EXCLUDED.updated_at`,
        [
          input.querySignature,
          input.page.nextCursor,
          input.cumulativePages,
          input.cumulativeEvents,
          input.page.fetchedAt,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeRun(input: {
    runId: string | null;
    querySignature: string;
    completedAt: string;
    pagesProcessed: number;
    eventsProcessed: number;
    warningCount: number;
    fullyDrained: boolean;
    nextCursor: string | null;
  }): Promise<void> {
    if (input.runId === null) return;
    await this.pool.query(
      `UPDATE provider_sync_runs
       SET status = $2, completed_at = $3, pages_processed = $4, events_processed = $5,
           warning_count = $6, next_cursor = $7
       WHERE id = $1`,
      [
        input.runId,
        input.fullyDrained ? 'completed' : 'partial',
        input.completedAt,
        input.pagesProcessed,
        input.eventsProcessed,
        input.warningCount,
        input.nextCursor,
      ],
    );
  }

  async failRun(input: {
    runId: string | null;
    querySignature: string;
    failedAt: string;
    error: string;
    pagesProcessed: number;
    eventsProcessed: number;
  }): Promise<void> {
    if (input.runId !== null) {
      await this.pool.query(
        `UPDATE provider_sync_runs
         SET status = 'failed', completed_at = $2, pages_processed = $3, events_processed = $4, last_error = $5
         WHERE id = $1`,
        [input.runId, input.failedAt, input.pagesProcessed, input.eventsProcessed, input.error],
      );
    }
    await this.pool.query(
      `INSERT INTO provider_sync_checkpoints (
         provider, resource_type, query_signature, pages_processed, events_processed,
         last_failed_at, last_error, updated_at
       ) VALUES ('polymarket', 'events', $1, $2, $3, $4, $5, $4)
       ON CONFLICT (provider, resource_type, query_signature)
       DO UPDATE SET last_failed_at = EXCLUDED.last_failed_at, last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at`,
      [input.querySignature, input.pagesProcessed, input.eventsProcessed, input.failedAt, input.error],
    );
  }
}

async function persistEvent(client: PoolClient, event: NormalizedPolymarketEvent): Promise<void> {
  const eventResult = await client.query<{ id: string }>(
    `INSERT INTO provider_events (provider, provider_event_id, raw_payload, source_updated_at, imported_at)
     VALUES ('polymarket', $1, $2, $3, NOW())
     ON CONFLICT (provider, provider_event_id)
     DO UPDATE SET raw_payload = EXCLUDED.raw_payload, source_updated_at = EXCLUDED.source_updated_at, imported_at = NOW()
     RETURNING id`,
    [event.providerEventId, event.raw, event.sourceUpdatedAt],
  );
  const providerEventDatabaseId = eventResult.rows[0]?.id;
  if (providerEventDatabaseId === undefined) throw new Error(`provider event upsert returned no id for ${event.providerEventId}`);

  for (const market of event.markets) await persistMarket(client, providerEventDatabaseId, market);
}

async function persistMarket(
  client: PoolClient,
  providerEventDatabaseId: string,
  market: NormalizedPolymarketMarket,
): Promise<void> {
  const providerMarketResult = await client.query<{ id: string }>(
    `INSERT INTO provider_markets (
       provider_event_id, provider, provider_market_id, provider_condition_id, raw_payload, source_updated_at, imported_at
     ) VALUES ($1, 'polymarket', $2, $3, $4, $5, NOW())
     ON CONFLICT (provider, provider_market_id)
     DO UPDATE SET
       provider_event_id = EXCLUDED.provider_event_id,
       provider_condition_id = EXCLUDED.provider_condition_id,
       raw_payload = EXCLUDED.raw_payload,
       source_updated_at = EXCLUDED.source_updated_at,
       imported_at = NOW()
     RETURNING id`,
    [providerEventDatabaseId, market.providerMarketId, market.providerConditionId, market.raw, market.sourceUpdatedAt],
  );
  const providerMarketDatabaseId = providerMarketResult.rows[0]?.id;
  if (providerMarketDatabaseId === undefined) throw new Error(`provider market upsert returned no id for ${market.providerMarketId}`);

  const existing = await client.query<{ id: string }>(
    'SELECT id FROM markets WHERE provider_market_id = $1 LIMIT 1',
    [providerMarketDatabaseId],
  );
  let marketId = existing.rows[0]?.id;

  if (marketId === undefined) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO markets (
         provider_market_id, kind, status, source_type, original_title, title, original_rules,
         opens_at, closes_at, schema_version, created_at, updated_at
       ) VALUES ($1, $2, $3, 'provider', $4, $4, $5, $6, $7, 1, NOW(), NOW())
       RETURNING id`,
      [
        providerMarketDatabaseId,
        market.kind,
        market.status,
        market.title,
        market.rules,
        market.opensAt,
        market.closesAt,
      ],
    );
    marketId = inserted.rows[0]?.id;
  } else {
    await client.query(
      `UPDATE markets SET
         kind = $2, status = $3, original_title = $4, title = $4, original_rules = $5,
         opens_at = $6, closes_at = $7, updated_at = NOW()
       WHERE id = $1`,
      [marketId, market.kind, market.status, market.title, market.rules, market.opensAt, market.closesAt],
    );
  }

  if (marketId === undefined) throw new Error(`local market persistence returned no id for ${market.providerMarketId}`);

  for (const outcome of market.outcomes) {
    await client.query(
      `INSERT INTO market_outcomes (market_id, provider_outcome_id, label, sort_order, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (market_id, sort_order)
       DO UPDATE SET provider_outcome_id = EXCLUDED.provider_outcome_id, label = EXCLUDED.label`,
      [marketId, outcome.providerOutcomeId, outcome.label, outcome.sortOrder],
    );
  }
}

function createPageKey(input: EventsSyncPageCommit): string {
  return createHash('sha256')
    .update(input.querySignature)
    .update('\n')
    .update(input.page.requestCursor ?? '<first>')
    .update('\n')
    .update(JSON.stringify(input.page.rawPayload))
    .digest('hex');
}
