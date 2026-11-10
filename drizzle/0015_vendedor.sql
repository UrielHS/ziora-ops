-- Idempotente a propósito: se puede volver a aplicar contra una base donde ya exista parte del esquema.
CREATE TABLE IF NOT EXISTS "ops"."seller_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"referral_url" text,
	"booking_url" text,
	"discount_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."seller_profiles" ADD CONSTRAINT "seller_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "email_invalid_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "phone_invalid_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "referred_by_code" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_users_referred_by_code_idx" ON "ops"."app_users" USING btree ("referred_by_code");
