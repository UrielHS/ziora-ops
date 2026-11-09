"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { demoRequests, demoStageEnum, tasks } from "@/db/schema";
import { toCity, upsertContact } from "@/domain/contacts";
import { formAction, type ActionState } from "@/lib/action";
import { calendarConfig, syncCalendarDemos } from "@/domain/demos";
import { requirePermission } from "@/lib/session";
import { advanceLead, logActivity } from "@/domain/leads";

const dt = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional();
const toDate = (s?: string) => (s ? new Date(`${s}:00-06:00`) : null); // hora de CDMX

const _createDemo = formAction(
  z.object({
    fullName: z.string().trim().min(3, "nombre completo").max(200),
    email: z.email("correo válido"),
    whatsapp: z.string().max(40).optional(),
    city: z.string().max(40).optional(),
    patientsPerWeek: z.string().max(40).optional(),
    teletherapy: z.string().max(10).optional(),
    painPoint: z.string().max(300).optional(),
    scheduledAt: dt,
    ownerId: z.uuid().optional(),
    marketingOptIn: z.literal("on").optional(),
  }),
  async (d) => {
    await requirePermission("leads.manage");
    const { id: contactId } = await upsertContact(db, {
      name: d.fullName, email: d.email, phone: d.whatsapp, city: toCity(d.city), source: "demo_form",
      tags: ["psychologist", "lead"],
      details: { patientsPerWeek: d.patientsPerWeek, teletherapy: d.teletherapy },
      marketingOptIn: d.marketingOptIn ? { source: "manual", evidence: "Registrado a mano por el equipo con aceptación verbal o escrita" } : null,
    });
    await db.insert(demoRequests).values({
      contactId, fullName: d.fullName, email: d.email.toLowerCase(), whatsapp: d.whatsapp, patientsPerWeek: d.patientsPerWeek,
      teletherapy: d.teletherapy, painPoint: d.painPoint, scheduledAt: toDate(d.scheduledAt),
      stage: d.scheduledAt ? "scheduled" : "requested", ownerId: d.ownerId ?? null, source: "manual",
    });
    revalidatePath("/", "layout");
    return "Demo registrada y contacto agregado a Contactos";
  },
);

const _updateDemo = formAction(
  z.object({
    id: z.uuid(),
    stage: z.enum(demoStageEnum.enumValues),
    scheduledAt: dt,
    ownerId: z.uuid().optional(),
    notes: z.string().max(4000).optional(),
    lostReason: z.string().max(300).optional(),
  }),
  async ({ id, ...d }) => {
    await requirePermission("leads.manage");
    await db.update(demoRequests).set({
      stage: d.stage, scheduledAt: toDate(d.scheduledAt), ownerId: d.ownerId ?? null, notes: d.notes ?? null,
      lostReason: d.lostReason ?? null, ...(d.stage === "trial" ? { trialStartedAt: new Date() } : {}),
    }).where(eq(demoRequests.id, id));
    revalidatePath("/", "layout");
  },
);

export async function moveDemo(id: string, stage: string) {
  const { user } = await requirePermission("leads.manage");
  const s = z.enum(demoStageEnum.enumValues).parse(stage);
  const [cur] = await db.select({ trial: demoRequests.trialStartedAt, contactId: demoRequests.contactId }).from(demoRequests).where(eq(demoRequests.id, id));
  await db.update(demoRequests).set({ stage: s, ...(s === "trial" && !cur?.trial ? { trialStartedAt: new Date() } : {}) }).where(eq(demoRequests.id, id));
  // El lead avanza con la demo; perder la demo o no asistir solo queda en el timeline.
  if (cur?.contactId) {
    const actor = { userId: user.id, label: user.name };
    if (s === "trial") await advanceLead(db, cur.contactId, "en_trial", actor, { demoId: id });
    else if (s === "paid") await advanceLead(db, cur.contactId, "pago", actor, { demoId: id });
    else if (s === "scheduled") await advanceLead(db, cur.contactId, "demo_agendada", actor, { demoId: id });
    else if (s === "lost" || s === "no_show") await logActivity(db, { contactId: cur.contactId, type: "demo", actor, summary: s === "lost" ? "Demo perdida" : "No asistió a la demo", meta: { demoId: id } });
  }
  revalidatePath("/", "layout");
}

export async function demoFollowUpTask(fd: FormData) {
  const { user } = await requirePermission("leads.manage");
  const id = z.uuid().parse(fd.get("id"));
  const [d] = await db.select().from(demoRequests).where(eq(demoRequests.id, id));
  if (!d) return;
  await db.insert(tasks).values({
    title: `Seguimiento demo: ${d.fullName}`, status: "todo", priority: "high", demoId: d.id, contactId: d.contactId,
    assigneeId: d.ownerId ?? user.id, reporterId: user.id, labels: ["ventas"],
  });
  revalidatePath("/", "layout");
}

// Next exige que cada export de un archivo "use server" sea una función async declarada.
export async function createDemo(prev: ActionState, fd: FormData) {
  return _createDemo(prev, fd);
}
export async function updateDemo(prev: ActionState, fd: FormData) {
  return _updateDemo(prev, fd);
}

export async function syncDemosNow(_prev: ActionState): Promise<ActionState> {
  await requirePermission("leads.manage");
  if (!calendarConfig().ready) {
    return { error: "Falta configurar GOOGLE_CALENDAR_SUBJECT y GOOGLE_INGEST_SA (ver Ajustes → Integraciones)." };
  }
  try {
    const r = await syncCalendarDemos(db);
    revalidatePath("/", "layout");
    return { ok: true, message: `Calendario leído: ${r.created} nuevas, ${r.rescheduled} reagendadas, ${r.cancelled} canceladas.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo leer el calendario" };
  }
}
