"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contactConsents, cityEnum, contacts, contactSourceEnum, contactTagEnum, contactTags } from "@/db/schema";
import { importFromEventOps, optOut, upsertContact } from "@/domain/contacts";
import { importLeadSheet, parseLeadSheet } from "@/domain/lead-sheet";
import { formAction, type ActionState } from "@/lib/action";
import { requirePermission } from "@/lib/session";

const _createContact = formAction(
  z.object({
    name: z.string().trim().min(2).max(200),
    email: z.email("correo válido"),
    phone: z.string().max(40).optional(),
    city: z.enum(cityEnum.enumValues).optional(),
    source: z.enum(contactSourceEnum.enumValues).default("manual"),
    tags: z.array(z.enum(contactTagEnum.enumValues)).default([]),
    notes: z.string().max(2000).optional(),
    optIn: z.literal("on").optional(),
    evidence: z.string().max(300).optional(),
  }),
  async (d) => {
    await requirePermission("leads.manage");
    if (d.optIn && !d.evidence) throw new Error("Indica cómo dio su permiso (formulario, evento, mensaje…)");
    const { id } = await upsertContact(db, {
      name: d.name, email: d.email, phone: d.phone, city: d.city ?? null, source: d.source, tags: d.tags,
      marketingOptIn: d.optIn ? { source: "manual", evidence: d.evidence } : null,
    });
    if (d.notes) await db.update(contacts).set({ notes: d.notes }).where(eq(contacts.id, id));
    revalidatePath("/contacts");
    return "Contacto guardado.";
  },
);

const _updateContact = formAction(
  z.object({
    id: z.uuid(),
    name: z.string().trim().min(2).max(200),
    phone: z.string().max(40).optional(),
    city: z.enum(cityEnum.enumValues).optional(),
    notes: z.string().max(2000).optional(),
    company: z.string().max(200).optional(),
    jobTitle: z.string().max(200).optional(),
    tags: z.array(z.enum(contactTagEnum.enumValues)).default([]),
  }),
  async ({ id, tags, ...d }) => {
    await requirePermission("leads.manage");
    await db.transaction(async (tx) => {
      await tx.update(contacts).set({
        name: d.name, phone: d.phone ?? null, city: d.city ?? null, notes: d.notes ?? null,
        company: d.company ?? null, jobTitle: d.jobTitle ?? null,
      }).where(eq(contacts.id, id));
      // Las etiquetas son propias de Ziora Ops: se reemplazan por las elegidas.
      await tx.delete(contactTags).where(eq(contactTags.contactId, id));
      if (tags.length) await tx.insert(contactTags).values(tags.map((tag) => ({ contactId: id, tag }))).onConflictDoNothing();
    });
    revalidatePath("/contacts");
  },
);

const _setConsent = formAction(
  z.object({ contactId: z.uuid(), optIn: z.enum(["yes", "no"]), evidence: z.string().max(300).optional() }),
  async ({ contactId, optIn, evidence }) => {
    await requirePermission("leads.manage");
    if (optIn === "no") {
      await optOut(db, contactId);
      revalidatePath("/contacts");
      return "Baja registrada";
    }
    if (!evidence) throw new Error("Describe la evidencia del permiso");
    const [cur] = await db.select().from(contactConsents).where(and(eq(contactConsents.contactId, contactId), eq(contactConsents.channel, "email")));
    if (cur?.optedOutAt) throw new Error("Este contacto se dio de baja. Solo él puede volver a suscribirse.");
    await db.insert(contactConsents)
      .values({ contactId, channel: "email", optIn: true, source: "manual", evidence, optedInAt: new Date() })
      .onConflictDoUpdate({ target: [contactConsents.contactId, contactConsents.channel], set: { optIn: true, evidence, optedInAt: new Date() } });
    revalidatePath("/contacts");
    return "Permiso registrado";
  },
);

const _importEventOps = formAction(
  z.object({ ids: z.array(z.uuid()).min(1, "Selecciona al menos un contacto").max(500) }),
  async ({ ids }) => {
    await requirePermission("contacts.import");
    const r = await importFromEventOps(db, ids);
    revalidatePath("/contacts");
    revalidatePath("/contacts/importar-event-ops");
    const parts = [`${r.created} nuevos`, r.completed ? `${r.completed} ya existían y se completaron` : "", r.skipped ? `${r.skipped} sin correo (no se importan)` : ""].filter(Boolean);
    return `Importados: ${parts.join(" · ")}.`;
  },
);

const MAX_CSV = 5 * 1024 * 1024;
const _importLeads = formAction(
  z.object({
    file: z.instanceof(File, { message: "elige el CSV de la hoja" }).refine((f) => f.size > 0 && f.size <= MAX_CSV, "el CSV debe pesar menos de 5 MB"),
    consentSource: z.enum(["evento_luma"]).optional(),
    ownerId: z.uuid().optional(),
    sequenceId: z.uuid().optional(),
  }),
  async ({ file, consentSource, ownerId, sequenceId }) => {
    const { user } = await requirePermission("contacts.import");
    const { rows, skipped } = parseLeadSheet(await file.text());
    if (!rows.length) throw new Error("No encontré filas con correo o teléfono válido.");
    const r = await importLeadSheet(db, rows, {
      consentSource: consentSource ?? null, ownerId: ownerId ?? null, sequenceId: sequenceId ?? null, actor: { userId: user.id, label: user.name },
    });
    revalidatePath("/contacts");
    revalidatePath("/leads", "layout");
    const soloTel = rows.filter((x) => !x.email).length;
    const skip = skipped.length ? ` · ${skipped.length} filas saltadas (${skipped.slice(0, 3).map((x) => `fila ${x.line}: ${x.reason}`).join("; ")}${skipped.length > 3 ? "…" : ""})` : "";
    const enrolados = sequenceId ? ` · ${r.enrolled} enrolado(s) en la secuencia` : "";
    return `${r.created} contactos nuevos · ${r.completed} ya existían y se completaron${soloTel ? ` · ${soloTel} solo con teléfono` : ""}${enrolados}${skip}.`;
  },
);

// Next exige que cada export de un archivo "use server" sea una función async declarada.
export async function createContact(prev: ActionState, fd: FormData) {
  return _createContact(prev, fd);
}
export async function updateContact(prev: ActionState, fd: FormData) {
  return _updateContact(prev, fd);
}
export async function setConsent(prev: ActionState, fd: FormData) {
  return _setConsent(prev, fd);
}
export async function importEventOpsContacts(prev: ActionState, fd: FormData) {
  return _importEventOps(prev, fd);
}
export async function importLeadsCsv(prev: ActionState, fd: FormData) {
  return _importLeads(prev, fd);
}
