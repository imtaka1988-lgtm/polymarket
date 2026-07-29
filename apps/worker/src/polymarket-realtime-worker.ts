import { createHash } from 'node:crypto';
import type {
  ClobOrderBookSnapshot,
  PolymarketRealtimeMarketEvent,
} from '@forecast/provider-polymarket';
import { averageDecimalStrings } from '@forecast/provider-polymarket';
import type {
  MarketPriceUpdate,
  PersistPriceUpdateResult,
  SubscribableMarketToken,
} from './postgres-market-price-store.js';

export interface MarketRealtimeDataStore {
  loadSubscribableTokens(): Promise<SubscribableMarketToken[]>;
  persistPriceUpdate(input: MarketPriceUpdate): Promise<PersistPriceUpdateResult>;
}

export interface ClobOrderBookClient {
  getOrderBooks(tokenIds: Iterable<string>): Promise<ClobOrderBookSnapshot[]>;
}

export interface MarketWebSocketController {
  start(): void;
  stop(): void;
  replaceSubscriptions(tokenIds: Iterable<string>): void;
}

export interface PolymarketRealtimeWorkerOptions {
  tokenRefreshIntervalMs?: number;
  reconciliationIntervalMs?: number;
  maxEventQueueSize?: number;
  now?: () => Date;
  setIntervalFn?: (callback: () => void, delayMs: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  onLog?: (level: 'info' | 'warn' | 'error', event: string, details: object) => void;
}

export interface PolymarketRealtimeWorkerMetrics {
  queuedEvents: number;
  queueHighWaterMark: number;
  processedEvents: number;
  failedEvents: number;
  droppedEvents: number;
}

export class PolymarketRealtimeWorker {
  private readonly tokenRefreshIntervalMs: number;
  private readonly reconciliationIntervalMs: number;
  private readonly maxEventQueueSize: number;
  private readonly now: () => Date;
  private readonly setIntervalFn: (callback: () => void, delayMs: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;
  private readonly onLog: (
    level: 'info' | 'warn' | 'error',
    event: string,
    details: object,
  ) => void;
  private tokenIds: string[] = [];
  private tokenRefreshTimer: unknown = null;
  private reconciliationTimer: unknown = null;
  private started = false;
  private activeReconciliation: Promise<{
    requested: number;
    inserted: number;
    duplicates: number;
    unmatched: number;
  }> | null = null;
  private readonly eventQueue: PolymarketRealtimeMarketEvent[] = [];
  private eventProcessing: Promise<void> | null = null;
  private readonly metrics: PolymarketRealtimeWorkerMetrics = {
    queuedEvents: 0,
    queueHighWaterMark: 0,
    processedEvents: 0,
    failedEvents: 0,
    droppedEvents: 0,
  };

  constructor(
    private readonly store: MarketRealtimeDataStore,
    private readonly restClient: ClobOrderBookClient,
    private readonly webSocket: MarketWebSocketController,
    options: PolymarketRealtimeWorkerOptions = {},
  ) {
    this.tokenRefreshIntervalMs = positiveInteger(
      options.tokenRefreshIntervalMs ?? 60_000,
      'tokenRefreshIntervalMs',
    );
    this.reconciliationIntervalMs = positiveInteger(
      options.reconciliationIntervalMs ?? 60_000,
      'reconciliationIntervalMs',
    );
    this.maxEventQueueSize = positiveInteger(
      options.maxEventQueueSize ?? 10_000,
      'maxEventQueueSize',
    );
    this.now = options.now ?? (() => new Date());
    this.setIntervalFn =
      options.setIntervalFn ?? ((callback, delayMs) => setInterval(callback, delayMs));
    this.clearIntervalFn =
      options.clearIntervalFn ??
      ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
    this.onLog = options.onLog ?? (() => undefined);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await this.refreshSubscriptions();
      await this.reconcile().catch((error) =>
        this.logFailure('market_rest_reconciliation_failed', error),
      );
      this.webSocket.start();
      this.tokenRefreshTimer = this.setIntervalFn(() => {
        void this.refreshSubscriptions().catch((error) =>
          this.logFailure('market_token_refresh_failed', error),
        );
      }, this.tokenRefreshIntervalMs);
      this.reconciliationTimer = this.setIntervalFn(() => {
        void this.reconcile().catch((error) =>
          this.logFailure('market_rest_reconciliation_failed', error),
        );
      }, this.reconciliationIntervalMs);
    } catch (error) {
      this.started = false;
      this.webSocket.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.tokenRefreshTimer !== null) this.clearIntervalFn(this.tokenRefreshTimer);
    if (this.reconciliationTimer !== null) this.clearIntervalFn(this.reconciliationTimer);
    this.tokenRefreshTimer = null;
    this.reconciliationTimer = null;
    this.webSocket.stop();
    await this.activeReconciliation;
    await this.eventProcessing;
  }

  getMetrics(): PolymarketRealtimeWorkerMetrics {
    return {
      ...this.metrics,
      queuedEvents: this.eventQueue.length,
    };
  }

  enqueueWebSocketEvent(event: PolymarketRealtimeMarketEvent): void {
    if (!this.started) return;
    if (this.eventQueue.length >= this.maxEventQueueSize) {
      this.metrics.droppedEvents += 1;
      this.onLog('error', 'market_websocket_event_dropped', {
        kind: event.kind,
        queueSize: this.eventQueue.length,
        maxEventQueueSize: this.maxEventQueueSize,
      });
      return;
    }
    this.eventQueue.push(event);
    this.metrics.queueHighWaterMark = Math.max(
      this.metrics.queueHighWaterMark,
      this.eventQueue.length,
    );
    this.startEventDrain();
  }

  async refreshSubscriptions(): Promise<string[]> {
    const tokens = await this.store.loadSubscribableTokens();
    this.tokenIds = [
      ...new Set(tokens.map((token) => token.tokenId.trim()).filter(Boolean)),
    ].sort();
    this.webSocket.replaceSubscriptions(this.tokenIds);
    this.onLog('info', 'market_token_registry_refreshed', { tokenCount: this.tokenIds.length });
    return [...this.tokenIds];
  }

  async reconcile(): Promise<{
    requested: number;
    inserted: number;
    duplicates: number;
    unmatched: number;
  }> {
    if (this.activeReconciliation !== null) {
      this.onLog('warn', 'market_rest_reconciliation_skipped', {
        reason: 'previous_run_still_active',
      });
      return { requested: 0, inserted: 0, duplicates: 0, unmatched: 0 };
    }
    if (this.tokenIds.length === 0) {
      this.onLog('info', 'market_rest_reconciliation_skipped', { reason: 'empty_token_registry' });
      return { requested: 0, inserted: 0, duplicates: 0, unmatched: 0 };
    }

    const task = this.runReconciliation();
    this.activeReconciliation = task;
    try {
      return await task;
    } finally {
      if (this.activeReconciliation === task) this.activeReconciliation = null;
    }
  }

  async handleWebSocketEvent(event: PolymarketRealtimeMarketEvent): Promise<void> {
    const observedAt = this.now();
    const updates = websocketEventToUpdates(event, observedAt);
    if (updates.length === 0) return;

    for (const update of updates) {
      const result = await this.store.persistPriceUpdate(update);
      if (result.status === 'unmatched_token') {
        this.onLog('warn', 'market_price_token_unmatched', {
          tokenId: update.tokenId,
          source: update.source,
        });
      }
    }
  }

  private logFailure(event: string, error: unknown): void {
    this.onLog('error', event, { message: error instanceof Error ? error.message : String(error) });
  }

  private async runReconciliation(): Promise<{
    requested: number;
    inserted: number;
    duplicates: number;
    unmatched: number;
  }> {
    const snapshots = await this.restClient.getOrderBooks(this.tokenIds);
    const counts = { requested: this.tokenIds.length, inserted: 0, duplicates: 0, unmatched: 0 };
    for (const snapshot of snapshots) {
      const result = await this.store.persistPriceUpdate(
        restSnapshotToUpdate(snapshot, this.now()),
      );
      incrementResult(counts, result);
    }
    this.onLog('info', 'market_rest_reconciliation_completed', counts);
    return counts;
  }

  private startEventDrain(): void {
    if (this.eventProcessing !== null) return;
    this.eventProcessing = this.drainEventQueue().finally(() => {
      this.eventProcessing = null;
      if (this.eventQueue.length > 0) this.startEventDrain();
    });
  }

  private async drainEventQueue(): Promise<void> {
    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift();
      if (event === undefined) continue;
      try {
        await this.handleWebSocketEvent(event);
        this.metrics.processedEvents += 1;
      } catch (error) {
        this.metrics.failedEvents += 1;
        this.logFailure('market_websocket_event_persist_failed', error);
      }
    }
  }
}

export function restSnapshotToUpdate(
  snapshot: ClobOrderBookSnapshot,
  observedAt: Date,
): MarketPriceUpdate {
  return {
    tokenId: snapshot.assetId,
    source: 'clob_rest',
    sourceEventKey: eventKey('rest_book', {
      assetId: snapshot.assetId,
      capturedAt: snapshot.capturedAt,
      hash: snapshot.hash,
    }),
    sourceHash: snapshot.hash,
    metadata: {
      marketId: snapshot.marketId,
      bids: snapshot.bids,
      asks: snapshot.asks,
      minOrderSize: snapshot.minOrderSize,
      tickSize: snapshot.tickSize,
      negativeRisk: snapshot.negativeRisk,
    },
    capturedAt: snapshot.capturedAt,
    observedAt: observedAt.toISOString(),
    bid: snapshot.bestBid,
    ask: snapshot.bestAsk,
    midpoint: snapshot.midpoint,
    lastTrade: snapshot.lastTrade,
  };
}

export function websocketEventToUpdates(
  event: PolymarketRealtimeMarketEvent,
  observedAt: Date,
): MarketPriceUpdate[] {
  const capturedAt = timestampToIso(event.timestampMs);
  if (capturedAt === null) return [];
  const observedAtIso = observedAt.toISOString();

  switch (event.kind) {
    case 'book': {
      const bid = highest(event.bids.map((level) => level.price));
      const ask = lowest(event.asks.map((level) => level.price));
      const update = buildWebSocketUpdate({
        event,
        tokenId: event.assetId,
        capturedAt,
        observedAt: observedAtIso,
        hash: event.hash,
        bid,
        ask,
        midpoint: calculateMidpoint(bid, ask),
        lastTrade: null,
      });
      return hasPrice(update) ? [update] : [];
    }
    case 'price_change':
      return event.changes
        .map((change) =>
          buildWebSocketUpdate({
            event,
            tokenId: change.assetId,
            capturedAt,
            observedAt: observedAtIso,
            hash: change.hash,
            bid: change.bestBid,
            ask: change.bestAsk,
            midpoint: calculateMidpoint(change.bestBid, change.bestAsk),
            lastTrade: null,
          }),
        )
        .filter(hasPrice);
    case 'last_trade_price':
      return [
        buildWebSocketUpdate({
          event,
          tokenId: event.assetId,
          capturedAt,
          observedAt: observedAtIso,
          hash: event.transactionHash,
          bid: null,
          ask: null,
          midpoint: null,
          lastTrade: event.price,
        }),
      ];
    case 'best_bid_ask': {
      const update = buildWebSocketUpdate({
        event,
        tokenId: event.assetId,
        capturedAt,
        observedAt: observedAtIso,
        hash: null,
        bid: event.bestBid,
        ask: event.bestAsk,
        midpoint: calculateMidpoint(event.bestBid, event.bestAsk),
        lastTrade: null,
      });
      return hasPrice(update) ? [update] : [];
    }
    default:
      return [];
  }
}

function hasPrice(update: MarketPriceUpdate): boolean {
  return (
    update.bid !== null ||
    update.ask !== null ||
    update.midpoint !== null ||
    update.lastTrade !== null
  );
}

function buildWebSocketUpdate(input: {
  event: PolymarketRealtimeMarketEvent;
  tokenId: string;
  capturedAt: string;
  observedAt: string;
  hash: string | null;
  bid: string | null;
  ask: string | null;
  midpoint: string | null;
  lastTrade: string | null;
}): MarketPriceUpdate {
  return {
    tokenId: input.tokenId,
    source: 'clob_websocket',
    sourceEventKey: eventKey(`websocket_${input.event.kind}`, {
      event: input.event,
      tokenId: input.tokenId,
    }),
    sourceHash: input.hash,
    metadata: { eventKind: input.event.kind },
    capturedAt: input.capturedAt,
    observedAt: input.observedAt,
    bid: input.bid,
    ask: input.ask,
    midpoint: input.midpoint,
    lastTrade: input.lastTrade,
  };
}

function eventKey(prefix: string, value: unknown): string {
  const digest = createHash('sha256').update(stableStringify(value)).digest('hex');
  return `polymarket:${prefix}:${digest}`;
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

function timestampToIso(timestampMs: number | null): string | null {
  if (timestampMs === null) return null;
  const milliseconds = timestampMs < 1_000_000_000_000 ? timestampMs * 1_000 : timestampMs;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function highest(values: string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((result, value) => (Number(value) > Number(result) ? value : result));
}

function lowest(values: string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((result, value) => (Number(value) < Number(result) ? value : result));
}

function calculateMidpoint(bid: string | null, ask: string | null): string | null {
  if (bid === null || ask === null) return null;
  return averageDecimalStrings(bid, ask);
}

function incrementResult(
  counts: { inserted: number; duplicates: number; unmatched: number },
  result: PersistPriceUpdateResult,
): void {
  if (result.status === 'inserted') counts.inserted += 1;
  else if (result.status === 'duplicate') counts.duplicates += 1;
  else counts.unmatched += 1;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive integer`);
  return value;
}
