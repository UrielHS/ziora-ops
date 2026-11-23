-- Idempotente a propósito: se puede volver a aplicar sin error.
--> statement-breakpoint
ALTER TABLE "ops"."app_users" ADD COLUMN IF NOT EXISTS "first_note_at" timestamp with time zone;