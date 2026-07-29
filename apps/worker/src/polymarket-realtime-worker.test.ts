import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ClobOrderBookSnapshot,
  PolymarketRealtimeMarketEvent,
} from '@forecast/provider-polymarket';
import {
  PolymarketRealtimeWorker,
  type MarketRealtimeDataStore,
  type MarketWebSocketController,
  websocketEventToUpdates,
} from './polymarket-realtime-worker.js';
import type {
  MarketPriceUpdate,
  PersistPriceUpdateResult,
  SubscribableMarketToken,
} from './postgres-market-price-store.js';

test('loads database tokens, reconciles REST before opening WebSocket, and persists live updates', async () => {
  const sequence: string[] = [];
  const store = new MemoryStore([
    { marketId: 'market-1', outcomeId: 'outcome-b', tokenId: 'token-b' },
    { marketId: 'market-1', outcomeId: 'outcome-a', tokenId: 'token-a' },
  ]);
  const socket = new FakeSocket(sequence);
  const worker = new PolymarketRealtimeWorker(
    store,
    {
      getOrderBooks: async (tokenIds) => {
        sequence.push('rest');
        assert.deepEqual([...tokenIds], ['token-a', 'token-b']);
        return [restFixture('token-a')];
      },
    },
    socket,
    {
      now: () => new Date('2026-07-29T12:00:01.000Z'),
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
    },
  );

  await worker.start();

  assert.deepEqual(sequence, ['replace:token-a,token-b', 'rest', 'socket:start']);
  assert.equal(store.updates[0]?.source, 'clob_rest');
  assert.equal(store.updates[0]?.tokenId, 'token-a');

  await worker.handleWebSocketEvent({
    kind: 'last_trade_price',
    marketId: 'condition-1',
    assetId: 'token-b',
    timestampMs: 1_785_326_400_000,
    price: '0.61',
    size: '4',
    side: 'BUY',
    transactionHash: '0xtrade',
  });

  assert.equal(store.updates[1]?.source, 'clob_websocket');
  assert.equal(store.updates[1]?.lastTrade, '0.61');
  await worker.stop();
  assert.equal(socket.stopped, true);
});

test('does not create price updates for non-price events or missing source timestamps', () => {
  const observedAt = new Date('2026-07-29T12:00:01.000Z');
  const noTimestamp: PolymarketRealtimeMarketEvent = {
    kind: 'best_bid_ask',
    marketId: 'condition-1',
    assetId: 'token-a',
    timestampMs: null,
    bestBid: '0.4',
    bestAsk: '0.6',
  };
  const unknown: PolymarketRealtimeMarketEvent = {
    kind: 'unknown',
    eventType: 'future',
    marketId: 'condition-1',
    timestampMs: 1_785_326_400_000,
  };

  assert.deepEqual(websocketEventToUpdates(noTimestamp, observedAt), []);
  assert.deepEqual(websocketEventToUpdates(unknown, observedAt), []);
});

test('bounds the WebSocket queue, reports drops, and drains accepted events before stop', async () => {
  let releaseFirstWrite: (() => void) | undefined;
  const firstWriteBlocked = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const logs: Array<{ event: string; details: object }> = [];
  let writeCount = 0;
  const store: MarketRealtimeDataStore = {
    loadSubscribableTokens: async () => [
      { marketId: 'market-1', outcomeId: 'outcome-a', tokenId: 'token-a' },
    ],
    persistPriceUpdate: async () => {
      writeCount += 1;
      if (writeCount === 1) await firstWriteBlocked;
      return { status: 'inserted', snapshotId: `snapshot-${writeCount}` };
    },
  };
  const worker = new PolymarketRealtimeWorker(
    store,
    { getOrderBooks: async () => [] },
    new FakeSocket([]),
    {
      maxEventQueueSize: 1,
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
      onLog: (_level, event, details) => logs.push({ event, details }),
    },
  );
  await worker.start();

  worker.enqueueWebSocketEvent(tradeFixture('trade-1'));
  worker.enqueueWebSocketEvent(tradeFixture('trade-2'));
  worker.enqueueWebSocketEvent(tradeFixture('trade-3'));
  await Promise.resolve();

  assert.equal(worker.getMetrics().queueHighWaterMark, 1);
  assert.equal(worker.getMetrics().droppedEvents, 1);
  assert.equal(
    logs.some((entry) => entry.event === 'market_websocket_event_dropped'),
    true,
  );

  releaseFirstWrite?.();
  await worker.stop();
  assert.equal(writeCount, 2);
  assert.equal(worker.getMetrics().processedEvents, 2);
  assert.equal(worker.getMetrics().queuedEvents, 0);
});

class MemoryStore implements MarketRealtimeDataStore {
  readonly updates: MarketPriceUpdate[] = [];

  constructor(private readonly tokens: SubscribableMarketToken[]) {}

  async loadSubscribableTokens(): Promise<SubscribableMarketToken[]> {
    return this.tokens;
  }

  async persistPriceUpdate(input: MarketPriceUpdate): Promise<PersistPriceUpdateResult> {
    this.updates.push(input);
    return { status: 'inserted', snapshotId: `snapshot-${this.updates.length}` };
  }
}

class FakeSocket implements MarketWebSocketController {
  stopped = false;

  constructor(private readonly sequence: string[]) {}

  start(): void {
    this.sequence.push('socket:start');
  }

  stop(): void {
    this.stopped = true;
  }

  replaceSubscriptions(tokenIds: Iterable<string>): void {
    this.sequence.push(`replace:${[...tokenIds].join(',')}`);
  }
}

function restFixture(assetId: string): ClobOrderBookSnapshot {
  return {
    marketId: 'condition-1',
    assetId,
    capturedAt: '2026-07-29T12:00:00.000Z',
    hash: 'hash-1',
    bids: [{ price: '0.4', size: '10' }],
    asks: [{ price: '0.6', size: '10' }],
    bestBid: '0.4',
    bestAsk: '0.6',
    midpoint: '0.5',
    lastTrade: '0.49',
    minOrderSize: '1',
    tickSize: '0.01',
    negativeRisk: false,
  };
}

function tradeFixture(transactionHash: string): PolymarketRealtimeMarketEvent {
  return {
    kind: 'last_trade_price',
    marketId: 'condition-1',
    assetId: 'token-a',
    timestampMs: 1_785_326_400_000,
    price: '0.61',
    size: '4',
    side: 'BUY',
    transactionHash,
  };
}
