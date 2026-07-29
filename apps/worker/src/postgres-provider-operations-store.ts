import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  MarketWebSocketMetrics,
  MarketWebSocketState,
  PolymarketMarketLifecycleSnapshot,
} from '@forecast/provider-polymarket';
import type { PolymarketRealtimeWorkerMetrics } from './polymarket-realtime-worker.js';

export interface LifecycleCheckCandidate {
  marketId: string;
  providerMarketId: string;
}

export interface LifecycleObservationResult {
  status: 'inserted' | 'duplicate' | 'unmatched_market';
  observationId: string | null;
  localStatus: string | null;
  resolutionCandidateCreated: boolean;
}

export class PostgresProviderOperationsStore {
  constructor(
    private readonly pool: Pool,
    private readonly failureAlertThreshold = 3,
  ) {
    if (!Number.isInteger(failureAlertThreshold) || failureAlertThreshold < 1) {
      throw new RangeError('failureAlertThreshold must be a positive integer');
    }
  }

  async loadLifecycleCheckCandidates(
    lookAheadUntil: Date,
    recheckBefore: Date,
    limit: number,
  ): Promise<LifecycleCheckCandidate[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError('lifecycle candidate limit must be an integer from 1 to 500');
    }
    const result = await this.pool.query<{
      market_id: string;
      provider_market_id: string;
    }>(
      `SELECT m.id AS market_id, pm.provider_market_id
       FROM markets m
       JOIN provider_markets pm ON pm.id = m.provider_market_id
       LEFT JOIN LATERAL (
         SELECT MAX(mlo.observed_at) AS last_observed_at
         FROM market_lifecycle_observations mlo
         WHERE mlo.market_id = m.id
       ) observation ON TRUE
       WHERE pm.provider = 'polymarket'
         AND m.status IN ('open', 'suspended', 'closed', 'resolving')
         AND (
           m.status IN ('closed', 'resolving')
           OR m.closes_at <= $1
           OR (m.closes_at IS NULL AND pm.imported_at <= NOW() - INTERVAL '24 hours')
         )
         AND (
           observation.last_observed_at IS NULL
           OR observation.last_observed_at <= $2
         )
       ORDER BY
         observation.last_observed_at ASC NULLS FIRST,
         CASE WHEN m.status IN ('closed', 'resolving') THEN 0 ELSE 1 END,
         COALESCE(m.closes_at, m.updated_at),
         pm.provider_market_id
       LIMIT $3`,
      [lookAheadUntil, recheckBefore, limit],
    );
    return result.rows.map((row) => ({
      marketId: row.market_id,
      providerMarketId: row.provider_market_id,
    }));
  }

  async applyLifecycleObservation(
    snapshot: PolymarketMarketLifecycleSnapshot,
    observedAt: Date,
  ): Promise<LifecycleObservationResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await client.query<{
        market_id: string;
        current_status: string;
        provider_market_database_id: string;
      }>(
        `SELECT m.id AS market_id, m.status AS current_status, pm.id AS provider_market_database_id
         FROM provider_markets pm
         JOIN markets m ON m.provider_market_id = pm.id
         WHERE pm.provider = 'polymarket' AND pm.provider_market_id = $1
         LIMIT 2`,
        [snapshot.providerMarketId],
      );
      if (identity.rows.length !== 1) {
        await client.query('ROLLBACK');
        if (identity.rows.length > 1) {
          throw new Error(
            `Polymarket market ${snapshot.providerMarketId} matched multiple local markets`,
          );
        }
        return {
          status: 'unmatched_market',
          observationId: null,
          localStatus: null,
          resolutionCandidateCreated: false,
        };
      }

      const row = identity.rows[0];
      if (row === undefined) throw new Error('lifecycle identity disappeared');
      const observedStatus = inferObservedStatus(snapshot);
      const nextStatus = transitionLocalStatus(row.current_status, observedStatus);
      const sourceEventKey = lifecycleEventKey(snapshot);

      await client.query(
        `UPDATE provider_markets
         SET raw_payload = $2, source_updated_at = $3, imported_at = $4
         WHERE id = $1`,
        [row.provider_market_database_id, snapshot.raw, snapshot.sourceUpdatedAt, observedAt],
      );
      await client.query(
        `UPDATE markets
         SET status = $2,
             closes_at = COALESCE($3, closes_at),
             updated_at = $4
         WHERE id = $1`,
        [row.market_id, nextStatus, snapshot.closedAt, observedAt],
      );

      const observation = await client.query<{ id: string }>(
        `INSERT INTO market_lifecycle_observations (
           market_id, provider, provider_market_id, source_event_key, observed_status,
           raw_payload, source_updated_at, observed_at
         ) VALUES ($1, 'polymarket', $2, $3, $4, $5, $6, $7)
         ON CONFLICT (source_event_key) DO NOTHING
         RETURNING id`,
        [
          row.market_id,
          snapshot.providerMarketId,
          sourceEventKey,
          observedStatus,
          snapshot.raw,
          snapshot.sourceUpdatedAt,
          observedAt,
        ],
      );
      const observationId = observation.rows[0]?.id;
      if (observationId === undefined) {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM market_lifecycle_observations WHERE source_event_key = $1',
          [sourceEventKey],
        );
        await client.query('COMMIT');
        return {
          status: 'duplicate',
          observationId: existing.rows[0]?.id ?? null,
          localStatus: nextStatus,
          resolutionCandidateCreated: false,
        };
      }

      let resolutionCandidateCreated = false;
      if (snapshot.closed === true) {
        const winningOutcomeId = await findWinningOutcomeId(
          client,
          row.market_id,
          snapshot.winningTokenId,
        );
        const candidate = await client.query(
          `INSERT INTO market_resolution_candidates (
             market_id, observation_id, winning_outcome_id, provider_resolution_status,
             status, evidence, detected_at
           ) VALUES ($1, $2, $3, $4, 'pending_review', $5, $6)
           ON CONFLICT (observation_id) DO NOTHING
           RETURNING id`,
          [
            row.market_id,
            observationId,
            winningOutcomeId,
            snapshot.providerResolutionStatus,
            {
              provider: 'polymarket',
              providerMarketId: snapshot.providerMarketId,
              winningTokenId: snapshot.winningTokenId,
              outcomes: snapshot.outcomes,
              closedAt: snapshot.closedAt,
              sourceUpdatedAt: snapshot.sourceUpdatedAt,
            },
            observedAt,
          ],
        );
        resolutionCandidateCreated = candidate.rowCount === 1;
      }

      await client.query('COMMIT');
      return {
        status: 'inserted',
        observationId,
        localStatus: nextStatus,
        resolutionCandidateCreated,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordComponentSuccess(
    component: string,
    at: Date,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO provider_runtime_states (
         provider, component, status, consecutive_failures, last_attempt_at,
         last_succeeded_at, last_error, details, updated_at
       ) VALUES ('polymarket', $1, 'healthy', 0, $2, $2, NULL, $3, $2)
       ON CONFLICT (provider, component)
       DO UPDATE SET
         status = 'healthy',
         consecutive_failures = 0,
         last_attempt_at = EXCLUDED.last_attempt_at,
         last_succeeded_at = EXCLUDED.last_succeeded_at,
         last_error = NULL,
         details = EXCLUDED.details,
         updated_at = EXCLUDED.updated_at`,
      [component, at, details],
    );
    await this.resolveAlert(`${component}:consecutive_failures`, at);
  }

  async recordComponentFailure(
    component: string,
    at: Date,
    error: unknown,
    details: Record<string, unknown> = {},
  ): Promise<number> {
    const message = error instanceof Error ? error.message : String(error);
    const result = await this.pool.query<{ consecutive_failures: number }>(
      `INSERT INTO provider_runtime_states (
         provider, component, status, consecutive_failures, last_attempt_at,
         last_failed_at, last_error, details, updated_at
       ) VALUES ('polymarket', $1, 'degraded', 1, $2, $2, $3, $4, $2)
       ON CONFLICT (provider, component)
       DO UPDATE SET
         status = 'degraded',
         consecutive_failures = provider_runtime_states.consecutive_failures + 1,
         last_attempt_at = EXCLUDED.last_attempt_at,
         last_failed_at = EXCLUDED.last_failed_at,
         last_error = EXCLUDED.last_error,
         details = EXCLUDED.details,
         updated_at = EXCLUDED.updated_at
       RETURNING consecutive_failures`,
      [component, at, message.slice(0, 4_000), details],
    );
    const failures = result.rows[0]?.consecutive_failures ?? 1;
    if (failures >= this.failureAlertThreshold) {
      await this.openAlert({
        component,
        code: 'consecutive_failures',
        severity: 'error',
        dedupKey: `${component}:consecutive_failures`,
        message: `${component} has failed ${failures} consecutive times`,
        details: { ...details, consecutiveFailures: failures, lastError: message },
        at,
      });
    }
    return failures;
  }

  async recordCatalogSyncResult(
    at: Date,
    details: Record<string, unknown> & { warningCount: number },
    warningAlertThreshold: number,
  ): Promise<void> {
    if (!Number.isInteger(warningAlertThreshold) || warningAlertThreshold < 1) {
      throw new RangeError('warningAlertThreshold must be a positive integer');
    }
    await this.recordComponentSuccess('catalog_sync', at, details);
    if (details.warningCount >= warningAlertThreshold) {
      await this.openAlert({
        component: 'catalog_sync',
        code: 'parse_warnings',
        severity: 'warning',
        dedupKey: 'catalog_sync:parse_warnings',
        message: `Catalog sync produced ${details.warningCount} normalization warnings`,
        details,
        at,
      });
    } else {
      await this.resolveAlert('catalog_sync:parse_warnings', at);
    }
  }

  async evaluatePriceFreshness(
    staleBefore: Date,
    at: Date,
  ): Promise<{
    openOutcomes: number;
    missingPrices: number;
    stalePrices: number;
    latestSourceAt: string | null;
  }> {
    const result = await this.pool.query<{
      open_outcomes: number;
      missing_prices: number;
      stale_prices: number;
      latest_source_at: Date | null;
    }>(
      `SELECT
         COUNT(*)::int AS open_outcomes,
         COUNT(*) FILTER (WHERE mcp.outcome_id IS NULL)::int AS missing_prices,
         COUNT(*) FILTER (
           WHERE mcp.outcome_id IS NOT NULL AND mcp.latest_source_at < $1
         )::int AS stale_prices,
         MAX(mcp.latest_source_at) AS latest_source_at
       FROM markets m
       JOIN market_outcomes mo ON mo.market_id = m.id
       LEFT JOIN market_current_prices mcp ON mcp.outcome_id = mo.id
       WHERE m.status = 'open'`,
      [staleBefore],
    );
    const row = result.rows[0] ?? {
      open_outcomes: 0,
      missing_prices: 0,
      stale_prices: 0,
      latest_source_at: null,
    };
    const details = {
      openOutcomes: row.open_outcomes,
      missingPrices: row.missing_prices,
      stalePrices: row.stale_prices,
      latestSourceAt: row.latest_source_at?.toISOString() ?? null,
      staleBefore: staleBefore.toISOString(),
    };

    if (row.missing_prices > 0 || row.stale_prices > 0) {
      await this.setComponentDegraded('market_data', at, details);
      await this.openAlert({
        component: 'market_data',
        code: 'stale_prices',
        severity: 'warning',
        dedupKey: 'market_data:stale_prices',
        message: `${row.missing_prices} open outcomes lack prices and ${row.stale_prices} are stale`,
        details,
        at,
      });
    } else {
      await this.recordComponentSuccess('market_data', at, details);
      await this.resolveAlert('market_data:stale_prices', at);
    }

    return details;
  }

  async recordRealtimeQueueMetrics(
    metrics: PolymarketRealtimeWorkerMetrics,
    droppedSinceLast: number,
    failedSinceLast: number,
    maxQueueSize: number,
    at: Date,
  ): Promise<void> {
    const details = { ...metrics, droppedSinceLast, failedSinceLast, maxQueueSize };
    if (droppedSinceLast > 0 || failedSinceLast > 0) {
      await this.setComponentDegraded('realtime_queue', at, details);
      await this.openAlert({
        component: 'realtime_queue',
        code: 'event_loss',
        severity: 'error',
        dedupKey: 'realtime_queue:event_loss',
        message: `${droppedSinceLast} WebSocket events were dropped and ${failedSinceLast} failed since the previous check`,
        details,
        at,
      });
      return;
    }
    await this.recordComponentSuccess('realtime_queue', at, details);
    await this.resolveAlert('realtime_queue:event_loss', at);
  }

  async recordWebSocketHealth(
    state: MarketWebSocketState,
    metrics: MarketWebSocketMetrics,
    parseWarningsSinceLast: number,
    disconnectedForMs: number,
    disconnectedAlertThresholdMs: number,
    at: Date,
  ): Promise<void> {
    const details = {
      state,
      ...metrics,
      parseWarningsSinceLast,
      disconnectedForMs,
      disconnectedAlertThresholdMs,
    };
    const disconnectedTooLong =
      (state === 'connecting' || state === 'waiting_to_reconnect') &&
      disconnectedForMs >= disconnectedAlertThresholdMs;
    if (disconnectedTooLong || parseWarningsSinceLast > 0) {
      await this.setComponentDegraded('market_websocket', at, details);
    } else {
      await this.recordComponentSuccess('market_websocket', at, details);
    }

    if (disconnectedTooLong) {
      await this.openAlert({
        component: 'market_websocket',
        code: 'prolonged_disconnect',
        severity: 'error',
        dedupKey: 'market_websocket:prolonged_disconnect',
        message: `Market WebSocket has not been open for ${disconnectedForMs}ms`,
        details,
        at,
      });
    } else {
      await this.resolveAlert('market_websocket:prolonged_disconnect', at);
    }

    if (parseWarningsSinceLast > 0) {
      await this.openAlert({
        component: 'market_websocket',
        code: 'parse_warnings',
        severity: 'warning',
        dedupKey: 'market_websocket:parse_warnings',
        message: `${parseWarningsSinceLast} WebSocket payloads produced parse warnings`,
        details,
        at,
      });
    } else {
      await this.resolveAlert('market_websocket:parse_warnings', at);
    }
  }

  private async setComponentDegraded(
    component: string,
    at: Date,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO provider_runtime_states (
         provider, component, status, consecutive_failures, last_attempt_at, details, updated_at
       ) VALUES ('polymarket', $1, 'degraded', 0, $2, $3, $2)
       ON CONFLICT (provider, component)
       DO UPDATE SET
         status = 'degraded',
         last_attempt_at = EXCLUDED.last_attempt_at,
         details = EXCLUDED.details,
         updated_at = EXCLUDED.updated_at`,
      [component, at, details],
    );
  }

  private async openAlert(input: {
    component: string;
    code: string;
    severity: 'warning' | 'error';
    dedupKey: string;
    message: string;
    details: Record<string, unknown>;
    at: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO provider_alerts (
         provider, component, alert_code, severity, status, dedup_key,
         message, details, first_seen_at, last_seen_at
       ) VALUES ('polymarket', $1, $2, $3, 'open', $4, $5, $6, $7, $7)
       ON CONFLICT (provider, dedup_key)
       DO UPDATE SET
         component = EXCLUDED.component,
         alert_code = EXCLUDED.alert_code,
         severity = EXCLUDED.severity,
         status = 'open',
         message = EXCLUDED.message,
         details = EXCLUDED.details,
         first_seen_at = CASE
           WHEN provider_alerts.status = 'resolved' THEN EXCLUDED.first_seen_at
           ELSE provider_alerts.first_seen_at
         END,
         last_seen_at = EXCLUDED.last_seen_at,
         resolved_at = NULL`,
      [
        input.component,
        input.code,
        input.severity,
        input.dedupKey,
        input.message,
        input.details,
        input.at,
      ],
    );
  }

  private async resolveAlert(dedupKey: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE provider_alerts
       SET status = 'resolved', resolved_at = $2, last_seen_at = $2
       WHERE provider = 'polymarket' AND dedup_key = $1 AND status = 'open'`,
      [dedupKey, at],
    );
  }
}

async function findWinningOutcomeId(
  client: PoolClient,
  marketId: string,
  winningTokenId: string | null,
): Promise<string | null> {
  if (winningTokenId === null) return null;
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM market_outcomes
     WHERE market_id = $1 AND provider_outcome_id = $2
     LIMIT 2`,
    [marketId, winningTokenId],
  );
  if (result.rows.length > 1) {
    throw new Error(`winning token ${winningTokenId} matched multiple local outcomes`);
  }
  return result.rows[0]?.id ?? null;
}

function inferObservedStatus(snapshot: PolymarketMarketLifecycleSnapshot): string {
  if (snapshot.archived === true) return 'archived';
  if (snapshot.closed === true) return 'closed';
  if (snapshot.active === true && snapshot.acceptingOrders === true) return 'open';
  if (snapshot.active === false || snapshot.acceptingOrders === false) return 'suspended';
  return 'pending_review';
}

function transitionLocalStatus(currentStatus: string, observedStatus: string): string {
  if (currentStatus === 'resolved' || currentStatus === 'cancelled') return currentStatus;
  if (observedStatus === 'archived') return 'archived';
  if (observedStatus === 'closed') {
    return currentStatus === 'resolving' ? 'resolving' : 'closed';
  }
  if (observedStatus === 'open') return 'open';
  if (observedStatus === 'suspended') return 'suspended';
  return currentStatus;
}

function lifecycleEventKey(snapshot: PolymarketMarketLifecycleSnapshot): string {
  const digest = createHash('sha256')
    .update(
      stableStringify({
        providerMarketId: snapshot.providerMarketId,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        active: snapshot.active,
        closed: snapshot.closed,
        archived: snapshot.archived,
        acceptingOrders: snapshot.acceptingOrders,
        closedAt: snapshot.closedAt,
        providerResolutionStatus: snapshot.providerResolutionStatus,
        outcomes: snapshot.outcomes,
      }),
    )
    .digest('hex');
  return `polymarket:market_lifecycle:${digest}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
