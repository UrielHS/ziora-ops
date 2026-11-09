/**
 * Cadencia de leads (spec §4.4): secuencias de toques por correo y WhatsApp.
 *
 * - Los pasos de correo los manda el job (Resend, con liga de baja), igual que las campañas.
 * - Los pasos de WhatsApp NO se envían: quedan como "toque pendiente" para que el dueño lo mande desde Hoy
 *   y marque "Ya lo mandé" (completePendingTouch).
 * - Parar al responder / perder / baja vive en leads.ts (stopActiveEnrollments) para que ningún camino se lo salte.
 * - Nada se enrola solo: enroll() se llama desde la ficha, el kanban o la importación.
 */
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db, Dbx } from "@/db";
import {
  contactConsents, contacts, emailTemplates, sequenceEnrollments, sequenceSteps, sequences,
  type EnrollmentStatus, type SequenceChannel, type SequenceEnrollment, type SequenceStep,
} from "@/db/schema";
import { users } from "@/db/shared";
import { sendBatch, type OutgoingEmail } from "@/integrations/resend";
import { unsubscribeToken } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { logActivity, recordTouch, stopActiveEnrollments, SYSTEM_ACTOR, type Actor } from "./leads";
import { firstName, renderTemplate, type TemplateVars } from "./template";

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

export const SENDING_TZ = "America/Mexico_City";
const SEND_HOUR = 10; // hora CDMX a la que se programan los pasos con offset > 0
const CDMX_OFFSET = "-06:00"; // CDMX no tiene horario de verano desde 2022

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: SENDING_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: SENDING_TZ, hour: "numeric", hour12: false });

/** Fecha YYYY-MM-DD en CDMX. */
export function cdmxDay(d: Date): string {
  return dayFmt.format(d);
}

function cdmxHour(d: Date): number {
  return Number(hourFmt.format(d)) % 24; // "24" a medianoche en algunos runtimes
}

/** offset 0 → ya; si no, las 10:00 CDMX del día enrolledAt + offset, o ya si ese instante ya pasó. */
export function computeNextRunAt(enrolledAt: Date, dayOffset: number, now: Date): Date {
  if (dayOffset <= 0) return now;
  const base = new Date(`${cdmxDay(enrolledAt)}T12:00:00${CDMX_OFFSET}`); // mediodía: sumar días sin cruzar fechas
  base.setUTCDate(base.getUTCDate() + dayOffset);
  const at = new Date(`${cdmxDay(base)}T${String(SEND_HOUR).padStart(2, "0")}:00:00${CDMX_OFFSET}`);
  return at.getTime() <= now.getTime() ? now : at;
}

/** 08:00 ≤ hora CDMX < 20:00. */
export function inSendingWindow(now: Date): boolean {
  const h = cdmxHour(now);
  return h >= 8 && h < 20;
}

export function cadenceVars(c: { name: string; email: string | null; cityName: string | null }, ownerName: string | null): TemplateVars {
  return {
    nombre: firstName(c.name),
    nombre_completo: c.name,
    email: c.email,
    ciudad: c.cityName,
    remitente: ownerName ? firstName(ownerName) : "el equipo de Ziora",
  };
}

const UNESC: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** WhatsApp es texto plano: renderiza y deshace el escape HTML de renderTemplate. */
export function renderWhatsapp(text: string, vars: TemplateVars): string {
  return renderTemplate(text, vars).replace(/&(amp|lt|gt|quot|#39);/g, (m) => UNESC[m] ?? m);
}

export function touchLabel(touch: number, total: number, channel: SequenceChannel): string {
  return `Toque ${touch} de ${total} · ${channel === "email" ? "Correo" : "WhatsApp"}`;
}

// ---------------------------------------------------------------------------
// Enrolar
// ---------------------------------------------------------------------------

export type EnrollSkipReason = "estado" | "ya_enrolado" | "secuencia_inactiva";
export type EnrollResult = { enrolled: number; skipped: { contactId: string; reason: EnrollSkipReason }[] };

/** Enrola leads en nuevo/contactado. No duplica (un enrollment activo por secuencia) y deja actividad. */
export async function enroll(db: Dbx, contactIds: string[], sequenceId: string, actor: Actor, now = new Date()): Promise<EnrollResult> {
  const skipped: EnrollResult["skipped"] = [];
  if (!contactIds.length) return { enrolled: 0, skipped };
  const [seq] = await db.select().from(sequences).where(eq(sequences.id, sequenceId)).limit(1);
  if (!seq) throw new Error("La secuencia no existe.");
  if (!seq.active) return { enrolled: 0, skipped: contactIds.map((contactId) => ({ contactId, reason: "secuencia_inactiva" as const })) };
  const [first] = await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, sequenceId)).orderBy(asc(sequenceSteps.position)).limit(1);
  if (!first) throw new Error("La secuencia no tiene pasos.");

  const rows = await db.select({ id: contacts.id, leadStatus: contacts.leadStatus }).from(contacts).where(inArray(contacts.id, contactIds));
  const active = new Set(
    (await db.select({ contactId: sequenceEnrollments.contactId }).from(sequenceEnrollments)
      .where(and(inArray(sequenceEnrollments.contactId, contactIds), eq(sequenceEnrollments.sequenceId, sequenceId), eq(sequenceEnrollments.status, "activa"))))
      .map((r) => r.contactId),
  );
  let enrolled = 0;
  for (const c of rows) {
    if (c.leadStatus !== "nuevo" && c.leadStatus !== "contactado") { skipped.push({ contactId: c.id, reason: "estado" }); continue; }
    if (active.has(c.id)) { skipped.push({ contactId: c.id, reason: "ya_enrolado" }); continue; }
    try {
      const [e] = await db.insert(sequenceEnrollments).values({
        contactId: c.id, sequenceId, currentStep: first.position, nextRunAt: computeNextRunAt(now, first.dayOffset, now),
        enrolledBy: actor.userId, enrolledAt: now,
      }).returning({ id: sequenceEnrollments.id });
      await logActivity(db, { contactId: c.id, type: "secuencia", actor, summary: `Enrolado en «${seq.name}»`, meta: { sequenceId, enrollmentId: e.id } });
      enrolled++;
    } catch (err) {
      // Carrera con otro enrolamiento: el índice único parcial lo rechaza.
      if (/enrollments_active_unique/.test(String((err as { cause?: Error })?.cause?.message ?? (err as Error)?.message))) {
        skipped.push({ contactId: c.id, reason: "ya_enrolado" });
        continue;
      }
      throw err;
    }
  }
  return { enrolled, skipped };
}

// ---------------------------------------------------------------------------
// Correr el job
// ---------------------------------------------------------------------------

export type Sender = (from: string, emails: OutgoingEmail[]) => Promise<(string | null)[]>;
export type RunResult = { sent: number; pendingWhatsapp: number; skipped: number; finished: number; stopped: number };

const HOUR = 60 * 60 * 1000;
const RETRY_MS = HOUR; // reserva / reintento tras fallo de envío
export const PENDING_MAX_DAYS = 7; // WhatsApp pendiente que nadie marcó: se omite y la secuencia sigue
export const EMAIL_LIMIT_PER_RUN = 200; // spec §4.10

type Ctx = {
  seq: typeof sequences.$inferSelect;
  steps: SequenceStep[];
  contact: typeof contacts.$inferSelect;
  consent: { email: boolean; whatsapp: boolean };
  ownerName: string | null;
  templates: Map<string, typeof emailTemplates.$inferSelect>;
};

async function loadCtx(db: Dbx, e: SequenceEnrollment): Promise<Ctx | null> {
  const [seq] = await db.select().from(sequences).where(eq(sequences.id, e.sequenceId)).limit(1);
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, e.contactId)).limit(1);
  if (!seq || !contact) return null;
  const steps = await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, seq.id)).orderBy(asc(sequenceSteps.position));
  const consents = await db.select({ channel: contactConsents.channel, optIn: contactConsents.optIn }).from(contactConsents).where(eq(contactConsents.contactId, contact.id));
  const consent = {
    email: consents.some((c) => c.channel === "email" && c.optIn),
    whatsapp: consents.some((c) => c.channel === "whatsapp" && c.optIn),
  };
  const [owner] = contact.ownerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, contact.ownerId)).limit(1) : [];
  const tplIds = steps.map((s) => s.emailTemplateId).filter((x): x is string => !!x);
  const tpls = tplIds.length ? await db.select().from(emailTemplates).where(inArray(emailTemplates.id, tplIds)) : [];
  return { seq, steps, contact, consent, ownerName: owner?.name ?? null, templates: new Map(tpls.map((t) => [t.id, t])) };
}

const clearPending = { pendingStepId: null, pendingText: null, pendingSince: null } as const;

/** Termina el enrollment. Sin toques → no se le escribió: no se toca el siguiente paso del contacto. */
async function finish(db: Dbx, e: SequenceEnrollment, ctx: Ctx, reason: "completada" | "sin_canal" | "tope"): Promise<void> {
  await db.update(sequenceEnrollments).set({ status: "terminada", stopReason: reason, nextRunAt: null, touches: e.touches, ...clearPending }).where(eq(sequenceEnrollments.id, e.id));
  if (e.touches > 0) await db.update(contacts).set({ nextAction: "Nutrir por newsletter", nextActionOn: null }).where(eq(contacts.id, e.contactId));
  const summary = reason === "sin_canal"
    ? "Secuencia terminada: ningún canal disponible"
    : reason === "tope" ? `Secuencia terminada: tope de ${ctx.seq.maxTouches} toques sin respuesta` : "Secuencia terminada sin respuesta";
  await logActivity(db, { contactId: e.contactId, type: "secuencia", actor: SYSTEM_ACTOR, summary, meta: { sequenceId: e.sequenceId, enrollmentId: e.id, reason, touches: e.touches } });
}

/** Pasa al siguiente paso (persistiendo touches y limpiando el pendiente). Devuelve el enrollment actualizado o null si terminó. */
async function advanceStep(db: Dbx, e: SequenceEnrollment, ctx: Ctx, now: Date): Promise<SequenceEnrollment | null> {
  const next = ctx.steps.find((s) => s.position > e.currentStep);
  if (!next) { await finish(db, e, ctx, e.touches === 0 ? "sin_canal" : "completada"); return null; }
  const nextRunAt = computeNextRunAt(e.enrolledAt, next.dayOffset, now);
  await db.update(sequenceEnrollments).set({ currentStep: next.position, nextRunAt, touches: e.touches, ...clearPending }).where(eq(sequenceEnrollments.id, e.id));
  return { ...e, currentStep: next.position, nextRunAt, ...clearPending };
}

async function skipStep(db: Dbx, e: SequenceEnrollment, step: SequenceStep, why: string): Promise<void> {
  await logActivity(db, {
    contactId: e.contactId, type: "sistema", actor: SYSTEM_ACTOR,
    summary: `Paso ${step.position} de ${step.channel === "email" ? "correo" : "WhatsApp"} omitido: ${why}`,
    meta: { sequenceId: e.sequenceId, enrollmentId: e.id, step: step.position },
  });
}

type Mail = { appUrl: string; unsubSecret: string; from: string };
let mailEnv: Mail | null = null;
const mail = (): Mail => (mailEnv ??= { appUrl: requireEnv("APP_URL"), unsubSecret: requireEnv("UNSUBSCRIBE_SECRET"), from: requireEnv("MAIL_FROM") });

/**
 * Ejecuta el paso actual de un enrollment. Tras un paso OMITIDO, si el siguiente ya toca, sigue en la misma corrida
 * (así "sin canal" termina de una vez); tras un paso ejecutado o dejado pendiente, no.
 */
async function processEnrollment(db: Dbx, start: SequenceEnrollment, ctx: Ctx, now: Date, send: Sender, r: RunResult, budget: { emails: number }): Promise<void> {
  let e: SequenceEnrollment | null = start;
  const total = ctx.steps.length;
  while (e) {
    if (e.touches >= ctx.seq.maxTouches) { await finish(db, e, ctx, "tope"); r.finished++; return; }
    const current = e.currentStep;
    const step = ctx.steps.find((s) => s.position === current);
    if (!step) { await finish(db, e, ctx, e.touches === 0 ? "sin_canal" : "completada"); r.finished++; return; }
    const touchNo = e.touches + 1;
    const vars = cadenceVars(ctx.contact, ctx.ownerName);

    if (step.channel === "email") {
      const tpl = step.emailTemplateId ? ctx.templates.get(step.emailTemplateId) : undefined;
      const why = !ctx.contact.email ? "sin correo" : !ctx.consent.email ? "sin permiso de correo" : !tpl ? "sin plantilla" : null;
      if (why) {
        await skipStep(db, e, step, why);
        r.skipped++;
        e = await advanceStep(db, e, ctx, now);
        if (!e) { r.finished++; return; }
        if (e.nextRunAt && e.nextRunAt.getTime() <= now.getTime()) continue;
        return;
      }
      if (budget.emails <= 0) return; // tope de correos por corrida: queda reservado y sale en la siguiente
      const m = mail();
      const unsubscribeUrl = `${m.appUrl}/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken(m.unsubSecret, ctx.contact.id))}`;
      const v = { ...vars, baja: unsubscribeUrl };
      const subject = renderTemplate(tpl!.subject, v);
      try {
        await send(m.from, [{ to: ctx.contact.email!, subject, html: renderTemplate(tpl!.html, v), unsubscribeUrl, tags: [{ name: "sequence", value: ctx.seq.id }] }]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await logActivity(db, { contactId: e.contactId, type: "sistema", actor: SYSTEM_ACTOR, summary: `Paso ${step.position} de correo falló: ${msg}`.slice(0, 500), meta: { sequenceId: e.sequenceId, enrollmentId: e.id, step: step.position } });
        await db.update(sequenceEnrollments).set({ nextRunAt: new Date(now.getTime() + RETRY_MS) }).where(eq(sequenceEnrollments.id, e.id));
        return;
      }
      budget.emails--;
      await recordTouch(db, ctx.contact.id, "correo", SYSTEM_ACTOR, `Secuencia «${ctx.seq.name}» · toque ${touchNo}: ${subject}`, { sequenceId: ctx.seq.id, enrollmentId: e.id, step: step.position });
      r.sent++;
      e = await advanceStep(db, { ...e, touches: touchNo }, ctx, now);
      if (!e) r.finished++;
      return;
    }

    // WhatsApp: no se envía, se deja listo para el dueño.
    const why = !ctx.contact.phoneE164 ? "sin teléfono" : !ctx.consent.whatsapp ? "sin permiso de WhatsApp" : !step.whatsappText ? "sin texto" : null;
    if (why) {
      await skipStep(db, e, step, why);
      r.skipped++;
      e = await advanceStep(db, e, ctx, now);
      if (!e) { r.finished++; return; }
      if (e.nextRunAt && e.nextRunAt.getTime() <= now.getTime()) continue;
      return;
    }
    const text = renderWhatsapp(step.whatsappText!, vars);
    await db.update(sequenceEnrollments).set({ pendingStepId: step.id, pendingText: text, pendingSince: now, nextRunAt: null }).where(eq(sequenceEnrollments.id, e.id));
    await db.update(contacts).set({ nextAction: touchLabel(touchNo, total, "whatsapp"), nextActionOn: cdmxDay(now) }).where(eq(contacts.id, ctx.contact.id));
    await logActivity(db, { contactId: e.contactId, type: "secuencia", actor: SYSTEM_ACTOR, summary: `Toque ${touchNo} de ${total} listo para mandar por WhatsApp`, meta: { sequenceId: e.sequenceId, enrollmentId: e.id, step: step.position } });
    r.pendingWhatsapp++;
    return;
  }
}

/**
 * Job horario (POST /api/jobs/run-sequences). Reserva los enrollments que tocan con FOR UPDATE SKIP LOCKED y les
 * adelanta next_run_at ANTES de enviar, así una corrida encabalgada o un reintento del scheduler no manda dos veces.
 */
export async function runSequences(db: Db, opts: { now?: Date; limit?: number; send?: Sender } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? EMAIL_LIMIT_PER_RUN;
  const send = opts.send ?? sendBatch;
  const r: RunResult = { sent: 0, pendingWhatsapp: 0, skipped: 0, finished: 0, stopped: 0 };
  if (!inSendingWindow(now)) return r;
  const budget = { emails: EMAIL_LIMIT_PER_RUN };

  // 1. WhatsApp pendientes que nadie marcó en PENDING_MAX_DAYS: se omiten y la secuencia sigue.
  const stale = await db.select().from(sequenceEnrollments).where(and(
    eq(sequenceEnrollments.status, "activa"), isNotNull(sequenceEnrollments.pendingSince),
    lt(sequenceEnrollments.pendingSince, new Date(now.getTime() - PENDING_MAX_DAYS * 24 * HOUR)),
  )).limit(limit);
  for (const e of stale) {
    try {
      const ctx = await loadCtx(db, e);
      if (!ctx) continue;
      await logActivity(db, { contactId: e.contactId, type: "sistema", actor: SYSTEM_ACTOR, summary: `WhatsApp del toque ${e.touches + 1} no se marcó en ${PENDING_MAX_DAYS} días: se omite`, meta: { sequenceId: e.sequenceId, enrollmentId: e.id } });
      r.skipped++;
      const next = await advanceStep(db, { ...e, ...clearPending }, ctx, now);
      if (!next) r.finished++;
    } catch (err) {
      console.error("[run-sequences] pendiente", e.id, err instanceof Error ? err.message : err);
    }
  }

  // 2. Reserva de los que tocan.
  const due = await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      select id from ops.sequence_enrollments
      where status = 'activa' and pending_since is null and next_run_at is not null and next_run_at <= ${now.toISOString()}::timestamptz
      order by next_run_at limit ${limit} for update skip locked`);
    const ids = Array.from(rows as Iterable<{ id: string }>).map((x) => x.id);
    if (ids.length) await tx.update(sequenceEnrollments).set({ nextRunAt: new Date(now.getTime() + RETRY_MS) }).where(inArray(sequenceEnrollments.id, ids));
    return ids;
  });

  // 3. Un enrollment a la vez; un fallo no tumba la corrida (queda reservado y reintenta en una hora).
  for (const id of due) {
    try {
      const [e] = await db.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.id, id)).limit(1);
      if (!e || e.status !== "activa") continue;
      const ctx = await loadCtx(db, e);
      if (!ctx) continue;
      if (ctx.contact.leadStatus !== "nuevo" && ctx.contact.leadStatus !== "contactado") {
        await stopActiveEnrollments(db, e.contactId, ctx.contact.leadStatus ?? "sin_estado");
        r.stopped++;
        continue;
      }
      await processEnrollment(db, e, ctx, now, send, r, budget);
    } catch (err) {
      console.error("[run-sequences] enrollment", id, err instanceof Error ? err.message : err);
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Completar el toque pendiente y leer el estado
// ---------------------------------------------------------------------------

/**
 * El dueño marcó "Ya lo mandé" (o un correo a mano) sobre un paso pendiente del canal: cuenta el toque y avanza.
 * No registra el toque en sí: eso lo hace recordTouch desde el action. Devuelve false si no había nada pendiente de ese canal.
 */
export async function completePendingTouch(db: Dbx, contactId: string, channel: "whatsapp" | "correo", now = new Date()): Promise<boolean> {
  const [e] = await db.select().from(sequenceEnrollments)
    .where(and(eq(sequenceEnrollments.contactId, contactId), eq(sequenceEnrollments.status, "activa"), isNotNull(sequenceEnrollments.pendingStepId))).limit(1);
  if (!e?.pendingStepId) return false;
  const [step] = await db.select().from(sequenceSteps).where(eq(sequenceSteps.id, e.pendingStepId)).limit(1);
  if (!step || step.channel !== (channel === "whatsapp" ? "whatsapp" : "email")) return false;
  const ctx = await loadCtx(db, e);
  if (!ctx) return false;
  const done = { ...e, touches: e.touches + 1 };
  await logActivity(db, {
    contactId, type: "secuencia", actor: SYSTEM_ACTOR,
    summary: `Toque ${done.touches} de ${ctx.steps.length} por ${channel === "whatsapp" ? "WhatsApp" : "correo"} marcado como enviado`,
    meta: { sequenceId: e.sequenceId, enrollmentId: e.id, step: step.position },
  });
  await advanceStep(db, done, ctx, now);
  return true;
}

export type Cadence = {
  enrollmentId: string;
  sequenceName: string;
  status: EnrollmentStatus;
  touches: number;
  total: number;
  nextRunAt: Date | null;
  nextChannel: SequenceChannel | null;
  pendingText: string | null;
  stopReason: string | null;
};

/** El enrollment más reciente por contacto (activa primero), para Hoy y la ficha. */
export async function loadCadence(db: Dbx, contactIds: string[]): Promise<Map<string, Cadence>> {
  const out = new Map<string, Cadence>();
  if (!contactIds.length) return out;
  const rows = await db.select({ e: sequenceEnrollments, name: sequences.name })
    .from(sequenceEnrollments).innerJoin(sequences, eq(sequences.id, sequenceEnrollments.sequenceId))
    .where(inArray(sequenceEnrollments.contactId, contactIds))
    .orderBy(sql`case when ${sequenceEnrollments.status} = 'activa' then 0 else 1 end`, desc(sequenceEnrollments.enrolledAt));
  if (!rows.length) return out;
  const seqIds = [...new Set(rows.map((r) => r.e.sequenceId))];
  const steps = await db.select().from(sequenceSteps).where(inArray(sequenceSteps.sequenceId, seqIds));
  for (const { e, name } of rows) {
    if (out.has(e.contactId)) continue;
    const mine = steps.filter((s) => s.sequenceId === e.sequenceId);
    const current = e.pendingStepId ? mine.find((s) => s.id === e.pendingStepId) : mine.find((s) => s.position === e.currentStep);
    out.set(e.contactId, {
      enrollmentId: e.id, sequenceName: name, status: e.status, touches: e.touches, total: mine.length,
      nextRunAt: e.nextRunAt, nextChannel: e.status === "activa" ? current?.channel ?? null : null,
      pendingText: e.pendingText, stopReason: e.stopReason,
    });
  }
  return out;
}
