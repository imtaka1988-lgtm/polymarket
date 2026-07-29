import type { PolymarketMarketLifecycleSnapshot } from '@forecast/provider-polymarket';
import type {
  LifecycleCheckCandidate,
  LifecycleObservationResult,
} from './postgres-provider-operations-store.js';

export interface MarketLifecycleClient {
  getMarketLifecycle(providerMarketId: string): Promise<PolymarketMarketLifecycleSnapshot>;
}

export interface MarketLifecycleStore {
  loadLifecycleCheckCandidates(
    lookAheadUntil: Date,
    recheckBefore: Date,
    limit: number,
  ): Promise<LifecycleCheckCandidate[]>;
  applyLifecycleObservation(
    snapshot: PolymarketMarketLifecycleSnapshot,
    observedAt: Date,
  ): Promise<LifecycleObservationResult>;
  recordComponentSuccess(
    component: string,
    at: Date,
    details: Record<string, unknown>,
  ): Promise<void>;
  recordComponentFailure(
    component: string,
    at: Date,
    error: unknown,
    details?: Record<string, unknown>,
  ): Promise<number>;
}

export interface PolymarketLifecycleWorkerOptions {
  limit?: number;
  lookAheadMs?: number;
  recheckIntervalMs?: number;
  now?: () => Date;
  onLog?: (level: 'info' | 'warn' | 'error', event: string, details: object) => void;
}

export interface LifecycleRunResult {
  candidates: number;
  checked: number;
  observations: number;
  resolutionCandidates: number;
  unmatched: number;
  failed: number;
}

export class PolymarketLifecycleWorker {
  private readonly limit: number;
  private readonly lookAheadMs: number;
  private readonly recheckIntervalMs: number;
  private readonly now: () => Date;
  private readonly onLog: (
    level: 'info' | 'warn' | 'error',
    event: string,
    details: object,
  ) => void;

  constructor(
    private readonly client: MarketLifecycleClient,
    private readonly store: MarketLifecycleStore,
    options: PolymarketLifecycleWorkerOptions = {},
  ) {
    this.limit = boundedLimit(options.limit ?? 100);
    this.lookAheadMs = positiveInteger(options.lookAheadMs ?? 24 * 60 * 60 * 1_000, 'lookAheadMs');
    this.recheckIntervalMs = positiveInteger(
      options.recheckIntervalMs ?? 15 * 60 * 1_000,
      'recheckIntervalMs',
    );
    this.now = options.now ?? (() => new Date());
    this.onLog = options.onLog ?? (() => undefined);
  }

  async runOnce(): Promise<LifecycleRunResult> {
    const startedAt = this.now();
    const candidates = await this.store.loadLifecycleCheckCandidates(
      new Date(startedAt.getTime() + this.lookAheadMs),
      new Date(startedAt.getTime() - this.recheckIntervalMs),
      this.limit,
    );
    const result: LifecycleRunResult = {
      candidates: candidates.length,
      checked: 0,
      observations: 0,
      resolutionCandidates: 0,
      unmatched: 0,
      failed: 0,
    };

    for (const candidate of candidates) {
      try {
        const snapshot = await this.client.getMarketLifecycle(candidate.providerMarketId);
        const persisted = await this.store.applyLifecycleObservation(snapshot, this.now());
        result.checked += 1;
        if (persisted.status === 'inserted') result.observations += 1;
        if (persisted.status === 'unmatched_market') result.unmatched += 1;
        if (persisted.resolutionCandidateCreated) result.resolutionCandidates += 1;
      } catch (error) {
        result.failed += 1;
        this.onLog('error', 'market_lifecycle_check_item_failed', {
          providerMarketId: candidate.providerMarketId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const finishedAt = this.now();
    if (result.failed > 0) {
      await this.store.recordComponentFailure(
        'market_lifecycle',
        finishedAt,
        new Error(`${result.failed} lifecycle checks failed`),
        { ...result },
      );
    } else {
      await this.store.recordComponentSuccess('market_lifecycle', finishedAt, { ...result });
    }
    this.onLog(result.failed > 0 ? 'warn' : 'info', 'market_lifecycle_check_completed', result);
    return result;
  }
}

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new RangeError('limit must be an integer from 1 to 500');
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}
