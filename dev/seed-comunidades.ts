/**
 * Semilla de Comunidades (Fase 1): campaña «Prueba de 1 mes · nov 2026» y mensajes base M0–M6 (spec §9, aprobados por Chris el 10-nov-2026).
 *
 *   export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); npx tsx dev/seed-comunidades.ts
 *
 * Idempotente: la campaña se busca por `slug` y los mensajes por `key`. Re-correrla restaura el texto aprobado.
 * El ajuste `community_lead_rr` (reparto de leads de comunidad entre Uriel y Chris) lo siembra la Tarea 7: aquí no se inventan ids de dueños.
 */
import { eq, ilike, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { baseMessages, communityCampaigns, settings } from "@/db/schema";
import { users } from "@/db/shared";

export const COMMUNITY_CAMPAIGN = {
  slug: "prueba-1-mes-202611",
  name: "Prueba de 1 mes · nov 2026",
  trialDays: 30,
  paidGoal: 10,
  seatLimit: 20,
  active: true,
} as const;

export const APPROVED_AT = new Date("2026-11-10T12:00:00Z");

export type SeedBaseMessage = { key: string; angle: string; isPost: boolean; body: string };

export const BASE_MESSAGES: SeedBaseMessage[] = [
  {
    key: "M0", angle: "Pedir permiso al admin", isPost: false,
    body: "Hola, {admin}. Soy {nombre}, del equipo de Ziora, una herramienta para psicólogos que ayuda con las notas de sesión. Antes de publicar nada quería preguntarte si el grupo permite compartir una invitación a probarla gratis; buscamos opiniones de colegas, no vender. Si no se puede, lo respeto sin problema. Gracias.",
  },
  {
    key: "M1", angle: "Pedir un favor", isPost: true,
    body: "Hola, colegas. Soy {nombre}, del equipo de Ziora. Nuestro fundador, Chris, creó una herramienta que transcribe la sesión y te propone la nota clínica para que tú la revises. La hicimos pensando primero en la privacidad: los datos de tus pacientes se guardan cifrados. Vengo a pedirles un favor más que a vender: ¿la probarían un mes y nos dirían qué le falta? Es gratis y no pide tarjeta. {liga}",
  },
  {
    key: "M2", angle: "El tiempo de las notas", isPost: true,
    body: "Una pregunta honesta para quienes dan consulta: ¿cuánto tiempo se les va en las notas después de cada sesión? Soy {nombre}, trabajo en Ziora, un asistente que escribe el borrador de la nota a partir de la sesión; tú lo corriges y decides qué queda. Queremos saber si de verdad ayuda. Hay un mes completo gratis, sin tarjeta, y al final nos encantaría su opinión, buena o mala. {liga}",
  },
  {
    key: "M3", angle: "Privacidad primero", isPost: true,
    body: "Sé que usar IA con información de pacientes genera dudas, y con razón. Soy {nombre}, del equipo de Ziora. Cuando Chris empezó a construirla, lo primero que resolvió fue cómo proteger los datos: se guardan cifrados y tú controlas la nota final. Si quieren ver cómo lo hicimos y decirnos qué les preocupa, pueden probarla un mes sin costo y sin tarjeta. Sus dudas nos sirven tanto como sus elogios. {liga}",
  },
  {
    key: "M4", angle: "Hecho aquí, con psicólogos", isPost: true,
    body: "Hola a todas y todos. Soy {nombre}, de Ziora, un proyecto mexicano que construimos junto con psicólogos clínicos. Hace una cosa: acompaña tu sesión y te deja lista una propuesta de nota para que no la escribas desde cero. Estamos empezando y lo que más necesitamos es que colegas la usen y nos digan la verdad. Un mes gratis, sin tarjeta; si después no te sirve, te quedas en el plan gratuito y no pierdes nada. {liga}",
  },
  {
    key: "M5", angle: "Corto, para WhatsApp", isPost: true,
    body: "Hola, soy {nombre}, del equipo de Ziora. Hicimos un asistente que redacta la nota clínica a partir de la sesión, con los datos de tus pacientes cifrados. ¿Nos ayudas a probarlo? Un mes gratis, sin tarjeta, y nos cuentas qué mejorarías: {liga}",
  },
  {
    key: "M6", angle: "Buscamos opiniones, no clientes", isPost: true,
    body: "Buscamos a 20 psicólogas y psicólogos que quieran decirnos en qué nos equivocamos. Soy {nombre}, de Ziora: un asistente que transcribe la sesión y propone la nota, hecho con la privacidad como base. Les damos un mes completo sin costo y sin tarjeta; a cambio pedimos su opinión sincera a la mitad y al final del mes. Si les interesa: {liga}",
  },
];

/** Resuelve correos de `public.users` a ids, en el orden dado. Falla si alguno no existe. */
export async function resolveOwnerIds(db: Db, emails: string[]): Promise<string[]> {
  const wanted = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) throw new Error("--owners necesita al menos un correo");
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, wanted));
  const byEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r.id]));
  const missing = wanted.filter((e) => !byEmail.has(e));
  if (missing.length) throw new Error(`No existe en public.users: ${missing.length} de los correos de --owners (${missing.map((_, i) => `#${wanted.indexOf(missing[i]) + 1}`).join(", ")})`);
  return wanted.map((e) => byEmail.get(e)!);
}

export async function seedComunidades(db: Db, opts: { owners?: string[] } = {}): Promise<{ campaignCreated: boolean; messagesCreated: number; messagesUpdated: number }> {
  // Se resuelven primero: si falta alguien, no se siembra nada a medias.
  const ownerIds = opts.owners?.length ? await resolveOwnerIds(db, opts.owners) : null;
  // `approved_by` es un id de usuario de Ops: se resuelve el de Chris por nombre; si no existe (base local vacía), queda null.
  const [chris] = await db.select({ id: users.id }).from(users).where(ilike(users.name, "chris%")).limit(1);
  const approvedBy = chris?.id ?? null;

  const [camp] = await db.select({ id: communityCampaigns.id }).from(communityCampaigns).where(eq(communityCampaigns.slug, COMMUNITY_CAMPAIGN.slug)).limit(1);
  if (camp) await db.update(communityCampaigns).set({ ...COMMUNITY_CAMPAIGN }).where(eq(communityCampaigns.id, camp.id));
  else await db.insert(communityCampaigns).values({ ...COMMUNITY_CAMPAIGN });

  let messagesCreated = 0, messagesUpdated = 0;
  for (const m of BASE_MESSAGES) {
    const values = { angle: m.angle, body: m.body, isPost: m.isPost, status: "aprobado" as const, approvedBy, approvedAt: APPROVED_AT };
    const [cur] = await db.select({ id: baseMessages.id }).from(baseMessages).where(eq(baseMessages.key, m.key)).limit(1);
    if (cur) { await db.update(baseMessages).set(values).where(eq(baseMessages.id, cur.id)); messagesUpdated++; }
    else { await db.insert(baseMessages).values({ key: m.key, ...values }); messagesCreated++; }
  }
  if (ownerIds) {
    // Reparto de leads de comunidad: solo estos dueños, alternados. Si ya había turno, se conserva (acotado al nuevo largo).
    const [cur] = await db.select().from(settings).where(eq(settings.key, "community_lead_rr")).limit(1);
    const prev = (cur?.value as { last?: number } | undefined)?.last;
    const last = typeof prev === "number" && prev < ownerIds.length ? prev : -1;
    await db.insert(settings).values({ key: "community_lead_rr", value: { ownerIds, last } })
      .onConflictDoUpdate({ target: settings.key, set: { value: { ownerIds, last } } });
  }
  return { campaignCreated: !camp, messagesCreated, messagesUpdated };
}

// CLI: solo cuando se ejecuta este archivo directamente (las pruebas lo importan).
if (process.argv[1] && /seed-comunidades\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  (async () => {
    const { db } = await import("@/db");
    const arg = process.argv.find((a) => a.startsWith("--owners="));
    const r = await seedComunidades(db, { owners: arg ? arg.slice("--owners=".length).split(",") : undefined });
    console.log(`campaña «${COMMUNITY_CAMPAIGN.slug}»: ${r.campaignCreated ? "creada" : "actualizada"}; mensajes: ${r.messagesCreated} creados, ${r.messagesUpdated} actualizados`);
    process.exit(0);
  })().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
