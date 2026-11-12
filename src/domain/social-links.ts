/** Leads de redes: ligas cortas personales (invitación y promoción) y resolución del clic. Solo viaja el código, nunca el usuario. */
import { randomInt } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Dbx } from "@/db";
import { contacts, socialLinks, type SocialLink } from "@/db/schema";
import { CODE_ALPHABET, type UtmKey } from "./community-posts";
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
