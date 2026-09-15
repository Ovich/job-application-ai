-- Rules are renamed profile concerns (D14, ID243): renamed in place, never dropped and
-- created, so every row, every superseded_by link and every option's words survive.
ALTER TABLE "rule" RENAME TO "profile_concern";--> statement-breakpoint
ALTER TYPE "public"."rule_kind" RENAME TO "profile_concern_kind";--> statement-breakpoint
ALTER TYPE "public"."rule_source" RENAME TO "profile_concern_source";--> statement-breakpoint
ALTER TABLE "question_option" RENAME COLUMN "rule" TO "concern";--> statement-breakpoint
ALTER TABLE "profile_concern" RENAME CONSTRAINT "rule_pkey" TO "profile_concern_pkey";--> statement-breakpoint
ALTER TABLE "profile_concern" RENAME CONSTRAINT "rule_user_id_user_id_fk" TO "profile_concern_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "profile_concern" RENAME CONSTRAINT "rule_item_id_profile_item_id_fk" TO "profile_concern_item_id_profile_item_id_fk";--> statement-breakpoint
ALTER TABLE "profile_concern" RENAME CONSTRAINT "rule_question_id_question_id_fk" TO "profile_concern_question_id_question_id_fk";--> statement-breakpoint
ALTER TABLE "profile_concern" RENAME CONSTRAINT "rule_superseded_by_rule_id_fk" TO "profile_concern_superseded_by_profile_concern_id_fk";
