CREATE TYPE "public"."run_unit_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_unit" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"status" "run_unit_status" DEFAULT 'pending' NOT NULL,
	"result" text,
	"done_at" timestamp with time zone,
	CONSTRAINT "run_unit_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
ALTER TABLE "run_unit" ADD CONSTRAINT "run_unit_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;