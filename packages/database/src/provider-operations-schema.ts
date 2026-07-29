import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { marketOutcomes, markets } from './schema.js';

export const providerRuntimeStates = pgTable(
  'provider_runtime_states',
  {
    provider: varchar('provider', { length: 32 }).notNull(),
    component: varchar('component', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('unknown'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastSucceededAt: timestamp('last_succeeded_at', { withTimezone: true }),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
    lastError: text('last_error'),
    details: jsonb('details').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.component] }),
    index('provider_runtime_states_status_idx').on(table.status, table.updatedAt),
  ],
);

export const providerAlerts = pgTable(
  'provider_alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: varchar('provider', { length: 32 }).notNull(),
    component: varchar('component', { length: 64 }).notNull(),
    alertCode: varchar('alert_code', { length: 64 }).notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    dedupKey: varchar('dedup_key', { length: 255 }).notNull(),
    message: text('message').notNull(),
    details: jsonb('details').notNull().default({}),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('provider_alerts_dedup_uidx').on(table.provider, table.dedupKey),
    index('provider_alerts_open_idx').on(table.status, table.severity, table.lastSeenAt),
  ],
);

export const marketLifecycleObservations = pgTable(
  'market_lifecycle_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerMarketId: varchar('provider_market_id', { length: 255 }).notNull(),
    sourceEventKey: varchar('source_event_key', { length: 255 }).notNull(),
    observedStatus: varchar('observed_status', { length: 32 }).notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('market_lifecycle_observations_source_uidx').on(table.sourceEventKey),
    index('market_lifecycle_observations_market_idx').on(table.marketId, table.observedAt),
  ],
);

export const marketResolutionCandidates = pgTable(
  'market_resolution_candidates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    observationId: uuid('observation_id')
      .notNull()
      .references(() => marketLifecycleObservations.id),
    winningOutcomeId: uuid('winning_outcome_id').references(() => marketOutcomes.id),
    providerResolutionStatus: varchar('provider_resolution_status', { length: 64 }),
    status: varchar('status', { length: 32 }).notNull().default('pending_review'),
    evidence: jsonb('evidence').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('market_resolution_candidates_observation_uidx').on(table.observationId),
    index('market_resolution_candidates_status_idx').on(table.status, table.detectedAt),
  ],
);
