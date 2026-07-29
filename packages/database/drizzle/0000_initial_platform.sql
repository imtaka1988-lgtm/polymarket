CREATE TYPE "public"."ledger_side" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('draft', 'pending_review', 'open', 'suspended', 'closed', 'resolving', 'resolved', 'cancelled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('pending', 'detected', 'reviewing', 'calculating', 'posting', 'completed', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."provider_sync_status" AS ENUM('running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"actor_id" varchar(255),
	"action" varchar(128) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" varchar(255) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" varchar(255),
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_subject" varchar(255) NOT NULL,
	"email" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" varchar(32) NOT NULL,
	"owner_id" uuid NOT NULL,
	"asset_code" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"side" "ledger_side" NOT NULL,
	"amount" numeric(30, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_type" varchar(64) NOT NULL,
	"reference_type" varchar(64) NOT NULL,
	"reference_id" varchar(255) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"reversal_of_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"provider_outcome_id" varchar(255),
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_winning_outcome" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"bid" numeric(20, 10),
	"ask" numeric(20, 10),
	"midpoint" numeric(20, 10),
	"last_trade" numeric(20, 10),
	"source" varchar(32) NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_market_id" uuid,
	"created_by_user_id" uuid,
	"kind" varchar(32) NOT NULL,
	"status" "market_status" DEFAULT 'draft' NOT NULL,
	"source_type" varchar(32) DEFAULT 'provider' NOT NULL,
	"original_title" text NOT NULL,
	"title" text NOT NULL,
	"original_rules" text,
	"rules_summary" text,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" varchar(128) NOT NULL,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"correlation_id" varchar(255),
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"stake" numeric(30, 8) NOT NULL,
	"shares" numeric(30, 8) NOT NULL,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_event_id" varchar(255) NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" uuid,
	"provider" varchar(32) NOT NULL,
	"provider_market_id" varchar(255) NOT NULL,
	"provider_condition_id" varchar(255),
	"raw_payload" jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"price" numeric(20, 10) NOT NULL,
	"source_snapshot_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "settlement_status" DEFAULT 'pending' NOT NULL,
	"winning_outcome_id" uuid,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_by_user_id" uuid,
	"reversal_of_id" uuid,
	"detected_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"locale" varchar(16) DEFAULT 'zh-CN' NOT NULL,
	"time_zone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sync_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"query_signature" text NOT NULL,
	"next_cursor" text,
	"pages_processed" integer DEFAULT 0 NOT NULL,
	"events_processed" integer DEFAULT 0 NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sync_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"provider" varchar(32) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"query_signature" text NOT NULL,
	"page_key" varchar(64) NOT NULL,
	"page_number" integer NOT NULL,
	"request_cursor" text,
	"response_cursor" text,
	"event_count" integer NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"request_url" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"query_signature" text NOT NULL,
	"status" "provider_sync_status" DEFAULT 'running' NOT NULL,
	"pages_processed" integer DEFAULT 0 NOT NULL,
	"events_processed" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"next_cursor" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_provider_market_id_provider_markets_id_fk" FOREIGN KEY ("provider_market_id") REFERENCES "public"."provider_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_markets" ADD CONSTRAINT "provider_markets_provider_event_id_provider_events_id_fk" FOREIGN KEY ("provider_event_id") REFERENCES "public"."provider_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_source_snapshot_id_market_price_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."market_price_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_winning_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("winning_outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_sync_pages" ADD CONSTRAINT "provider_sync_pages_run_id_provider_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."provider_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_subject_uidx" ON "identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "identities_user_idx" ON "identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_owner_asset_uidx" ON "ledger_accounts" USING btree ("owner_type","owner_id","asset_code");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_idempotency_uidx" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_transactions_reference_idx" ON "ledger_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_outcomes_order_uidx" ON "market_outcomes" USING btree ("market_id","sort_order");--> statement-breakpoint
CREATE INDEX "market_outcomes_market_idx" ON "market_outcomes" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "market_price_snapshots_lookup_idx" ON "market_price_snapshots" USING btree ("market_id","outcome_id","captured_at");--> statement-breakpoint
CREATE INDEX "markets_status_closes_idx" ON "markets" USING btree ("status","closes_at");--> statement-breakpoint
CREATE INDEX "markets_provider_idx" ON "markets" USING btree ("provider_market_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("published_at","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_idempotency_uidx" ON "predictions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "predictions_user_status_idx" ON "predictions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "predictions_market_status_idx" ON "predictions" USING btree ("market_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_identity_uidx" ON "provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_markets_identity_uidx" ON "provider_markets" USING btree ("provider","provider_market_id");--> statement-breakpoint
CREATE INDEX "provider_markets_event_idx" ON "provider_markets" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX "quotes_user_expiry_idx" ON "quotes" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_market_version_uidx" ON "settlements" USING btree ("market_id","version");--> statement-breakpoint
CREATE INDEX "settlements_status_idx" ON "settlements" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sync_checkpoints_identity_uidx" ON "provider_sync_checkpoints" USING btree ("provider","resource_type","query_signature");--> statement-breakpoint
CREATE INDEX "provider_sync_checkpoints_updated_idx" ON "provider_sync_checkpoints" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sync_pages_page_key_uidx" ON "provider_sync_pages" USING btree ("page_key");--> statement-breakpoint
CREATE INDEX "provider_sync_pages_query_idx" ON "provider_sync_pages" USING btree ("provider","resource_type","committed_at");--> statement-breakpoint
CREATE INDEX "provider_sync_runs_lookup_idx" ON "provider_sync_runs" USING btree ("provider","resource_type","started_at");--> statement-breakpoint
CREATE INDEX "provider_sync_runs_status_idx" ON "provider_sync_runs" USING btree ("status");