/** Comunidades (Fase 1): importación del inventario, alta manual, revisión, membresías y política de promoción. */
import { and, eq, like } from "drizzle-orm";
import type { Db } from "@/db";
import { communities, communityMemberships } from "@/db/schema";
import type { Actor } from "./leads";
import { parseCsv, slug } from "./marketing";

export type CommunityPlatform = (typeof communities.$inferSelect)["platform"];
export type PromoPolicy = (typeof communities.$inferSelect)["promoPolicy"];
export type CommunityKind = (typeof communities.$inferSelect)["kind"];
export type MembershipStatus = (typeof communityMemberships.$inferSelect)["status"];

export const PLATFORM_PREFIX: Record<CommunityPlatform, string> = {
  facebook: "fb", whatsapp: "wa", telegram: "tg", linkedin: "li", reddit: "rd", discord: "dc", asociacion: "as", otro: "ot",
};
export const PLATFORMS = Object.keys(PLATFORM_PREFIX) as CommunityPlatform[];
const PROMO_POLICIES: PromoPolicy[] = ["desconocido", "si", "no", "permiso_admin", "dias_especificos"];
export const PRIORITIES = ["A", "B", "C"] as const;
export const ORIGINS = ["tavily_2026_11", "recomendada", "manual"] as const;
export const DISCARD_REASONS = ["para_pacientes", "inactiva", "no_es_de_psicologos", "duplicada", "otro"] as const;
export type DiscardReason = (typeof DISCARD_REASONS)[number];

const SLUG_MAX = 60;

export function communitySlug(platform: CommunityPlatform, name: string): string {
  return `${PLATFORM_PREFIX[platform]}-${slug(name)}`.slice(0, SLUG_MAX).replace(/-+$/, "");
}

export type CommunityRow = {
  name: string; platform: CommunityPlatform; url: string; country: string | null; cityRegion: string | null; topic: string | null;
  sizeApprox: string | null; accessType: string | null; promoPolicy: PromoPolicy; activity: string | null; phase: number | null;
  priority: "A" | "B" | "C" | null; notes: string | null; sourceUrl: string | null; kind: CommunityKind;
};

const clean = (s: string | undefined) => (s ?? "").trim() || null;

export function parseCommunitiesCsv(text: string): { rows: CommunityRow[]; skipped: { line: number; reason: string }[] } {
  const table = parseCsv(text);
  const rows: CommunityRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  if (!table.length) return { rows, skipped };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (r: string[], name: string) => r[header.indexOf(name)];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (r.every((c) => !c.trim())) return;
    const name = clean(col(r, "nombre"));
    const url = clean(col(r, "url"));
    if (!name) return void skipped.push({ line, reason: "sin nombre" });
    if (!url) return void skipped.push({ line, reason: "sin URL" });
    const platformRaw = (clean(col(r, "plataforma")) ?? "otro").toLowerCase() as CommunityPlatform;
    const platform = PLATFORMS.includes(platformRaw) ? platformRaw : "otro";
    const promoRaw = (clean(col(r, "permite_promocion")) ?? "").toLowerCase() as PromoPolicy;
    const prio = (clean(col(r, "prioridad")) ?? "").toUpperCase();
    const phaseN = Number.parseInt(col(r, "fase") ?? "", 10);
    rows.push({
      name, platform, url,
      country: clean(col(r, "pais")), cityRegion: clean(col(r, "ciudad_region")), topic: clean(col(r, "enfoque_o_tema")),
      sizeApprox: clean(col(r, "tamano_aprox")), accessType: clean(col(r, "tipo_acceso")),
      promoPolicy: PROMO_POLICIES.includes(promoRaw) ? promoRaw : "desconocido",
      activity: clean(col(r, "actividad")), phase: Number.isFinite(phaseN) ? phaseN : null,
      priority: (PRIORITIES as readonly string[]).includes(prio) ? (prio as "A" | "B" | "C") : null,
      notes: clean(col(r, "notas")), sourceUrl: clean(col(r, "fuente")),
      kind: platform === "asociacion" ? "alianza" : "grupo",
    });
  });
  return { rows, skipped };
}

/** Slug libre: base, o base-2, base-3… respetando el máximo de 60. */
async function uniqueSlug(db: Db, platform: CommunityPlatform, name: string, taken: Set<string>): Promise<string> {
  const base = communitySlug(platform, name);
  const existing = await db.select({ slug: communities.slug }).from(communities).where(like(communities.slug, `${base}%`));
  for (const e of existing) taken.add(e.slug);
  if (!taken.has(base)) { taken.add(base); return base; }
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const cand = base.slice(0, SLUG_MAX - suffix.length) + suffix;
    if (!taken.has(cand)) { taken.add(cand); return cand; }
  }
}

export async function importCommunities(db: Db, rows: CommunityRow[], opts: { origin: string }): Promise<{ created: number; existing: number }> {
  if (!(ORIGINS as readonly string[]).includes(opts.origin)) throw new Error(`Origen no válido: ${opts.origin}`);
  let created = 0, existing = 0;
  const taken = new Set<string>();
  for (const r of rows) {
    const [dup] = await db.select({ id: communities.id }).from(communities).where(eq(communities.url, r.url)).limit(1);
    if (dup) { existing++; continue; }
    const s = await uniqueSlug(db, r.platform, r.name, taken);
    const inserted = await db.insert(communities).values({ ...r, slug: s, status: "por_revisar", origin: opts.origin }).onConflictDoNothing({ target: communities.url }).returning({ id: communities.id });
    if (inserted.length) created++; else existing++;
  }
  return { created, existing };
}

export async function createCommunity(
  db: Db,
  input: { name: string; platform: CommunityPlatform; url: string; cityRegion?: string; recommendedBy?: string; notes?: string },
  actor: Actor,
): Promise<{ id: string }> {
  void actor;
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name) throw new Error("Falta el nombre");
  if (!url) throw new Error("Falta la liga");
  if (!PLATFORMS.includes(input.platform)) throw new Error("Plataforma no válida");
  const [dup] = await db.select({ id: communities.id }).from(communities).where(eq(communities.url, url)).limit(1);
  if (dup) throw new Error("Esa comunidad ya está registrada");
  const recommendedBy = input.recommendedBy?.trim() || null;
  const s = await uniqueSlug(db, input.platform, name, new Set());
  const [row] = await db.insert(communities).values({
    name, url, platform: input.platform, slug: s, cityRegion: input.cityRegion?.trim() || null, notes: input.notes?.trim() || null,
    recommendedBy, origin: recommendedBy ? "recomendada" : "manual", kind: input.platform === "asociacion" ? "alianza" : "grupo", status: "por_revisar",
  }).returning({ id: communities.id });
  return { id: row.id };
}

export type ReviewDecision = { to: "aprobada" } | { to: "descartada"; reason: DiscardReason } | { to: "alianza" };

export async function reviewCommunity(db: Db, id: string, decision: ReviewDecision, actor: Actor, now: Date = new Date()): Promise<void> {
  const patch: Partial<typeof communities.$inferInsert> = { reviewedBy: actor.userId, reviewedAt: now, updatedAt: now };
  if (decision.to === "descartada") {
    if (!decision.reason || !(DISCARD_REASONS as readonly string[]).includes(decision.reason)) throw new Error("Indica el motivo del descarte");
    Object.assign(patch, { status: "descartada", discardReason: decision.reason });
  } else if (decision.to === "alianza") {
    Object.assign(patch, { kind: "alianza", status: "aprobada", discardReason: null });
  } else if (decision.to === "aprobada") {
    Object.assign(patch, { status: "aprobada", discardReason: null });
  } else throw new Error("Decisión no válida");
  const res = await db.update(communities).set(patch).where(eq(communities.id, id)).returning({ id: communities.id });
  if (!res.length) throw new Error("Comunidad no encontrada");
}

export async function setMembership(db: Db, communityId: string, userId: string, status: MembershipStatus, now: Date = new Date()): Promise<void> {
  const [cur] = await db.select().from(communityMemberships).where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, userId))).limit(1);
  const patch: Partial<typeof communityMemberships.$inferInsert> = { status, updatedAt: now };
  if (status === "solicitud_enviada") patch.requestedAt = cur?.requestedAt ?? now;
  if (status === "unida") { patch.joinedAt = now; patch.requestedAt = cur?.requestedAt ?? now; patch.leftAt = null; }
  if (status === "nos_sacaron" || status === "salio") patch.leftAt = now;
  if (cur) await db.update(communityMemberships).set(patch).where(eq(communityMemberships.id, cur.id));
  else await db.insert(communityMemberships).values({ communityId, userId, ...patch }).onConflictDoUpdate({ target: [communityMemberships.communityId, communityMemberships.userId], set: patch });
}

export async function setPromoPolicy(db: Db, communityId: string, policy: PromoPolicy, rulesText: string | null, actor: Actor): Promise<void> {
  void actor;
  if (!PROMO_POLICIES.includes(policy)) throw new Error("Política no válida");
  const res = await db.update(communities).set({ promoPolicy: policy, rulesText: rulesText?.trim() || null, updatedAt: new Date() }).where(eq(communities.id, communityId)).returning({ id: communities.id });
  if (!res.length) throw new Error("Comunidad no encontrada");
}
