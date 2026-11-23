/**
 * Meta Graph API: Instagram (cuenta profesional), página de Facebook y Meta Ads.
 * Token: de un "usuario del sistema" en Business Manager con instagram_basic, instagram_manage_insights,
 * pages_read_engagement, read_insights y ads_read. Guía: docs/REDES-Y-ANUNCIOS.md.
 *
 * Meta retira métricas seguido. Cada métrica se pide por separado: si una deja de existir,
 * se anota en `warnings` y el resto de la sincronización sigue.
 */
import type { AdRow, OrganicRow, PostRow } from "@/domain/marketing";

const VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

type Json = Record<string, unknown>;

async function graph(path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  const url = path.startsWith("http") ? new URL(path) : new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = (await res.json()) as Json & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) throw new Error(`Meta ${res.status}: ${body.error?.message ?? "error desconocido"}`);
  return body;
}

async function* pages(path: string, token: string, params: Record<string, string>) {
  let next: string | null = null;
  let first = true;
  for (let i = 0; i < 50 && (first || next); i++) {
    const body: Json = first ? await graph(path, token, params) : await graph(next!, token);
    first = false;
    yield (body.data as Json[]) ?? [];
    next = ((body.paging as Json | undefined)?.next as string | undefined) ?? null;
  }
}

const unix = (iso: string, endOfDay = false) => String(Math.floor(Date.parse(`${iso}T${endOfDay ? "23:59:59" : "00:00:00"}-06:00`) / 1000));
/**
 * Meta marca el valor diario con end_time = fin del día en la zona de la cuenta
 * (p. ej. 2026-11-03T06:00:00+0000 es el 2 de noviembre en CDMX). Se resta una hora y se lee en CDMX,
 * así que la cuenta de Instagram/Facebook debe estar configurada en hora de CDMX.
 */
export const dayOfEndTime = (endTime: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(Date.parse(endTime) - 3_600_000));

export type MetaSync = { daily: OrganicRow[]; posts: PostRow[]; ads: AdRow[]; campaignMeta: Record<string, { objective?: string; status?: string }>; warnings: string[] };

function emptyRow(day: string): OrganicRow {
  return { day, followers: null, reach: null, impressions: null, engagements: null, profileViews: null, linkClicks: null };
}

function rowFor(map: Map<string, OrganicRow>, day: string) {
  if (!map.has(day)) map.set(day, emptyRow(day));
  return map.get(day)!;
}

export async function syncInstagram(igUserId: string, token: string, days: string[], today: string): Promise<MetaSync> {
  const warnings: string[] = [];
  const map = new Map<string, OrganicRow>();
  const since = days[0];
  const until = days[days.length - 1];

  try {
    const me = await graph(igUserId, token, { fields: "followers_count" });
    rowFor(map, today).followers = Number(me.followers_count ?? 0);
  } catch (e) { warnings.push(`seguidores: ${(e as Error).message}`); }

  try {
    const r = await graph(`${igUserId}/insights`, token, { metric: "reach", period: "day", since: unix(since), until: unix(until, true) });
    for (const m of (r.data as Json[]) ?? []) {
      for (const v of (m.values as { value: number; end_time: string }[]) ?? []) rowFor(map, dayOfEndTime(v.end_time)).reach = v.value;
    }
  } catch (e) { warnings.push(`alcance: ${(e as Error).message}`); }

  // Métricas de "valor total": una llamada por día y métrica.
  const totals: [keyof OrganicRow, string][] = [["impressions", "views"], ["engagements", "accounts_engaged"], ["profileViews", "profile_views"], ["linkClicks", "website_clicks"]];
  for (const [field, metric] of totals) {
    try {
      for (const day of days) {
        const r = await graph(`${igUserId}/insights`, token, { metric, period: "day", metric_type: "total_value", since: unix(day), until: unix(day, true) });
        const value = ((r.data as Json[])?.[0]?.total_value as { value?: number } | undefined)?.value;
        if (typeof value === "number") (rowFor(map, day) as Record<string, unknown>)[field] = value;
      }
    } catch (e) { warnings.push(`${metric}: ${(e as Error).message}`); }
  }

  const posts: PostRow[] = [];
  try {
    const media = await graph(`${igUserId}/media`, token, { fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", limit: "25" });
    for (const m of (media.data as Json[]) ?? []) {
      const post: PostRow = {
        externalId: String(m.id), url: (m.permalink as string) ?? null, caption: ((m.caption as string) ?? "").slice(0, 280),
        mediaType: (m.media_type as string) ?? null, publishedAt: m.timestamp ? new Date(m.timestamp as string) : null,
        likes: Number(m.like_count ?? 0), comments: Number(m.comments_count ?? 0), reach: null, views: null, shares: null, saves: null,
      };
      try {
        const ins = await graph(`${m.id}/insights`, token, { metric: "reach,saved,shares,views" });
        for (const x of (ins.data as Json[]) ?? []) {
          const v = Number((x.values as { value: number }[])?.[0]?.value ?? 0);
          if (x.name === "reach") post.reach = v;
          if (x.name === "saved") post.saves = v;
          if (x.name === "shares") post.shares = v;
          if (x.name === "views") post.views = v;
        }
      } catch { /* publicaciones viejas o historias no tienen insights */ }
      posts.push(post);
    }
  } catch (e) { warnings.push(`publicaciones: ${(e as Error).message}`); }

  return { daily: [...map.values()], posts, ads: [], campaignMeta: {}, warnings };
}

/**
 * Las métricas de página (/{page}/insights) exigen un token DE PÁGINA. Con el token del usuario del sistema
 * se pide el de la página (requiere que la página esté asignada a ese usuario). Si no se puede, se usa el original
 * y el error de Meta queda como aviso.
 */
export async function pageAccessToken(pageId: string, token: string): Promise<{ token: string; warning?: string }> {
  try {
    const r = await graph(pageId, token, { fields: "access_token" });
    if (typeof r.access_token === "string" && r.access_token) return { token: r.access_token };
    return { token, warning: "Meta no devolvió token de página: asigna la página al usuario del sistema (control total)." };
  } catch (e) {
    return { token, warning: `token de página: ${(e as Error).message}` };
  }
}

/** Página de Facebook: con el token del usuario del sistema se obtiene el de la página. */
export async function syncFacebookPage(pageId: string, systemToken: string, days: string[], today: string): Promise<MetaSync> {
  const warnings: string[] = [];
  const map = new Map<string, OrganicRow>();
  const pt = await pageAccessToken(pageId, systemToken);
  const token = pt.token;
  if (pt.warning) warnings.push(pt.warning);
  try {
    const p = await graph(pageId, token, { fields: "followers_count" });
    rowFor(map, today).followers = Number(p.followers_count ?? 0);
  } catch (e) { warnings.push(`seguidores: ${(e as Error).message}`); }
  const metrics: [keyof OrganicRow, string][] = [["reach", "page_impressions_unique"], ["engagements", "page_post_engagements"], ["profileViews", "page_views_total"]];
  for (const [field, metric] of metrics) {
    try {
      const r = await graph(`${pageId}/insights`, token, { metric, period: "day", since: unix(days[0]), until: unix(days[days.length - 1], true) });
      for (const m of (r.data as Json[]) ?? []) {
        for (const v of (m.values as { value: number; end_time: string }[]) ?? []) (rowFor(map, dayOfEndTime(v.end_time)) as Record<string, unknown>)[field] = v.value;
      }
    } catch (e) { warnings.push(`${metric}: ${(e as Error).message}`); }
  }
  return { daily: [...map.values()], posts: [], ads: [], campaignMeta: {}, warnings };
}

const LEAD_ACTIONS = new Set(["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"]);
const CONVERSION_ACTIONS = new Set(["complete_registration", "offsite_conversion.fb_pixel_complete_registration", "offsite_conversion.fb_pixel_purchase", "purchase"]);

/** Meta Ads por campaña y día. El gasto viene en la moneda de la cuenta publicitaria (debe ser MXN). */
export async function syncMetaAds(adAccountId: string, token: string, since: string, until: string): Promise<MetaSync> {
  const act = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const warnings: string[] = [];
  const campaignMeta: MetaSync["campaignMeta"] = {};
  try {
    const acc = await graph(act, token, { fields: "currency" });
    if (acc.currency && acc.currency !== "MXN") warnings.push(`La cuenta publicitaria está en ${acc.currency}; los montos se muestran como MXN.`);
    for await (const batch of pages(`${act}/campaigns`, token, { fields: "id,objective,effective_status", limit: "100" })) {
      for (const c of batch) campaignMeta[String(c.id)] = { objective: c.objective as string, status: c.effective_status as string };
    }
  } catch (e) { warnings.push(`campañas: ${(e as Error).message}`); }

  const ads: AdRow[] = [];
  for await (const batch of pages(`${act}/insights`, token, {
    level: "campaign", time_increment: "1", time_range: JSON.stringify({ since, until }), limit: "500",
    fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,date_start",
  })) {
    for (const r of batch) {
      const actions = (r.actions as { action_type: string; value: string }[]) ?? [];
      const sum = (set: Set<string>) => actions.filter((a) => set.has(a.action_type)).reduce((s, a) => s + Number(a.value), 0);
      ads.push({
        day: String(r.date_start), campaign: String(r.campaign_name), campaignId: String(r.campaign_id),
        spendCents: Math.round(Number(r.spend ?? 0) * 100), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
        leads: sum(LEAD_ACTIONS), conversions: sum(CONVERSION_ACTIONS),
      });
    }
  }
  return { daily: [], posts: [], ads, campaignMeta, warnings };
}
