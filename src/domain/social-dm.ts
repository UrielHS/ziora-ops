import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Dbx } from "@/db";
import { baseMessages, contactActivities, contacts } from "@/db/schema";
import { advanceLead, logActivity, type Actor } from "./leads";
import type { SocialLeadType, SocialPlatform } from "./social-leads";

/** Llaves de los mensajes de DM por tipo de lead y paso (1 = primer contacto, 2 = a los 4 días, 3 = a los 7). */
export const DM_KEYS = {
  psicologo: ["RP1", "RP2", "RP3"],
  influencer: ["RI1", "RI2", "RI3"],
} as const;

/** Paso que toca según los DMs ya mandados; `null` si ya se mandaron los tres. */
export function dmStep(sent: number): 1 | 2 | 3 | null {
  if (!Number.isInteger(sent) || sent < 0 || sent > 2) return null;
  return (sent + 1) as 1 | 2 | 3;
}

const PLATFORM_LABEL: Record<SocialPlatform, string> = { instagram: "Instagram", tiktok: "TikTok" };

export function renderDm(body: string, v: { nombre: string; yo: string; liga: string; red: string }): string {
  return body.replaceAll("{nombre}", v.nombre).replaceAll("{yo}", v.yo).replaceAll("{liga}", v.liga).replaceAll("{red}", v.red);
}

/** Ajusta una fila de contacts a lo que pide `dmFor` (la columna admite plataformas que no son de DM). */
export function dmLead(c: { name: string; socialLeadType: SocialLeadType | null; socialPlatform: string | null }) {
  return { name: c.name, socialLeadType: c.socialLeadType, socialPlatform: (c.socialPlatform === "instagram" || c.socialPlatform === "tiktok" ? c.socialPlatform : null) as SocialPlatform | null };
}

/** Mensaje que toca para este lead. `text: null` = ese mensaje no está aprobado; `null` = ya no hay más pasos. */
export function dmFor(
  lead: { name: string; socialLeadType: SocialLeadType | null; socialPlatform: SocialPlatform | null },
  sent: number,
  messages: { key: string; body: string; status: string }[],
  v: { yo: string; liga: string },
): { key: string; step: 1 | 2 | 3; text: string | null } | null {
  const step = dmStep(sent);
  if (!step) return null;
  const key = DM_KEYS[lead.socialLeadType ?? "psicologo"][step - 1];
  const m = messages.find((x) => x.key === key);
  if (!m || m.status !== "aprobado") return { key, step, text: null };
  const red = lead.socialPlatform ? PLATFORM_LABEL[lead.socialPlatform] : "redes";
  return { key, step, text: renderDm(m.body, { nombre: lead.name, yo: v.yo, liga: v.liga, red }) };
}

// ---------- «Le escribí»: registrar el DM ----------

/** Días después del DM 1, 2 y 3 en que toca el siguiente paso. */
export const FOLLOWUP_DAYS = [4, 7, 14] as const;
export { DM_DAILY_WARN } from "./social-shared";
/** Dos «Le escribí» del mismo lead dentro de esta ventana se cuentan como uno (doble clic). */
export const DM_DEDUP_SECONDS = 120;

const NEXT_ACTION = ["Seguimiento 1 por DM", "Último seguimiento por DM", "Sin respuesta tras 3 mensajes: decidir si se marca perdido"] as const;
const DM_KIND = sql`${contactActivities.meta}->>'kind' = 'social_dm'`;
const cdmxDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }); // YYYY-MM-DD en CDMX

/**
 * Registra que se mandó el DM que tocaba: nota saliente, pasa a contactado (sin retroceder) y programa el seguimiento.
 * Una transacción con `for update` sobre el contacto ordena los envíos simultáneos; un segundo clic dentro de
 * DM_DEDUP_SECONDS no cuenta ni salta el paso (devuelve el paso ya registrado).
 */
export async function recordDm(db: Db, contactId: string, actor: Actor, now = new Date()): Promise<{ recorded: boolean; step: 1 | 2 | 3 | null }> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ platform: contacts.socialPlatform, handle: contacts.socialHandle, type: contacts.socialLeadType })
      .from(contacts).where(eq(contacts.id, contactId)).limit(1).for("update");
    if (!c) throw new Error("El contacto no existe.");
    if (!c.handle || !c.platform) throw new Error("Este contacto no tiene usuario de redes.");

    const dms = await tx.select({ occurredAt: contactActivities.occurredAt, meta: contactActivities.meta })
      .from(contactActivities).where(and(eq(contactActivities.contactId, contactId), DM_KIND)).orderBy(desc(contactActivities.occurredAt));
    const last = dms[0];
    if (last && Math.abs(now.getTime() - last.occurredAt.getTime()) < DM_DEDUP_SECONDS * 1000) {
      return { recorded: false, step: (last.meta as { step?: 1 | 2 | 3 }).step ?? null };
    }
    const step = dmStep(dms.length);
    if (!step) return { recorded: false, step: null };

    const key = DM_KEYS[c.type ?? "psicologo"][step - 1];
    const on = cdmxDate(new Date(now.getTime() + FOLLOWUP_DAYS[step - 1] * 24 * 60 * 60 * 1000));
    await tx.update(contacts).set({ lastContactAt: now, nextAction: NEXT_ACTION[step - 1], nextActionOn: on }).where(eq(contacts.id, contactId));
    await advanceLead(tx, contactId, "contactado", actor, { via: "dm" });
    await logActivity(tx, {
      contactId, type: "nota", direction: "saliente", actor, summary: `DM ${step} por ${PLATFORM_LABEL[c.platform as SocialPlatform] ?? c.platform}`,
      meta: { kind: "social_dm", step, key }, occurredAt: now,
    });
    return { recorded: true, step };
  });
}

/** Los seis mensajes R* (una consulta por render; se reparten a todas las filas). */
export async function loadDmMessages(db: Dbx): Promise<{ key: string; body: string; status: string }[]> {
  return db.select({ key: baseMessages.key, body: baseMessages.body, status: baseMessages.status })
    .from(baseMessages).where(inArray(baseMessages.key, [...DM_KEYS.psicologo, ...DM_KEYS.influencer]));
}

/** DMs registrados por lead (los que no tienen ninguno no aparecen en el mapa). */
export async function dmCounts(db: Dbx, contactIds: string[]): Promise<Map<string, number>> {
  if (!contactIds.length) return new Map();
  const rows = await db.select({ id: contactActivities.contactId, n: sql<number>`count(*)::int` })
    .from(contactActivities).where(and(inArray(contactActivities.contactId, contactIds), DM_KIND)).groupBy(contactActivities.contactId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** DMs que esta persona registró en el día de CDMX de `now`. */
export async function dmsSentToday(db: Dbx, userId: string, now = new Date()): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(contactActivities).where(and(
    eq(contactActivities.actorId, userId), DM_KIND,
    sql`(${contactActivities.occurredAt} at time zone 'America/Mexico_City')::date = ${cdmxDate(now)}::date`,
  ));
  return r?.n ?? 0;
}
