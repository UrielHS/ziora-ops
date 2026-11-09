/**
 * Tablas propias de Ziora Ops, en el schema "ops" de la misma base que Event Ops.
 * drizzle-kit solo ve este archivo (ver drizzle.config.ts).
 */
import { sql } from "drizzle-orm";
import {
  boolean, date, index, integer, jsonb, pgSchema, primaryKey, serial, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { events, users } from "./shared";

export const ops = pgSchema("ops");

// ---------- contactos (propios de Ziora Ops) ----------
// Desde nov-2026 Ziora Ops ya no comparte contactos con Event Ops: tiene los suyos.
// Los de Event Ops solo se leen para importarlos (copia independiente, ver domain/contacts.ts).
export const cityEnum = ops.enum("city", ["cdmx", "nyc", "gdl", "mty", "other", "tbd"]);
export const contactSourceEnum = ops.enum("contact_source", [
  "manual", "demo_form", "ziora_app", "sheet_import", "csv_import", "event_ops",
  "facebook_group", "instagram", "linkedin", "referral",
]);
export const contactTagEnum = ops.enum("contact_tag", [
  "psychologist", "lead", "clinic", "ziora_user",
  "sponsor", "speaker", "founder", "angel", "vc", "community_partner", "influencer",
  "hospital", "university", "attendee", "vendor",
]);
export type CityValue = (typeof cityEnum.enumValues)[number];
export type ContactSource = (typeof contactSourceEnum.enumValues)[number];
export type ContactTag = (typeof contactTagEnum.enumValues)[number];

/** Embudo de leads (CRM). Orden: nuevo < contactado < respondio < demo_agendada < en_trial < pago; perdido es terminal. */
export const leadStatusEnum = ops.enum("lead_status", ["nuevo", "contactado", "respondio", "demo_agendada", "en_trial", "pago", "perdido"]);
export type LeadStatus = (typeof leadStatusEnum.enumValues)[number];

export const contacts = ops.table(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"), // en minúsculas; único cuando existe
    phone: text("phone"),
    company: text("company"),
    jobTitle: text("job_title"), // en la hoja de leads: "Rol"
    city: cityEnum("city"), // normalizada para filtrar
    cityName: text("city_name"), // como la escribió la persona ("Ciudad de México", "Cdmx"…)
    // Perfil del lead (hoja "Leads Ziora MTW", columnas Nombre a Ciudad): mismos valores que la hoja, sin traducir.
    patientsPerWeek: text("patients_per_week"),
    approach: text("approach"), // Enfoque terapéutico
    documentation: text("documentation"), // Cómo documenta hoy
    aiUsage: text("ai_usage"), // Usa IA
    linkedinUrl: text("linkedin_url"),
    website: text("website"),
    source: contactSourceEnum("source").notNull().default("manual"),
    notes: text("notes"),
    // Columnas de la importación que no tienen campo propio (se guardan tal cual vienen en la hoja).
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    eventOpsContactId: uuid("event_ops_contact_id"), // de qué contacto de Event Ops se copió, si aplica
    // --- Lead (CRM). Null en lead_status = el contacto no es un lead que se esté trabajando.
    phoneE164: text("phone_e164"), // solo dígitos, p. ej. 525512345678; único cuando no es null
    leadStatus: leadStatusEnum("lead_status"),
    lostReason: text("lost_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    nextAction: text("next_action"),
    nextActionOn: date("next_action_on"),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    priority: integer("priority"), // 1 alta (P1) · 2 media (P2) · 3 baja (P3-P5 de la hoja)
    segment: text("segment"), // segmento de la hoja de leads, tal cual (HOT, WARM-A, COLD-Virtual…)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("contacts_email_unique").on(t.email),
    uniqueIndex("contacts_event_ops_unique").on(t.eventOpsContactId),
    uniqueIndex("contacts_phone_e164_unique").on(t.phoneE164).where(sql`${t.phoneE164} is not null`),
    index("contacts_name_idx").on(t.name),
    index("contacts_lead_status_idx").on(t.leadStatus),
    index("contacts_owner_idx").on(t.ownerId),
    index("contacts_next_action_idx").on(t.nextActionOn),
  ],
);

export const contactTags = ops.table(
  "contact_tags",
  {
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    tag: contactTagEnum("tag").notNull(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tag] })],
);

// ---------- enums ----------
export const taskStatusEnum = ops.enum("task_status", ["backlog", "todo", "in_progress", "in_review", "done"]);
export const priorityEnum = ops.enum("priority", ["low", "medium", "high", "urgent"]);
export const sprintStatusEnum = ops.enum("sprint_status", ["planned", "active", "closed"]);
export const demoStageEnum = ops.enum("demo_stage", [
  "requested", "scheduled", "done", "no_show", "trial", "paid", "lost",
]);
export const bugSeverityEnum = ops.enum("bug_severity", ["critical", "high", "medium", "low"]);
export const bugStatusEnum = ops.enum("bug_status", [
  "new", "triaged", "in_progress", "fixed", "verified", "wont_fix", "duplicate",
]);
export const bugSourceEnum = ops.enum("bug_source", ["manual", "ziora_app", "sentry", "github"]);
export const prStateEnum = ops.enum("pr_state", ["open", "closed", "merged"]);
export const campaignStatusEnum = ops.enum("campaign_status", ["draft", "scheduled", "sending", "sent", "failed"]);
export const sendStatusEnum = ops.enum("send_status", [
  "queued", "sent", "delivered", "opened", "clicked", "bounced", "complained", "failed", "skipped",
]);
export const contentPillarEnum = ops.enum("content_pillar", [
  "producto", "ia_psicoterapia", "estudios", "roi", "psicoterapia_moderna", "memes",
]);
export const contentChannelEnum = ops.enum("content_channel", ["instagram", "tiktok", "facebook_group", "linkedin", "blog", "email", "facebook"]);
export const contentStatusEnum = ops.enum("content_status", [
  "idea", "draft", "legal_review", "approved", "scheduled", "published", "discarded",
]);
export const riskEnum = ops.enum("risk", ["low", "medium", "high"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ---------- trabajo (tipo Jira) ----------
export const epics = ops.table("epics", {
  id: id(),
  key: text("key").notNull().unique(), // GTM, PROD, QA, VENTAS
  name: text("name").notNull(),
  color: text("color").notNull().default("#507060"),
  ...timestamps(),
});

export const sprints = ops.table("sprints", {
  id: id(),
  name: text("name").notNull(),
  goal: text("goal"),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  status: sprintStatusEnum("status").notNull().default("planned"),
  ...timestamps(),
});

export const tasks = ops.table(
  "tasks",
  {
    id: id(),
    number: serial("number").notNull().unique(), // se muestra como ZOP-<number>
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("backlog"),
    priority: priorityEnum("priority").notNull().default("medium"),
    epicId: uuid("epic_id").references(() => epics.id, { onDelete: "set null" }),
    sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    dueOn: date("due_on"),
    estimate: integer("estimate"),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    blocker: boolean("blocker").notNull().default(false), // aparece en "Bloqueos activos" del dashboard
    position: integer("position").notNull().default(0),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    bugId: uuid("bug_id"),
    demoId: uuid("demo_id"),
    prUrl: text("pr_url"),
    ...timestamps(),
  },
  (t) => [
    index("tasks_status_idx").on(t.status),
    index("tasks_sprint_idx").on(t.sprintId),
    index("tasks_assignee_idx").on(t.assigneeId),
  ],
);

// ---------- ventas: demos ----------
export const demoRequests = ops.table(
  "demo_requests",
  {
    id: id(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    whatsapp: text("whatsapp"),
    patientsPerWeek: text("patients_per_week"),
    teletherapy: text("teletherapy"),
    painPoint: text("pain_point"),
    stage: demoStageEnum("stage").notNull().default("requested"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source").notNull().default("ziora-copilot.com/demo"),
    utm: jsonb("utm").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    externalId: text("external_id"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    lostReason: text("lost_reason"),
    ...timestamps(),
  },
  (t) => [
    index("demo_requests_stage_idx").on(t.stage),
    uniqueIndex("demo_requests_external_id_unique").on(t.externalId).where(sql`${t.externalId} is not null`),
  ],
);

// ---------- producto: QA y bugs ----------
export const bugs = ops.table(
  "bugs",
  {
    id: id(),
    number: serial("number").notNull().unique(), // BUG-<number>
    title: text("title").notNull(),
    description: text("description"),
    stepsToReproduce: text("steps_to_reproduce"),
    expected: text("expected"),
    actual: text("actual"),
    severity: bugSeverityEnum("severity").notNull().default("medium"),
    status: bugStatusEnum("status").notNull().default("new"),
    area: text("area"), // Checkout, Grabación, Nota, Portal, Videollamada...
    environment: text("environment").notNull().default("production"),
    device: text("device"),
    appVersion: text("app_version"),
    pageUrl: text("page_url"),
    source: bugSourceEnum("source").notNull().default("manual"),
    externalId: text("external_id"), // id de Sentry o issue de GitHub
    externalUrl: text("external_url"),
    reporterEmail: text("reporter_email"),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    prUrl: text("pr_url"),
    occurrences: integer("occurrences").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    index("bugs_status_idx").on(t.status),
    uniqueIndex("bugs_source_external_unique").on(t.source, t.externalId).where(sql`${t.externalId} is not null`),
  ],
);

// ---------- producto: PRs de GitHub (caché) ----------
export const pullRequests = ops.table(
  "pull_requests",
  {
    id: id(),
    repo: text("repo").notNull(), // owner/name
    number: integer("number").notNull(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    state: prStateEnum("state").notNull(),
    draft: boolean("draft").notNull().default(false),
    reviewState: text("review_state"), // approved | changes_requested | pending
    checksState: text("checks_state"), // success | failure | pending
    url: text("url").notNull(),
    headRef: text("head_ref"),
    baseRef: text("base_ref"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    ghUpdatedAt: timestamp("gh_updated_at", { withTimezone: true }).notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("pull_requests_repo_number_unique").on(t.repo, t.number)],
);

// ---------- marketing: correo masivo ----------
export const emailTemplates = ops.table("email_templates", {
  id: id(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  previewText: text("preview_text"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
});

export type CampaignSegment = {
  tags?: string[];
  cities?: string[];
  sources?: string[];
  eventId?: string; // invitados a un evento de Event Ops
  contactIds?: string[];
};

export const campaigns = ops.table("campaigns", {
  id: id(),
  name: text("name").notNull(),
  templateId: uuid("template_id").notNull().references(() => emailTemplates.id),
  subject: text("subject"), // si es null usa el de la plantilla
  fromEmail: text("from_email"),
  segment: jsonb("segment").$type<CampaignSegment>().notNull().default(sql`'{}'::jsonb`),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  status: campaignStatusEnum("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
});

export const campaignSends = ops.table(
  "campaign_sends",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    status: sendStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("campaign_sends_unique").on(t.campaignId, t.email),
    uniqueIndex("campaign_sends_provider_unique").on(t.providerMessageId).where(sql`${t.providerMessageId} is not null`),
  ],
);

// Consentimiento de correo de marketing (LFPDPPP). Sin fila con emailOptIn = true, no se envía.
export const contactConsents = ops.table(
  "contact_consents",
  {
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("email"),
    optIn: boolean("opt_in").notNull().default(false),
    source: text("source").notNull(), // demo_form, evento, importación con aviso, manual
    evidence: text("evidence"), // texto o URL del aviso aceptado
    optedInAt: timestamp("opted_in_at", { withTimezone: true }),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.channel] })],
);

export const activityTypeEnum = ops.enum("activity_type", ["nota", "whatsapp", "correo", "llamada", "reunion", "cambio_estado", "demo", "campana", "secuencia", "sistema"]);
export const activityDirectionEnum = ops.enum("activity_direction", ["saliente", "entrante", "ninguna"]);
export type ActivityType = (typeof activityTypeEnum.enumValues)[number];

/** Timeline del contacto: cada toque, respuesta, cambio de estado o evento del sistema. Solo se agrega, no se edita. */
export const contactActivities = ops.table(
  "contact_activities",
  {
    id: id(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    type: activityTypeEnum("type").notNull(),
    direction: activityDirectionEnum("direction").notNull().default("ninguna"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorLabel: text("actor_label").notNull(), // nombre de la persona, "sistema" o "token:<nombre>"
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    summary: text("summary").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("contact_activities_contact_idx").on(t.contactId, t.occurredAt)],
);

// ---------- CRM: cadencia (secuencias de toques) ----------
// Solo tablas nuevas: no toca contacts ni datos existentes. Nada se enrola solo; el job únicamente actúa sobre sequence_enrollments.
export const sequenceChannelEnum = ops.enum("sequence_channel", ["email", "whatsapp"]);
export const enrollmentStatusEnum = ops.enum("enrollment_status", ["activa", "terminada", "detenida"]);
export type SequenceChannel = (typeof sequenceChannelEnum.enumValues)[number];
export type EnrollmentStatus = (typeof enrollmentStatusEnum.enumValues)[number];

export const sequences = ops.table(
  "sequences",
  {
    id: id(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    stopOnReply: boolean("stop_on_reply").notNull().default(true),
    maxTouches: integer("max_touches").notNull().default(4),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("sequences_name_unique").on(t.name)],
);

export const sequenceSteps = ops.table(
  "sequence_steps",
  {
    id: id(),
    sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    dayOffset: integer("day_offset").notNull(), // días después de enrolar (0, 3, 7, 14)
    channel: sequenceChannelEnum("channel").notNull(),
    emailTemplateId: uuid("email_template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
    whatsappText: text("whatsapp_text"), // mismas variables {{nombre}} que las plantillas; texto plano
  },
  (t) => [uniqueIndex("sequence_steps_position_unique").on(t.sequenceId, t.position)],
);

export const sequenceEnrollments = ops.table(
  "sequence_enrollments",
  {
    id: id(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
    currentStep: integer("current_step").notNull().default(1), // posición del próximo paso a ejecutar
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    status: enrollmentStatusEnum("status").notNull().default("activa"),
    stopReason: text("stop_reason"), // respondio · perdido · baja · tope · manual · completada · sin_canal
    touches: integer("touches").notNull().default(0), // pasos ejecutados (correo enviado o WhatsApp marcado); los omitidos no cuentan
    // Toque de WhatsApp pendiente: el job no envía WhatsApp, lo deja listo para que el dueño lo mande desde Hoy.
    pendingStepId: uuid("pending_step_id").references(() => sequenceSteps.id, { onDelete: "set null" }),
    pendingText: text("pending_text"),
    pendingSince: timestamp("pending_since", { withTimezone: true }),
    enrolledBy: uuid("enrolled_by").references(() => users.id, { onDelete: "set null" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("enrollments_active_unique").on(t.contactId, t.sequenceId).where(sql`${t.status} = 'activa'`),
    index("enrollments_due_idx").on(t.status, t.nextRunAt),
  ],
);
export type Sequence = typeof sequences.$inferSelect;
export type SequenceStep = typeof sequenceSteps.$inferSelect;
export type SequenceEnrollment = typeof sequenceEnrollments.$inferSelect;

// ---------- marketing: calendario de contenido (plan GTM 90 días) ----------
export const contentPieces = ops.table(
  "content_pieces",
  {
    id: id(),
    title: text("title").notNull(),
    pillar: contentPillarEnum("pillar").notNull(),
    channel: contentChannelEnum("channel").notNull(), // canal principal (el primero de channels)
    // Una pieza se publica en varios canales a la vez (siempre TikTok, Instagram y Facebook; LinkedIn si es educativa).
    channels: contentChannelEnum("channels").array().notNull().default(sql`'{}'::ops.content_channel[]`),
    format: text("format").notNull(), // reel, carrusel, imagen, aporte
    status: contentStatusEnum("status").notNull().default("idea"),
    risk: riskEnum("risk").notNull().default("low"),
    publishOn: date("publish_on"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    copy: text("copy"),
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    assetUrl: text("asset_url"),
    publishedUrl: text("published_url"),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    legalChecklistOk: boolean("legal_checklist_ok").notNull().default(false),
    // Se pidió revisión (y no se ha cancelado). Una pieza puede estar programada y seguir pendiente de revisión.
    reviewRequestedAt: timestamp("review_requested_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("content_pieces_publish_on_idx").on(t.publishOn)],
);

// ---------- ajustes editables desde la app (clave → valor) ----------
export const settings = ops.table("settings", {
  key: text("key").primaryKey(), // p. ej. "content_mix"
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ---------- métricas: metas del plan GTM (sección 9 del brief) ----------
export type GoalTargets = { d30: [number, number]; d60: [number, number]; d90: [number, number] };

export const goals = ops.table("goals", {
  id: id(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  source: text("source").notNull(), // Meta Insights, PostHog, registro manual...
  current: integer("current").notNull().default(0),
  // Si es "auto", se calcula desde la BD (demos, altas registradas aquí) en lugar de capturarse a mano.
  auto: text("auto"),
  targets: jsonb("targets").$type<GoalTargets>().notNull(),
  position: integer("position").notNull().default(0),
  ...timestamps(),
});

// ---------- equipo: roles funcionales de Ziora Ops ----------
// public.users.role (admin/operator/volunteer) es de Event Ops. Estos roles son propios de Ziora Ops
// y deciden qué ve y qué puede hacer cada persona. Una persona puede tener varios.
export const opsRoleEnum = ops.enum("ops_role", ["ceo", "sales", "clinical_director", "marketing", "operations", "dev_qa"]);

export const memberRoles = ops.table(
  "member_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: opsRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

// ---------- marketing: revisión de contenido y sugerencias ----------
// Una pieza se publica solo con la aprobación de cada rol revisor (CEO, director clínico y ventas)
// más la checklist legal. La última decisión de cada persona reemplaza a la anterior.
export const reviewDecisionEnum = ops.enum("review_decision", ["approved", "changes_requested"]);

export const contentReviews = ops.table(
  "content_reviews",
  {
    id: id(),
    pieceId: uuid("piece_id").notNull().references(() => contentPieces.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    decision: reviewDecisionEnum("decision").notNull(),
    comment: text("comment"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("content_reviews_piece_reviewer_unique").on(t.pieceId, t.reviewerId)],
);

// Sugerencias de contenido de cualquier persona del equipo. No son tareas: marketing las revisa
// y, si las acepta, se crean la pieza en el calendario y la tarea de publicación.
export const suggestionStatusEnum = ops.enum("suggestion_status", ["new", "accepted", "rejected"]);

export const contentSuggestions = ops.table(
  "content_suggestions",
  {
    id: id(),
    title: text("title").notNull(),
    idea: text("idea").notNull(),
    why: text("why"),
    channel: contentChannelEnum("channel"),
    referenceUrl: text("reference_url"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    status: suggestionStatusEnum("status").notNull().default("new"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
    pieceId: uuid("piece_id").references(() => contentPieces.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("content_suggestions_status_idx").on(t.status)],
);

// ---------- producto: tickets (cambios, mejoras y errores) en formato historia de usuario ----------
// Los levanta el equipo (director clínico, ventas…) o llegan de "Ayuda y sugerencias" de la app.
// Dev/QA los evalúa (impacto, esfuerzo, viabilidad) y, si se planean, se crea la tarea.
export const ticketKindEnum = ops.enum("ticket_kind", ["bug", "change", "feature"]);
export const ticketOriginEnum = ops.enum("ticket_origin", ["team", "ziora_app_help"]);
export const ticketStatusEnum = ops.enum("ticket_status", ["new", "evaluating", "planned", "in_progress", "done", "rejected"]);
export const viabilityEnum = ops.enum("viability", ["pending", "viable", "not_viable", "needs_info"]);
export const effortEnum = ops.enum("effort", ["s", "m", "l", "xl"]);

export const tickets = ops.table(
  "tickets",
  {
    id: id(),
    number: serial("number").notNull().unique(), // TKT-<number>
    kind: ticketKindEnum("kind").notNull().default("change"),
    origin: ticketOriginEnum("origin").notNull().default("team"),
    title: text("title").notNull(),
    // Historia de usuario: Como <asA>, quiero <iWant>, para <soThat>.
    asA: text("as_a"),
    iWant: text("i_want"),
    soThat: text("so_that"),
    // "Sabremos que está listo cuando…": un criterio por elemento.
    acceptanceCriteria: text("acceptance_criteria").array().notNull().default(sql`'{}'::text[]`),
    // Texto original (mensaje del usuario de la app o contexto libre del equipo).
    context: text("context"),
    area: text("area"),
    category: text("category"), // categoría que eligió el usuario en la app
    impact: integer("impact"), // 1 a 5
    effort: effortEnum("effort"),
    viability: viabilityEnum("viability").notNull().default("pending"),
    decisionNote: text("decision_note"),
    status: ticketStatusEnum("status").notNull().default("new"),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    reporterEmail: text("reporter_email"), // terapeuta que escribió desde la app
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    externalId: text("external_id"), // id del documento en Firestore
    appVersion: text("app_version"),
    pageUrl: text("page_url"),
    bugId: uuid("bug_id").references(() => bugs.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("tickets_status_idx").on(t.status),
    uniqueIndex("tickets_origin_external_unique").on(t.origin, t.externalId).where(sql`${t.externalId} is not null`),
  ],
);

// ---------- ventas B2B: cuentas, oportunidades y contratos ----------
// ziora_ops solo puede LEER public.organizations, así que las cuentas viven aquí.
// organizationId enlaza (sin FK) con la organización de Event Ops cuando existe.
export const accountTypeEnum = ops.enum("account_type", ["clinic", "university", "hospital", "institution", "other"]);
export const dealStageEnum = ops.enum("deal_stage", ["prospect", "meeting", "proposal", "negotiation", "won", "lost"]);
export const contractStatusEnum = ops.enum("contract_status", ["draft", "sent", "signed", "active", "expired", "cancelled"]);
export const billingPeriodEnum = ops.enum("billing_period", ["monthly", "annual", "one_time"]);

export const accounts = ops.table("accounts", {
  id: id(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull().default("clinic"),
  city: text("city"),
  website: text("website"),
  organizationId: uuid("organization_id"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  therapistsCount: integer("therapists_count"), // tamaño: cuántos terapeutas tiene
  notes: text("notes"),
  ...timestamps(),
});

export const accountContacts = ops.table(
  "account_contacts",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    title: text("title"), // Directora, Coordinador clínico…
    decisionMaker: boolean("decision_maker").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.contactId] })],
);

export const deals = ops.table(
  "deals",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    stage: dealStageEnum("stage").notNull().default("prospect"),
    seats: integer("seats"), // licencias
    amountMxn: integer("amount_mxn"), // valor estimado del contrato
    billingPeriod: billingPeriodEnum("billing_period").notNull().default("monthly"),
    expectedCloseOn: date("expected_close_on"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    lostReason: text("lost_reason"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [index("deals_stage_idx").on(t.stage)],
);

export const contracts = ops.table(
  "contracts",
  {
    id: id(),
    number: serial("number").notNull().unique(), // CTR-<number>
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    seats: integer("seats"),
    pricePerSeatMxn: integer("price_per_seat_mxn"),
    amountMxn: integer("amount_mxn").notNull().default(0), // por periodo de cobro
    billingPeriod: billingPeriodEnum("billing_period").notNull().default("monthly"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    status: contractStatusEnum("status").notNull().default("draft"),
    signedOn: date("signed_on"),
    documentUrl: text("document_url"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [index("contracts_status_idx").on(t.status), index("contracts_ends_on_idx").on(t.endsOn)],
);

// ---------- Ziora Copilot (Firebase): usuarios, planes y pacientes ----------
// Copia de solo lectura que llena /api/jobs/sync-ziora-users. Por privacidad, de los pacientes
// SOLO se guarda el conteo: nunca nombres, notas ni ningún dato clínico.
export const appUsers = ops.table(
  "app_users",
  {
    uid: text("uid").primaryKey(), // uid de Firebase Auth
    email: text("email").notNull(),
    name: text("name"),
    plan: text("plan").notNull(), // tal cual lo guarda la app: free, pro, clinic…
    status: text("status").notNull(), // active, trialing, past_due, cancelled…
    signedUpAt: timestamp("signed_up_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    patientCount: integer("patient_count").notNull().default(0),
    sessionsLast30d: integer("sessions_last_30d").notNull().default(0),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    // Suscripción real (Stripe, vía la app). mrrCents null = la app no lo mandó y se usa plan × precio.
    billingPeriod: text("billing_period"), // monthly | annual
    mrrCents: integer("mrr_cents"),
    currency: text("currency"), // ISO 4217 en minúsculas: mxn, usd…
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }), // si pertenece a una clínica cliente
    firstSyncedAt: timestamp("first_synced_at", { withTimezone: true }).notNull().defaultNow(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }), // ya no viene en el snapshot (cuenta borrada)
    // Cuenta de prueba o interna (la marca el equipo en Usuarios de Ziora): no se muestra ni cuenta en métricas,
    // MRR ni seguimientos. La sincronización nunca la cambia.
    isTest: boolean("is_test").notNull().default(false),
  },
  (t) => [index("app_users_plan_idx").on(t.plan), uniqueIndex("app_users_email_unique").on(t.email)],
);

// Foto diaria agregada por plan para ver tendencias (sin datos por persona).
export const appUserDaily = ops.table(
  "app_user_daily",
  {
    day: date("day").notNull(),
    plan: text("plan").notNull(),
    users: integer("users").notNull(),
    active: integer("active").notNull(),
    paying: integer("paying").notNull(),
    patients: integer("patients").notNull(),
    estimatedMrrMxn: integer("estimated_mrr_mxn").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.plan] })],
);

// Precio de cada plan para el MRR estimado, mientras se conecta la fuente real de pagos.
export const planPrices = ops.table("plan_prices", {
  plan: text("plan").primaryKey(),
  label: text("label").notNull(),
  priceMxn: integer("price_mxn").notNull().default(0),
  billingPeriod: billingPeriodEnum("billing_period").notNull().default("monthly"),
  paying: boolean("paying").notNull().default(true), // free/trial = false
  ...timestamps(),
});

// ---------- seguimiento 1:1 (director clínico, ventas) ----------
// Una fila = un seguimiento agendado; al completarlo se registra el resultado y, si hace falta, el siguiente.
export const followupChannelEnum = ops.enum("followup_channel", ["call", "whatsapp", "email", "video", "in_person"]);
export const followupStatusEnum = ops.enum("followup_status", ["pending", "done", "cancelled"]);
export const healthEnum = ops.enum("health", ["green", "yellow", "red"]);

export const followups = ops.table(
  "followups",
  {
    id: id(),
    title: text("title").notNull(),
    appUserUid: text("app_user_uid").references(() => appUsers.uid, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    demoId: uuid("demo_id").references(() => demoRequests.id, { onDelete: "set null" }),
    channel: followupChannelEnum("channel").notNull().default("call"),
    dueOn: date("due_on").notNull(),
    status: followupStatusEnum("status").notNull().default("pending"),
    reason: text("reason").notNull().default("manual"), // manual | paying_inactive | trial_ending
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    outcome: text("outcome"),
    health: healthEnum("health"),
    nextAction: text("next_action"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("followups_status_due_idx").on(t.status, t.dueOn),
    // Una sola sugerencia automática pendiente por usuario y motivo.
    uniqueIndex("followups_auto_unique").on(t.appUserUid, t.reason).where(sql`${t.status} = 'pending' and ${t.reason} <> 'manual'`),
  ],
);

// ---------- marketing: redes sociales y campañas pagadas ----------
// Se llenan con /api/jobs/sync-social (API de Meta) o con importación CSV (TikTok, LinkedIn,
// agregadores como Windsor.ai o Supermetrics). Montos en centavos de MXN para no perder precisión.
export const socialPlatformEnum = ops.enum("social_platform", ["instagram", "facebook", "tiktok", "linkedin"]);

export const socialAccounts = ops.table(
  "social_accounts",
  {
    id: id(),
    platform: socialPlatformEnum("platform").notNull(),
    handle: text("handle").notNull(), // @ziora.mx
    externalId: text("external_id"), // id de la cuenta en la plataforma (IG user id, page id…)
    adAccountId: text("ad_account_id"), // act_123… para campañas
    tokenEncrypted: text("token_encrypted"), // AES-256-GCM con SOCIAL_TOKEN_KEY; nunca se muestra
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("social_accounts_platform_handle_unique").on(t.platform, t.handle)],
);

export const socialDaily = ops.table(
  "social_daily",
  {
    accountId: uuid("account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    followers: integer("followers"),
    reach: integer("reach"),
    impressions: integer("impressions"),
    engagements: integer("engagements"),
    profileViews: integer("profile_views"),
    linkClicks: integer("link_clicks"),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.day] })],
);

export const socialPosts = ops.table(
  "social_posts",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    url: text("url"),
    caption: text("caption"),
    mediaType: text("media_type"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    reach: integer("reach"),
    views: integer("views"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    contentPieceId: uuid("content_piece_id").references(() => contentPieces.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("social_posts_account_external_unique").on(t.accountId, t.externalId)],
);

export const adCampaigns = ops.table(
  "ad_campaigns",
  {
    id: id(),
    platform: socialPlatformEnum("platform").notNull(),
    externalId: text("external_id").notNull(),
    accountId: uuid("account_id").references(() => socialAccounts.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    objective: text("objective"),
    status: text("status"),
    // Valor de utm_campaign con el que llegan las demos de esta campaña (atribución real).
    utmCampaign: text("utm_campaign"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("ad_campaigns_platform_external_unique").on(t.platform, t.externalId)],
);

export const adDaily = ops.table(
  "ad_daily",
  {
    campaignId: uuid("campaign_id").notNull().references(() => adCampaigns.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    spendCents: integer("spend_cents").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0), // lo que reporta la plataforma
    conversions: integer("conversions").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.day] })],
);
