CREATE TYPE "public"."wallet_op_kind" AS ENUM('DEBIT', 'CREDIT', 'ROLLBACK');--> statement-breakpoint
CREATE TYPE "public"."wallet_op_state" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TABLE "wallet_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "wallet_op_kind" NOT NULL,
	"state" "wallet_op_state" DEFAULT 'PENDING' NOT NULL,
	"tx_ref" text NOT NULL,
	"ref_tx_ref" text,
	"bet_id" uuid,
	"player_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"round_id" uuid,
	"slot_id" smallint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_ops_tx_ref_unique" UNIQUE("tx_ref"),
	CONSTRAINT "wallet_ops_amount_non_negative" CHECK ("amount" >= 0),
	CONSTRAINT "wallet_ops_attempts_non_negative" CHECK ("attempts" >= 0),
	CONSTRAINT "wallet_ops_rollback_has_ref" CHECK (("kind" = 'ROLLBACK') = ("ref_tx_ref" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "wallet_ops" ADD CONSTRAINT "wallet_ops_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_ops_pending_idx" ON "wallet_ops" USING btree ("state","next_attempt_at") WHERE "state" = 'PENDING';--> statement-breakpoint
CREATE INDEX "wallet_ops_bet_idx" ON "wallet_ops" USING btree ("bet_id");