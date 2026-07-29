import type { MarketKind, MarketStatus } from '@forecast/domain';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export interface PolymarketClientOptions {
  gammaBaseUrl: string;
  timeoutMs: number;
  retry?: Partial<RetryPolicy>;
  fetchFn?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

export interface ListEventsOptions {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
}

export interface ListEventsKeysetOptions {
  limit?: number;
  order?: readonly string[];
  ascending?: boolean;
  afterCursor?: string;
  ids?: readonly number[];
  slugs?: readonly string[];
  closed?: boolean;
  live?: boolean;
  featured?: boolean;
  cyom?: boolean;
  titleSearch?: string;
  liquidityMin?: number;
  liquidityMax?: number;
  volumeMin?: number;
  volumeMax?: number;
  startDateMin?: string;
  startDateMax?: string;
  endDateMin?: string;
  endDateMax?: string;
  startTimeMin?: string;
  startTimeMax?: string;
  tagIds?: readonly number[];
  tagSlug?: string;
  excludeTagIds?: readonly number[];
  relatedTags?: boolean;
  tagMatch?: string;
  seriesIds?: readonly number[];
  gameIds?: readonly number[];
  eventDate?: string;
  eventWeek?: number;
  featuredOrder?: boolean;
  recurrence?: string;
  createdBy?: readonly string[];
  parentEventId?: number;
  includeChildren?: boolean;
  partnerSlug?: string;
  includeChat?: boolean;
  includeTemplate?: boolean;
  includeBestLines?: boolean;
  locale?: string;
}

export interface PolymarketMarketRaw extends Record<string, unknown> {
  id: string | number;
  question: string;
  conditionId?: unknown;
  description?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  clobTokenIds?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  restricted?: unknown;
  acceptingOrders?: unknown;
  enableOrderBook?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  updatedAt?: unknown;
  bestBid?: unknown;
  bestAsk?: unknown;
  lastTradePrice?: unknown;
}

export interface PolymarketEventRaw extends Record<string, unknown> {
  id: string | number;
  title: string;
  slug?: unknown;
  description?: unknown;
  resolutionSource?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  restricted?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  updatedAt?: unknown;
  markets?: unknown;
}

export interface EventsKeysetPage {
  events: PolymarketEventRaw[];
  nextCursor: string | null;
  requestCursor: string | null;
  requestUrl: string;
  fetchedAt: string;
  rawPayload: Record<string, unknown>;
}

export interface NormalizationWarning {
  scope: 'event' | 'market' | 'outcome';
  providerId: string;
  field: string;
  message: string;
}

export interface NormalizedPolymarketOutcome {
  providerOutcomeId: string | null;
  label: string;
  sortOrder: number;
  indicativePrice: number | null;
}

export interface NormalizedPolymarketMarket {
  providerMarketId: string;
  providerConditionId: string | null;
  providerEventId: string;
  kind: MarketKind;
  status: MarketStatus;
  title: string;
  rules: string | null;
  opensAt: string | null;
  closesAt: string | null;
  sourceUpdatedAt: string | null;
  outcomes: NormalizedPolymarketOutcome[];
  clobTokenIds: string[];
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
  flags: {
    active: boolean | null;
    closed: boolean | null;
    archived: boolean | null;
    restricted: boolean | null;
    acceptingOrders: boolean | null;
    enableOrderBook: boolean | null;
  };
  raw: PolymarketMarketRaw;
}

export interface NormalizedPolymarketEvent {
  providerEventId: string;
  slug: string | null;
  title: string;
  description: string | null;
  resolutionSource: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sourceUpdatedAt: string | null;
  markets: NormalizedPolymarketMarket[];
  raw: PolymarketEventRaw;
  warnings: NormalizationWarning[];
}

export interface EventsSyncCheckpoint {
  querySignature: string;
  nextCursor: string | null;
  pagesProcessed: number;
  eventsProcessed: number;
  updatedAt: string;
}

export interface EventsSyncPageCommit {
  provider: 'polymarket';
  resourceType: 'events';
  querySignature: string;
  runId: string | null;
  pageNumber: number;
  page: EventsKeysetPage;
  normalizedEvents: NormalizedPolymarketEvent[];
  warnings: NormalizationWarning[];
  cumulativePages: number;
  cumulativeEvents: number;
}

export interface EventsKeysetSyncStore {
  loadCheckpoint(querySignature: string): Promise<EventsSyncCheckpoint | null>;
  startRun(input: { querySignature: string; startedAt: string }): Promise<string | null>;
  commitPage(input: EventsSyncPageCommit): Promise<void>;
  completeRun(input: {
    runId: string | null;
    querySignature: string;
    completedAt: string;
    pagesProcessed: number;
    eventsProcessed: number;
    warningCount: number;
    fullyDrained: boolean;
    nextCursor: string | null;
  }): Promise<void>;
  failRun(input: {
    runId: string | null;
    querySignature: string;
    failedAt: string;
    error: string;
    pagesProcessed: number;
    eventsProcessed: number;
  }): Promise<void>;
}

export interface EventsKeysetSyncResult {
  querySignature: string;
  pagesProcessed: number;
  eventsProcessed: number;
  warningCount: number;
  fullyDrained: boolean;
  nextCursor: string | null;
  durationMs: number;
}
