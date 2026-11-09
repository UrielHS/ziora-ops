-- Leads (CRM): estado, dueño, próxima acción, teléfono E.164 y timeline. Idempotente: se puede volver a correr.
DO $$ BEGIN CREATE TYPE "ops"."activity_direction" AS ENUM('saliente', 'entrante', 'ninguna'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."activity_type" AS ENUM('nota', 'whatsapp', 'correo', 'llamada', 'reunion', 'cambio_estado', 'demo', 'campana', 'secuencia', 'sistema'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "ops"."lead_status" AS ENUM('nuevo', 'contactado', 'respondio', 'demo_agendada', 'en_trial', 'pago', 'perdido'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."contact_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"type" "ops"."activity_type" NOT NULL,
	"direction" "ops"."activity_direction" DEFAULT 'ninguna' NOT NULL,
	"actor_id" uuid,
	"actor_label" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "phone_e164" text;--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "lead_status" "ops"."lead_status";--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "lost_reason" text;--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "next_action" text;--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "next_action_on" date;--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "last_contact_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "priority" integer;--> statement-breakpoint
ALTER TABLE "ops"."contacts" ADD COLUMN IF NOT EXISTS "segment" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_activities_contact_id_contacts_id_fk') THEN
    ALTER TABLE "ops"."contact_activities" ADD CONSTRAINT "contact_activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "ops"."contacts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_activities_actor_id_users_id_fk') THEN
    ALTER TABLE "ops"."contact_activities" ADD CONSTRAINT "contact_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_owner_id_users_id_fk') THEN
    ALTER TABLE "ops"."contacts" ADD CONSTRAINT "contacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_activities_contact_idx" ON "ops"."contact_activities" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_lead_status_idx" ON "ops"."contacts" USING btree ("lead_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_owner_idx" ON "ops"."contacts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_next_action_idx" ON "ops"."contacts" USING btree ("next_action_on");--> statement-breakpoint
-- Teléfono E.164 (mismas reglas que src/domain/phone.ts): 10 dígitos son de México; se acepta solo 521+13, 52+12 o 1+11.
CREATE OR REPLACE FUNCTION "ops".normalize_phone_e164(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  WITH d AS (SELECT regexp_replace(coalesce(raw, ''), '\D', '', 'g') AS digits),
       n AS (SELECT CASE WHEN length(digits) = 10 THEN '52' || digits ELSE digits END AS digits FROM d)
  SELECT CASE
    WHEN digits LIKE '521%' AND length(digits) = 13 THEN digits
    WHEN digits LIKE '52%' AND length(digits) = 12 THEN digits
    WHEN digits LIKE '1%' AND length(digits) = 11 THEN digits
    ELSE NULL
  END FROM n
$$;--> statement-breakpoint
UPDATE "ops"."contacts" SET "phone_e164" = "ops".normalize_phone_e164("phone") WHERE "phone_e164" IS NULL AND "phone" IS NOT NULL;--> statement-breakpoint
-- Dos contactos con el mismo número: el más antiguo lo conserva; los demás quedan sin phone_e164 y con una nota para fusionarlos a mano.
WITH ranked AS (
  SELECT id, phone_e164, first_value(id) OVER (PARTITION BY phone_e164 ORDER BY created_at, id) AS keeper,
         row_number() OVER (PARTITION BY phone_e164 ORDER BY created_at, id) AS rn
  FROM "ops"."contacts" WHERE phone_e164 IS NOT NULL
)
UPDATE "ops"."contacts" c SET "phone_e164" = NULL, "details" = c."details" || jsonb_build_object('telefono_duplicado_de', r.keeper)
FROM ranked r WHERE r.id = c.id AND r.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_phone_e164_unique" ON "ops"."contacts" USING btree ("phone_e164") WHERE "phone_e164" is not null;
