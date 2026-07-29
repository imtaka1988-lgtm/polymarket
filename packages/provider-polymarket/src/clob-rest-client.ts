import { PolymarketHttpError, PolymarketPayloadError } from './errors.js';
import { averageDecimalStrings } from './decimal.js';
import { asBoolean, asFiniteNumber, asString, isRecord } from './parsers.js';
import type { RetryPolicy } from './types.js';

const DEFAULT_CLOB_REST_URL = 'https://clob.polymarket.com';
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitterRatio: 0.2,
};

export interface ClobOrderBookLevel {
  price: string;
  size: string;
}

export interface ClobOrderBookSnapshot {
  marketId: string;
  assetId: string;
  capturedAt: string;
  hash: string;
  bids: ClobOrderBookLevel[];
  asks: ClobOrderBookLevel[];
  bestBid: string | null;
  bestAsk: string | null;
  midpoint: string | null;
  lastTrade: string | null;
  minOrderSize: string | null;
  tickSize: string | null;
  negativeRisk: boolean | null;
}

export interface PolymarketClobRestClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxTokensPerRequest?: number;
  retry?: Partial<RetryPolicy>;
  fetchFn?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export class PolymarketClobRestClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTokensPerRequest: number;
  private readonly retry: RetryPolicy;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: PolymarketClobRestClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_CLOB_REST_URL;
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 10_000, 'timeoutMs');
    this.maxTokensPerRequest = boundedBatchSize(options.maxTokensPerRequest ?? 500);
    this.retry = {
      maxAttempts: positiveInteger(
        options.retry?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
        'maxAttempts',
      ),
      baseDelayMs: positiveInteger(
        options.retry?.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs,
        'baseDelayMs',
      ),
      maxDelayMs: positiveInteger(
        options.retry?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
        'maxDelayMs',
      ),
      jitterRatio: boundedRatio(
        options.retry?.jitterRatio ?? DEFAULT_RETRY_POLICY.jitterRatio,
        'jitterRatio',
      ),
    };
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  async getOrderBooks(tokenIds: Iterable<string>): Promise<ClobOrderBookSnapshot[]> {
    const normalized = normalizeTokenIds(tokenIds);
    const snapshots: ClobOrderBookSnapshot[] = [];
    for (const batch of chunk(normalized, this.maxTokensPerRequest)) {
      const response = await this.requestJson(
        new URL('/books', this.baseUrl),
        batch.map((tokenId) => ({ token_id: tokenId })),
      );
      if (!Array.isArray(response)) {
        throw new PolymarketPayloadError('CLOB /books returned a non-array payload', '/books');
      }
      for (const candidate of response) snapshots.push(parseOrderBookSnapshot(candidate));
    }
    return snapshots;
  }

  private async requestJson(url: URL, body: unknown): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'user-agent': 'event-forecast-lab/0.4',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const responseText = await response.text();
        if (!response.ok) {
          const retryable = isRetryableStatus(response.status);
          const error = new PolymarketHttpError(
            `Polymarket CLOB request failed: ${response.status} ${response.statusText}`,
            response.status,
            retryable,
            responseText.slice(0, 2_000),
          );
          if (!retryable || attempt === this.retry.maxAttempts) throw error;
          await this.sleep(getRetryDelay(response, attempt, this.retry, this.random));
          continue;
        }
        try {
          return JSON.parse(responseText) as unknown;
        } catch {
          throw new PolymarketPayloadError('Polymarket CLOB returned invalid JSON', url.toString());
        }
      } catch (error) {
        lastError = error;
        if (error instanceof PolymarketPayloadError) throw error;
        if (error instanceof PolymarketHttpError && !error.retryable) throw error;
        if (attempt === this.retry.maxAttempts) throw error;
        await this.sleep(calculateBackoff(attempt, this.retry, this.random));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('CLOB request failed without an error object');
  }
}

export function parseOrderBookSnapshot(value: unknown): ClobOrderBookSnapshot {
  if (!isRecord(value))
    throw new PolymarketPayloadError('CLOB order book was not an object', '/books');
  const marketId = asString(value.market);
  const assetId = asString(value.asset_id);
  const hash = asString(value.hash);
  const capturedAt = parseSourceTimestamp(value.timestamp);
  if (marketId === null || assetId === null || hash === null || capturedAt === null) {
    throw new PolymarketPayloadError(
      'CLOB order book lacked market, asset_id, hash, or timestamp',
      '/books',
    );
  }

  const bids = parseLevels(value.bids, 'bids');
  const asks = parseLevels(value.asks, 'asks');
  const bestBid = maxPrice(bids);
  const bestAsk = minPrice(asks);

  return {
    marketId,
    assetId,
    capturedAt,
    hash,
    bids,
    asks,
    bestBid,
    bestAsk,
    midpoint: midpoint(bestBid, bestAsk),
    lastTrade: decimalString(value.last_trade_price),
    minOrderSize: decimalString(value.min_order_size),
    tickSize: decimalString(value.tick_size),
    negativeRisk: asBoolean(value.neg_risk),
  };
}

function parseLevels(value: unknown, field: string): ClobOrderBookLevel[] {
  if (!Array.isArray(value))
    throw new PolymarketPayloadError(`CLOB order book ${field} was not an array`, '/books');
  return value.map((candidate) => {
    if (!isRecord(candidate))
      throw new PolymarketPayloadError(`CLOB ${field} contained a non-object level`, '/books');
    const price = decimalString(candidate.price);
    const size = decimalString(candidate.size);
    if (price === null || size === null) {
      throw new PolymarketPayloadError(
        `CLOB ${field} contained an invalid price or size`,
        '/books',
      );
    }
    return { price, size };
  });
}

function parseSourceTimestamp(value: unknown): string | null {
  const numeric = asFiniteNumber(value);
  if (numeric !== null) {
    const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === 'string') {
    const milliseconds = Date.parse(value);
    if (!Number.isNaN(milliseconds)) return new Date(milliseconds).toISOString();
  }
  return null;
}

function decimalString(value: unknown): string | null {
  const parsed = asFiniteNumber(value);
  return parsed === null ? null : String(typeof value === 'string' ? value.trim() : parsed);
}

function maxPrice(levels: ClobOrderBookLevel[]): string | null {
  if (levels.length === 0) return null;
  return levels.reduce(
    (best, level) => (Number(level.price) > Number(best) ? level.price : best),
    levels[0]?.price ?? '0',
  );
}

function minPrice(levels: ClobOrderBookLevel[]): string | null {
  if (levels.length === 0) return null;
  return levels.reduce(
    (best, level) => (Number(level.price) < Number(best) ? level.price : best),
    levels[0]?.price ?? '1',
  );
}

function midpoint(bid: string | null, ask: string | null): string | null {
  if (bid === null || ask === null) return null;
  return averageDecimalStrings(bid, ask);
}

function normalizeTokenIds(tokenIds: Iterable<string>): string[] {
  return [...new Set([...tokenIds].map((value) => value.trim()).filter(Boolean))].sort();
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function boundedBatchSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new RangeError('maxTokensPerRequest must be an integer from 1 to 500');
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function boundedRatio(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new RangeError(`${name} must be between 0 and 1`);
  return value;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function getRetryDelay(
  response: Response,
  attempt: number,
  retry: RetryPolicy,
  random: () => number,
): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1_000, retry.maxDelayMs);
  }
  return calculateBackoff(attempt, retry, random);
}

function calculateBackoff(attempt: number, retry: RetryPolicy, random: () => number): number {
  const exponential = Math.min(retry.baseDelayMs * 2 ** Math.max(attempt - 1, 0), retry.maxDelayMs);
  const jitter = exponential * retry.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}
