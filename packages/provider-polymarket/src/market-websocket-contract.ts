import { asBoolean, asFiniteNumber, asString, isRecord, parseStringArray } from './parsers.js';

export interface RealtimeOrderBookLevel {
  price: string;
  size: string;
}

export interface RealtimeBookEvent {
  kind: 'book';
  marketId: string;
  assetId: string;
  timestampMs: number | null;
  hash: string | null;
  bids: RealtimeOrderBookLevel[];
  asks: RealtimeOrderBookLevel[];
}

export interface RealtimePriceChange {
  assetId: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL' | null;
  hash: string | null;
  bestBid: string | null;
  bestAsk: string | null;
}

export interface RealtimePriceChangeEvent {
  kind: 'price_change';
  marketId: string;
  timestampMs: number | null;
  changes: RealtimePriceChange[];
}

export interface RealtimeLastTradePriceEvent {
  kind: 'last_trade_price';
  marketId: string;
  assetId: string;
  timestampMs: number | null;
  price: string;
  size: string | null;
  side: 'BUY' | 'SELL' | null;
  transactionHash: string | null;
}

export interface RealtimeTickSizeChangeEvent {
  kind: 'tick_size_change';
  marketId: string;
  assetId: string;
  timestampMs: number | null;
  oldTickSize: string;
  newTickSize: string;
}

export interface RealtimeBestBidAskEvent {
  kind: 'best_bid_ask';
  marketId: string;
  assetId: string;
  timestampMs: number | null;
  bestBid: string | null;
  bestAsk: string | null;
}

export interface RealtimeNewMarketEventMessage {
  id: string | null;
  ticker: string | null;
  slug: string | null;
  title: string | null;
  description: string | null;
}

export interface RealtimeNewMarketEvent {
  kind: 'new_market';
  providerMarketId: string;
  marketId: string;
  conditionId: string | null;
  timestampMs: number | null;
  question: string | null;
  slug: string | null;
  description: string | null;
  assetIds: string[];
  outcomes: string[];
  event: RealtimeNewMarketEventMessage | null;
  tags: string[];
  active: boolean | null;
  clobTokenIds: string[];
  sportsMarketType: string | null;
  line: string | null;
  gameStartTime: string | null;
  minTickSize: string | null;
  groupItemTitle: string | null;
}

export interface RealtimeMarketResolvedEvent {
  kind: 'market_resolved';
  providerMarketId: string;
  marketId: string;
  timestampMs: number | null;
  assetIds: string[];
  winningAssetId: string;
  winningOutcome: string;
  tags: string[];
}

export interface RealtimeUnknownEvent {
  kind: 'unknown';
  eventType: string;
  marketId: string | null;
  timestampMs: number | null;
}

export type PolymarketRealtimeMarketEvent =
  | RealtimeBookEvent
  | RealtimePriceChangeEvent
  | RealtimeLastTradePriceEvent
  | RealtimeTickSizeChangeEvent
  | RealtimeBestBidAskEvent
  | RealtimeNewMarketEvent
  | RealtimeMarketResolvedEvent
  | RealtimeUnknownEvent;

export interface ParsedMarketWebSocketMessage {
  heartbeat: boolean;
  events: PolymarketRealtimeMarketEvent[];
  warnings: string[];
}

export function parseMarketWebSocketMessage(data: unknown): ParsedMarketWebSocketMessage {
  if (data === 'PONG') return { heartbeat: true, events: [], warnings: [] };
  if (typeof data !== 'string') {
    return { heartbeat: false, events: [], warnings: ['market WebSocket message was not text'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return { heartbeat: false, events: [], warnings: ['market WebSocket message was not valid JSON'] };
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  const events: PolymarketRealtimeMarketEvent[] = [];
  const warnings: string[] = [];

  for (const candidate of candidates) {
    const event = parseEvent(candidate);
    if (event === null) {
      warnings.push('market WebSocket event lacked a usable event_type or required identifiers');
      continue;
    }
    events.push(event);
  }

  return { heartbeat: false, events, warnings };
}

function parseEvent(value: unknown): PolymarketRealtimeMarketEvent | null {
  if (!isRecord(value)) return null;
  const eventType = asString(value.event_type);
  if (eventType === null) return null;

  switch (eventType) {
    case 'book':
      return parseBook(value);
    case 'price_change':
      return parsePriceChange(value);
    case 'last_trade_price':
      return parseLastTradePrice(value);
    case 'tick_size_change':
      return parseTickSizeChange(value);
    case 'best_bid_ask':
      return parseBestBidAsk(value);
    case 'new_market':
      return parseNewMarket(value);
    case 'market_resolved':
      return parseMarketResolved(value);
    default:
      return {
        kind: 'unknown',
        eventType,
        marketId: asString(value.market),
        timestampMs: parseTimestamp(value.timestamp),
      };
  }
}

function parseBook(value: Record<string, unknown>): RealtimeBookEvent | null {
  const marketId = asString(value.market);
  const assetId = asString(value.asset_id);
  if (marketId === null || assetId === null) return null;

  return {
    kind: 'book',
    marketId,
    assetId,
    timestampMs: parseTimestamp(value.timestamp),
    hash: asString(value.hash),
    bids: parseLevels(value.bids),
    asks: parseLevels(value.asks),
  };
}

function parsePriceChange(value: Record<string, unknown>): RealtimePriceChangeEvent | null {
  const marketId = asString(value.market);
  if (marketId === null || !Array.isArray(value.price_changes)) return null;

  const changes: RealtimePriceChange[] = [];
  for (const candidate of value.price_changes) {
    if (!isRecord(candidate)) continue;
    const assetId = asString(candidate.asset_id);
    const price = asDecimalString(candidate.price);
    const size = asDecimalString(candidate.size);
    if (assetId === null || price === null || size === null) continue;
    changes.push({
      assetId,
      price,
      size,
      side: parseSide(candidate.side),
      hash: asString(candidate.hash),
      bestBid: asDecimalString(candidate.best_bid),
      bestAsk: asDecimalString(candidate.best_ask),
    });
  }

  return {
    kind: 'price_change',
    marketId,
    timestampMs: parseTimestamp(value.timestamp),
    changes,
  };
}

function parseLastTradePrice(value: Record<string, unknown>): RealtimeLastTradePriceEvent | null {
  const marketId = asString(value.market);
  const assetId = asString(value.asset_id);
  const price = asDecimalString(value.price);
  if (marketId === null || assetId === null || price === null) return null;

  return {
    kind: 'last_trade_price',
    marketId,
    assetId,
    timestampMs: parseTimestamp(value.timestamp),
    price,
    size: asDecimalString(value.size),
    side: parseSide(value.side),
    transactionHash: asString(value.transaction_hash),
  };
}

function parseTickSizeChange(value: Record<string, unknown>): RealtimeTickSizeChangeEvent | null {
  const marketId = asString(value.market);
  const assetId = asString(value.asset_id);
  const oldTickSize = asDecimalString(value.old_tick_size);
  const newTickSize = asDecimalString(value.new_tick_size);
  if (marketId === null || assetId === null || oldTickSize === null || newTickSize === null) return null;

  return {
    kind: 'tick_size_change',
    marketId,
    assetId,
    timestampMs: parseTimestamp(value.timestamp),
    oldTickSize,
    newTickSize,
  };
}

function parseBestBidAsk(value: Record<string, unknown>): RealtimeBestBidAskEvent | null {
  const marketId = asString(value.market);
  const assetId = asString(value.asset_id);
  if (marketId === null || assetId === null) return null;

  return {
    kind: 'best_bid_ask',
    marketId,
    assetId,
    timestampMs: parseTimestamp(value.timestamp),
    bestBid: asDecimalString(value.best_bid),
    bestAsk: asDecimalString(value.best_ask),
  };
}

function parseNewMarket(value: Record<string, unknown>): RealtimeNewMarketEvent | null {
  const providerMarketId = asString(value.id);
  const marketId = asString(value.market);
  if (providerMarketId === null || marketId === null) return null;

  return {
    kind: 'new_market',
    providerMarketId,
    marketId,
    conditionId: asString(value.condition_id),
    timestampMs: parseTimestamp(value.timestamp),
    question: asString(value.question),
    slug: asString(value.slug),
    description: asString(value.description),
    assetIds: parseStringArray(value.assets_ids).values,
    outcomes: parseStringArray(value.outcomes).values,
    event: parseNewMarketEventMessage(value.event_message),
    tags: parseStringArray(value.tags).values,
    active: asBoolean(value.active),
    clobTokenIds: parseStringArray(value.clob_token_ids).values,
    sportsMarketType: asString(value.sports_market_type),
    line: asString(value.line),
    gameStartTime: asString(value.game_start_time),
    minTickSize: asDecimalString(value.order_price_min_tick_size),
    groupItemTitle: asString(value.group_item_title),
  };
}

function parseNewMarketEventMessage(value: unknown): RealtimeNewMarketEventMessage | null {
  if (!isRecord(value)) return null;
  return {
    id: asString(value.id),
    ticker: asString(value.ticker),
    slug: asString(value.slug),
    title: asString(value.title),
    description: asString(value.description),
  };
}

function parseMarketResolved(value: Record<string, unknown>): RealtimeMarketResolvedEvent | null {
  const providerMarketId = asString(value.id);
  const marketId = asString(value.market);
  const winningAssetId = asString(value.winning_asset_id);
  const winningOutcome = asString(value.winning_outcome);
  if (
    providerMarketId === null ||
    marketId === null ||
    winningAssetId === null ||
    winningOutcome === null
  ) {
    return null;
  }

  return {
    kind: 'market_resolved',
    providerMarketId,
    marketId,
    timestampMs: parseTimestamp(value.timestamp),
    assetIds: parseStringArray(value.assets_ids).values,
    winningAssetId,
    winningOutcome,
    tags: parseStringArray(value.tags).values,
  };
}

function parseLevels(value: unknown): RealtimeOrderBookLevel[] {
  if (!Array.isArray(value)) return [];
  const levels: RealtimeOrderBookLevel[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const price = asDecimalString(candidate.price);
    const size = asDecimalString(candidate.size);
    if (price !== null && size !== null) levels.push({ price, size });
  }
  return levels;
}

function asDecimalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0 && asFiniteNumber(value) !== null) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function parseTimestamp(value: unknown): number | null {
  const parsed = asFiniteNumber(value);
  return parsed === null ? null : parsed;
}

function parseSide(value: unknown): 'BUY' | 'SELL' | null {
  return value === 'BUY' || value === 'SELL' ? value : null;
}
