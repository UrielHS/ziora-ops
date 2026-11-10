"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { leadStatusEnum } from "@/db/schema";
import {
  assignOwner, convertLeadToAccount, logActivity, markReplied, markTrying, recordReferralLinkSent, recordTouch, setChannelInvalid, setLeadStatus, setNextAction, setPriority, type Actor,
} from "@/domain/leads";
import { completePendingTouch, enroll, enrollMessage } from "@/domain/sequences";
import { formAction, type ActionState } from "@/lib/action";
import { todayISO } from "@/lib/format";
import { requirePermission } from "@/lib/session";

const id = z.uuid();
const ids = z.array(z.uuid()).min(1, "elige al menos un lead");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD").optional();
const status = z.enum(leadStatusEnum.enumValues);
const channel = z.enum(["whatsapp", "correo", "llamada", "reunion"]);
const CHANNEL_LABEL: Record<z.infer<typeof channel>, string> = { whatsapp: "WhatsApp", correo: "correo", llamada: "llamada", reunion: "reunión" };

async function actor(): Promise<Actor> {
  const { user } = await requirePermission("leads.manage");
  return { userId: user.id, label: user.name };
}

function refresh(leadId?: string) {
  revalidatePath("/leads", "layout");
  revalidatePath("/contacts");
  if (leadId) revalidatePath(`/contacts/${leadId}`);
}

/** Arrastre en el kanban. Perdido se marca con su botón para capturar el motivo. */
export async function moveLead(leadId: string, to: string): Promise<void | { error?: string }> {
  try {
    const a = await actor();
    const s = status.parse(to);
    if (s === "perdido") return { error: "Usa el botón Perdido en la ficha para indicar el motivo" };
    await setLeadStatus(db, id.parse(leadId), s, a);
    refresh(leadId);
  } catch (err) {
    // No se lanza: en producción Next oculta el mensaje de un error lanzado en una server action.
    return { error: err instanceof Error ? err.message : "No se pudo mover el lead" };
  }
}

const _setLeadStatus = formAction(z.object({ id, status, lostReason: z.string().trim().max(200).optional() }), async (d) => {
  await setLeadStatus(db, d.id, d.status, await actor(), { lostReason: d.lostReason });
  refresh(d.id);
  return d.status === "perdido" ? "Lead marcado como perdido" : "Estado actualizado";
});

const _recordTouch = formAction(z.object({ id, channel, summary: z.string().trim().max(500).optional() }), async (d) => {
  await recordTouch(db, d.id, d.channel, await actor(), d.summary ?? `Mensaje enviado por ${CHANNEL_LABEL[d.channel]}`);
  // Si el toque era el paso pendiente de una secuencia (WhatsApp listo en Hoy), cuenta y avanza la cadencia.
  if (d.channel === "whatsapp" || d.channel === "correo") await completePendingTouch(db, d.id, d.channel);
  refresh(d.id);
  return "Toque registrado";
});

const _referralLinkSent = formAction(z.object({ id }), async (d) => {
  await recordReferralLinkSent(db, d.id, await actor());
  refresh(d.id);
  return "Liga registrada";
});

const _setChannelInvalid = formAction(z.object({ id, channel: z.enum(["email", "phone"]), invalid: z.enum(["1", "0"]) }), async (d) => {
  await setChannelInvalid(db, d.id, d.channel, d.invalid === "1", await actor());
  refresh(d.id);
  return d.invalid === "1" ? "Marcado como incorrecto: nadie lo volverá a usar" : "Marcado como válido otra vez";
});

const _markTrying = formAction(z.object({ id }), async (d) => {
  const r = await markTrying(db, d.id, await actor());
  if (!r.ok) throw new Error(r.message ?? "No se pudo cambiar el estado");
  refresh(d.id);
  return "Marcado como en trial";
});

const _markReplied = formAction(z.object({ id, summary: z.string().trim().max(500).optional() }), async (d) => {
  await markReplied(db, d.id, await actor(), d.summary);
  refresh(d.id);
  return "Respuesta registrada";
});

const _setNextAction = formAction(z.object({ id, text: z.string().trim().max(200).optional(), on: isoDate }), async (d) => {
  await setNextAction(db, d.id, { text: d.text ?? null, on: d.on ?? null }, await actor());
  refresh(d.id);
  return d.text ? "Siguiente paso guardado" : "Siguiente paso borrado";
});

/** Posponer no es un toque: solo mueve la fecha, sin actividad en el timeline. */
const _postpone = formAction(z.object({ id, days: z.coerce.number().int().refine((n) => [1, 3, 7].includes(n), "1, 3 o 7 días") }), async (d) => {
  await actor();
  const { contacts } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const base = new Date(`${todayISO()}T12:00:00`);
  base.setDate(base.getDate() + d.days);
  await db.update(contacts).set({ nextActionOn: base.toISOString().slice(0, 10) }).where(eq(contacts.id, d.id));
  refresh(d.id);
  return `Pospuesto ${d.days} ${d.days === 1 ? "día" : "días"}`;
});

const _assignOwner = formAction(z.object({ ids, ownerId: z.uuid().optional() }), async (d) => {
  await assignOwner(db, d.ids, d.ownerId ?? null, await actor());
  refresh();
  return d.ownerId ? `${d.ids.length} lead(s) asignado(s)` : `${d.ids.length} lead(s) sin dueño`;
});

const _setPriority = formAction(z.object({ ids, priority: z.coerce.number().int().min(1).max(3).optional() }), async (d) => {
  await setPriority(db, d.ids, (d.priority as 1 | 2 | 3 | undefined) ?? null, await actor());
  refresh();
  return "Prioridad actualizada";
});

/** Barra del kanban: el botón presionado (op) decide si se asigna dueño, se cambia prioridad o se enrola en una secuencia a los seleccionados. */
const _bulk = formAction(z.object({ ids, op: z.enum(["owner", "priority", "enroll"]), ownerId: z.uuid().optional(), priority: z.coerce.number().int().min(1).max(3).optional(), sequenceId: z.uuid().optional() }), async (d) => {
  const a = await actor();
  if (d.op === "enroll") {
    if (!d.sequenceId) throw new Error("Elige una secuencia");
    const r = await enroll(db, d.ids, d.sequenceId, a);
    refresh();
    return enrollMessage(r);
  }
  if (d.op === "owner") {
    await assignOwner(db, d.ids, d.ownerId ?? null, a);
    refresh();
    return d.ownerId ? `${d.ids.length} lead(s) asignado(s)` : `${d.ids.length} lead(s) sin dueño`;
  }
  await setPriority(db, d.ids, (d.priority as 1 | 2 | 3 | undefined) ?? null, a);
  refresh();
  return `Prioridad actualizada en ${d.ids.length} lead(s)`;
});

const _addNote = formAction(z.object({ id, text: z.string().trim().min(1, "escribe la nota").max(2000) }), async (d) => {
  await logActivity(db, { contactId: d.id, type: "nota", actor: await actor(), summary: d.text });
  refresh(d.id);
  return "Nota guardada";
});

/** Convierte al lead en cuenta B2B y lleva a la ficha de la cuenta. Si ya tenía una, va a esa. */
const _convertToAccount = formAction(z.object({ id, name: z.string().trim().max(200).optional() }), async (d) => {
  const { accountId } = await convertLeadToAccount(db, d.id, await actor(), { name: d.name });
  refresh(d.id);
  revalidatePath("/sales");
  redirect(`/sales/accounts/${accountId}`);
});

export async function setLeadStatusAction(prev: ActionState, fd: FormData) { return _setLeadStatus(prev, fd); }
export async function recordTouchAction(prev: ActionState, fd: FormData) { return _recordTouch(prev, fd); }
export async function markRepliedAction(prev: ActionState, fd: FormData) { return _markReplied(prev, fd); }
export async function referralLinkSentAction(prev: ActionState, fd: FormData) { return _referralLinkSent(prev, fd); }
export async function markTryingAction(prev: ActionState, fd: FormData) { return _markTrying(prev, fd); }
export async function setChannelInvalidAction(prev: ActionState, fd: FormData) { return _setChannelInvalid(prev, fd); }
export async function setNextActionAction(prev: ActionState, fd: FormData) { return _setNextAction(prev, fd); }
export async function postponeAction(prev: ActionState, fd: FormData) { return _postpone(prev, fd); }
export async function assignOwnerAction(prev: ActionState, fd: FormData) { return _assignOwner(prev, fd); }
export async function setPriorityAction(prev: ActionState, fd: FormData) { return _setPriority(prev, fd); }
export async function addNoteAction(prev: ActionState, fd: FormData) { return _addNote(prev, fd); }
export async function bulkLeadsAction(prev: ActionState, fd: FormData) { return _bulk(prev, fd); }
export async function convertToAccountAction(prev: ActionState, fd: FormData) { return _convertToAccount(prev, fd); }
