/**
 * Perfil del vendedor: sus ligas personales (referido de la app, calendario, código de descuento) y cómo se arma la
 * liga de referido con UTM para mandarla desde la ficha de un lead. Spec: docs/superpowers/specs/2026-11-10-herramientas-vendedor-design.md
 */
import { eq } from "drizzle-orm";
import type { Dbx } from "@/db";
import { sellerProfiles, type SellerProfile } from "@/db/schema";

/** Código de referido = último segmento de `https://ziora-copilot.com/r/<código>`, en mayúsculas. Null si la liga no tiene /r/. */
export function referralCodeFrom(url: string | null | undefined): string | null {
  if (!url) return null;
  let path: string;
  try { path = new URL(url).pathname; } catch { return null; }
  const m = /\/r\/([A-Za-z0-9-]+)\/?$/.exec(path);
  return m ? m[1].toUpperCase() : null;
}

/** Liga de referido con los UTM de Ops: fuente ziora_ops, medio vendedor, campaña por origen del lead, contenido = código. */
export function referralLinkWithUtm(url: string, opts: { campaign: string; code: string | null }): string {
  const params = new URLSearchParams({ utm_source: "ziora_ops", utm_medium: "vendedor", utm_campaign: opts.campaign });
  if (opts.code) params.set("utm_content", opts.code);
  return `${url}${url.includes("?") ? "&" : "?"}${params.toString()}`;
}

/** Campaña UTM según de dónde salió el lead: los de la hoja de Mexico Tech Week van aparte. */
export function utmCampaignFor(source: string | null | undefined): string {
  return source === "sheet_import" ? "mtw-2026" : "leads";
}

export type SellerProfileInput = { referralUrl?: string | null; bookingUrl?: string | null; discountCode?: string | null };

export async function getSellerProfile(db: Dbx, userId: string): Promise<SellerProfile | null> {
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, userId)).limit(1);
  return p ?? null;
}

export async function listSellerProfiles(db: Dbx): Promise<SellerProfile[]> {
  return db.select().from(sellerProfiles);
}

/** Crea o actualiza el perfil (un renglón por usuario). Cadenas vacías se guardan como null. */
export async function upsertSellerProfile(db: Dbx, userId: string, data: SellerProfileInput): Promise<SellerProfile> {
  const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  const values = { referralUrl: clean(data.referralUrl), bookingUrl: clean(data.bookingUrl), discountCode: clean(data.discountCode)?.toUpperCase() ?? null };
  const [row] = await db.insert(sellerProfiles).values({ userId, ...values })
    .onConflictDoUpdate({ target: sellerProfiles.userId, set: { ...values, updatedAt: new Date() } }).returning();
  return row;
}
