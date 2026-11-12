/** Leads de redes: ligas cortas personales (invitación y promoción) y resolución del clic. Solo viaja el código, nunca el usuario. */
import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db, Dbx } from "@/db";
import { appUsers, contactTags, contacts, socialLinks, type SocialLink } from "@/db/schema";
import { CODE_ALPHABET, type UtmKey } from "./community-posts";
import { logActivity, SYSTEM_ACTOR } from "./leads";
import type { SocialLeadType, SocialPlatform } from "./social-leads";

export type { SocialLink };
export type SocialLinkKind = "invitacion" | "promocion";

export const SOCIAL_MEDIUM = "redes";
export const SOCIAL_CAMPAIGN = {
  psicologo: "redes-psicologo-202611",
  influencer: "redes-influencer-202611",
  promo: "redes-promo-202611",
} as const;
export const SOCIAL_CODE_RE = /^[abcdefghjkmnpqrstuvwxyz23456789]{7}$/;
const CODE_LENGTH = 7;

export function newSocialCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function socialUtm(
  link: { code: string; kind: SocialLinkKind },
  lead: { platform: SocialPlatform | null; leadType: SocialLeadType | null },
): Record<UtmKey, string> {
  const campaign = link.kind === "promocion" ? SOCIAL_CAMPAIGN.promo : SOCIAL_CAMPAIGN[lead.leadType ?? "psicologo"];
  return {
    utm_source: lead.platform ?? "redes",
    utm_medium: SOCIAL_MEDIUM,
    utm_campaign: campaign,
    utm_content: link.kind === "promocion" ? "promo" : "invitacion",
    utm_term: link.code,
  };
}

async function ensureLink(db: Dbx, contactId: string, kind: SocialLinkKind, createdBy: string | null): Promise<SocialLink> {
  const find = async () =>
    (await db.select().from(socialLinks).where(and(eq(socialLinks.contactId, contactId), eq(socialLinks.kind, kind))).limit(1))[0];
  const existing = await find();
  if (existing) return existing;
  for (let attempt = 0; attempt < 8; attempt++) {
    // onConflictDoNothing sin target cubre el choque de código y la carrera por (contacto, tipo).
    const [row] = await db.insert(socialLinks).values({ code: newSocialCode(), kind, contactId, createdBy }).onConflictDoNothing().returning();
    if (row) return row;
    const raced = await find();
    if (raced) return raced;
  }
  throw new Error("No se pudo generar un código único");
}

/** La liga de invitación del lead: siempre la misma. */
export function ensureInviteLink(db: Dbx, contactId: string, createdBy: string | null): Promise<SocialLink> {
  return ensureLink(db, contactId, "invitacion", createdBy);
}

/** La liga de promoción del influencer: solo con el acuerdo cerrado. */
export async function createPromoLink(db: Dbx, contactId: string, createdBy: string | null): Promise<SocialLink> {
  const [c] = await db.select({ stage: contacts.influencerStage }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!c) throw new Error("Lead no encontrado");
  if (c.stage !== "acuerdo_cerrado") throw new Error("La liga de promoción exige acuerdo cerrado");
  return ensureLink(db, contactId, "promocion", createdBy);
}

/** Cuenta el clic solo si `count`; devuelve las 5 UTM (con el tipo ACTUAL del lead) o null si el código no existe. */
export async function resolveSocialLink(db: Db, code: string, opts: { count: boolean }): Promise<{ utm: Record<UtmKey, string> } | null> {
  if (!SOCIAL_CODE_RE.test(code)) return null;
  if (opts.count) {
    await db.update(socialLinks).set({ clicks: sql`${socialLinks.clicks} + 1` }).where(eq(socialLinks.code, code));
  }
  const [row] = await db
    .select({ code: socialLinks.code, kind: socialLinks.kind, platform: contacts.socialPlatform, leadType: contacts.socialLeadType })
    .from(socialLinks)
    .innerJoin(contacts, eq(contacts.id, socialLinks.contactId))
    .where(eq(socialLinks.code, code))
    .limit(1);
  if (!row) return null;
  const platform = row.platform === "instagram" || row.platform === "tiktok" ? row.platform : null;
  return { utm: socialUtm({ code: row.code, kind: row.kind }, { platform, leadType: row.leadType }) };
}

export async function loadLinks(db: Dbx, contactIds: string[]): Promise<Map<string, { invite?: SocialLink; promo?: SocialLink }>> {
  const out = new Map<string, { invite?: SocialLink; promo?: SocialLink }>();
  if (!contactIds.length) return out;
  const rows = await db.select().from(socialLinks).where(inArray(socialLinks.contactId, contactIds));
  for (const r of rows) {
    const e = out.get(r.contactId) ?? {};
    if (r.kind === "invitacion") e.invite = r;
    else e.promo = r;
    out.set(r.contactId, e);
  }
  return out;
}

/**
 * Liga cada registro nuevo de la app con la liga de redes por la que llegó (utm_term = código), sin mirar el medio:
 * si la landing cayó en el respaldo (medio "comunidad") el código sigue siendo el de redes. Del más antiguo al más nuevo.
 * Siempre guarda social_link_id. Solo el primer registro real con una liga de invitación se vuelve la cuenta del lead;
 * las cuentas de prueba, los siguientes registros y las ligas de promoción solo quedan atribuidos.
 * Una transacción por usuario: un choque (p. ej. el correo ya es de otro contacto) nunca tumba la sincronización.
 */
export async function linkSocialSignups(db: Db, _now = new Date()): Promise<{ linked: number; attributed: number; failed: number }> {
  const pending = await db
    .select({ uid: appUsers.uid, email: appUsers.email, isTest: appUsers.isTest, code: sql<string>`${appUsers.attribution}->>'utm_term'` })
    .from(appUsers)
    .where(and(isNull(appUsers.socialLinkId), isNotNull(appUsers.attribution), sql`${appUsers.attribution}->>'utm_term' is not null`))
    .orderBy(sql`${appUsers.signedUpAt} asc nulls last`, asc(appUsers.uid));
  const codes = [...new Set(pending.map((p) => p.code).filter((c) => SOCIAL_CODE_RE.test(c)))];
  if (!codes.length) return { linked: 0, attributed: 0, failed: 0 };
  const links = new Map((await db.select().from(socialLinks).where(inArray(socialLinks.code, codes))).map((l) => [l.code, l]));

  let linked = 0, attributed = 0, failed = 0;
  for (const p of pending) {
    const link = links.get(p.code);
    if (!link) continue;
    let didLink: boolean | null;
    try {
      didLink = await db.transaction(async (tx) => {
      const set = await tx.update(appUsers).set({ socialLinkId: link.id }).where(and(eq(appUsers.uid, p.uid), isNull(appUsers.socialLinkId))).returning({ uid: appUsers.uid });
      if (!set.length) return null; // otro proceso ya lo atribuyó
      if (link.kind !== "invitacion" || p.isTest) return false;
      // Esta cuenta ya es de algún contacto (p. ej. ligada a mano): no se reasigna.
      const [mine] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.appUserUid, p.uid)).limit(1);
      if (mine) return false;
      const claimed = await tx.update(contacts).set({ appUserUid: p.uid })
        .where(and(eq(contacts.id, link.contactId), isNull(contacts.appUserUid))).returning({ email: contacts.email });
      if (!claimed.length) return false; // la liga ya la gastó un registro anterior
      const email = p.email.trim().toLowerCase();
      const meta: Record<string, unknown> = { kind: "app_signup", uid: p.uid, linkId: link.id };
      if (!claimed[0].email && email) {
        const [other] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email)).limit(1);
        if (!other) await tx.update(contacts).set({ email }).where(eq(contacts.id, link.contactId));
        else {
          await tx.update(contacts).set({ details: sql`${contacts.details} || ${JSON.stringify({ correo_en_otro_lead: other.id })}::jsonb` }).where(eq(contacts.id, link.contactId));
          meta.correo_en_otro_lead = other.id;
        }
      }
      await tx.insert(contactTags).values({ contactId: link.contactId, tag: "ziora_user" }).onConflictDoNothing();
      await logActivity(tx, { contactId: link.contactId, type: "sistema", actor: SYSTEM_ACTOR, summary: "Se registró en Ziora con su invitación", meta });
      return true;
      });
    } catch (err) {
      // La transacción de este usuario se deshizo: se sigue con los demás. Sin correo ni @ en el log (el mensaje de Postgres puede traerlos).
      failed++;
      console.error("[social-signups] no se pudo ligar", p.uid, (err as { code?: string })?.code ?? "error");
      continue;
    }
    if (didLink === null) continue;
    attributed++;
    if (didLink) linked++;
  }
  return { linked, attributed, failed };
}
