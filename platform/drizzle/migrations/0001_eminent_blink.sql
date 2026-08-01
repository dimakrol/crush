CREATE TYPE "public"."bet_status" AS ENUM('PENDING_STAKE', 'PLACED', 'CASHED_OUT', 'LOST', 'CANCELED', 'REJECTED', 'SETTLEMENT_PENDING');--> statement-breakpoint
CREATE TYPE "public"."round_phase" AS ENUM('WAITING', 'RUNNING', 'CRASHED');--> statement-breakpoint
DROP INDEX "bets_round_user_slot_uniq";--> statement-breakpoint
ALTER TABLE "bets" ALTER COLUMN "status" SET DATA TYPE "public"."bet_status" USING "status"::"public"."bet_status";--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "phase" SET DATA TYPE "public"."round_phase" USING "phase"::"public"."round_phase";--> statement-breakpoint
CREATE UNIQUE INDEX "bets_round_user_slot_uniq" ON "bets" USING btree ("round_id","user_id","slot_id") WHERE "status" <> 'REJECTED';--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_amount_positive" CHECK ("amount" > 0);--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_payout_non_negative" CHECK ("payout" >= 0);--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_slot_id_valid" CHECK ("slot_id" IN (1, 2));--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_auto_cash_out_gt_one" CHECK ("auto_cash_out" IS NULL OR "auto_cash_out" > 1);--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_crash_point_min" CHECK ("crash_point" >= 1.01);