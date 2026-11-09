ALTER TYPE "ops"."content_channel" ADD VALUE IF NOT EXISTS 'facebook';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."content_pieces" ADD COLUMN IF NOT EXISTS "channels" "ops"."content_channel"[] DEFAULT '{}'::ops.content_channel[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."content_pieces" ADD COLUMN IF NOT EXISTS "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Las piezas que ya existían quedan con su canal de siempre y conservan su revisión pendiente.
UPDATE "ops"."content_pieces" SET "channels" = ARRAY["channel"] WHERE cardinality("channels") = 0;--> statement-breakpoint
UPDATE "ops"."content_pieces" SET "review_requested_at" = "updated_at" WHERE "status" = 'legal_review' AND "review_requested_at" IS NULL;
