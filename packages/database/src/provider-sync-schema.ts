import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const providerSyncStatus = pgEnum('provider_sync_status', [
  'running',
  'completed',
  'partial',
  'failed',
]);

export const providerSyncCheckpoints = pgTable('provider_sync_checkpoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  provider: varchar('provider', { length: 32 }).notNull(),
  resourceType: varchar('resource_type', { length: 64 }).notNull(),
  querySignature: text('query_signature').notNull(),
  nextCursor: text('next_cursor'),
  pagesProcessed: integer('pages_processed').notNull().default(0),
  eventsProcessed: integer('events_processed').notNull().default(0),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastSucceededAt: timestamp('last_succeeded_at', { withTimezone: true }),
  lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('provider_sync_checkpoints_identity_uidx').on(table.provider, table.resourceType, table.querySignature),
  index('provider_sync_checkpoints_updated_idx').on(table.updatedAt),
]);

export const providerSyncRuns = pgTable('provider_sync_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  provider: varchar('provider', { length: 32 }).notNull(),
  resourceType: varchar('resource_type', { length: 64 }).notNull(),
  querySignature: text('query_signature').notNull(),
  status: providerSyncStatus('status').notNull().default('running'),
  pagesProcessed: integer('pages_processed').notNull().default(0),
  eventsProcessed: integer('events_processed').notNull().default(0),
  warningCount: integer('warning_count').notNull().default(0),
  nextCursor: text('next_cursor'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastError: text('last_error'),
}, (table) => [
  index('provider_sync_runs_lookup_idx').on(table.provider, table.resourceType, table.startedAt),
  index('provider_sync_runs_status_idx').on(table.status),
]);

export const providerSyncPages = pgTable('provider_sync_pages', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id').references(() => providerSyncRuns.id),
  provider: varchar('provider', { length: 32 }).notNull(),
  resourceType: varchar('resource_type', { length: 64 }).notNull(),
  querySignature: text('query_signature').notNull(),
  pageKey: varchar('page_key', { length: 64 }).notNull(),
  pageNumber: integer('page_number').notNull(),
  requestCursor: text('request_cursor'),
  responseCursor: text('response_cursor'),
  eventCount: integer('event_count').notNull(),
  warningCount: integer('warning_count').notNull().default(0),
  requestUrl: text('request_url').notNull(),
  rawPayload: jsonb('raw_payload').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  committedAt: timestamp('committed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('provider_sync_pages_page_key_uidx').on(table.pageKey),
  index('provider_sync_pages_query_idx').on(table.provider, table.resourceType, table.committedAt),
]);
