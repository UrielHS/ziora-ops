/**
 * Semilla de los DM de redes sociales: RP1–RP3 (psicólogos) y RI1–RI3 (influencers). Textos aprobados por Chris el 12-nov-2026.
 *
 *   export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); npx tsx dev/seed-mensajes-redes.ts
 *
 * Idempotente: los mensajes se buscan por `key`. Re-correrla restaura el texto aprobado (pisa ediciones hechas en la app).
 * Ale ajusta cada DM a mano a la persona antes de mandarlo: no se mandan iguales en serie.
 */
import { eq, ilike } from "drizzle-orm";
import type { Db } from "@/db";
import { baseMessages } from "@/db/schema";
import { users } from "@/db/shared";
import type { SeedBaseMessage } from "./seed-comunidades";

const APPROVED_AT_SOCIAL = new Date("2026-11-12T12:00:00Z");

export const SOCIAL_MESSAGES: SeedBaseMessage[] = [
  {
    key: "RP1", angle: "Psicólogo · primer contacto", isPost: false,
    body: "Hola, {nombre}. Soy {yo}, del equipo de Ziora. Vi tu consulta aquí en {red} y por eso te escribo. Hicimos un asistente para psicólogos que transcribe la sesión y te propone la nota clínica; tú la revisas y decides qué queda, y los datos de tus pacientes se guardan cifrados. ¿Te gustaría probarlo un mes en tu consulta? Es gratis y no pide tarjeta: {liga} Si no es para ti, no pasa nada; gracias por leerme.",
  },
  {
    key: "RP2", angle: "Psicólogo · seguimiento a los 4 días", isPost: false,
    body: "Hola, {nombre}. Te dejo de nuevo la invitación por si se perdió entre tus mensajes: un mes de Ziora Pro gratis, sin tarjeta, para que veas si te quita tiempo de notas. {liga} Cualquier duda, aquí estoy.",
  },
  {
    key: "RP3", angle: "Psicólogo · último seguimiento a los 7 días", isPost: false,
    body: "Hola, {nombre}. Es mi último mensaje, no quiero llenarte la bandeja. Si más adelante quieres probar Ziora en tu consulta, la invitación de un mes gratis sigue abierta: {liga} Gracias por tu tiempo.",
  },
  {
    key: "RI1", angle: "Influencer · primer contacto", isPost: false,
    body: "Hola, {nombre}. Soy {yo}, del equipo de Ziora. Vi tu contenido de psicología en {red} y por eso te escribo. Hicimos un asistente para psicólogos que transcribe la sesión y propone la nota clínica; el psicólogo la revisa y decide qué queda, y los datos de los pacientes se guardan cifrados. Nos gustaría que lo pruebes en tu consulta: son dos meses de Pro gratis, sin tarjeta: {liga} Y te lo digo desde ahora: si te gusta y quieres recomendarlo a tu audiencia, hay compensación, ya sea una comisión de la suscripción o un pago por contenido, según lo que te acomode. Primero queremos que lo uses y nos digas con honestidad qué te parece.",
  },
  {
    key: "RI2", angle: "Influencer · seguimiento a los 4 días", isPost: false,
    body: "Hola, {nombre}. Paso de nuevo por si no viste mi mensaje: te invitamos a probar Ziora dos meses gratis en tu consulta, sin tarjeta: {liga} Nos interesa tu opinión sincera; y si después quieres recomendarlo, platicamos la compensación.",
  },
  {
    key: "RI3", angle: "Influencer · último seguimiento a los 7 días", isPost: false,
    body: "Hola, {nombre}. Es mi último mensaje. La invitación a probar Ziora dos meses sin costo sigue abierta: {liga} Si prefieres que te cuente más antes de probarlo, dime y te explico por aquí. Gracias por tu tiempo.",
  },
];

export async function seedMensajesRedes(db: Db): Promise<{ created: number; updated: number }> {
  // Mismo patrón que seed-comunidades: el id de Chris se busca por nombre; en una base local vacía queda null.
  const [chris] = await db.select({ id: users.id }).from(users).where(ilike(users.name, "chris%")).limit(1);
  const approvedBy = chris?.id ?? null;
  let created = 0, updated = 0;
  for (const m of SOCIAL_MESSAGES) {
    const values = { angle: m.angle, body: m.body, isPost: m.isPost, status: "aprobado" as const, approvedBy, approvedAt: APPROVED_AT_SOCIAL };
    const [cur] = await db.select({ id: baseMessages.id }).from(baseMessages).where(eq(baseMessages.key, m.key)).limit(1);
    if (cur) { await db.update(baseMessages).set(values).where(eq(baseMessages.id, cur.id)); updated++; }
    else { await db.insert(baseMessages).values({ key: m.key, ...values }); created++; }
  }
  return { created, updated };
}

// CLI: solo cuando se ejecuta este archivo directamente (las pruebas lo importan).
if (process.argv[1] && /seed-mensajes-redes\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  (async () => {
    const { db } = await import("@/db");
    const r = await seedMensajesRedes(db);
    console.log(`mensajes de redes: created: ${r.created}, updated: ${r.updated}`);
    process.exit(0);
  })().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
