import assert from 'node:assert/strict';
import test from 'node:test';
import { PolymarketClobRestClient, parseOrderBookSnapshot } from './clob-rest-client.js';

test('batches token ids, retries a transient failure, and parses official order books', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  let call = 0;
  const client = new PolymarketClobRestClient({
    maxTokensPerRequest: 2,
    retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
    sleep: async () => undefined,
    fetchFn: async (input, init) => {
      call += 1;
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as unknown });
      if (call === 1) return new Response('temporary', { status: 503 });
      const requested = JSON.parse(String(init?.body)) as Array<{ token_id: string }>;
      return Response.json(
        requested.map(({ token_id: tokenId }, index) => fixture(tokenId, index)),
      );
    },
  });

  const snapshots = await client.getOrderBooks([' token-b ', 'token-a', 'token-c', 'token-a']);

  assert.equal(requests.length, 3);
  assert.deepEqual(requests[1]?.body, [{ token_id: 'token-a' }, { token_id: 'token-b' }]);
  assert.deepEqual(requests[2]?.body, [{ token_id: 'token-c' }]);
  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots[0], {
    marketId: 'condition-token-a',
    assetId: 'token-a',
    capturedAt: '2025-07-29T00:00:00.000Z',
    hash: 'hash-token-a',
    bids: [
      { price: '0.4', size: '10' },
      { price: '0.45', size: '5' },
    ],
    asks: [
      { price: '0.6', size: '10' },
      { price: '0.55', size: '5' },
    ],
    bestBid: '0.45',
    bestAsk: '0.55',
    midpoint: '0.5',
    lastTrade: '0.49',
    minOrderSize: '1',
    tickSize: '0.01',
    negativeRisk: false,
  });
});

test('rejects malformed order book levels instead of persisting invented prices', () => {
  assert.throws(
    () =>
      parseOrderBookSnapshot({
        market: 'condition',
        asset_id: 'token',
        timestamp: '1753747200000',
        hash: 'hash',
        bids: [{ price: 'invalid', size: '1' }],
        asks: [],
      }),
    /invalid price or size/,
  );
});

function fixture(tokenId: string, index: number): object {
  return {
    market: `condition-${tokenId}`,
    asset_id: tokenId,
    timestamp: String(1_753_747_200_000 + index),
    hash: `hash-${tokenId}`,
    bids: [
      { price: '0.4', size: '10' },
      { price: '0.45', size: '5' },
    ],
    asks: [
      { price: '0.6', size: '10' },
      { price: '0.55', size: '5' },
    ],
    min_order_size: '1',
    tick_size: '0.01',
    neg_risk: false,
    last_trade_price: '0.49',
  };
}
