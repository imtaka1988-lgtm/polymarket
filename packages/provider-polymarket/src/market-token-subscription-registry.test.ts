import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketTokenSubscriptionRegistry } from './market-token-subscription-registry.js';

test('registry normalizes, deduplicates, adds, removes, and replaces token ids', () => {
  const registry = new MarketTokenSubscriptionRegistry([' token-b ', 'token-a', 'token-a', '']);

  assert.deepEqual(registry.snapshot(), ['token-a', 'token-b']);
  assert.equal(registry.has(' token-a '), true);

  assert.deepEqual(registry.add(['token-b', 'token-c']), {
    added: ['token-c'],
    removed: [],
    current: ['token-a', 'token-b', 'token-c'],
  });
  assert.deepEqual(registry.remove(['missing', 'token-b']), {
    added: [],
    removed: ['token-b'],
    current: ['token-a', 'token-c'],
  });
  assert.deepEqual(registry.replace(['token-d', 'token-c']), {
    added: ['token-d'],
    removed: ['token-a'],
    current: ['token-c', 'token-d'],
  });
});
