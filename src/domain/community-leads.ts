/** Comunidades (Fase 1): interesados registrados a mano o por /comunidad, con atribución y reparto Uriel/Chris. */
import { eq } from "drizzle-orm";
import type { Db, Dbx } from "@/db";
import { communities, communityCampaigns, communityPosts, contacts, contactTags, settings, type ContactSource, type ContactTag } from "@/db/schema";
import { users } from "@/db/shared";
import { notifyTeam } from "@/integrations/notify";
import { normalizeEmail, upsertContact } from "./contacts";
import { CODE_RE, postUtm } from "./community-posts";
import { logActivity, SYSTEM_ACTOR, type Actor } from "./leads";
import { normalizePhoneE164 } from "./phone";

export const LEAD_RR_KEY = "community_lead_rr";
type LeadRr = { ownerIds: string[]; last: number };

/** Siguiente dueño en la rotación; `last` es el índice del último turno (-1 si nadie ha tenido). */
export function nextOwner(ownerIds: string[], last: number): { ownerId: string; index: number } | null {
  if (!ownerIds.length) return null;
  const n = ownerIds.length;
  const index = ((((Number.isInteger(last) ? last : -1) + 1) % n) + n) % n;
  return { ownerId: ownerIds[index], index };
}

/** Toma el siguiente turno de `settings["community_lead_rr"]` (con candado de fila). Null si no hay reparto configurado. */
export async function assignCommunityLeadOwner(tx: Dbx): Promise<string | null> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, LEAD_RR_KEY)).for("update").limit(1);
  const v = row?.value as Partial<LeadRr> | undefined;
  if (!v || !Array.isArray(v.ownerIds)) return null;
  const next = nextOwner(v.ownerIds, typeof v.last === "number" ? v.last : -1);
  if (!next) return null;
  await tx.update(settings).set({ value: { ownerIds: v.ownerIds, last: next.index } }).where(eq(settings.key, LEAD_RR_KEY));
  return next.ownerId;
}

/** Comunidad y post a partir de los UTM: primero `utm_term` (código del post), si no `utm_content` (slug de la comunidad). */
export async function resolveAttribution(db: Dbx, utm: Record<string, string>): Promise<{ communityId: string | null; postId: string | null }> {
  const code = (utm.utm_term ?? "").trim().toLowerCase();
  if (CODE_RE.test(code)) {
    const [p] = await db.select({ id: communityPosts.id, communityId: communityPosts.communityId }).from(communityPosts).where(eq(communityPosts.code, code)).limit(1);
    if (p) return { communityId: p.communityId, postId: p.id };
  }
  const slug = (utm.utm_content ?? "").trim();
  if (slug) {
    const [c] = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, slug)).limit(1);
    if (c) return { communityId: c.id, postId: null };
  }
  return { communityId: null, postId: null };
}

const PLATFORM_SOURCE: Record<string, ContactSource> = {
  facebook: "facebook_group", whatsapp: "whatsapp_group", telegram: "telegram_group", linkedin: "linkedin",
};
const KIND_TAGS: Record<"psicologo" | "clinica" | "asociacion", ContactTag[]> = {
  psicologo: ["psychologist", "lead"], clinica: ["clinic", "lead"], asociacion: ["lead"],
};

export type InterestedInput = {
  postId: string; name: string; email?: string; phone?: string; profileUrl?: string; note?: string;
  kind: "psicologo" | "clinica" | "asociacion";
};

export async function registerInterested(
  db: Db, input: InterestedInput, actor: Actor, now: Date = new Date(),
): Promise<{ contactId: string; ownerId: string | null; created: boolean }> {
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  const phone = input.phone?.trim() || null;
  const phoneE164 = normalizePhoneE164(phone);
  const profileUrl = input.profileUrl?.trim() || null;
  if (phone && !phoneE164 && !email && !profileUrl) throw new Error("Teléfono no válido");
  if (!email && !phoneE164 && !profileUrl) throw new Error("Indica correo, teléfono o perfil del interesado");

  const [post] = await db.select().from(communityPosts).where(eq(communityPosts.id, input.postId)).limit(1);
  if (!post) throw new Error("Post no encontrado");
  const [community] = await db.select().from(communities).where(eq(communities.id, post.communityId)).limit(1);
  if (!community) throw new Error("Comunidad no encontrada");
  const [camp] = post.campaignId
    ? await db.select({ slug: communityCampaigns.slug }).from(communityCampaigns).where(eq(communityCampaigns.id, post.campaignId)).limit(1)
    : [];
  const utm: Record<string, string> = postUtm(post.code, community, camp?.slug ?? "prueba-1-mes-202611");

  // Si ya existía con dueño o fecha de registro, no se toca ninguno y no se gasta turno del reparto.
  let existing: typeof contacts.$inferSelect | undefined;
  if (email) [existing] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1);
  if (!existing && phoneE164) [existing] = await db.select().from(contacts).where(eq(contacts.phoneE164, phoneE164)).limit(1);
  if (!existing && !email && !phoneE164 && profileUrl) [existing] = await db.select().from(contacts).where(eq(contacts.website, profileUrl)).limit(1);
  const alreadyWorked = !!existing && (!!existing.ownerId || !!existing.leadRegisteredAt);

  const ownerId = alreadyWorked ? existing!.ownerId : await db.transaction((tx) => assignCommunityLeadOwner(tx));
  // Sin reparto configurado, un lead con fecha de registro y sin dueño no volvería a entrar a la rotación.
  if (!alreadyWorked && !ownerId) throw new Error("Reparto de leads no configurado");
  const registration = alreadyWorked ? {} : { registeredById: actor.userId, leadRegisteredAt: now, ownerId };
  const source = PLATFORM_SOURCE[community.platform] ?? ("manual" as ContactSource);
  const tags = KIND_TAGS[input.kind];
  const notes = input.note?.trim() || null;

  let contactId: string;
  let created: boolean;
  if (email || phoneE164) {
    ({ id: contactId, created } = await upsertContact(db, {
      name: input.name, email, phone, website: profileUrl, source, tags, leadStatus: "nuevo", notes,
      utm, communityId: community.id, communityPostId: post.id, ...registration,
    }));
  } else if (existing) {
    // Solo con perfil y ya existía: se completa lo vacío.
    contactId = existing.id;
    created = false;
    await db.update(contacts).set({
      utm: Object.keys(existing.utm ?? {}).length ? existing.utm : utm,
      communityId: existing.communityId ?? community.id,
      communityPostId: existing.communityPostId ?? post.id,
      leadStatus: existing.leadStatus ?? "nuevo",
      statusChangedAt: existing.leadStatus ? existing.statusChangedAt : now,
      ...registration,
    }).where(eq(contacts.id, contactId));
  } else {
    const [row] = await db.insert(contacts).values({
      name: input.name.trim() || profileUrl!, website: profileUrl, notes, source, details: {},
      leadStatus: "nuevo", statusChangedAt: now, ownerId, utm, communityId: community.id, communityPostId: post.id,
      registeredById: actor.userId, leadRegisteredAt: now,
    }).returning({ id: contacts.id });
    contactId = row.id;
    created = true;
    await db.insert(contactTags).values(tags.map((tag) => ({ contactId, tag }))).onConflictDoNothing();
  }

  const [final] = await db.select({ ownerId: contacts.ownerId }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  const finalOwner = final?.ownerId ?? null;
  await logActivity(db, {
    contactId, type: "sistema", actor, occurredAt: now,
    summary: `Interesado registrado desde ${community.name}`,
    meta: { kind: "community_interested", communityId: community.id, postId: post.id },
  });
  await notifyOwner(db, finalOwner, contactId, `${actor.label} registró un interesado desde ${community.name}.`);
  return { contactId, ownerId: finalOwner, created };
}

async function notifyOwner(db: Db, ownerId: string | null, contactId: string, text: string) {
  if (!ownerId) return;
  try {
    const [o] = await db.select({ email: users.email }).from(users).where(eq(users.id, ownerId)).limit(1);
    if (o) await notifyTeam([o.email], "Nuevo interesado de comunidad", [text], { href: `/leads/${contactId}`, label: "Abrir lead" });
  } catch { /* el aviso es de cortesia: no debe tumbar el registro */ }
}

/** Captura suave de /comunidad: lead con atribución por UTM (con o sin comunidad resuelta); no crea demo. Entra al reparto Uriel/Chris. */
export async function ingestCommunityCapture(
  db: Db, p: { externalId?: string; fullName: string; email: string; utm: Record<string, string>; note?: string }, now: Date = new Date(),
): Promise<{ contactId: string; created: boolean }> {
  const attr = await resolveAttribution(db, p.utm);
  const [existing] = await db.select({ ownerId: contacts.ownerId, leadRegisteredAt: contacts.leadRegisteredAt }).from(contacts).where(eq(contacts.email, normalizeEmail(p.email))).limit(1);
  const alreadyWorked = !!existing && (!!existing.ownerId || !!existing.leadRegisteredAt);
  const ownerId = alreadyWorked ? null : await db.transaction((tx) => assignCommunityLeadOwner(tx));
  // Sin reparto configurado se guarda sin dueño ni fecha de registro, para poder asignarlo después (sin PII en el log).
  if (!alreadyWorked && !ownerId) console.warn("[comunidades] reparto de leads no configurado: captura guardada sin dueño");
  const assigned = !alreadyWorked && !!ownerId;
  const { id, created } = await upsertContact(db, {
    name: p.fullName, email: p.email, source: "landing_comunidad", tags: ["psychologist", "lead"], leadStatus: "nuevo",
    notes: p.note ?? null, utm: p.utm, communityId: attr.communityId, communityPostId: attr.postId,
    details: p.externalId ? { externalId: p.externalId } : {},
    ...(assigned ? { ownerId, leadRegisteredAt: now } : {}),
  });
  await logActivity(db, {
    contactId: id, type: "sistema", actor: SYSTEM_ACTOR, occurredAt: now,
    summary: "Registro desde la página de comunidad",
    meta: { kind: "community_capture", communityId: attr.communityId, postId: attr.postId },
  });
  if (assigned) await notifyOwner(db, ownerId, id, "Una persona se registró desde la página de comunidad.");
  return { contactId: id, created };
}
