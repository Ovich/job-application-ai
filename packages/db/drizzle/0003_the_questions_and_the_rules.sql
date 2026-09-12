CREATE TYPE "public"."question_kind" AS ENUM('scope', 'conflict', 'provenance');--> statement-breakpoint
CREATE TYPE "public"."question_state" AS ENUM('waiting', 'answered', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."rule_kind" AS ENUM('scope', 'constraint');--> statement-breakpoint
CREATE TYPE "public"."rule_source" AS ENUM('answer', 'own words');--> statement-breakpoint
CREATE TABLE "question" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"kind" "question_kind" NOT NULL,
	"asked" boolean NOT NULL,
	"where" text NOT NULL,
	"lead" text NOT NULL,
	"state" "question_state" NOT NULL,
	"position" integer NOT NULL,
	"answered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_option" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"hint" text NOT NULL,
	"rule" text
);
--> statement-breakpoint
CREATE TABLE "rule" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"kind" "rule_kind" NOT NULL,
	"text" text NOT NULL,
	"source" "rule_source" NOT NULL,
	"question_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"superseded_by" text
);
--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_item_id_profile_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."profile_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_option" ADD CONSTRAINT "question_option_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_item_id_profile_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."profile_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_superseded_by_rule_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."rule"("id") ON DELETE no action ON UPDATE no action;