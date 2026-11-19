/**
 * Redes sociales y campañas pagadas: métricas, atribución por UTM e importación CSV.
 * Funciones puras arriba (probadas en marketing.test.ts); escritura a la base abajo.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { adCampaigns, adDaily, socialAccounts, socialDaily, socialPosts } from "@/db/schema";

export type Platform = (typeof socialAccounts.$inferSelect)["platform"];

// ---------- métricas ----------
export type AdTotals = { spendCents: number; impressions: number; clicks: number; leads: number; conversions: number };

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** CTR en %, costos en MXN. null cuando no hay denominador (no "0", que engaña). */
export function adMetrics(t: AdTotals, demos = 0, customers = 0) {
  const spend = t.spendCents / 100;
  return {
    spend,
    ctr: t.impressions ? Math.round((t.clicks / t.impressions) * 10000) / 100 : null,
    cpc: ratio(spend, t.clicks),
    cpm: t.impressions ? (spend / t.impressions) * 1000 : null,
    cpl: ratio(spend, t.leads),
    costPerDemo: ratio(spend, demos),
    costPerCustomer: ratio(spend, customers),
  };
}

export function sumAds(rows: AdTotals[]): AdTotals {
  return rows.reduce(
    (a, r) => ({ spendCents: a.spendCents + r.spendCents, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, leads: a.leads + r.leads, conversions: a.conversions + r.conversions }),
    { spendCents: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 },
  );
}

export const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Atribución real: una demo cuenta para la campaña si su utm_campaign coincide con el utm configurado
 * (o, si no hay, con el nombre de la campaña en formato slug).
 */
export function attributeDemos(
  campaigns: { id: string; name: string; utmCampaign: string | null }[],
  demos: { utm: Record<string, string>; stage: string }[],
) {
  const out = new Map<string, { demos: number; customers: number }>();
  for (const c of campaigns) {
    const key = slug(c.utmCampaign || c.name);
    const mine = demos.filter((d) => d.utm?.utm_campaign && slug(d.utm.utm_campaign) === key);
    out.set(c.id, { demos: mine.length, customers: mine.filter((d) => d.stage === "paid").length });
  }
  return out;
}

// ---------- CSV ----------
/** CSV con comillas, comas o punto y coma, y BOM de Excel. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (re: RegExp) => firstLine.match(re)?.length ?? 0;
  // Coma por defecto; punto y coma o tabulador (CSV de Meta) cuando dominan en la primera línea.
  const sep = count(/\t/g) > Math.max(count(/;/g), count(/,/g)) ? "\t" : count(/;/g) > count(/,/g) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const norm = (h: string) => slug(h).replace(/-/g, "_");

const ORGANIC_ALIASES = {
  day: ["date", "fecha", "day", "dia"],
  followers: ["followers", "seguidores", "followers_count", "total_followers"],
  reach: ["reach", "alcance", "accounts_reached", "unique_impressions"],
  impressions: ["impressions", "impresiones", "views", "visualizaciones", "video_views"],
  engagements: ["engagements", "engagement", "interacciones", "accounts_engaged", "interactions"],
  profileViews: ["profile_views", "visitas_al_perfil", "visitas_perfil", "page_views"],
  linkClicks: ["link_clicks", "clics_en_el_enlace", "website_clicks", "clics"],
} as const;

const ADS_ALIASES = {
  day: ["date", "fecha", "day", "dia", "reporting_starts", "inicio_del_informe"],
  campaign: ["campaign", "campana", "campaign_name", "nombre_de_la_campana"],
  campaignId: ["campaign_id", "id_de_la_campana", "id_campana"],
  spend: ["spend", "gasto", "amount_spent", "importe_gastado", "importe_gastado_mxn", "cost", "costo", "amount_spent_mxn"],
  impressions: ["impressions", "impresiones"],
  clicks: ["clicks", "clics", "link_clicks", "clics_en_el_enlace"],
  leads: ["leads", "clientes_potenciales", "resultados", "results"],
  conversions: ["conversions", "conversiones", "registrations", "registros"],
} as const;

function mapHeaders<K extends string>(header: string[], aliases: Record<K, readonly string[]>) {
  const h = header.map(norm);
  const idx = {} as Record<K, number>;
  for (const [key, names] of Object.entries(aliases) as [K, readonly string[]][]) idx[key] = h.findIndex((x) => names.includes(x));
  return idx;
}

/** "1,234" "1.234,5" "$2,500.00" → número. Vacío → null. */
export function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Fechas como 2026-11-03, 03/11/2026 (día primero, formato MX) o 2026/11/03. */
export function toISODate(raw: string | undefined): string | null {
  const s = raw?.trim() ?? "";
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export type OrganicRow = { day: string; followers: number | null; reach: number | null; impressions: number | null; engagements: number | null; profileViews: number | null; linkClicks: number | null };

export function parseOrganicCsv(text: string): { rows: OrganicRow[]; skipped: number } {
  const [header, ...data] = parseCsv(text);
  if (!header) throw new Error("El archivo está vacío.");
  const i = mapHeaders(header, ORGANIC_ALIASES);
  if (i.day < 0) throw new Error("No encontré la columna de fecha (date / fecha).");
  if ([i.followers, i.reach, i.impressions, i.engagements].every((x) => x < 0)) throw new Error("No encontré columnas de métricas (seguidores, alcance, impresiones o interacciones).");
  const int = (r: string[], k: number) => (k < 0 ? null : (v => (v == null ? null : Math.round(v)))(toNumber(r[k])));
  let skipped = 0;
  const rows: OrganicRow[] = [];
  for (const r of data) {
    const day = toISODate(r[i.day]);
    if (!day) { skipped++; continue; }
    rows.push({ day, followers: int(r, i.followers), reach: int(r, i.reach), impressions: int(r, i.impressions), engagements: int(r, i.engagements), profileViews: int(r, i.profileViews), linkClicks: int(r, i.linkClicks) });
  }
  return { rows, skipped };
}

export type AdRow = { day: string; campaign: string; campaignId: string; spendCents: number; impressions: number; clicks: number; leads: number; conversions: number };

export function parseAdsCsv(text: string): { rows: AdRow[]; skipped: number } {
  const [header, ...data] = parseCsv(text);
  if (!header) throw new Error("El archivo está vacío.");
  const i = mapHeaders(header, ADS_ALIASES);
  if (i.day < 0 || i.campaign < 0 || i.spend < 0) throw new Error("El CSV necesita al menos fecha, campaña y gasto.");
  const n = (r: string[], k: number) => (k < 0 ? 0 : Math.round(toNumber(r[k]) ?? 0));
  let skipped = 0;
  const rows: AdRow[] = [];
  for (const r of data) {
    const day = toISODate(r[i.day]);
    const campaign = r[i.campaign]?.trim();
    if (!day || !campaign) { skipped++; continue; }
    rows.push({
      day, campaign, campaignId: (i.campaignId >= 0 && r[i.campaignId]?.trim()) || slug(campaign),
      spendCents: Math.round((toNumber(r[i.spend]) ?? 0) * 100),
      impressions: n(r, i.impressions), clicks: n(r, i.clicks), leads: n(r, i.leads), conversions: n(r, i.conversions),
    });
  }
  return { rows, skipped };
}

// ---------- base de datos ----------
export async function upsertSocialDaily(db: Db, accountId: string, rows: OrganicRow[]) {
  for (const r of rows) {
    // Un null no borra un valor ya guardado (una fuente puede traer solo algunas métricas).
    await db.insert(socialDaily).values({ accountId, ...r }).onConflictDoUpdate({
      target: [socialDaily.accountId, socialDaily.day],
      set: {
        followers: sql`coalesce(excluded.followers, ${socialDaily.followers})`,
        reach: sql`coalesce(excluded.reach, ${socialDaily.reach})`,
        impressions: sql`coalesce(excluded.impressions, ${socialDaily.impressions})`,
        engagements: sql`coalesce(excluded.engagements, ${socialDaily.engagements})`,
        profileViews: sql`coalesce(excluded.profile_views, ${socialDaily.profileViews})`,
        linkClicks: sql`coalesce(excluded.link_clicks, ${socialDaily.linkClicks})`,
      },
    });
  }
  return rows.length;
}

export async function upsertAds(db: Db, platform: Platform, accountId: string | null, rows: AdRow[], meta: Record<string, { objective?: string; status?: string }> = {}) {
  const ids = new Map<string, string>();
  for (const r of rows) {
    if (!ids.has(r.campaignId)) {
      const m = meta[r.campaignId] ?? {};
      const [c] = await db.insert(adCampaigns)
        .values({ platform, externalId: r.campaignId, accountId, name: r.campaign, objective: m.objective ?? null, status: m.status ?? null })
        .onConflictDoUpdate({ target: [adCampaigns.platform, adCampaigns.externalId], set: { name: r.campaign, ...(m.status ? { status: m.status } : {}), ...(m.objective ? { objective: m.objective } : {}) } })
        .returning({ id: adCampaigns.id });
      ids.set(r.campaignId, c.id);
    }
    const campaignId = ids.get(r.campaignId)!;
    const vals = { spendCents: r.spendCents, impressions: r.impressions, clicks: r.clicks, leads: r.leads, conversions: r.conversions };
    await db.insert(adDaily).values({ campaignId, day: r.day, ...vals }).onConflictDoUpdate({ target: [adDaily.campaignId, adDaily.day], set: vals });
  }
  return { campaigns: ids.size, rows: rows.length };
}

export type PostRow = Omit<typeof socialPosts.$inferInsert, "id" | "accountId" | "createdAt" | "updatedAt">;

export async function upsertPosts(db: Db, accountId: string, posts: PostRow[]) {
  for (const p of posts) {
    await db.insert(socialPosts).values({ accountId, ...p }).onConflictDoUpdate({
      target: [socialPosts.accountId, socialPosts.externalId],
      set: { reach: p.reach, views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, caption: p.caption, url: p.url },
    });
  }
  return posts.length;
}

export async function markSync(db: Db, accountId: string, error: string | null) {
  await db.update(socialAccounts).set({ lastSyncAt: new Date(), lastError: error }).where(and(eq(socialAccounts.id, accountId)));
}
