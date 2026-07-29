import { PolymarketHttpError, PolymarketPayloadError } from './errors.js';
import { parseMarketLifecycleSnapshot } from './market-lifecycle.js';
import { isPolymarketEventRaw, isRecord } from './parsers.js';
import type {
  EventsKeysetPage,
  ListEventsKeysetOptions,
  ListEventsOptions,
  PolymarketClientOptions,
  PolymarketEventRaw,
  PolymarketMarketLifecycleSnapshot,
  RetryPolicy,
} from './types.js';

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitterRatio: 0.2,
};

export class PolymarketClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly retry: RetryPolicy;

  constructor(private readonly options: PolymarketClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => new Date());
    this.retry = {
      maxAttempts: options.retry?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
      baseDelayMs: options.retry?.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs,
      maxDelayMs: options.retry?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
      jitterRatio: options.retry?.jitterRatio ?? DEFAULT_RETRY_POLICY.jitterRatio,
    };
  }

  async listEvents(options: ListEventsOptions = {}): Promise<PolymarketEventRaw[]> {
    const url = new URL('/events', this.options.gammaBaseUrl);
    url.searchParams.set('limit', String(options.limit ?? 20));
    url.searchParams.set('offset', String(options.offset ?? 0));
    if (options.active !== undefined) url.searchParams.set('active', String(options.active));
    if (options.closed !== undefined) url.searchParams.set('closed', String(options.closed));

    const body = await this.requestJson(url);
    if (!Array.isArray(body))
      throw new PolymarketPayloadError(
        'Gamma /events returned a non-array payload',
        url.toString(),
      );
    return body.filter(isPolymarketEventRaw);
  }

  async listEventsKeyset(options: ListEventsKeysetOptions = {}): Promise<EventsKeysetPage> {
    validateKeysetOptions(options);
    const url = buildEventsKeysetUrl(this.options.gammaBaseUrl, options);
    const body = await this.requestJson(url);

    if (!isRecord(body) || !Array.isArray(body.events)) {
      throw new PolymarketPayloadError(
        'Gamma /events/keyset payload did not contain an events array',
        url.toString(),
      );
    }

    const invalidCount = body.events.filter((event) => !isPolymarketEventRaw(event)).length;
    if (invalidCount > 0) {
      throw new PolymarketPayloadError(
        `Gamma /events/keyset contained ${invalidCount} event records without a usable id/title`,
        url.toString(),
      );
    }

    if (body.next_cursor !== undefined && typeof body.next_cursor !== 'string') {
      throw new PolymarketPayloadError(
        'Gamma /events/keyset next_cursor was not a string',
        url.toString(),
      );
    }

    return {
      events: body.events as PolymarketEventRaw[],
      nextCursor:
        typeof body.next_cursor === 'string' && body.next_cursor.length > 0
          ? body.next_cursor
          : null,
      requestCursor: options.afterCursor ?? null,
      requestUrl: url.toString(),
      fetchedAt: this.now().toISOString(),
      rawPayload: body,
    };
  }

  async getMarketLifecycle(providerMarketId: string): Promise<PolymarketMarketLifecycleSnapshot> {
    const normalizedId = providerMarketId.trim();
    if (normalizedId.length === 0) throw new RangeError('providerMarketId must not be empty');
    const url = new URL(`/markets/${encodeURIComponent(normalizedId)}`, this.options.gammaBaseUrl);
    const body = await this.requestJson(url);
    return parseMarketLifecycleSnapshot(body, url.toString());
  }

  private async requestJson(url: URL): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchFn(url, {
          headers: { accept: 'application/json', 'user-agent': 'event-forecast-lab/0.2' },
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        const responseText = await response.text();

        if (!response.ok) {
          const retryable = isRetryableStatus(response.status);
          const error = new PolymarketHttpError(
            `Polymarket Gamma request failed: ${response.status} ${response.statusText}`,
            response.status,
            retryable,
            responseText.slice(0, 2_000),
          );
          if (!retryable || attempt === this.retry.maxAttempts) throw error;
          await this.sleep(getRetryDelay(response, attempt, this.retry));
          continue;
        }

        try {
          return JSON.parse(responseText) as unknown;
        } catch {
          throw new PolymarketPayloadError(
            'Polymarket Gamma returned invalid JSON',
            url.toString(),
          );
        }
      } catch (error) {
        lastError = error;
        if (error instanceof PolymarketPayloadError) throw error;
        if (error instanceof PolymarketHttpError && !error.retryable) throw error;
        if (attempt === this.retry.maxAttempts) throw error;
        await this.sleep(calculateBackoff(attempt, this.retry));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Polymarket request failed without an error object');
  }
}

export function buildEventsKeysetUrl(baseUrl: string, options: ListEventsKeysetOptions): URL {
  const url = new URL('/events/keyset', baseUrl);
  setNumber(url, 'limit', options.limit ?? 100);
  if (options.order !== undefined && options.order.length > 0)
    url.searchParams.set('order', options.order.join(','));
  setBoolean(url, 'ascending', options.ascending);
  setString(url, 'after_cursor', options.afterCursor);
  appendMany(url, 'id', options.ids);
  appendMany(url, 'slug', options.slugs);
  setBoolean(url, 'closed', options.closed);
  setBoolean(url, 'live', options.live);
  setBoolean(url, 'featured', options.featured);
  setBoolean(url, 'cyom', options.cyom);
  setString(url, 'title_search', options.titleSearch);
  setNumber(url, 'liquidity_min', options.liquidityMin);
  setNumber(url, 'liquidity_max', options.liquidityMax);
  setNumber(url, 'volume_min', options.volumeMin);
  setNumber(url, 'volume_max', options.volumeMax);
  setString(url, 'start_date_min', options.startDateMin);
  setString(url, 'start_date_max', options.startDateMax);
  setString(url, 'end_date_min', options.endDateMin);
  setString(url, 'end_date_max', options.endDateMax);
  setString(url, 'start_time_min', options.startTimeMin);
  setString(url, 'start_time_max', options.startTimeMax);
  appendMany(url, 'tag_id', options.tagIds);
  setString(url, 'tag_slug', options.tagSlug);
  appendMany(url, 'exclude_tag_id', options.excludeTagIds);
  setBoolean(url, 'related_tags', options.relatedTags);
  setString(url, 'tag_match', options.tagMatch);
  appendMany(url, 'series_id', options.seriesIds);
  appendMany(url, 'game_id', options.gameIds);
  setString(url, 'event_date', options.eventDate);
  setNumber(url, 'event_week', options.eventWeek);
  setBoolean(url, 'featured_order', options.featuredOrder);
  setString(url, 'recurrence', options.recurrence);
  appendMany(url, 'created_by', options.createdBy);
  setNumber(url, 'parent_event_id', options.parentEventId);
  setBoolean(url, 'include_children', options.includeChildren);
  setString(url, 'partner_slug', options.partnerSlug);
  setBoolean(url, 'include_chat', options.includeChat);
  setBoolean(url, 'include_template', options.includeTemplate);
  setBoolean(url, 'include_best_lines', options.includeBestLines);
  setString(url, 'locale', options.locale);
  return url;
}

function validateKeysetOptions(options: ListEventsKeysetOptions): void {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new RangeError('events keyset limit must be an integer from 1 to 500');

  const included = new Set(options.tagIds ?? []);
  const overlap = (options.excludeTagIds ?? []).filter((tagId) => included.has(tagId));
  if (overlap.length > 0)
    throw new RangeError(`tagIds and excludeTagIds overlap: ${overlap.join(',')}`);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function getRetryDelay(response: Response, attempt: number, retry: RetryPolicy): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1_000, retry.maxDelayMs);
    const dateValue = Date.parse(retryAfter);
    if (!Number.isNaN(dateValue))
      return Math.min(Math.max(dateValue - Date.now(), 0), retry.maxDelayMs);
  }
  return calculateBackoff(attempt, retry);
}

function calculateBackoff(attempt: number, retry: RetryPolicy): number {
  const exponential = Math.min(retry.baseDelayMs * 2 ** Math.max(attempt - 1, 0), retry.maxDelayMs);
  const jitter = exponential * retry.jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

function appendMany(url: URL, key: string, values: readonly (string | number)[] | undefined): void {
  for (const value of values ?? []) url.searchParams.append(key, String(value));
}

function setString(url: URL, key: string, value: string | undefined): void {
  if (value !== undefined) url.searchParams.set(key, value);
}

function setNumber(url: URL, key: string, value: number | undefined): void {
  if (value !== undefined) url.searchParams.set(key, String(value));
}

function setBoolean(url: URL, key: string, value: boolean | undefined): void {
  if (value !== undefined) url.searchParams.set(key, String(value));
}
