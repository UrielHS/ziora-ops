import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { contactConsents, contacts, contactTagEnum, contactTags, type CityValue, type ContactSource, type ContactTag, type LeadStatus } from "@/db/schema";
import { normalizePhoneE164 } from "./phone";
import { logActivity, setLeadStatus, SYSTEM_ACTOR, type Actor } from "./leads";
import { eoContacts, eoContactTags, organizations } from "@/db/shared";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const CITY_ALIASES: Record<string, CityValue> = {
  cdmx: "cdmx", "ciudad de mexico": "cdmx", "ciudad de méxico": "cdmx", "mexico city": "cdmx",
  gdl: "gdl", guadalajara: "gdl", zapopan: "gdl",
  mty: "mty", monterrey: "mty", "san pedro garza garcia": "mty",
};
export function toCity(raw?: string | null): CityValue | null {
  if (!raw) return null;
  return CITY_ALIASES[raw.trim().toLowerCase()] ?? "other";
}

export type ConsentInput = { channel: "email" | "whatsapp"; source: string; evidence?: string };

type UpsertInput = {
  name: string;
  /** Correo o teléfono: hace falta al menos uno para poder buscar el contacto. */
  email?: string | null;
  phone?: string | null;
  /** Solo dígitos (525512345678). Si no viene, se calcula del teléfono. */
  phoneE164?: string | null;
  // Lead (CRM). Nunca pisan lo que ya estaba.
  leadStatus?: LeadStatus | null;
  priority?: number | null;
  segment?: string | null;
  ownerId?: string | null;
  /** Consentimiento por canal; azúcar: marketingOptIn equivale a consents: [{ channel: "email", ... }]. */
  consents?: ConsentInput[];
  company?: string | null;
  jobTitle?: string | null;
  city?: CityValue | null;
  cityName?: string | null;
  patientsPerWeek?: string | null;
  approach?: string | null;
  documentation?: string | null;
  aiUsage?: string | null;
  linkedinUrl?: string | null;
  website?: string | null;
  notes?: string | null;
  source: ContactSource;
  tags: ContactTag[];
  details?: Record<string, unknown>;
  eventOpsContactId?: string | null;
  marketingOptIn?: { source: string; evidence?: string } | null;
  // Atribución de comunidades. Solo llenan lo vacío, como el resto.
  utm?: Record<string, string>;
  communityId?: string | null;
  communityPostId?: string | null;
  registeredById?: string | null;
  leadRegisteredAt?: Date | null;
};

const TAGS = new Set<string>(contactTagEnum.enumValues);

/**
 * Crea o completa un contacto de Ziora Ops (ops.contacts), buscándolo por correo o, si no hay correo, por teléfono E.164.
 * Nunca pisa datos existentes: solo llena lo vacío, agrega etiquetas, consentimientos y suma columnas nuevas a details.
 */
export type ContactEdit = { name: string; phone?: string | null; city?: CityValue | null; notes?: string | null; company?: string | null; jobTitle?: string | null };

/** Edición manual desde el formulario. Si el teléfono cambia, se recalcula el E.164 y deja de estar «marcado incorrecto». */
export async function editContact(db: Db, id: string, d: ContactEdit, tags: ContactTag[], actor: Actor, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [cur] = await tx.select({ phone: contacts.phone, phoneInvalidAt: contacts.phoneInvalidAt }).from(contacts).where(eq(contacts.id, id));
    const phone = d.phone?.trim() || null;
    const phoneChanged = !!cur && phone !== cur.phone;
    await tx.update(contacts).set({
      name: d.name, phone, city: d.city ?? null, notes: d.notes ?? null, company: d.company ?? null, jobTitle: d.jobTitle ?? null,
      ...(phoneChanged ? { phoneE164: normalizePhoneE164(phone), phoneInvalidAt: null } : {}),
    }).where(eq(contacts.id, id));
    if (phoneChanged && cur?.phoneInvalidAt) {
      await logActivity(tx, { contactId: id, type: "nota", actor, summary: "Corrigió el teléfono; deja de estar marcado como incorrecto", meta: { kind: "channel_invalid", channel: "phone", invalid: false }, occurredAt: now });
    }
    // Las etiquetas son propias de Ziora Ops: se reemplazan por las elegidas.
    await tx.delete(contactTags).where(eq(contactTags.contactId, id));
    if (tags.length) await tx.insert(contactTags).values(tags.map((tag) => ({ contactId: id, tag }))).onConflictDoNothing();
  });
}

export async function upsertContact(db: Db, input: UpsertInput): Promise<{ id: string; created: boolean }> {
  const email = input.email ? normalizeEmail(input.email) : null;
  const phoneE164 = input.phoneE164 ?? normalizePhoneE164(input.phone);
  if (!email && !phoneE164) throw new Error("Un contacto necesita correo o teléfono válido.");
  const fill = <T>(cur: T | null, next: T | null | undefined) => cur ?? next ?? null;
  const consents: ConsentInput[] = [
    ...(input.consents ?? []),
    ...(input.marketingOptIn ? [{ channel: "email" as const, ...input.marketingOptIn }] : []),
  ];
  return db.transaction(async (tx) => {
    let [existing] = email
      ? await tx.select().from(contacts).where(eq(contacts.email, email)).limit(1)
      : await tx.select().from(contacts).where(eq(contacts.phoneE164, phoneE164!)).limit(1);
    // Un lead que entró solo con teléfono y después trae correo es la misma persona: se completa en vez de duplicarlo.
    // Si el dueño del teléfono ya tiene OTRO correo, son dos personas (p. ej. el conmutador de una clínica) y sigue abajo.
    if (!existing && email && phoneE164) {
      const [byPhone] = await tx.select().from(contacts).where(eq(contacts.phoneE164, phoneE164)).limit(1);
      if (byPhone && (!byPhone.email || byPhone.email === email)) existing = byPhone;
    }
    // El teléfono normalizado es único: si ya lo tiene otro contacto, se deja una nota en vez de romper.
    let nextPhoneE164 = existing?.phoneE164 ?? phoneE164 ?? null;
    const extra: Record<string, unknown> = {};
    if (nextPhoneE164 && !existing?.phoneE164) {
      const [owner] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, nextPhoneE164)).limit(1);
      if (owner && owner.id !== existing?.id) { nextPhoneE164 = null; extra.telefono_duplicado_de = owner.id; }
    }
    let id: string;
    if (existing) {
      id = existing.id;
      await tx.update(contacts).set({
        email: fill(existing.email, email),
        phone: fill(existing.phone, input.phone), phoneE164: nextPhoneE164, company: fill(existing.company, input.company),
        jobTitle: fill(existing.jobTitle, input.jobTitle), city: fill(existing.city, input.city),
        cityName: fill(existing.cityName, input.cityName),
        patientsPerWeek: fill(existing.patientsPerWeek, input.patientsPerWeek), approach: fill(existing.approach, input.approach),
        documentation: fill(existing.documentation, input.documentation), aiUsage: fill(existing.aiUsage, input.aiUsage),
        linkedinUrl: fill(existing.linkedinUrl, input.linkedinUrl), website: fill(existing.website, input.website),
        notes: fill(existing.notes, input.notes), eventOpsContactId: fill(existing.eventOpsContactId, input.eventOpsContactId),
        leadStatus: fill(existing.leadStatus, input.leadStatus),
        statusChangedAt: existing.leadStatus || !input.leadStatus ? existing.statusChangedAt : new Date(),
        priority: fill(existing.priority, input.priority), segment: fill(existing.segment, input.segment),
        ownerId: fill(existing.ownerId, input.ownerId),
        utm: Object.keys(existing.utm ?? {}).length ? existing.utm : (input.utm ?? {}),
        communityId: fill(existing.communityId, input.communityId), communityPostId: fill(existing.communityPostId, input.communityPostId),
        registeredById: fill(existing.registeredById, input.registeredById), leadRegisteredAt: fill(existing.leadRegisteredAt, input.leadRegisteredAt),
        // Lo que ya tenía gana sobre lo importado.
        details: sql`${JSON.stringify({ ...(input.details ?? {}), ...extra })}::jsonb || ${contacts.details}`,
      }).where(eq(contacts.id, id));
    } else {
      const [row] = await tx.insert(contacts).values({
        name: input.name.trim() || email || phoneE164!, email, phone: input.phone ?? null, phoneE164: nextPhoneE164, company: input.company ?? null,
        jobTitle: input.jobTitle ?? null, city: input.city ?? null, cityName: input.cityName ?? null,
        patientsPerWeek: input.patientsPerWeek ?? null, approach: input.approach ?? null,
        documentation: input.documentation ?? null, aiUsage: input.aiUsage ?? null, linkedinUrl: input.linkedinUrl ?? null,
        website: input.website ?? null, notes: input.notes ?? null, source: input.source, details: { ...(input.details ?? {}), ...extra },
        eventOpsContactId: input.eventOpsContactId ?? null,
        leadStatus: input.leadStatus ?? null, statusChangedAt: input.leadStatus ? new Date() : null,
        priority: input.priority ?? null, segment: input.segment ?? null, ownerId: input.ownerId ?? null,
        utm: input.utm ?? {}, communityId: input.communityId ?? null, communityPostId: input.communityPostId ?? null,
        registeredById: input.registeredById ?? null, leadRegisteredAt: input.leadRegisteredAt ?? null,
      }).returning({ id: contacts.id });
      id = row.id;
    }
    const tags = input.tags.filter((t) => TAGS.has(t));
    if (tags.length) await tx.insert(contactTags).values(tags.map((tag) => ({ contactId: id, tag }))).onConflictDoNothing();
    for (const c of consents) {
      await tx
        .insert(contactConsents)
        .values({ contactId: id, channel: c.channel, optIn: true, source: c.source, evidence: c.evidence, optedInAt: new Date() })
        .onConflictDoUpdate({
          target: [contactConsents.contactId, contactConsents.channel],
          // Una baja previa gana: no se re-suscribe automáticamente a quien se dio de baja.
          set: { optIn: sql`case when ${contactConsents.optedOutAt} is null then true else ${contactConsents.optIn} end` },
        });
    }
    return { id, created: !existing };
  });
}

/**
 * Copia contactos de Event Ops a Ziora Ops. Copia independiente: después de importarlos, los cambios
 * de un lado no afectan al otro. Sin correo no se importan (no habría forma de evitar duplicados).
 * El consentimiento de correo NO se copia: Event Ops no lo registra.
 */
export async function importFromEventOps(db: Db, eventOpsIds: string[]) {
  if (!eventOpsIds.length) return { created: 0, completed: 0, skipped: 0 };
  const rows = await db
    .select({ c: eoContacts, org: organizations.name })
    .from(eoContacts)
    .leftJoin(organizations, eq(organizations.id, eoContacts.organizationId))
    .where(and(inArray(eoContacts.id, eventOpsIds), isNotNull(eoContacts.email)));
  const tagRows = await db.select().from(eoContactTags).where(inArray(eoContactTags.contactId, rows.map((r) => r.c.id)));
  let created = 0, completed = 0;
  for (const { c, org } of rows) {
    const r = await upsertContact(db, {
      name: c.name, email: c.email!, phone: c.phone, company: org, city: c.city as CityValue | null,
      linkedinUrl: c.linkedinUrl, website: c.website, notes: c.notes, source: "event_ops",
      tags: tagRows.filter((t) => t.contactId === c.id).map((t) => t.tag as ContactTag),
      details: { ...c.details, eventOpsSource: c.source }, eventOpsContactId: c.id,
    });
    if (r.created) created++; else completed++;
  }
  return { created, completed, skipped: eventOpsIds.length - rows.length };
}

/**
 * Baja de un canal: revoca el consentimiento y, si es un lead en trabajo (antes de trial), lo marca perdido con motivo "baja".
 * A quien ya está en trial o pagando no se le cambia el estado por dejar de recibir marketing: solo queda en el timeline.
 */
export async function optOut(db: Db, contactId: string, channel = "email") {
  await db
    .insert(contactConsents)
    .values({ contactId, channel, optIn: false, source: "unsubscribe", optedOutAt: new Date() })
    .onConflictDoUpdate({
      target: [contactConsents.contactId, contactConsents.channel],
      set: { optIn: false, optedOutAt: new Date() },
    });
  const [c] = await db.select({ leadStatus: contacts.leadStatus }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!c?.leadStatus) return;
  if (["en_trial", "pago", "perdido"].includes(c.leadStatus)) {
    await logActivity(db, { contactId, type: "sistema", actor: SYSTEM_ACTOR, summary: `Baja de ${channel === "email" ? "correo" : channel}` });
  } else {
    await setLeadStatus(db, contactId, "perdido", SYSTEM_ACTOR, { lostReason: "baja" });
  }
}

/**
 * Rebote duro: ese correo no sirve, pero el lead sigue vivo (se le escribe por WhatsApp o se corrige el correo).
 * Quita el permiso de correo y deja nota; no cambia el estado. La baja y la queja de spam sí van por optOut.
 */
export async function emailBounced(db: Db, email: string) {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, normalizeEmail(email))).limit(1);
  if (!c) return;
  await db
    .insert(contactConsents)
    .values({ contactId: c.id, channel: "email", optIn: false, source: "bounce", optedOutAt: new Date() })
    .onConflictDoUpdate({
      target: [contactConsents.contactId, contactConsents.channel],
      set: { optIn: false, optedOutAt: new Date() },
    });
  await logActivity(db, { contactId: c.id, type: "sistema", actor: SYSTEM_ACTOR, summary: "Correo rebotó: se quitó el permiso de correo. Revisa la dirección o escríbele por WhatsApp." });
}

export async function optOutByEmail(db: Db, email: string) {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.email, normalizeEmail(email)))).limit(1);
  if (c) await optOut(db, c.id);
}
