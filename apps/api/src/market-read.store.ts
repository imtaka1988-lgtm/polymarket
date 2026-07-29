import type { Pool } from 'pg';
import {
  encodeMarketCursor,
  type MarketCursor,
  type MarketDetailDto,
  type MarketOutcomeDto,
  type MarketSummaryDto,
  type PlatformDataStatusDto,
  type PublicMarketStatus,
} from './api-contract';

export interface MarketListResult {
  markets: MarketSummaryDto[];
  hasNextPage: boolean;
  nextCursor: string | null;
}

export class MarketReadStore {
  constructor(private readonly pool: Pool) {}

  async listMarkets(input: {
    statuses: PublicMarketStatus[];
    limit: number;
    cursor: MarketCursor | null;
  }): Promise<MarketListResult> {
    const result = await this.pool.query<MarketRow>(
      `WITH page AS (
         SELECT
           m.id,
           m.title,
           m.kind,
           m.status::text AS status,
           m.original_rules,
           m.rules_summary,
           m.opens_at,
           m.closes_at,
           m.resolved_at,
           m.schema_version,
           m.updated_at,
           pm.provider,
           pm.provider_market_id
         FROM markets m
         LEFT JOIN provider_markets pm ON pm.id = m.provider_market_id
         WHERE m.status::text = ANY($1::text[])
           AND (
             $2::timestamptz IS NULL
             OR (m.updated_at, m.id) < ($2::timestamptz, $3::uuid)
           )
         ORDER BY m.updated_at DESC, m.id DESC
         LIMIT $4
       )
       SELECT
         page.*,
         mo.id AS outcome_id,
         mo.label AS outcome_label,
         mo.sort_order AS outcome_sort_order,
         mcp.bid,
         mcp.ask,
         mcp.midpoint,
         mcp.last_trade,
         mcp.bid_captured_at,
         mcp.ask_captured_at,
         mcp.midpoint_captured_at,
         mcp.last_trade_captured_at,
         mcp.latest_source,
         mcp.latest_source_at
       FROM page
       LEFT JOIN market_outcomes mo ON mo.market_id = page.id
       LEFT JOIN market_current_prices mcp ON mcp.outcome_id = mo.id
       ORDER BY page.updated_at DESC, page.id DESC, mo.sort_order ASC`,
      [input.statuses, input.cursor?.updatedAt ?? null, input.cursor?.id ?? null, input.limit + 1],
    );
    const grouped = groupMarkets(result.rows);
    const hasNextPage = grouped.length > input.limit;
    const markets = grouped.slice(0, input.limit);
    const last = markets.at(-1);
    return {
      markets: markets.map(toSummary),
      hasNextPage,
      nextCursor:
        hasNextPage && last !== undefined
          ? encodeMarketCursor({
              version: 1,
              updatedAt: last.updatedAt,
              id: last.id,
            })
          : null,
    };
  }

  async getMarket(id: string): Promise<MarketDetailDto | null> {
    const result = await this.pool.query<MarketRow>(
      `${MARKET_DETAIL_SELECT}
       WHERE m.id = $1
         AND m.status::text = ANY($2::text[])
       ORDER BY mo.sort_order ASC`,
      [id, PUBLIC_STATUS_VALUES],
    );
    const market = groupMarkets(result.rows)[0];
    return market === undefined ? null : market;
  }

  async getMarketPrices(
    id: string,
  ): Promise<{ marketId: string; outcomes: MarketOutcomeDto[]; asOf: string | null } | null> {
    const market = await this.getMarket(id);
    if (market === null) return null;
    const latest = market.outcomes
      .map((outcome) => outcome.price?.latestSourceAt ?? null)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1);
    return {
      marketId: market.id,
      outcomes: market.outcomes,
      asOf: latest ?? null,
    };
  }

  async getPlatformDataStatus(): Promise<PlatformDataStatusDto> {
    const [states, alerts] = await Promise.all([
      this.pool.query<RuntimeStateRow>(
        `SELECT
           component,
           status,
           consecutive_failures,
           last_attempt_at,
           last_succeeded_at,
           last_failed_at
         FROM provider_runtime_states
         WHERE provider = 'polymarket'
         ORDER BY component ASC`,
      ),
      this.pool.query<AlertRow>(
        `SELECT alert_code, severity, component, first_seen_at, last_seen_at
         FROM provider_alerts
         WHERE provider = 'polymarket' AND status = 'open'
         ORDER BY
           CASE severity
             WHEN 'critical' THEN 0
             WHEN 'error' THEN 1
             WHEN 'warning' THEN 2
             ELSE 3
           END,
           last_seen_at DESC,
           id ASC
         LIMIT 100`,
      ),
    ]);

    const unavailable = states.rows.length === 0;
    const degraded =
      !unavailable &&
      (states.rows.some((row) => row.status !== 'healthy') || alerts.rows.length > 0);
    const status = unavailable ? 'unavailable' : degraded ? 'degraded' : 'healthy';
    const lastSuccessfulAt =
      states.rows
        .map((row) => iso(row.last_succeeded_at))
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null;

    return {
      status,
      readOnly: status !== 'healthy',
      provider: 'polymarket',
      lastSuccessfulAt,
      components: states.rows.map((row) => ({
        name: row.component,
        status: row.status,
        consecutiveFailures: row.consecutive_failures,
        lastAttemptAt: iso(row.last_attempt_at),
        lastSucceededAt: iso(row.last_succeeded_at),
        lastFailedAt: iso(row.last_failed_at),
      })),
      openAlerts: alerts.rows.map((row) => ({
        code: row.alert_code,
        severity: row.severity,
        component: row.component,
        firstSeenAt: row.first_seen_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
      })),
    };
  }
}

interface MarketAggregate extends MarketDetailDto {
  updatedAt: string;
}

interface MarketRow {
  id: string;
  title: string;
  kind: string;
  status: PublicMarketStatus;
  original_rules: string | null;
  rules_summary: string | null;
  opens_at: Date | null;
  closes_at: Date | null;
  resolved_at: Date | null;
  schema_version: number;
  updated_at: Date;
  provider: string | null;
  provider_market_id: string | null;
  outcome_id: string | null;
  outcome_label: string | null;
  outcome_sort_order: number | null;
  bid: string | null;
  ask: string | null;
  midpoint: string | null;
  last_trade: string | null;
  bid_captured_at: Date | null;
  ask_captured_at: Date | null;
  midpoint_captured_at: Date | null;
  last_trade_captured_at: Date | null;
  latest_source: string | null;
  latest_source_at: Date | null;
}

interface RuntimeStateRow {
  component: string;
  status: string;
  consecutive_failures: number;
  last_attempt_at: Date | null;
  last_succeeded_at: Date | null;
  last_failed_at: Date | null;
}

interface AlertRow {
  alert_code: string;
  severity: string;
  component: string;
  first_seen_at: Date;
  last_seen_at: Date;
}

function groupMarkets(rows: MarketRow[]): MarketAggregate[] {
  const markets = new Map<string, MarketAggregate>();
  for (const row of rows) {
    let market = markets.get(row.id);
    if (market === undefined) {
      market = {
        id: row.id,
        title: row.title,
        kind: row.kind,
        status: row.status,
        rules: row.rules_summary ?? row.original_rules,
        schemaVersion: row.schema_version,
        opensAt: iso(row.opens_at),
        closesAt: iso(row.closes_at),
        resolvedAt: iso(row.resolved_at),
        updatedAt: row.updated_at.toISOString(),
        provider:
          row.provider === null || row.provider_market_id === null
            ? null
            : { name: row.provider, marketId: row.provider_market_id },
        outcomes: [],
      };
      markets.set(row.id, market);
    }
    if (row.outcome_id !== null && row.outcome_label !== null && row.outcome_sort_order !== null) {
      market.outcomes.push({
        id: row.outcome_id,
        label: row.outcome_label,
        sortOrder: row.outcome_sort_order,
        price:
          row.latest_source === null || row.latest_source_at === null
            ? null
            : {
                bid: row.bid,
                ask: row.ask,
                midpoint: row.midpoint,
                lastTrade: row.last_trade,
                bidCapturedAt: iso(row.bid_captured_at),
                askCapturedAt: iso(row.ask_captured_at),
                midpointCapturedAt: iso(row.midpoint_captured_at),
                lastTradeCapturedAt: iso(row.last_trade_captured_at),
                latestSource: row.latest_source,
                latestSourceAt: row.latest_source_at.toISOString(),
              },
      });
    }
  }
  return [...markets.values()];
}

function toSummary(market: MarketAggregate): MarketSummaryDto {
  const { rules: _rules, schemaVersion: _schemaVersion, ...summary } = market;
  return summary;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

const PUBLIC_STATUS_VALUES: PublicMarketStatus[] = [
  'open',
  'suspended',
  'closed',
  'resolving',
  'resolved',
];

const MARKET_DETAIL_SELECT = `
  SELECT
    m.id,
    m.title,
    m.kind,
    m.status::text AS status,
    m.original_rules,
    m.rules_summary,
    m.opens_at,
    m.closes_at,
    m.resolved_at,
    m.schema_version,
    m.updated_at,
    pm.provider,
    pm.provider_market_id,
    mo.id AS outcome_id,
    mo.label AS outcome_label,
    mo.sort_order AS outcome_sort_order,
    mcp.bid,
    mcp.ask,
    mcp.midpoint,
    mcp.last_trade,
    mcp.bid_captured_at,
    mcp.ask_captured_at,
    mcp.midpoint_captured_at,
    mcp.last_trade_captured_at,
    mcp.latest_source,
    mcp.latest_source_at
  FROM markets m
  LEFT JOIN provider_markets pm ON pm.id = m.provider_market_id
  LEFT JOIN market_outcomes mo ON mo.market_id = m.id
  LEFT JOIN market_current_prices mcp ON mcp.outcome_id = mo.id`;
