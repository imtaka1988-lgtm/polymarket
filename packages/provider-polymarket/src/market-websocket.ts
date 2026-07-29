import {
  type ParsedMarketWebSocketMessage,
  type PolymarketRealtimeMarketEvent,
  parseMarketWebSocketMessage,
} from './market-websocket-contract.js';
import { MarketTokenSubscriptionRegistry } from './market-token-subscription-registry.js';

const DEFAULT_MARKET_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export type MarketWebSocketState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'waiting_to_reconnect'
  | 'stopped';

export interface MarketWebSocketMetrics {
  connectionAttempts: number;
  connectionsOpened: number;
  reconnectsScheduled: number;
  messagesReceived: number;
  parseWarnings: number;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastMessageAt: string | null;
  lastPongAt: string | null;
}

export interface MarketWebSocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface MarketWebSocketScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PolymarketMarketWebSocketOptions {
  url?: string;
  registry?: MarketTokenSubscriptionRegistry;
  webSocketFactory?: (url: string) => MarketWebSocketLike;
  scheduler?: MarketWebSocketScheduler;
  heartbeatIntervalMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectJitterRatio?: number;
  maxAssetsPerFrame?: number;
  customFeatureEnabled?: boolean;
  random?: () => number;
  onEvent?: (event: PolymarketRealtimeMarketEvent) => void;
  onStateChange?: (state: MarketWebSocketState) => void;
  onWarning?: (message: string) => void;
}

export class PolymarketMarketWebSocket {
  readonly registry: MarketTokenSubscriptionRegistry;
  private readonly url: string;
  private readonly webSocketFactory: (url: string) => MarketWebSocketLike;
  private readonly scheduler: MarketWebSocketScheduler;
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly reconnectJitterRatio: number;
  private readonly maxAssetsPerFrame: number;
  private readonly customFeatureEnabled: boolean;
  private readonly random: () => number;
  private readonly onEvent: (event: PolymarketRealtimeMarketEvent) => void;
  private readonly onStateChange: (state: MarketWebSocketState) => void;
  private readonly onWarning: (message: string) => void;
  private readonly metrics: MarketWebSocketMetrics = {
    connectionAttempts: 0,
    connectionsOpened: 0,
    reconnectsScheduled: 0,
    messagesReceived: 0,
    parseWarnings: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastMessageAt: null,
    lastPongAt: null,
  };
  private socket: MarketWebSocketLike | null = null;
  private heartbeatTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private reconnectAttempt = 0;
  private started = false;
  private state: MarketWebSocketState = 'idle';

  constructor(options: PolymarketMarketWebSocketOptions = {}) {
    this.url = options.url ?? DEFAULT_MARKET_WS_URL;
    this.registry = options.registry ?? new MarketTokenSubscriptionRegistry();
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url) => new WebSocket(url) as unknown as MarketWebSocketLike);
    this.scheduler = options.scheduler ?? createDefaultScheduler();
    this.heartbeatIntervalMs = positiveInteger(options.heartbeatIntervalMs ?? 10_000, 'heartbeatIntervalMs');
    this.reconnectBaseDelayMs = positiveInteger(options.reconnectBaseDelayMs ?? 1_000, 'reconnectBaseDelayMs');
    this.reconnectMaxDelayMs = positiveInteger(options.reconnectMaxDelayMs ?? 30_000, 'reconnectMaxDelayMs');
    this.reconnectJitterRatio = boundedRatio(options.reconnectJitterRatio ?? 0.2, 'reconnectJitterRatio');
    this.maxAssetsPerFrame = positiveInteger(options.maxAssetsPerFrame ?? 500, 'maxAssetsPerFrame');
    this.customFeatureEnabled = options.customFeatureEnabled ?? true;
    this.random = options.random ?? Math.random;
    this.onEvent = options.onEvent ?? (() => undefined);
    this.onStateChange = options.onStateChange ?? (() => undefined);
    this.onWarning = options.onWarning ?? (() => undefined);
  }

  getState(): MarketWebSocketState {
    return this.state;
  }

  getMetrics(): MarketWebSocketMetrics {
    return { ...this.metrics };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.registry.size === 0) {
      this.transition('idle');
      return;
    }
    this.connect();
  }

  stop(): void {
    if (!this.started && this.state === 'stopped') return;
    this.started = false;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.detachAndCloseSocket(1000, 'client_stopped');
    this.transition('stopped');
  }

  subscribe(tokenIds: Iterable<string>): string[] {
    const delta = this.registry.add(tokenIds);
    if (delta.added.length === 0) return [];

    if (!this.started) return delta.added;
    if (this.isSocketOpen()) {
      this.sendSubscriptionUpdates('subscribe', delta.added);
    } else if (this.socket === null && this.reconnectTimer === null) {
      this.connect();
    }
    return delta.added;
  }

  unsubscribe(tokenIds: Iterable<string>): string[] {
    const delta = this.registry.remove(tokenIds);
    if (delta.removed.length === 0) return [];

    if (this.isSocketOpen()) this.sendSubscriptionUpdates('unsubscribe', delta.removed);
    if (this.registry.size === 0) {
      this.clearReconnectTimer();
      this.clearHeartbeatTimer();
      this.detachAndCloseSocket(1000, 'no_subscriptions');
      if (this.started) this.transition('idle');
    }
    return delta.removed;
  }

  replaceSubscriptions(tokenIds: Iterable<string>): void {
    const delta = this.registry.replace(tokenIds);
    if (!this.started) return;

    if (this.isSocketOpen()) {
      this.sendSubscriptionUpdates('unsubscribe', delta.removed);
      this.sendSubscriptionUpdates('subscribe', delta.added);
    }

    if (this.registry.size === 0) {
      this.clearReconnectTimer();
      this.clearHeartbeatTimer();
      this.detachAndCloseSocket(1000, 'no_subscriptions');
      this.transition('idle');
    } else if (this.socket === null && this.reconnectTimer === null) {
      this.connect();
    }
  }

  private connect(): void {
    if (!this.started || this.registry.size === 0 || this.socket !== null) return;
    this.clearReconnectTimer();
    this.transition('connecting');
    this.metrics.connectionAttempts += 1;

    let socket: MarketWebSocketLike;
    try {
      socket = this.webSocketFactory(this.url);
    } catch (error) {
      this.onWarning(`market WebSocket construction failed: ${errorMessage(error)}`);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.metrics.connectionsOpened += 1;
      this.metrics.lastConnectedAt = this.nowIso();
      this.transition('open');
      this.sendFullSubscription();
      this.scheduleHeartbeat();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    };
    socket.onerror = (event) => {
      if (this.socket !== socket) return;
      this.onWarning(`market WebSocket error: ${errorMessage(event)}`);
      this.handleDisconnect(socket);
      socket.close(1011, 'websocket_error');
    };
    socket.onclose = () => {
      this.handleDisconnect(socket);
    };
  }

  private handleMessage(data: unknown): void {
    this.metrics.messagesReceived += 1;
    this.metrics.lastMessageAt = this.nowIso();
    const parsed = parseMarketWebSocketMessage(data);
    this.recordParsedMessage(parsed);
  }

  private recordParsedMessage(parsed: ParsedMarketWebSocketMessage): void {
    if (parsed.heartbeat) this.metrics.lastPongAt = this.nowIso();
    this.metrics.parseWarnings += parsed.warnings.length;
    for (const warning of parsed.warnings) this.onWarning(warning);
    for (const event of parsed.events) this.onEvent(event);
  }

  private handleDisconnect(socket: MarketWebSocketLike): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.clearHeartbeatTimer();
    this.metrics.lastDisconnectedAt = this.nowIso();
    if (this.started && this.registry.size > 0) this.scheduleReconnect();
    else if (this.started) this.transition('idle');
  }

  private scheduleReconnect(): void {
    if (!this.started || this.registry.size === 0 || this.reconnectTimer !== null) return;
    const delayMs = this.calculateReconnectDelay();
    this.reconnectAttempt += 1;
    this.metrics.reconnectsScheduled += 1;
    this.transition('waiting_to_reconnect');
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private calculateReconnectDelay(): number {
    const exponential = Math.min(
      this.reconnectBaseDelayMs * 2 ** this.reconnectAttempt,
      this.reconnectMaxDelayMs,
    );
    const jitter = exponential * this.reconnectJitterRatio * (this.random() * 2 - 1);
    return Math.max(0, Math.round(exponential + jitter));
  }

  private sendFullSubscription(): void {
    const batches = chunk(this.registry.snapshot(), this.maxAssetsPerFrame);
    const first = batches.shift();
    if (first === undefined) return;
    this.sendJson({
      type: 'market',
      assets_ids: first,
      custom_feature_enabled: this.customFeatureEnabled,
    });
    for (const tokenIds of batches) this.sendSubscriptionUpdate('subscribe', tokenIds);
  }

  private sendSubscriptionUpdates(operation: 'subscribe' | 'unsubscribe', tokenIds: string[]): void {
    for (const batch of chunk(tokenIds, this.maxAssetsPerFrame)) {
      this.sendSubscriptionUpdate(operation, batch);
    }
  }

  private sendSubscriptionUpdate(operation: 'subscribe' | 'unsubscribe', tokenIds: string[]): void {
    if (tokenIds.length === 0) return;
    this.sendJson({
      operation,
      assets_ids: tokenIds,
      ...(operation === 'subscribe' ? { custom_feature_enabled: this.customFeatureEnabled } : {}),
    });
  }

  private sendJson(message: object): void {
    if (!this.isSocketOpen()) return;
    this.socket?.send(JSON.stringify(message));
  }

  private scheduleHeartbeat(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = this.scheduler.setTimeout(() => {
      this.heartbeatTimer = null;
      if (!this.isSocketOpen()) return;
      this.socket?.send('PING');
      this.scheduleHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private isSocketOpen(): boolean {
    return this.socket?.readyState === 1;
  }

  private detachAndCloseSocket(code: number, reason: string): void {
    const socket = this.socket;
    if (socket === null) return;
    this.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close(code, reason);
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer === null) return;
    this.scheduler.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    this.scheduler.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private transition(next: MarketWebSocketState): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange(next);
  }

  private nowIso(): string {
    return new Date(this.scheduler.now()).toISOString();
  }
}

function createDefaultScheduler(): MarketWebSocketScheduler {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function chunk<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function boundedRatio(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`);
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) return 'non-Error event';
  return String(error);
}
