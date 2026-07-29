CREATE TABLE "market_current_prices" (
	"outcome_id" uuid PRIMARY KEY NOT NULL,
	"market_id" uuid NOT NULL,
	"bid" numeric(20, 10),
	"ask" numeric(20, 10),
	"midpoint" numeric(20, 10),
	"last_trade" numeric(20, 10),
	"bid_captured_at" timestamp with time zone,
	"ask_captured_at" timestamp with time zone,
	"midpoint_captured_at" timestamp with time zone,
	"last_trade_captured_at" timestamp with time zone,
	"latest_source" varchar(32) NOT NULL,
	"latest_source_at" timestamp with time zone NOT NULL,
	"latest_snapshot_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD COLUMN "source_event_key" varchar(255);--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD COLUMN "source_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD COLUMN "observed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "market_current_prices" ADD CONSTRAINT "market_current_prices_outcome_id_market_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."market_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_current_prices" ADD CONSTRAINT "market_current_prices_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_current_prices" ADD CONSTRAINT "market_current_prices_latest_snapshot_id_market_price_snapshots_id_fk" FOREIGN KEY ("latest_snapshot_id") REFERENCES "public"."market_price_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_current_prices_market_idx" ON "market_current_prices" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "market_current_prices_freshness_idx" ON "market_current_prices" USING btree ("latest_source_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_price_snapshots_source_event_uidx" ON "market_price_snapshots" USING btree ("source_event_key");