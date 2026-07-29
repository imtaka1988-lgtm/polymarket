import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEventsKeysetUrl, PolymarketClient } from './polymarket-client.js';
import { normalizePolymarketEvent } from './normalizer.js';

const samplePayload = {
  events: [
    {
      id: 'event-1',
      title: 'Will the test pass?',
      updatedAt: '2026-07-29T10:00:00Z',
      markets: [
        {
          id: 'market-1',
          question: 'Will the test pass?',
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.63","0.37"]',
          clobTokenIds: '["token-yes","token-no"]',
          active: true,
          closed: false,
          acceptingOrders: true,
        },
      ],
    },
  ],
  next_cursor: 'cursor-2',
};

test('buildEventsKeysetUrl uses keyset parameters and never emits offset', () => {
  const url = buildEventsKeysetUrl('https://gamma-api.polymarket.com', {
    limit: 200,
    order: ['updatedAt', 'id'],
    ascending: true,
    afterCursor: 'cursor-1',
    closed: false,
    tagIds: [1, 2],
    includeChildren: true,
  });

  assert.equal(url.pathname, '/events/keyset');
  assert.equal(url.searchParams.get('after_cursor'), 'cursor-1');
  assert.equal(url.searchParams.get('order'), 'updatedAt,id');
  assert.deepEqual(url.searchParams.getAll('tag_id'), ['1', '2']);
  assert.equal(url.searchParams.has('offset'), false);
});

test('listEventsKeyset parses page metadata and retries a transient 503', async () => {
  let attempts = 0;
  const client = new PolymarketClient({
    gammaBaseUrl: 'https://gamma-api.polymarket.com',
    timeoutMs: 1_000,
    retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    sleep: async () => undefined,
    fetchFn: async () => {
      attempts += 1;
      if (attempts === 1) return new Response('{"error":"temporary"}', { status: 503 });
      return new Response(JSON.stringify(samplePayload), { status: 200 });
    },
    now: () => new Date('2026-07-29T12:00:00Z'),
  });

  const page = await client.listEventsKeyset({ limit: 1 });
  assert.equal(attempts, 2);
  assert.equal(page.events.length, 1);
  assert.equal(page.nextCursor, 'cursor-2');
  assert.equal(page.fetchedAt, '2026-07-29T12:00:00.000Z');
});

test('normalizer safely parses string-encoded outcome fields', () => {
  const sampleEvent = samplePayload.events[0];
  assert.ok(sampleEvent);
  const event = normalizePolymarketEvent(sampleEvent);
  const market = event.markets[0];
  assert.ok(market);
  assert.equal(market.status, 'open');
  assert.equal(market.outcomes[0]?.providerOutcomeId, 'token-yes');
  assert.equal(market.outcomes[0]?.indicativePrice, 0.63);
  assert.equal(event.warnings.length, 0);
});
