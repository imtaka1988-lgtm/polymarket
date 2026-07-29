export type MarketStatus =
  | 'draft'
  | 'pending_review'
  | 'open'
  | 'suspended'
  | 'closed'
  | 'resolving'
  | 'resolved'
  | 'cancelled'
  | 'archived';

export type MarketKind = 'binary' | 'multi_outcome' | 'numeric_range' | 'sports';

export interface Outcome {
  id: string;
  label: string;
  sortOrder: number;
  providerOutcomeId?: string;
}

export interface NormalizedMarket {
  id: string;
  provider: string;
  providerMarketId: string;
  providerEventId?: string;
  kind: MarketKind;
  status: MarketStatus;
  originalTitle: string;
  title: string;
  originalRules?: string;
  rulesSummary?: string;
  outcomes: Outcome[];
  opensAt?: Date;
  closesAt?: Date;
  resolvedAt?: Date;
  sourceUpdatedAt: Date;
  schemaVersion: number;
}

export type DomainEventName =
  | 'MarketImported'
  | 'MarketPriceUpdated'
  | 'PredictionPlaced'
  | 'PositionClosed'
  | 'MarketResolutionDetected'
  | 'MarketSettled'
  | 'LedgerTransactionPosted'
  | 'DailyRewardClaimed'
  | 'UserSuspended';

export interface DomainEvent<TPayload = Record<string, unknown>> {
  id: string;
  name: DomainEventName;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  payload: TPayload;
  schemaVersion: number;
  correlationId?: string;
  causationId?: string;
}
