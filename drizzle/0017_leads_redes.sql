-- Idempotente a propósito: se puede volver a aplicar contra una base donde ya exista parte del esquema.
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."influencer_deal_kind" AS ENUM('comision', 'pago_contenido', 'otro'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."influencer_stage" AS ENUM('opinion_recibida', 'quiere_promover', 'acuerdo_cerrado', 'no_promueve'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."social_lead_type" AS ENUM('psicologo', 'influencer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."social_link_kind" AS ENUM('invitacion', 'promocion'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."social_tier" AS ENUM('micro', 'nano', 'por_confirmar_pais'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TYPE "ops"."contact_source" ADD VALUE IF NOT EXISTS 'tiktok';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."influencer_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "ops"."influencer_deal_kind" NOT NULL,
	"terms" text NOT NULL,
	"notes" text,
	"no_use_override" boolean DEFAULT false NOT NULL,
	"closed_by" uuid,
	"closed_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "influencer_deals_contact_id_unique" UNIQUE("contact_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."social_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "ops"."social_link_kind" NOT NULL,
	"contact_id" uuid NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "social_link_id" uuid;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "social_platform" "ops"."social_platform";
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "social_handle" text;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "social_profile_url" text;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "social_followers" text;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "social_tier" "ops"."social_tier";
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "social_lead_type" "ops"."social_lead_type";
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "influencer_stage" "ops"."influencer_stage";
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "influencer_opinion" text;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "app_user_uid" text;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."influencer_deals" ADD CONSTRAINT "influencer_deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "ops"."contacts"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."influencer_deals" ADD CONSTRAINT "influencer_deals_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."social_links" ADD CONSTRAINT "social_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "ops"."contacts"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."social_links" ADD CONSTRAINT "social_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_links_code_unique" ON "ops"."social_links" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_links_contact_kind_unique" ON "ops"."social_links" USING btree ("contact_id","kind");
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."app_users" ADD CONSTRAINT "app_users_social_link_id_social_links_id_fk" FOREIGN KEY ("social_link_id") REFERENCES "ops"."social_links"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."contacts" ADD CONSTRAINT "contacts_app_user_uid_app_users_uid_fk" FOREIGN KEY ("app_user_uid") REFERENCES "ops"."app_users"("uid") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_users_social_link_idx" ON "ops"."app_users" USING btree ("social_link_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_social_unique" ON "ops"."contacts" USING btree ("social_platform","social_handle") WHERE "ops"."contacts"."social_handle" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_app_user_uid_unique" ON "ops"."contacts" USING btree ("app_user_uid") WHERE "ops"."contacts"."app_user_uid" is not null;
