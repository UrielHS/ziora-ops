import { and, eq, ilike, isNull } from "drizzle-orm";
import type { Db, Dbx } from "@/db";
import { contacts, type ContactTag } from "@/db/schema";
import { parseCsv } from "./marketing";

import { normalizePhoneE164 } from "./phone";
import { logActivity, type Actor } from "./leads";
import { socialProfileUrl } from "./social-shared";

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

export { socialProfileUrl };

/**
 * Agrega correo y/o teléfono a un lead que hasta ahora solo tenía su @. No fusiona contactos:
 * si el correo o el teléfono ya es de otro contacto no toca nada y dice de quién es.
 */
export async function addContactChannel(
  db: Dbx, contactId: string, ch: { email?: string; phone?: string }, actor: Actor,
): Promise<{ ok: true; added: boolean; unreadablePhone: boolean } | { ok: false; takenBy: string }> {
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
  const unreadablePhone = !!ch.phone?.trim() && !phoneE164;
  if (!added.length) return { ok: true, added: false, unreadablePhone };
  await db.update(contacts).set(set).where(eq(contacts.id, contactId));
  await logActivity(db, { contactId, type: "sistema", actor, summary: `Se agregó ${added.join(" y ")} al lead`, meta: { kind: "channel_added", channels: added } });
  return { ok: true, added: true, unreadablePhone };
}

export async function setSocialLeadType(db: Dbx, contactId: string, type: SocialLeadType, actor: Actor): Promise<void> {
  const [cur] = await db.select({ t: contacts.socialLeadType }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!cur || cur.t === type) return;
  await db.update(contacts).set({ socialLeadType: type }).where(eq(contacts.id, contactId));
  await logActivity(db, { contactId, type: "sistema", actor, summary: `Tipo de lead: ${type === "psicologo" ? "psicólogo" : "influencer"}`, meta: { kind: "social_lead_type", from: cur.t, to: type } });
}

// ---------- importación de las listas de redes (docs/gtm/redes) ----------

export type SocialRow = {
  name: string; platform: SocialPlatform; handle: string; profileUrl: string; followers: string | null; tier: SocialTier | null;
  leadType: SocialLeadType; approach: string | null; cityName: string | null; notes: string | null; tags: ContactTag[];
  details: Record<string, string>;
};

const clean = (s: string | undefined) => (s ?? "").trim() || null;

export function parseSocialCsv(text: string, list: "influencers" | "psicologos"): { rows: SocialRow[]; skipped: { line: number; reason: string }[] } {
  const table = parseCsv(text);
  const rows: SocialRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  if (!table.length) return { rows, skipped };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (r: string[], name: string) => { const i = header.indexOf(name); return i < 0 ? null : clean(r[i]); };
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (r.every((c) => !c.trim())) return;
    const rawHandle = col(r, "usuario");
    if (!rawHandle) return void skipped.push({ line, reason: "sin usuario" });
    const handle = normalizeHandle(rawHandle);
    if (!handle) return void skipped.push({ line, reason: "usuario inválido" });
    const platform: SocialPlatform = list === "psicologos" ? "instagram" : (col(r, "plataforma") ?? "").toLowerCase() === "tiktok" ? "tiktok" : "instagram";
    const perfil = col(r, "perfil");
    const tipo = col(r, "tipo");
    const details: Record<string, string> = {};
    const put = (k: string, v: string | null) => { if (v) details[k] = v; };
    let tier: SocialTier | null = null;
    let tags: ContactTag[];
    let cityName: string | null;
    if (list === "influencers") {
      const nivel = (col(r, "nivel") ?? "").toLowerCase();
      tier = nivel === "micro" ? "micro" : nivel === "nano" ? "nano" : nivel === "por confirmar país" ? "por_confirmar_pais" : null;
      tags = ["influencer", "lead"];
      if (/^cl[ií]nica$/i.test(tipo ?? "")) tags.push("clinic");
      cityName = col(r, "ciudad");
      put("tipo_csv", tipo); put("dato_seguidores", col(r, "dato de seguidores"));
    } else {
      tags = ["psychologist", "lead"];
      if (/^consultorio/i.test(tipo ?? "")) tags.push("clinic");
      cityName = col(r, "alcaldía / municipio");
      put("zona", col(r, "zona")); put("tipo_csv", tipo); put("senal_consulta", col(r, "señal de consulta")); put("fuente", col(r, "fuente"));
    }
    rows.push({
      name: col(r, "nombre") ?? `@${handle}`, platform, handle,
      profileUrl: perfil && /^https?:\/\//i.test(perfil) ? perfil : socialProfileUrl(platform, handle),
      followers: col(r, "seguidores"), tier, leadType: list === "influencers" ? "influencer" : "psicologo",
      approach: col(r, "enfoque"), cityName, notes: col(r, "notas"), tags, details,
    });
  });
  return { rows, skipped };
}

/**
 * Importa filas de redes con `ownerId` como dueña. El lead se reconoce por (plataforma, usuario) o, si todavía no tenía
 * sus columnas de redes, por el perfil guardado en website. Un lead previo conserva dueño, estado y tipo; si su dueño
 * no es `ownerId` se reporta en `otherOwner`.
 */
export async function importSocialLeads(
  db: Db, rows: SocialRow[], opts: { ownerId: string; actor: Actor },
): Promise<{ created: number; existing: number; otherOwner: string[] }> {
  // Dinámicos: contacts.ts importa este módulo, así no hay ciclo al cargar.
  const { upsertContact, toCity } = await import("./contacts");
  const { ensureInviteLink } = await import("./social-links");
  const out = { created: 0, existing: 0, otherOwner: [] as string[] };
  for (const row of rows) {
    const [found] = await db.select({ id: contacts.id }).from(contacts)
      .where(and(eq(contacts.socialPlatform, row.platform), eq(contacts.socialHandle, row.handle))).limit(1);
    if (!found) {
      const domain = row.platform === "tiktok" ? "tiktok.com" : "instagram.com";
      const cands = await db.select({ id: contacts.id, website: contacts.website }).from(contacts)
        .where(and(isNull(contacts.socialHandle), ilike(contacts.website, `%${domain}/%${row.handle}%`)));
      const same = cands.find((c) => (c.website ?? "").toLowerCase().includes(domain) && normalizeHandle(c.website) === row.handle);
      if (same) await db.update(contacts).set({ socialPlatform: row.platform, socialHandle: row.handle }).where(eq(contacts.id, same.id));
    }
    const city = /^cdmx/i.test(row.details.zona ?? "") ? ("cdmx" as const) : row.cityName ? toCity(row.cityName) : null;
    const r = await upsertContact(db, {
      name: row.name, source: row.platform, tags: row.tags, leadStatus: "nuevo", ownerId: opts.ownerId,
      approach: row.approach, cityName: row.cityName, city, notes: row.notes, details: row.details,
      social: { platform: row.platform, handle: row.handle, profileUrl: row.profileUrl, followers: row.followers, tier: row.tier, leadType: row.leadType },
    });
    if (r.created) {
      out.created++;
      await logActivity(db, { contactId: r.id, type: "sistema", actor: opts.actor, summary: "Importado de la lista de redes", meta: { kind: "social_import", list: row.leadType } });
    } else out.existing++;
    await ensureInviteLink(db, r.id, opts.actor.userId);
    const [c] = await db.select({ ownerId: contacts.ownerId }).from(contacts).where(eq(contacts.id, r.id)).limit(1);
    if (c?.ownerId !== opts.ownerId) out.otherOwner.push(r.id);
  }
  return out;
}
