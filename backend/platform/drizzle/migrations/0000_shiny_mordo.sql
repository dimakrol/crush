CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"round_id" uuid NOT NULL,
	"slot_id" smallint NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"auto_cash_out" double precision,
	"status" text NOT NULL,
	"cash_out_multiplier" double precision,
	"payout" numeric(20, 4) DEFAULT '0' NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"cashed_out_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase" text NOT NULL,
	"crash_point" double precision NOT NULL,
	"started_at" timestamp with time zone,
	"crashed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bets_round_user_slot_uniq" ON "bets" USING btree ("round_id","user_id","slot_id");--> statement-breakpoint
CREATE INDEX "bets_user_placed_idx" ON "bets" USING btree ("user_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bets_round_idx" ON "bets" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "bets_round_user_idx" ON "bets" USING btree ("round_id","user_id");--> statement-breakpoint
CREATE INDEX "rounds_created_at_idx" ON "rounds" USING btree ("created_at" DESC NULLS LAST);