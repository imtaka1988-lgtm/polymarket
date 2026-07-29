import assert from 'node:assert/strict';
import test from 'node:test';
import type { PolymarketMarketLifecycleSnapshot } from '@forecast/provider-polymarket';
import {
  PolymarketLifecycleWorker,
  type MarketLifecycleStore,
} from './polymarket-lifecycle-worker.js';
import type {
  LifecycleCheckCandidate,
  LifecycleObservationResult,
} from './postgres-provider-operations-store.js';

test('checks lifecycle candidates, persists observations, and reports a healthy run', async () => {
  const store = new MemoryLifecycleStore([
    { marketId: 'local-1', providerMarketId: 'market-1' },
    { marketId: 'local-2', providerMarketId: 'market-2' },
  ]);
  const requested: string[] = [];
  const worker = new PolymarketLifecycleWorker(
    {
      getMarketLifecycle: async (providerMarketId) => {
        requested.push(providerMarketId);
        return lifecycleFixture(providerMarketId, providerMarketId === 'market-1');
      },
    },
    store,
    {
      limit: 20,
      lookAheadMs: 60_000,
      now: sequenceClock([
        '2026-07-29T12:00:00.000Z',
        '2026-07-29T12:00:01.000Z',
        '2026-07-29T12:00:02.000Z',
        '2026-07-29T12:00:03.000Z',
      ]),
    },
  );

  const result = await worker.runOnce();

  assert.deepEqual(requested, ['market-1', 'market-2']);
  assert.deepEqual(result, {
    candidates: 2,
    checked: 2,
    observations: 2,
    resolutionCandidates: 1,
    unmatched: 0,
    failed: 0,
  });
  assert.equal(store.successes.length, 1);
  assert.equal(store.failures.length, 0);
  assert.equal(store.lookAheadUntil?.toISOString(), '2026-07-29T12:01:00.000Z');
});

test('continues after one provider failure and records a degraded run', async () => {
  const store = new MemoryLifecycleStore([
    { marketId: 'local-1', providerMarketId: 'market-fails' },
    { marketId: 'local-2', providerMarketId: 'market-works' },
  ]);
  const worker = new PolymarketLifecycleWorker(
    {
      getMarketLifecycle: async (providerMarketId) => {
        if (providerMarketId === 'market-fails') throw new Error('temporary Gamma failure');
        return lifecycleFixture(providerMarketId, false);
      },
    },
    store,
    { now: () => new Date('2026-07-29T12:00:00.000Z') },
  );

  const result = await worker.runOnce();

  assert.equal(result.failed, 1);
  assert.equal(result.checked, 1);
  assert.equal(store.observations.length, 1);
  assert.equal(store.failures.length, 1);
  assert.equal(store.successes.length, 0);
});

class MemoryLifecycleStore implements MarketLifecycleStore {
  readonly observations: PolymarketMarketLifecycleSnapshot[] = [];
  readonly successes: Array<Record<string, unknown>> = [];
  readonly failures: Array<Record<string, unknown>> = [];
  lookAheadUntil: Date | null = null;

  constructor(private readonly candidates: LifecycleCheckCandidate[]) {}

  async loadLifecycleCheckCandidates(
    lookAheadUntil: Date,
    _recheckBefore: Date,
    _limit: number,
  ): Promise<LifecycleCheckCandidate[]> {
    this.lookAheadUntil = lookAheadUntil;
    return this.candidates;
  }

  async applyLifecycleObservation(
    snapshot: PolymarketMarketLifecycleSnapshot,
    _observedAt: Date,
  ): Promise<LifecycleObservationResult> {
    this.observations.push(snapshot);
    return {
      status: 'inserted',
      observationId: `observation-${this.observations.length}`,
      localStatus: snapshot.closed === true ? 'closed' : 'open',
      resolutionCandidateCreated: snapshot.closed === true,
    };
  }

  async recordComponentSuccess(
    _component: string,
    _at: Date,
    details: Record<string, unknown>,
  ): Promise<void> {
    this.successes.push(details);
  }

  async recordComponentFailure(
    _component: string,
    _at: Date,
    _error: unknown,
    details: Record<string, unknown> = {},
  ): Promise<number> {
    this.failures.push(details);
    return this.failures.length;
  }
}

function lifecycleFixture(
  providerMarketId: string,
  closed: boolean,
): PolymarketMarketLifecycleSnapshot {
  return {
    providerMarketId,
    question: 'Did the event happen?',
    active: !closed,
    closed,
    archived: false,
    acceptingOrders: !closed,
    closedAt: closed ? '2026-07-29T11:59:00.000Z' : null,
    sourceUpdatedAt: '2026-07-29T12:00:00.000Z',
    providerResolutionStatus: closed ? 'resolved' : null,
    outcomes: [
      { label: 'Yes', price: closed ? '1' : '0.5', tokenId: 'token-yes' },
      { label: 'No', price: closed ? '0' : '0.5', tokenId: 'token-no' },
    ],
    winningTokenId: closed ? 'token-yes' : null,
    raw: {
      id: providerMarketId,
      question: 'Did the event happen?',
      outcomes: '["Yes","No"]',
      outcomePrices: closed ? '["1","0"]' : '["0.5","0.5"]',
      clobTokenIds: '["token-yes","token-no"]',
      closed,
    },
  };
}

function sequenceClock(values: string[]): () => Date {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return new Date(value ?? '2026-07-29T12:00:00.000Z');
  };
}
