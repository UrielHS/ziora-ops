-- Idempotente a propósito: se puede volver a aplicar contra una base donde ya exista parte del esquema.
DO $$ BEGIN CREATE TYPE "ops"."base_message_status" AS ENUM('borrador', 'aprobado', 'retirado'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."community_kind" AS ENUM('grupo', 'alianza'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."community_platform" AS ENUM('facebook', 'whatsapp', 'telegram', 'linkedin', 'reddit', 'discord', 'asociacion', 'otro'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."community_post_status" AS ENUM('planeado', 'publicado', 'omitido', 'espera_admin', 'borrado_admin'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."community_promo_policy" AS ENUM('desconocido', 'si', 'no', 'permiso_admin', 'dias_especificos'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."community_status" AS ENUM('por_revisar', 'aprobada', 'activa', 'pausada', 'sin_promocion', 'descartada'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."membership_status" AS ENUM('por_solicitar', 'solicitud_enviada', 'unida', 'rechazada', 'nos_sacaron', 'salio'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TYPE "ops"."contact_source" ADD VALUE IF NOT EXISTS 'whatsapp_group';
--> statement-breakpoint
ALTER TYPE "ops"."contact_source" ADD VALUE IF NOT EXISTS 'telegram_group';
--> statement-breakpoint
ALTER TYPE "ops"."contact_source" ADD VALUE IF NOT EXISTS 'landing_comunidad';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."base_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"angle" text,
	"body" text NOT NULL,
	"is_post" boolean DEFAULT true NOT NULL,
	"status" "ops"."base_message_status" DEFAULT 'borrador' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "base_messages_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"platform" "ops"."community_platform" NOT NULL,
	"url" text NOT NULL,
	"country" text,
	"city_region" text,
	"topic" text,
	"size_approx" text,
	"access_type" text,
	"promo_policy" "ops"."community_promo_policy" DEFAULT 'desconocido' NOT NULL,
	"rules_text" text,
	"activity" text,
	"phase" integer,
	"priority" text,
	"slug" text NOT NULL,
	"kind" "ops"."community_kind" DEFAULT 'grupo' NOT NULL,
	"status" "ops"."community_status" DEFAULT 'por_revisar' NOT NULL,
	"discard_reason" text,
	"origin" text,
	"recommended_by" text,
	"notes" text,
	"source_url" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."community_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"trial_days" integer DEFAULT 30 NOT NULL,
	"paid_goal" integer DEFAULT 10 NOT NULL,
	"seat_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "community_campaigns_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."community_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "ops"."membership_status" DEFAULT 'por_solicitar' NOT NULL,
	"requested_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"campaign_id" uuid,
	"community_id" uuid NOT NULL,
	"publisher_id" uuid,
	"base_message_id" uuid,
	"ai_draft" text,
	"final_text" text,
	"scheduled_on" date,
	"status" "ops"."community_post_status" DEFAULT 'planeado' NOT NULL,
	"published_at" timestamp with time zone,
	"post_url" text,
	"skip_reason" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"passed_filter" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "attribution" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "trial_kind" text;
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "community_id" uuid;
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "community_post_id" uuid;
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "has_paid_invoice" boolean;
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "feedback_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "sessions_total" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "notes_total" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "utm" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "community_id" uuid;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "community_post_id" uuid;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "registered_by_id" uuid;
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "lead_registered_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."base_messages" ADD CONSTRAINT "base_messages_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."communities" ADD CONSTRAINT "communities_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."community_memberships" ADD CONSTRAINT "community_memberships_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "ops"."communities"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."community_memberships" ADD CONSTRAINT "community_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."community_posts" ADD CONSTRAINT "community_posts_campaign_id_community_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "ops"."community_campaigns"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."community_posts" ADD CONSTRAINT "community_posts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "ops"."communities"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."community_posts" ADD CONSTRAINT "community_posts_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."community_posts" ADD CONSTRAINT "community_posts_base_message_id_base_messages_id_fk" FOREIGN KEY ("base_message_id") REFERENCES "ops"."base_messages"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "communities_url_unique" ON "ops"."communities" USING btree ("url");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "communities_slug_unique" ON "ops"."communities" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "communities_status_idx" ON "ops"."communities" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_memberships_unique" ON "ops"."community_memberships" USING btree ("community_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_posts_code_unique" ON "ops"."community_posts" USING btree ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_posts_community_published_idx" ON "ops"."community_posts" USING btree ("community_id","published_at");
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."app_users" ADD CONSTRAINT "app_users_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "ops"."communities"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."app_users" ADD CONSTRAINT "app_users_community_post_id_community_posts_id_fk" FOREIGN KEY ("community_post_id") REFERENCES "ops"."community_posts"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."contacts" ADD CONSTRAINT "contacts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "ops"."communities"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."contacts" ADD CONSTRAINT "contacts_community_post_id_community_posts_id_fk" FOREIGN KEY ("community_post_id") REFERENCES "ops"."community_posts"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ops"."contacts" ADD CONSTRAINT "contacts_registered_by_id_users_id_fk" FOREIGN KEY ("registered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
