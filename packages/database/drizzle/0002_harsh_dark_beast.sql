CREATE TABLE "market_lifecycle_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_market_id" varchar(255) NOT NULL,
	"source_event_key" varchar(255) NOT NULL,
	"observed_status" varchar(32) NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_resolution_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"winning_outcome_id" uuid,
	"provider_resolution_status" varchar(64),
	"status" varchar(32) DEFAULT 'pending_review' NOT NULL,
	"evidence" jsonb NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"component" varchar(64) NOT NULL,
	"alert_code" varchar(64) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"dedup_key" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_runtime_states" (
	"provider" varchar(32) NOT NULL,
	"component" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_error" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_runtime_states_provider_component_pk" PRIMARY KEY("provider","component")
);
--> statement-breakpoint
ALTER TABLE "market_lifecycle_observations" ADD CONSTRAINT "market_lifecycle_observations_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_resolution_candidates" ADD CONSTRAINT "market_resolution_candidates_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_resolution_candidates" ADD CONSTRAINT "market_resolution_candidates_observation_id_market_lifecycle_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."market_lifecycle_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_resolution_candidates" ADD CONSTRAINT "market_resolution_candidates_winning_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("winning_outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_lifecycle_observations_source_uidx" ON "market_lifecycle_observations" USING btree ("source_event_key");--> statement-breakpoint
CREATE INDEX "market_lifecycle_observations_market_idx" ON "market_lifecycle_observations" USING btree ("market_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_resolution_candidates_observation_uidx" ON "market_resolution_candidates" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "market_resolution_candidates_status_idx" ON "market_resolution_candidates" USING btree ("status","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_alerts_dedup_uidx" ON "provider_alerts" USING btree ("provider","dedup_key");--> statement-breakpoint
CREATE INDEX "provider_alerts_open_idx" ON "provider_alerts" USING btree ("status","severity","last_seen_at");--> statement-breakpoint
CREATE INDEX "provider_runtime_states_status_idx" ON "provider_runtime_states" USING btree ("status","updated_at");