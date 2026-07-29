import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const marketStatus = pgEnum('market_status', [
  'draft',
  'pending_review',
  'open',
  'suspended',
  'closed',
  'resolving',
  'resolved',
  'cancelled',
  'archived',
]);
export const settlementStatus = pgEnum('settlement_status', [
  'pending',
  'detected',
  'reviewing',
  'calculating',
  'posting',
  'completed',
  'failed',
  'reversed',
]);
export const ledgerSide = pgEnum('ledger_side', ['debit', 'credit']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  locale: varchar('locale', { length: 16 }).notNull().default('zh-CN'),
  timeZone: varchar('time_zone', { length: 64 }).notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const identities = pgTable(
  'identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerSubject: varchar('provider_subject', { length: 255 }).notNull(),
    email: varchar('email', { length: 320 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('identities_provider_subject_uidx').on(table.provider, table.providerSubject),
    index('identities_user_idx').on(table.userId),
  ],
);

export const providerEvents = pgTable(
  'provider_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 255 }).notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('provider_events_identity_uidx').on(table.provider, table.providerEventId),
  ],
);

export const providerMarkets = pgTable(
  'provider_markets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerEventId: uuid('provider_event_id').references(() => providerEvents.id),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerMarketId: varchar('provider_market_id', { length: 255 }).notNull(),
    providerConditionId: varchar('provider_condition_id', { length: 255 }),
    rawPayload: jsonb('raw_payload').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('provider_markets_identity_uidx').on(table.provider, table.providerMarketId),
    index('provider_markets_event_idx').on(table.providerEventId),
  ],
);

export const markets = pgTable(
  'markets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerMarketId: uuid('provider_market_id').references(() => providerMarkets.id),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    kind: varchar('kind', { length: 32 }).notNull(),
    status: marketStatus('status').notNull().default('draft'),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('provider'),
    originalTitle: text('original_title').notNull(),
    title: text('title').notNull(),
    originalRules: text('original_rules'),
    rulesSummary: text('rules_summary'),
    opensAt: timestamp('opens_at', { withTimezone: true }),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    schemaVersion: integer('schema_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('markets_status_closes_idx').on(table.status, table.closesAt),
    index('markets_provider_idx').on(table.providerMarketId),
  ],
);

export const marketOutcomes = pgTable(
  'market_outcomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    providerOutcomeId: varchar('provider_outcome_id', { length: 255 }),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isWinningOutcome: boolean('is_winning_outcome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('market_outcomes_order_uidx').on(table.marketId, table.sortOrder),
    index('market_outcomes_market_idx').on(table.marketId),
  ],
);

export const marketPriceSnapshots = pgTable(
  'market_price_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    outcomeId: uuid('outcome_id')
      .notNull()
      .references(() => marketOutcomes.id),
    bid: numeric('bid', { precision: 20, scale: 10 }),
    ask: numeric('ask', { precision: 20, scale: 10 }),
    midpoint: numeric('midpoint', { precision: 20, scale: 10 }),
    lastTrade: numeric('last_trade', { precision: 20, scale: 10 }),
    source: varchar('source', { length: 32 }).notNull(),
    sourceEventKey: varchar('source_event_key', { length: 255 }),
    sourceHash: varchar('source_hash', { length: 255 }),
    metadata: jsonb('metadata').notNull().default({}),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('market_price_snapshots_lookup_idx').on(
      table.marketId,
      table.outcomeId,
      table.capturedAt,
    ),
    uniqueIndex('market_price_snapshots_source_event_uidx').on(table.sourceEventKey),
  ],
);

export const marketCurrentPrices = pgTable(
  'market_current_prices',
  {
    outcomeId: uuid('outcome_id')
      .primaryKey()
      .references(() => marketOutcomes.id),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    bid: numeric('bid', { precision: 20, scale: 10 }),
    ask: numeric('ask', { precision: 20, scale: 10 }),
    midpoint: numeric('midpoint', { precision: 20, scale: 10 }),
    lastTrade: numeric('last_trade', { precision: 20, scale: 10 }),
    bidCapturedAt: timestamp('bid_captured_at', { withTimezone: true }),
    askCapturedAt: timestamp('ask_captured_at', { withTimezone: true }),
    midpointCapturedAt: timestamp('midpoint_captured_at', { withTimezone: true }),
    lastTradeCapturedAt: timestamp('last_trade_captured_at', { withTimezone: true }),
    latestSource: varchar('latest_source', { length: 32 }).notNull(),
    latestSourceAt: timestamp('latest_source_at', { withTimezone: true }).notNull(),
    latestSnapshotId: uuid('latest_snapshot_id')
      .notNull()
      .references(() => marketPriceSnapshots.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('market_current_prices_market_idx').on(table.marketId),
    index('market_current_prices_freshness_idx').on(table.latestSourceAt),
  ],
);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerType: varchar('owner_type', { length: 32 }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    assetCode: varchar('asset_code', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ledger_accounts_owner_asset_uidx').on(
      table.ownerType,
      table.ownerId,
      table.assetCode,
    ),
  ],
);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    transactionType: varchar('transaction_type', { length: 64 }).notNull(),
    referenceType: varchar('reference_type', { length: 64 }).notNull(),
    referenceId: varchar('reference_id', { length: 255 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    reversalOfId: uuid('reversal_of_id'),
    metadata: jsonb('metadata').notNull().default({}),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ledger_transactions_idempotency_uidx').on(table.idempotencyKey),
    index('ledger_transactions_reference_idx').on(table.referenceType, table.referenceId),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    side: ledgerSide('side').notNull(),
    amount: numeric('amount', { precision: 30, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_entries_transaction_idx').on(table.transactionId),
    index('ledger_entries_account_idx').on(table.accountId, table.createdAt),
  ],
);

export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    outcomeId: uuid('outcome_id')
      .notNull()
      .references(() => marketOutcomes.id),
    price: numeric('price', { precision: 20, scale: 10 }).notNull(),
    sourceSnapshotId: uuid('source_snapshot_id').references(() => marketPriceSnapshots.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('quotes_user_expiry_idx').on(table.userId, table.expiresAt)],
);

export const predictions = pgTable(
  'predictions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    outcomeId: uuid('outcome_id')
      .notNull()
      .references(() => marketOutcomes.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    stake: numeric('stake', { precision: 30, scale: 8 }).notNull(),
    shares: numeric('shares', { precision: 30, scale: 8 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('open'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('predictions_idempotency_uidx').on(table.idempotencyKey),
    index('predictions_user_status_idx').on(table.userId, table.status),
    index('predictions_market_status_idx').on(table.marketId, table.status),
  ],
);

export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    version: integer('version').notNull(),
    status: settlementStatus('status').notNull().default('pending'),
    winningOutcomeId: uuid('winning_outcome_id').references(() => marketOutcomes.id),
    evidence: jsonb('evidence').notNull().default({}),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id),
    reversalOfId: uuid('reversal_of_id'),
    detectedAt: timestamp('detected_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('settlements_market_version_uidx').on(table.marketId, table.version),
    index('settlements_status_idx').on(table.status),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventName: varchar('event_name', { length: 128 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 255 }).notNull(),
    payload: jsonb('payload').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    correlationId: varchar('correlation_id', { length: 255 }),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('outbox_pending_idx').on(table.publishedAt, table.availableAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorType: varchar('actor_type', { length: 32 }).notNull(),
    actorId: varchar('actor_id', { length: 255 }),
    action: varchar('action', { length: 128 }).notNull(),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 255 }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    requestId: varchar('request_id', { length: 255 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_logs_target_idx').on(table.targetType, table.targetId)],
);

export const featureFlags = pgTable('feature_flags', {
  key: varchar('key', { length: 128 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  rules: jsonb('rules').notNull().default({}),
  description: text('description'),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
