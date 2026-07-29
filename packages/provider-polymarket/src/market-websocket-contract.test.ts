import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarketWebSocketMessage } from './market-websocket-contract.js';

test('parses official order book, price change, and last trade fixtures', () => {
  const book = parseMarketWebSocketMessage(JSON.stringify({
    event_type: 'book',
    asset_id: 'token-yes',
    market: 'condition-1',
    bids: [{ price: '0.48', size: '30' }],
    asks: [{ price: '0.52', size: '25' }],
    timestamp: '1757908892351',
    hash: '0xabc123',
  }));
  assert.deepEqual(book.events[0], {
    kind: 'book',
    marketId: 'condition-1',
    assetId: 'token-yes',
    timestampMs: 1757908892351,
    hash: '0xabc123',
    bids: [{ price: '0.48', size: '30' }],
    asks: [{ price: '0.52', size: '25' }],
  });

  const priceChange = parseMarketWebSocketMessage(JSON.stringify({
    event_type: 'price_change',
    market: 'condition-1',
    price_changes: [{
      asset_id: 'token-yes',
      price: '0.5',
      size: '200',
      side: 'BUY',
      hash: 'hash-1',
      best_bid: '0.5',
      best_ask: '0.51',
    }],
    timestamp: '1757908892352',
  }));
  assert.deepEqual(priceChange.events[0], {
    kind: 'price_change',
    marketId: 'condition-1',
    timestampMs: 1757908892352,
    changes: [{
      assetId: 'token-yes',
      price: '0.5',
      size: '200',
      side: 'BUY',
      hash: 'hash-1',
      bestBid: '0.5',
      bestAsk: '0.51',
    }],
  });

  const trade = parseMarketWebSocketMessage(JSON.stringify({
    event_type: 'last_trade_price',
    asset_id: 'token-yes',
    market: 'condition-1',
    price: '0.456',
    size: '219.217767',
    fee_rate_bps: '0',
    side: 'SELL',
    timestamp: '1750428146322',
    transaction_hash: '0xtrade',
  }));
  assert.deepEqual(trade.events[0], {
    kind: 'last_trade_price',
    marketId: 'condition-1',
    assetId: 'token-yes',
    timestampMs: 1750428146322,
    price: '0.456',
    size: '219.217767',
    side: 'SELL',
    transactionHash: '0xtrade',
  });
});

test('accepts heartbeat, arrays, forward-compatible events, and malformed input safely', () => {
  assert.deepEqual(parseMarketWebSocketMessage('PONG'), {
    heartbeat: true,
    events: [],
    warnings: [],
  });

  const arrayMessage = parseMarketWebSocketMessage(JSON.stringify([
    {
      event_type: 'tick_size_change',
      market: 'condition-1',
      asset_id: 'token-yes',
      old_tick_size: '0.01',
      new_tick_size: '0.001',
      timestamp: '1757908892353',
    },
    {
      event_type: 'future_event',
      market: 'condition-1',
      timestamp: '1757908892354',
    },
  ]));
  assert.equal(arrayMessage.events[0]?.kind, 'tick_size_change');
  assert.deepEqual(arrayMessage.events[1], {
    kind: 'unknown',
    eventType: 'future_event',
    marketId: 'condition-1',
    timestampMs: 1757908892354,
  });

  assert.deepEqual(parseMarketWebSocketMessage('{invalid'), {
    heartbeat: false,
    events: [],
    warnings: ['market WebSocket message was not valid JSON'],
  });
});

test('parses official new market and market resolved lifecycle fixtures', () => {
  const newMarket = parseMarketWebSocketMessage(JSON.stringify({
    event_type: 'new_market',
    id: '1031769',
    question: 'Will NVIDIA close above $240?',
    market: '0xcondition',
    slug: 'nvda-above-240',
    description: 'Resolution rules',
    assets_ids: ['token-yes', 'token-no'],
    outcomes: ['Yes', 'No'],
    event_message: {
      id: '125819',
      ticker: 'nvda-above',
      slug: 'nvda-above',
      title: 'Will NVIDIA close above ___?',
      description: 'Event rules',
    },
    timestamp: '1766790415550',
    tags: ['stocks'],
    condition_id: '0xcondition',
    active: true,
    clob_token_ids: ['token-yes', 'token-no'],
    sports_market_type: '',
    line: '',
    game_start_time: '',
    order_price_min_tick_size: '0.01',
    group_item_title: 'NVDA above $240',
  }));

  assert.deepEqual(newMarket.events[0], {
    kind: 'new_market',
    providerMarketId: '1031769',
    marketId: '0xcondition',
    conditionId: '0xcondition',
    timestampMs: 1766790415550,
    question: 'Will NVIDIA close above $240?',
    slug: 'nvda-above-240',
    description: 'Resolution rules',
    assetIds: ['token-yes', 'token-no'],
    outcomes: ['Yes', 'No'],
    event: {
      id: '125819',
      ticker: 'nvda-above',
      slug: 'nvda-above',
      title: 'Will NVIDIA close above ___?',
      description: 'Event rules',
    },
    tags: ['stocks'],
    active: true,
    clobTokenIds: ['token-yes', 'token-no'],
    sportsMarketType: '',
    line: '',
    gameStartTime: '',
    minTickSize: '0.01',
    groupItemTitle: 'NVDA above $240',
  });

  const resolved = parseMarketWebSocketMessage(JSON.stringify({
    event_type: 'market_resolved',
    id: '1031769',
    market: '0xcondition',
    assets_ids: ['token-yes', 'token-no'],
    winning_asset_id: 'token-yes',
    winning_outcome: 'Yes',
    timestamp: '1766790415550',
    tags: ['stocks'],
  }));

  assert.deepEqual(resolved.events[0], {
    kind: 'market_resolved',
    providerMarketId: '1031769',
    marketId: '0xcondition',
    timestampMs: 1766790415550,
    assetIds: ['token-yes', 'token-no'],
    winningAssetId: 'token-yes',
    winningOutcome: 'Yes',
    tags: ['stocks'],
  });
});
