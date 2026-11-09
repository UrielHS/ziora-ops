/**
 * Reglas del CRM de leads: el embudo, sus avances y el timeline de cada contacto.
 * Todo cambio de estado deja una actividad `cambio_estado`; nada se edita, solo se agrega.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Dbx } from "@/db";
import { appUsers, contactActivities, contacts, planPrices, type ActivityType, type LeadStatus } from "@/db/schema";
import { users } from "@/db/shared";
import { LEAD_STATUS } from "@/lib/labels";
import { isPaying } from "./app-users";

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

/** Avance automático (sync, webhook, toque): solo si es hacia adelante. Devuelve si cambió. */
export async function advanceLead(db: Dbx, contactId: string, to: LeadStatus, actor: Actor, meta: Record<string, unknown> = {}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ leadStatus: contacts.leadStatus }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!c || !isForward(c.leadStatus, to)) return false;
    await changeStatus(tx, contactId, c.leadStatus, to, actor, meta);
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
  });
}

/** Toque saliente (WhatsApp, correo, llamada, reunión): actualiza el último contacto y pasa a contactado si estaba en nuevo. */
export async function recordTouch(db: Dbx, contactId: string, channel: TouchChannel, actor: Actor, summary: string): Promise<void> {
  await db.transaction(async (tx) => {
    await logActivity(tx, { contactId, type: channel, direction: "saliente", actor, summary });
    await tx.update(contacts).set({ lastContactAt: new Date() }).where(eq(contacts.id, contactId));
    await advanceLead(tx, contactId, "contactado", actor, { via: channel });
  });
}

/** El lead respondió: actividad entrante y avance a respondio. */
export async function markReplied(db: Dbx, contactId: string, actor: Actor, summary = "Respondió"): Promise<void> {
  await db.transaction(async (tx) => {
    await logActivity(tx, { contactId, type: "nota", direction: "entrante", actor, summary });
    await advanceLead(tx, contactId, "respondio", actor);
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
    .where(and(isNull(appUsers.removedAt), eq(appUsers.isTest, false)));
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
