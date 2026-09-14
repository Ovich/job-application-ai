CREATE TYPE "public"."conversation_author" AS ENUM('person', 'assistant', 'tool');--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"assistant" text NOT NULL,
	"subject" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_user_assistant_subject" UNIQUE NULLS NOT DISTINCT("user_id","assistant","subject")
);
--> statement-breakpoint
CREATE TABLE "conversation_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"position" integer NOT NULL,
	"author" "conversation_author" NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_entry_position" UNIQUE("conversation_id","position")
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_entry" ADD CONSTRAINT "conversation_entry_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;