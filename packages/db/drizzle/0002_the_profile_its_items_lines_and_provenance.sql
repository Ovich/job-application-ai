CREATE TYPE "public"."item_kind" AS ENUM('summary', 'identity', 'experience', 'project', 'education', 'publication', 'language', 'group', 'entry');--> statement-breakpoint
CREATE TABLE "item_education" (
	"item_id" text PRIMARY KEY NOT NULL,
	"institution" text NOT NULL,
	"location" text,
	"credential" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "item_entry" (
	"item_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"qualifier" text
);
--> statement-breakpoint
CREATE TABLE "item_experience" (
	"item_id" text PRIMARY KEY NOT NULL,
	"organisation" text NOT NULL,
	"organisation_note" text,
	"location" text,
	"arrangement" text
);
--> statement-breakpoint
CREATE TABLE "item_line" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_project" (
	"item_id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"dates_text" text
);
--> statement-breakpoint
CREATE TABLE "profile_item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "item_kind" NOT NULL,
	"parent_id" text,
	"title" text NOT NULL,
	"subtitle" text,
	"start_text" text,
	"end_text" text,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provenance" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"item_id" text,
	"line_id" text,
	"said" text NOT NULL,
	CONSTRAINT "one_fact" CHECK (num_nonnulls("provenance"."item_id", "provenance"."line_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "item_education" ADD CONSTRAINT "item_education_item_id_profile_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."profile_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_entry" ADD CONSTRAINT "item_entry_item_id_profile_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."profile_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_experience" ADD CONSTRAINT "item_experience_item_id_profile_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."profile_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_line" ADD CONSTRAINT "item_line_item_id_profile_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."profile_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_project" ADD CONSTRAINT "item_project_item_id_profile_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."profile_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_item" ADD CONSTRAINT "profile_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_item" ADD CONSTRAINT "profile_item_parent_id_profile_item_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."profile_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance" ADD CONSTRAINT "provenance_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance" ADD CONSTRAINT "provenance_item_id_profile_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."profile_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance" ADD CONSTRAINT "provenance_line_id_item_line_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."item_line"("id") ON DELETE cascade ON UPDATE no action;