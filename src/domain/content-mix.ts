/**
 * Mezcla de contenido del mes: qué porcentaje de piezas va a cada grupo de pilares.
 * La meta se edita desde el calendario y se guarda en ops.settings (clave "content_mix").
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { settings } from "@/db/schema";

export const MIX_GROUPS = [
  { key: "education", label: "Educación", pillars: ["ia_psicoterapia", "estudios", "psicoterapia_moderna"] },
  { key: "entertainment", label: "Entretenimiento (memes)", pillars: ["memes"] },
  { key: "product", label: "Datos del producto", pillars: ["producto", "roi"] },
] as const;

export type MixKey = (typeof MIX_GROUPS)[number]["key"];
export type ContentMix = Record<MixKey, number>;

export const DEFAULT_MIX: ContentMix = { education: 40, entertainment: 40, product: 20 };
const KEY = "content_mix";

export function validateMix(mix: ContentMix) {
  const values = Object.values(mix);
  if (values.some((v) => !Number.isInteger(v) || v < 0 || v > 100)) throw new Error("Cada porcentaje debe ser un número entero de 0 a 100.");
  const total = values.reduce((a, b) => a + b, 0);
  if (total !== 100) throw new Error(`Los porcentajes deben sumar 100 (ahora suman ${total}).`);
}

export async function getContentMix(db: Db): Promise<ContentMix> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  return { ...DEFAULT_MIX, ...((row?.value as Partial<ContentMix> | undefined) ?? {}) };
}

export async function saveContentMix(db: Db, userId: string, mix: ContentMix) {
  validateMix(mix);
  await db.insert(settings).values({ key: KEY, value: mix, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: mix, updatedBy: userId, updatedAt: new Date() } });
}

/** Porcentaje real del mes por grupo (sobre las piezas no descartadas). */
export function actualMix(pieces: { pillar: string }[]): ContentMix {
  const total = pieces.length || 1;
  const pct = (pillars: readonly string[]) => Math.round((pieces.filter((p) => pillars.includes(p.pillar)).length / total) * 100);
  return Object.fromEntries(MIX_GROUPS.map((g) => [g.key, pct(g.pillars)])) as ContentMix;
}
