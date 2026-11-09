/**
 * Reglas del CRM de leads: el embudo, sus avances y el timeline de cada contacto.
 * Todo cambio de estado deja una actividad `cambio_estado`; nada se edita, solo se agrega.
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Dbx } from "@/db";
import { accountContacts, accounts, appUsers, campaigns, campaignSends, contactActivities, contacts, demoRequests, planPrices, sequenceEnrollments, type ActivityType, type LeadStatus } from "@/db/schema";
import { users } from "@/db/shared";
import { DEMO_STAGE, LEAD_STATUS, SEND_STATUS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { isPaying } from "./app-users";
import type { Cadence } from "./sequences";

/** Orden del embudo. `perdido` no está: es terminal y solo se pone a mano (o por baja). */
export const LEAD_ORDER: LeadStatus[] = ["nuevo", "contactado", "respondio", "demo_agendada", "en_trial", "pago"];

/** true si `to` está más adelante que `from` en el embudo. Sin estado cuenta como antes de nuevo; perdido nunca avanza. */
export function isForward(from: LeadStatus | null, to: LeadStatus): boolean {
  if (to === "perdido" || from === "perdido") return false;
  const a = from ? LEAD_ORDER.indexOf(from) : -1;
  return LEAD_ORDER.indexOf(to) > a;
}

/** Quién hizo la acción: la persona en sesión, "sistema" o "token:<nombre>" (API). */
export type Actor = { userId: string | null; label: string };
export const SYSTEM_ACTOR: Actor = { userId: null, label: "sistema" };

export type Direction = "saliente" | "entrante" | "ninguna";
export type TouchChannel = "whatsapp" | "correo" | "llamada" | "reunion";

export async function logActivity(db: Dbx, a: {
  contactId: string; type: ActivityType; direction?: Direction; actor: Actor; summary: string;
  meta?: Record<string, unknown>; occurredAt?: Date;
}): Promise<string> {
  const [row] = await db.insert(contactActivities).values({
    contactId: a.contactId, type: a.type, direction: a.direction ?? "ninguna", actorId: a.actor.userId, actorLabel: a.actor.label,
    summary: a.summary, meta: a.meta ?? {}, occurredAt: a.occurredAt ?? new Date(),
  }).returning({ id: contactActivities.id });
  return row.id;
}

const label = (s: LeadStatus | null) => (s ? LEAD_STATUS[s].label : "Sin estado");

async function changeStatus(db: Dbx, contactId: string, from: LeadStatus | null, to: LeadStatus, actor: Actor, meta: Record<string, unknown>, lostReason?: string) {
  await db.update(contacts).set({
    leadStatus: to, statusChangedAt: new Date(), lostReason: to === "perdido" ? lostReason ?? null : null,
  }).where(eq(contacts.id, contactId));
  await logActivity(db, {
    contactId, type: "cambio_estado", actor,
    summary: `${label(from)} → ${label(to)}${lostReason ? ` · ${lostReason}` : ""}`,
    meta: { from, to, ...(lostReason ? { lostReason } : {}), ...meta },
  });
}

const STOP_LABEL: Record<string, string> = {
  respondio: "respondió", demo_agendada: "demo agendada", en_trial: "entró a trial", pago: "pagó", perdido: "lead perdido",
  baja: "baja de correo", manual: "detenida a mano", rollback: "rollback",
};

/**
 * Cadencia (spec §4.4): detiene las secuencias activas del contacto. Se llama cuando el lead sale de nuevo/contactado
 * (respondió, demo, trial, pago, perdido, baja) o a mano. Devuelve cuántas detuvo.
 */
export async function stopActiveEnrollments(db: Dbx, contactId: string, reason: string): Promise<number> {
  const rows = await db.update(sequenceEnrollments)
    .set({ status: "detenida", stopReason: reason, nextRunAt: null, pendingStepId: null, pendingText: null, pendingSince: null })
    .where(and(eq(sequenceEnrollments.contactId, contactId), eq(sequenceEnrollments.status, "activa")))
    .returning({ id: sequenceEnrollments.id });
  for (const r of rows) {
    await logActivity(db, { contactId, type: "secuencia", actor: SYSTEM_ACTOR, summary: `Secuencia detenida: ${STOP_LABEL[reason] ?? reason}`, meta: { enrollmentId: r.id, reason } });
  }
  return rows.length;
}

/** A partir de respondió el lead ya no está en cadencia. */
const stopsCadence = (to: LeadStatus) => to === "perdido" || LEAD_ORDER.indexOf(to) >= LEAD_ORDER.indexOf("respondio");

/** Avance automático (sync, webhook, toque): solo si es hacia adelante. Devuelve si cambió. */
export async function advanceLead(db: Dbx, contactId: string, to: LeadStatus, actor: Actor, meta: Record<string, unknown> = {}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ leadStatus: contacts.leadStatus }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!c || !isForward(c.leadStatus, to)) return false;
    await changeStatus(tx, contactId, c.leadStatus, to, actor, meta);
    if (stopsCadence(to)) await stopActiveEnrollments(tx, contactId, to);
    return true;
  });
}

/** Cambio manual, en cualquier dirección. Perdido exige motivo. */
export async function setLeadStatus(db: Dbx, contactId: string, to: LeadStatus, actor: Actor, opts: { lostReason?: string } = {}): Promise<void> {
  const lostReason = opts.lostReason?.trim();
  if (to === "perdido" && !lostReason) throw new Error("Indica el motivo por el que se perdió el lead.");
  await db.transaction(async (tx) => {
    const [c] = await tx.select({ leadStatus: contacts.leadStatus }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!c) throw new Error("El contacto no existe.");
    if (c.leadStatus === to && to !== "perdido") return;
    await changeStatus(tx, contactId, c.leadStatus, to, actor, {}, lostReason);
    if (stopsCadence(to)) await stopActiveEnrollments(tx, contactId, lostReason === "baja" ? "baja" : to);
  });
}

/** Toque saliente (WhatsApp, correo, llamada, reunión): actualiza el último contacto y pasa a contactado si estaba en nuevo. */
export async function recordTouch(db: Dbx, contactId: string, channel: TouchChannel, actor: Actor, summary: string, meta: Record<string, unknown> = {}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(contacts).set({ lastContactAt: new Date() }).where(eq(contacts.id, contactId));
    await advanceLead(tx, contactId, "contactado", actor, { via: channel });
    // El toque se registra al final: es lo último que pasó y así queda arriba en el timeline.
    await logActivity(tx, { contactId, type: channel, direction: "saliente", actor, summary, meta });
  });
}

/** El lead respondió: actividad entrante y avance a respondio. */
export async function markReplied(db: Dbx, contactId: string, actor: Actor, summary = "Respondió"): Promise<void> {
  await db.transaction(async (tx) => {
    await advanceLead(tx, contactId, "respondio", actor);
    await logActivity(tx, { contactId, type: "nota", direction: "entrante", actor, summary });
  });
}

export async function assignOwner(db: Dbx, contactIds: string[], ownerId: string | null, actor: Actor): Promise<void> {
  if (!contactIds.length) return;
  const [owner] = ownerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, ownerId)).limit(1) : [];
  await db.transaction(async (tx) => {
    await tx.update(contacts).set({ ownerId }).where(inArray(contacts.id, contactIds));
    for (const contactId of contactIds) {
      await logActivity(tx, { contactId, type: "sistema", actor, summary: owner ? `Asignado a ${owner.name}` : "Sin dueño", meta: { ownerId } });
    }
  });
}

export async function setNextAction(db: Dbx, contactId: string, next: { text: string | null; on: string | null }, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(contacts).set({ nextAction: next.text?.trim() || null, nextActionOn: next.on || null }).where(eq(contacts.id, contactId));
    await logActivity(tx, {
      contactId, type: "sistema", actor,
      summary: next.text ? `Siguiente paso: ${next.text.trim()}${next.on ? ` (${next.on})` : ""}` : "Sin siguiente paso",
      meta: { nextAction: next.text, nextActionOn: next.on },
    });
  });
}

/** La prioridad es un dato de trabajo, no un evento: cambia el contacto y no ensucia el timeline. */
export async function setPriority(db: Dbx, contactIds: string[], priority: 1 | 2 | 3 | null, _actor: Actor): Promise<void> {
  if (!contactIds.length) return;
  await db.update(contacts).set({ priority }).where(inArray(contacts.id, contactIds));
}

/**
 * Cruza los usuarios de la app (snapshot de ziora-api) con los leads por correo y avanza: trial → en_trial, pagando → pago.
 * Solo avanza; cuenta únicamente los leads que cambiaron. Las cuentas de prueba y las borradas no cuentan.
 */
export async function syncLeadStatusFromAppUsers(db: Dbx): Promise<{ trial: number; paid: number }> {
  const prices = await db.select().from(planPrices);
  const rows = await db
    .select({ contactId: contacts.id, uid: appUsers.uid, plan: appUsers.plan, status: appUsers.status, mrrCents: appUsers.mrrCents, currency: appUsers.currency })
    .from(appUsers)
    .innerJoin(contacts, eq(contacts.email, sql`lower(trim(${appUsers.email}))`))
    // Solo quien ya es lead: un contacto sin estado (equipo, ponentes, usuarios que llegaron solos) no se vuelve lead por usar la app.
    .where(and(isNull(appUsers.removedAt), eq(appUsers.isTest, false), isNotNull(contacts.leadStatus)));
  let trial = 0, paid = 0;
  for (const r of rows) {
    const meta = { source: "app_users", uid: r.uid };
    if (isPaying(r, prices)) {
      if (await advanceLead(db, r.contactId, "pago", SYSTEM_ACTOR, meta)) paid++;
    } else if (/trial/i.test(r.status)) {
      if (await advanceLead(db, r.contactId, "en_trial", SYSTEM_ACTOR, meta)) trial++;
    }
  }
  return { trial, paid };
}

export type TimelineItem = {
  at: Date;
  kind: ActivityType | "campaign_send";
  title: string;
  detail?: string;
  actor?: string;
  direction?: Direction;
};

/** Todo lo que le ha pasado al contacto: actividades, correos de campaña y demos, de lo más reciente a lo más viejo. */
export async function loadTimeline(db: Dbx, contactId: string): Promise<TimelineItem[]> {
  const [acts, sends, demos] = await Promise.all([
    db.select().from(contactActivities).where(eq(contactActivities.contactId, contactId)).orderBy(desc(contactActivities.occurredAt)).limit(200),
    db.select({ at: campaignSends.createdAt, status: campaignSends.status, campaign: campaigns.name })
      .from(campaignSends).innerJoin(campaigns, eq(campaigns.id, campaignSends.campaignId)).where(eq(campaignSends.contactId, contactId)),
    db.select().from(demoRequests).where(eq(demoRequests.contactId, contactId)),
  ]);
  const items: TimelineItem[] = [
    ...acts.map((a) => ({ at: a.occurredAt, kind: a.type, title: a.summary, actor: a.actorLabel, direction: a.direction as Direction })),
    ...sends.map((s) => ({ at: s.at, kind: "campaign_send" as const, title: `Correo de campaña · ${SEND_STATUS[s.status] ?? s.status}`, detail: s.campaign })),
    ...demos.map((d) => ({
      at: d.createdAt, kind: "demo" as const,
      title: `Demo · ${DEMO_STAGE[d.stage]?.label ?? d.stage}`,
      detail: d.scheduledAt ? `Agendada para ${fmtDateTime(d.scheduledAt)}` : d.lostReason ?? undefined,
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * Mensaje de WhatsApp prellenado según la etapa. Sin precios ni datos de la consulta: eso se habla en la llamada.
 * La persona lo edita antes de mandarlo; aquí solo se le ahorra la hoja en blanco.
 */
export function defaultMessage(c: { name: string; leadStatus: LeadStatus | null }, userName: string): string {
  const first = c.name.trim().split(/\s+/)[0] || "hola";
  const me = userName.trim().split(/\s+/)[0] || userName;
  switch (c.leadStatus) {
    case "nuevo":
    case "contactado":
      return `Hola ${first}, soy ${me} de Ziora. Nos vimos en Mexico Tech Week, en el panel y el taller de IA para terapeutas. Ziora te ayuda a documentar tus sesiones con IA para que recuperes tiempo de tu consulta. ¿Te late que te lo enseñe en una llamada corta esta semana?`;
    case "respondio":
      return `Hola ${first}, qué gusto leerte. ¿Te acomoda una llamada de 15 minutos esta semana para enseñarte Ziora en vivo? Dime qué día y hora te quedan bien.`;
    case "demo_agendada":
      return `Hola ${first}, te confirmo nuestra demo de Ziora. Un rato antes te mando el enlace. ¿Sigue bien la hora que acordamos?`;
    default:
      return `Hola ${first}, soy ${me} de Ziora. ¿Cómo vas? Cualquier duda o idea, aquí estoy.`;
  }
}

/**
 * Un lead que dirige una clínica se vuelve cuenta B2B: crea la cuenta (una sola vez), lo liga como decisor y lo anota en su timeline.
 * No toca el estado del lead: la venta a la persona y la cuenta de la clínica siguen caminos distintos.
 */
export async function convertLeadToAccount(db: Dbx, contactId: string, actor: Actor, opts: { name?: string } = {}): Promise<{ accountId: string; created: boolean }> {
  return db.transaction(async (tx) => {
    // FOR UPDATE: un doble envío (segunda pestaña, reintento) espera a que termine el primero y entonces ve la cuenta ya ligada.
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1).for("update");
    if (!c) throw new Error("El contacto no existe.");
    const [linked] = await tx.select({ accountId: accountContacts.accountId }).from(accountContacts).where(eq(accountContacts.contactId, contactId)).limit(1);
    if (linked) return { accountId: linked.accountId, created: false };
    const name = opts.name?.trim() || c.company?.trim() || `Clínica de ${c.name}`;
    const [acc] = await tx.insert(accounts).values({ name, type: "clinic", city: c.cityName ?? null, ownerId: c.ownerId ?? null }).returning({ id: accounts.id });
    await tx.insert(accountContacts).values({ accountId: acc.id, contactId, title: c.jobTitle ?? null, decisionMaker: true });
    await logActivity(tx, { contactId, type: "sistema", actor, summary: `Convertido en cuenta ${name}`, meta: { accountId: acc.id } });
    return { accountId: acc.id, created: true };
  });
}

/** Estados en los que un lead "está en trabajo" y debería tener siguiente paso. */
export const WORKING_STATUSES = ["nuevo", "contactado", "respondio"] as const;

type TodayLead = { id: string; nextActionOn: string | null; leadStatus: string | null; priority: number | null };

/**
 * Secciones de "Mi día". Un lead en secuencia activa que espera su siguiente paso (sin WhatsApp pendiente) no es
 * "sin siguiente paso": la secuencia ya lo tiene; va a `inSequence` para que el dueño sepa que está cubierto.
 */
export function todayBuckets<T extends TodayLead>(rows: T[], cadence: Map<string, Cadence>, today: string, weekEnd: string) {
  const prio = (c: T) => c.priority ?? 9;
  const byDate = (a: T, b: T) => a.nextActionOn!.localeCompare(b.nextActionOn!) || prio(a) - prio(b);
  const waiting = (c: T) => { const cad = cadence.get(c.id); return cad?.status === "activa" && !cad.pendingText; };
  const due = rows.filter((c) => c.nextActionOn && c.nextActionOn <= today).sort(byDate);
  const soon = rows.filter((c) => c.nextActionOn && c.nextActionOn > today && c.nextActionOn <= weekEnd).sort(byDate);
  const noDate = rows.filter((c) => !c.nextActionOn && (WORKING_STATUSES as readonly string[]).includes(c.leadStatus ?? ""));
  const inSequence = noDate.filter(waiting).sort((a, b) => prio(a) - prio(b));
  const noPlan = noDate.filter((c) => !waiting(c)).sort((a, b) => prio(a) - prio(b));
  return { due, soon, noPlan, inSequence };
}
