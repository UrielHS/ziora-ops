CREATE TYPE "ops"."enrollment_status" AS ENUM('activa', 'terminada', 'detenida');--> statement-breakpoint
CREATE TYPE "ops"."sequence_channel" AS ENUM('email', 'whatsapp');--> statement-breakpoint
CREATE TABLE "ops"."sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"next_run_at" timestamp with time zone,
	"status" "ops"."enrollment_status" DEFAULT 'activa' NOT NULL,
	"stop_reason" text,
	"touches" integer DEFAULT 0 NOT NULL,
	"pending_step_id" uuid,
	"pending_text" text,
	"pending_since" timestamp with time zone,
	"enrolled_by" uuid,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"day_offset" integer NOT NULL,
	"channel" "ops"."sequence_channel" NOT NULL,
	"email_template_id" uuid,
	"whatsapp_text" text
);
--> statement-breakpoint
CREATE TABLE "ops"."sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"stop_on_reply" boolean DEFAULT true NOT NULL,
	"max_touches" integer DEFAULT 4 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "ops"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "ops"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_pending_step_id_sequence_steps_id_fk" FOREIGN KEY ("pending_step_id") REFERENCES "ops"."sequence_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_enrolled_by_users_id_fk" FOREIGN KEY ("enrolled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "ops"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sequence_steps" ADD CONSTRAINT "sequence_steps_email_template_id_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "ops"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."sequences" ADD CONSTRAINT "sequences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_active_unique" ON "ops"."sequence_enrollments" USING btree ("contact_id","sequence_id") WHERE "ops"."sequence_enrollments"."status" = 'activa';--> statement-breakpoint
CREATE INDEX "enrollments_due_idx" ON "ops"."sequence_enrollments" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_steps_position_unique" ON "ops"."sequence_steps" USING btree ("sequence_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sequences_name_unique" ON "ops"."sequences" USING btree ("name");