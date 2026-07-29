import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketTokenSubscriptionRegistry } from './market-token-subscription-registry.js';
import {
  type MarketWebSocketLike,
  type MarketWebSocketScheduler,
  PolymarketMarketWebSocket,
} from './market-websocket.js';

test('sends initial, dynamic subscribe, dynamic unsubscribe, and heartbeat frames', () => {
  const scheduler = new ManualScheduler();
  const factory = new FakeWebSocketFactory();
  const events: string[] = [];
  const client = new PolymarketMarketWebSocket({
    registry: new MarketTokenSubscriptionRegistry(['token-a']),
    scheduler,
    webSocketFactory: factory.create,
    reconnectJitterRatio: 0,
    onEvent: (event) => events.push(event.kind),
  });

  client.start();
  const socket = factory.sockets[0];
  assert.ok(socket);
  socket.open();
  assert.deepEqual(parseFrame(socket.sent[0]), {
    type: 'market',
    assets_ids: ['token-a'],
    custom_feature_enabled: true,
  });

  client.subscribe(['token-b', 'token-b']);
  assert.deepEqual(parseFrame(socket.sent[1]), {
    operation: 'subscribe',
    assets_ids: ['token-b'],
    custom_feature_enabled: true,
  });

  client.unsubscribe(['token-a']);
  assert.deepEqual(parseFrame(socket.sent[2]), {
    operation: 'unsubscribe',
    assets_ids: ['token-a'],
  });

  scheduler.advance(10_000);
  assert.equal(socket.sent[3], 'PING');
  socket.receive('PONG');
  socket.receive(JSON.stringify({
    event_type: 'last_trade_price',
    market: 'condition-1',
    asset_id: 'token-b',
    price: '0.5',
    timestamp: '1757908892351',
  }));
  assert.deepEqual(events, ['last_trade_price']);
  assert.equal(client.getMetrics().lastPongAt, '1970-01-01T00:00:10.000Z');
});

test('reconnects with backoff and fully resubscribes the current registry', () => {
  const scheduler = new ManualScheduler();
  const factory = new FakeWebSocketFactory();
  const states: string[] = [];
  const client = new PolymarketMarketWebSocket({
    registry: new MarketTokenSubscriptionRegistry(['token-a']),
    scheduler,
    webSocketFactory: factory.create,
    reconnectBaseDelayMs: 1_000,
    reconnectMaxDelayMs: 8_000,
    reconnectJitterRatio: 0,
    onStateChange: (state) => states.push(state),
  });

  client.start();
  const firstSocket = factory.sockets[0];
  assert.ok(firstSocket);
  firstSocket.open();
  client.subscribe(['token-b']);
  firstSocket.serverClose();

  assert.equal(client.getState(), 'waiting_to_reconnect');
  client.unsubscribe(['token-a']);
  client.subscribe(['token-c']);
  scheduler.advance(999);
  assert.equal(factory.sockets.length, 1);
  scheduler.advance(1);
  assert.equal(factory.sockets.length, 2);

  const secondSocket = factory.sockets[1];
  assert.ok(secondSocket);
  secondSocket.open();
  assert.deepEqual(parseFrame(secondSocket.sent[0]), {
    type: 'market',
    assets_ids: ['token-b', 'token-c'],
    custom_feature_enabled: true,
  });
  assert.equal(client.getMetrics().reconnectsScheduled, 1);
  assert.ok(states.includes('waiting_to_reconnect'));
});

test('increases reconnect delay after consecutive failures before a connection opens', () => {
  const scheduler = new ManualScheduler();
  const factory = new FakeWebSocketFactory();
  const client = new PolymarketMarketWebSocket({
    registry: new MarketTokenSubscriptionRegistry(['token-a']),
    scheduler,
    webSocketFactory: factory.create,
    reconnectBaseDelayMs: 1_000,
    reconnectMaxDelayMs: 8_000,
    reconnectJitterRatio: 0,
  });

  client.start();
  factory.sockets[0]?.serverClose();
  scheduler.advance(1_000);
  assert.equal(factory.sockets.length, 2);

  factory.sockets[1]?.serverClose();
  scheduler.advance(1_999);
  assert.equal(factory.sockets.length, 2);
  scheduler.advance(1);
  assert.equal(factory.sockets.length, 3);
  assert.equal(client.getMetrics().reconnectsScheduled, 2);
});

test('stopping cancels reconnect and removing the final token closes the idle socket', () => {
  const scheduler = new ManualScheduler();
  const factory = new FakeWebSocketFactory();
  const client = new PolymarketMarketWebSocket({
    registry: new MarketTokenSubscriptionRegistry(['token-a']),
    scheduler,
    webSocketFactory: factory.create,
    reconnectJitterRatio: 0,
  });

  client.start();
  const firstSocket = factory.sockets[0];
  assert.ok(firstSocket);
  firstSocket.open();
  firstSocket.serverClose();
  client.stop();
  scheduler.advance(60_000);
  assert.equal(factory.sockets.length, 1);
  assert.equal(client.getState(), 'stopped');

  const secondClient = new PolymarketMarketWebSocket({
    registry: new MarketTokenSubscriptionRegistry(['token-b']),
    scheduler,
    webSocketFactory: factory.create,
  });
  secondClient.start();
  const secondSocket = factory.sockets[1];
  assert.ok(secondSocket);
  secondSocket.open();
  secondClient.unsubscribe(['token-b']);
  assert.equal(secondSocket.closeCalls.length, 1);
  assert.equal(secondClient.getState(), 'idle');
});

test('batches a large desired registry and uses subscription updates after the initial frame', () => {
  const factory = new FakeWebSocketFactory();
  const client = new PolymarketMarketWebSocket({
    registry: new MarketTokenSubscriptionRegistry(['token-c', 'token-a', 'token-b']),
    webSocketFactory: factory.create,
    scheduler: new ManualScheduler(),
    maxAssetsPerFrame: 2,
  });

  client.start();
  const socket = factory.sockets[0];
  assert.ok(socket);
  socket.open();
  assert.deepEqual(parseFrame(socket.sent[0]), {
    type: 'market',
    assets_ids: ['token-a', 'token-b'],
    custom_feature_enabled: true,
  });
  assert.deepEqual(parseFrame(socket.sent[1]), {
    operation: 'subscribe',
    assets_ids: ['token-c'],
    custom_feature_enabled: true,
  });
});

class FakeWebSocketFactory {
  readonly sockets: FakeWebSocket[] = [];
  readonly create = (_url: string): MarketWebSocketLike => {
    const socket = new FakeWebSocket();
    this.sockets.push(socket);
    return socket;
  };
}

class FakeWebSocket implements MarketWebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closeCalls.push({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
    this.onclose?.({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  serverClose(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: 'network_lost' });
  }
}

class ManualScheduler implements MarketWebSocketScheduler {
  private currentTime = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { at: this.currentTime + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.tasks.delete(handle);
  }

  advance(milliseconds: number): void {
    const target = this.currentTime + milliseconds;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (next === undefined) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.currentTime = task.at;
      task.callback();
    }
    this.currentTime = target;
  }
}

function parseFrame(value: string | undefined): unknown {
  assert.notEqual(value, undefined);
  return JSON.parse(value as string) as unknown;
}
