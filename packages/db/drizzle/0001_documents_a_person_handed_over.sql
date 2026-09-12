CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"source" text NOT NULL,
	"address" text,
	"detected_kind" text,
	"detected_language" text,
	"storage_key" text,
	"content_hash" text,
	"status" text NOT NULL,
	"failure_reason" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_user_content_hash" UNIQUE("user_id","content_hash")
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;