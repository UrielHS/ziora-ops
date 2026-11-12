import { eq } from "drizzle-orm";
import type { Dbx } from "@/db";
import { contacts } from "@/db/schema";

import { normalizePhoneE164 } from "./phone";
import { logActivity, type Actor } from "./leads";

export type SocialPlatform = "instagram" | "tiktok";
export type SocialLeadType = "psicologo" | "influencer";
export type SocialTier = "micro" | "nano" | "por_confirmar_pais";

const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const SOCIAL_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:instagram|tiktok)\.com$/;

/**
 * Deja el usuario de Instagram/TikTok en su forma única: minúsculas, sin @ ni /.
 * Acepta el @, el usuario suelto o la URL del perfil (con www., query, rutas extra). Devuelve null si no es un usuario válido.
 */
export function normalizeHandle(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  // Solo es URL si trae esquema o su host es instagram.com / tiktok.com; "dra.lopez" o "terapia.mx" son usuarios, no dominios.
  const hostPart = s.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase();
  if (/^https?:\/\//i.test(s) || SOCIAL_HOST_RE.test(hostPart)) {
    let url: URL;
    try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
    if (!SOCIAL_HOST_RE.test(url.hostname.toLowerCase())) return null;
    s = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
  }
  s = s.replace(/^@+/, "").replace(/\/+$/, "").toLowerCase();
  return HANDLE_RE.test(s) ? s : null;
}

export function socialProfileUrl(platform: SocialPlatform, handle: string): string {
  return platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://www.instagram.com/${handle}/`;
}

/**
 * Agrega correo y/o teléfono a un lead que hasta ahora solo tenía su @. No fusiona contactos:
 * si el correo o el teléfono ya es de otro contacto no toca nada y dice de quién es.
 */
export async function addContactChannel(
  db: Dbx, contactId: string, ch: { email?: string; phone?: string }, actor: Actor,
): Promise<{ ok: true } | { ok: false; takenBy: string }> {
  const email = ch.email?.trim() ? ch.email.trim().toLowerCase() : null;
  const phoneE164 = normalizePhoneE164(ch.phone);
  const set: Partial<typeof contacts.$inferInsert> = {};
  const added: string[] = [];
  if (email) {
    const [o] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email)).limit(1);
    if (o && o.id !== contactId) return { ok: false, takenBy: o.id };
    if (!o) { set.email = email; added.push("correo"); }
  }
  if (phoneE164) {
    const [o] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phoneE164)).limit(1);
    if (o && o.id !== contactId) return { ok: false, takenBy: o.id };
    if (!o) { set.phone = ch.phone!.trim(); set.phoneE164 = phoneE164; set.phoneInvalidAt = null; added.push("teléfono"); }
  }
  if (!added.length) return { ok: true };
  await db.update(contacts).set(set).where(eq(contacts.id, contactId));
  await logActivity(db, { contactId, type: "sistema", actor, summary: `Se agregó ${added.join(" y ")} al lead`, meta: { kind: "channel_added", channels: added } });
  return { ok: true };
}

export async function setSocialLeadType(db: Dbx, contactId: string, type: SocialLeadType, actor: Actor): Promise<void> {
  const [cur] = await db.select({ t: contacts.socialLeadType }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!cur || cur.t === type) return;
  await db.update(contacts).set({ socialLeadType: type }).where(eq(contacts.id, contactId));
  await logActivity(db, { contactId, type: "sistema", actor, summary: `Tipo de lead: ${type === "psicologo" ? "psicólogo" : "influencer"}`, meta: { kind: "social_lead_type", from: cur.t, to: type } });
}
