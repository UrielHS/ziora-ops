import { and, eq, inArray, like } from "drizzle-orm";
import type { Db } from "@/db";
import { demoRequests } from "@/db/schema";
import { listDemoEvents } from "@/integrations/google/calendar";
import { requireEnv } from "@/lib/env";
import { toCity, upsertContact } from "./contacts";
import { parseDemoEvent, type ParsedDemoEvent } from "./demo-calendar";
import { advanceLead, logActivity, SYSTEM_ACTOR } from "./leads";
import { fmtDateTime } from "@/lib/format";

export type DemoInput = {
  externalId?: string;
  fullName: string;
  email: string;
  whatsapp?: string;
  patientsPerWeek?: string;
  teletherapy?: string;
  painPoint?: string;
  city?: string;
  scheduledAt?: Date | null;
  marketingOptIn?: boolean;
  utm?: Record<string, string>;
  source: string;
  raw?: Record<string, unknown>;
};

/** Una demo con fecha avanza al lead a demo_agendada (solo hacia adelante) y queda en su timeline. */
export async function leadDemoScheduled(db: Db, contactId: string, scheduledAt: Date, demoId?: string) {
  await logActivity(db, { contactId, type: "demo", actor: SYSTEM_ACTOR, summary: `Demo agendada para ${fmtDateTime(scheduledAt)}`, meta: { demoId: demoId ?? null } });
  await advanceLead(db, contactId, "demo_agendada", SYSTEM_ACTOR, { demoId: demoId ?? null });
}

/** Crea la demo y crea o completa el contacto en Ziora Ops. Idempotente por externalId. */
export async function ingestDemo(db: Db, p: DemoInput) {
  const { id: contactId } = await upsertContact(db, {
    name: p.fullName,
    email: p.email,
    phone: p.whatsapp,
    city: toCity(p.city),
    source: "demo_form",
    tags: ["psychologist", "lead"],
    details: { patientsPerWeek: p.patientsPerWeek, teletherapy: p.teletherapy },
    marketingOptIn: p.marketingOptIn ? { source: "demo_form", evidence: "Casilla de aviso en ziora-copilot.com/demo" } : null,
  });
  const [demo] = await db
    .insert(demoRequests)
    .values({
      contactId,
      fullName: p.fullName,
      email: p.email.toLowerCase(),
      whatsapp: p.whatsapp,
      patientsPerWeek: p.patientsPerWeek,
      teletherapy: p.teletherapy,
      painPoint: p.painPoint,
      stage: p.scheduledAt ? "scheduled" : "requested",
      scheduledAt: p.scheduledAt ?? null,
      utm: p.utm ?? {},
      externalId: p.externalId,
      source: p.source,
      raw: p.raw ?? {},
    })
    .onConflictDoNothing()
    .returning({ id: demoRequests.id });
  if (demo && p.scheduledAt) await leadDemoScheduled(db, contactId, p.scheduledAt, demo.id);
  return { contactId, demoId: demo?.id ?? null, duplicate: !demo };
}

export type CalendarSyncResult = { read: number; created: number; rescheduled: number; cancelled: number; skipped: number };

/** Aplica un evento ya interpretado: crea, reagenda o marca como cancelada. */
export async function applyCalendarDemo(db: Db, ev: ParsedDemoEvent): Promise<keyof Omit<CalendarSyncResult, "read">> {
  const [existing] = await db.select().from(demoRequests).where(eq(demoRequests.externalId, ev.externalId)).limit(1);

  if (ev.cancelled) {
    // Solo se cierra si seguía abierta; si ya se realizó o pagó, no se toca.
    if (existing && (existing.stage === "requested" || existing.stage === "scheduled")) {
      await db.update(demoRequests).set({ stage: "lost", lostReason: "Canceló en el calendario" }).where(eq(demoRequests.id, existing.id));
      return "cancelled";
    }
    return "skipped";
  }

  if (!existing) {
    await ingestDemo(db, {
      externalId: ev.externalId, fullName: ev.fullName, email: ev.email, whatsapp: ev.whatsapp, patientsPerWeek: ev.patientsPerWeek,
      teletherapy: ev.teletherapy, painPoint: ev.painPoint, city: ev.city, scheduledAt: ev.scheduledAt, source: "Google Calendar (CEO)",
      raw: { calendarLink: ev.link },
    });
    return "created";
  }

  const moved = ev.scheduledAt && existing.scheduledAt?.getTime() !== ev.scheduledAt.getTime();
  if (moved) {
    await db.update(demoRequests).set({
      scheduledAt: ev.scheduledAt,
      // Si se había marcado perdida por cancelación y la volvieron a agendar, regresa a Agendada.
      ...(existing.stage === "requested" || (existing.stage === "lost" && existing.lostReason === "Canceló en el calendario")
        ? { stage: "scheduled" as const, lostReason: null }
        : {}),
    }).where(eq(demoRequests.id, existing.id));
    return "rescheduled";
  }
  return "skipped";
}

/** Dominio del equipo: las demos con estos correos son pruebas internas y no entran al pipeline. */
export const TEAM_EMAIL_DOMAIN = "ziora-copilot.com";
export const isTeamEmail = (email: string) => email.trim().toLowerCase().endsWith(`@${TEAM_EMAIL_DOMAIN}`);

export type WebhookDemoResult = "created" | "rescheduled" | "cancelled" | "duplicate" | "skipped";
const CANCELLED_BY_LEAD = ["Canceló en el calendario", "Canceló la demo"];

/**
 * Demo que avisa la app (ziora-api). Por id: la crea, la reagenda si cambió la fecha o la marca perdida si se canceló.
 * Una demo ya realizada o pagada no se toca al cancelar.
 */
export async function applyWebhookDemo(db: Db, p: DemoInput & { status?: "scheduled" | "rescheduled" | "cancelled" }): Promise<{ result: WebhookDemoResult; demoId: string | null }> {
  const [existing] = p.externalId
    ? await db.select().from(demoRequests).where(eq(demoRequests.externalId, p.externalId)).limit(1)
    : [];

  if (p.status === "cancelled") {
    if (existing && (existing.stage === "requested" || existing.stage === "scheduled")) {
      await db.update(demoRequests).set({ stage: "lost", lostReason: "Canceló la demo" }).where(eq(demoRequests.id, existing.id));
      // El lead no retrocede: cancelar una demo solo queda en el timeline.
      if (existing.contactId) await logActivity(db, { contactId: existing.contactId, type: "demo", actor: SYSTEM_ACTOR, summary: "Canceló la demo", meta: { demoId: existing.id } });
      return { result: "cancelled", demoId: existing.id };
    }
    return { result: "skipped", demoId: existing?.id ?? null };
  }

  if (!existing) {
    const r = await ingestDemo(db, p);
    return { result: r.duplicate ? "duplicate" : "created", demoId: r.demoId };
  }

  const moved = p.scheduledAt && existing.scheduledAt?.getTime() !== p.scheduledAt.getTime();
  if (moved) {
    await db.update(demoRequests).set({
      scheduledAt: p.scheduledAt,
      ...(existing.stage === "requested" || (existing.stage === "lost" && CANCELLED_BY_LEAD.includes(existing.lostReason ?? ""))
        ? { stage: "scheduled" as const, lostReason: null }
        : {}),
    }).where(eq(demoRequests.id, existing.id));
    if (existing.contactId && p.scheduledAt) await leadDemoScheduled(db, existing.contactId, p.scheduledAt, existing.id);
    return { result: "rescheduled", demoId: existing.id };
  }
  return { result: "duplicate", demoId: existing.id };
}

export function calendarConfig() {
  return {
    subject: process.env.GOOGLE_CALENDAR_SUBJECT,
    calendarId: process.env.DEMO_CALENDAR_ID || "primary",
    match: process.env.DEMO_EVENT_MATCH || "Demo",
    ready: !!(process.env.GOOGLE_CALENDAR_SUBJECT && process.env.GOOGLE_INGEST_SA),
  };
}

/** Lee las demos del calendario del CEO (30 días atrás a 90 adelante) y las refleja en el pipeline. */
export async function syncCalendarDemos(db: Db): Promise<CalendarSyncResult> {
  const cfg = calendarConfig();
  const subject = cfg.subject ?? requireEnv("GOOGLE_CALENDAR_SUBJECT");
  const now = Date.now();
  const events = await listDemoEvents({
    subject, calendarId: cfg.calendarId, match: cfg.match,
    timeMin: new Date(now - 30 * 86_400_000), timeMax: new Date(now + 90 * 86_400_000),
  });
  const result: CalendarSyncResult = { read: events.length, created: 0, rescheduled: 0, cancelled: 0, skipped: 0 };
  for (const raw of events) {
    const parsed = parseDemoEvent(raw, [subject]);
    if (!parsed) {
      result.skipped++;
      continue;
    }
    result[await applyCalendarDemo(db, parsed)]++;
  }
  return result;
}

export async function calendarDemoCount(db: Db) {
  const rows = await db.select({ id: demoRequests.id }).from(demoRequests).where(and(like(demoRequests.externalId, "gcal:%"), inArray(demoRequests.stage, ["requested", "scheduled"])));
  return rows.length;
}
