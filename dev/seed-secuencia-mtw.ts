/**
 * Semilla de la secuencia «MTW 4 toques» (leads de Mexico Tech Week). Textos legibles y reglas en docs/secuencia-mtw.md.
 *
 *   export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); npx tsx dev/seed-secuencia-mtw.ts
 *
 * Idempotente: busca la secuencia y las plantillas por nombre. Si existen, actualiza textos y pasos (por posición) sin crear
 * duplicados ni tocar enrollments. Sirve igual en local y, con el túnel de Cloud SQL y el OK de Chris, en producción.
 */
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db";
import { emailTemplates, sequences, sequenceSteps, type SequenceChannel } from "@/db/schema";

export type SeedStep = {
  position: number;
  dayOffset: number;
  channel: SequenceChannel;
  template?: { name: string; subject: string; html: string };
  whatsappText?: string;
};

const FIRMA = "<p>{{remitente}}<br>Ziora</p>";
const BAJA = '<p style="font-size:12px;color:#888">Si prefieres no recibir más correos míos, <a href="{{{baja}}}">date de baja aquí</a>.</p>';

export const MTW_SEQUENCE: { name: string; maxTouches: number; steps: SeedStep[] } = {
  name: "MTW 4 toques",
  maxTouches: 4,
  steps: [
    {
      position: 1, dayOffset: 0, channel: "email",
      template: {
        name: "MTW · Toque 1 · Nos vimos en Mexico Tech Week",
        subject: "{{nombre}}, nos vimos en Mexico Tech Week",
        html: [
          "<p>Hola {{nombre}},</p>",
          "<p>Soy {{remitente}}, de Ziora. Coincidimos en Mexico Tech Week, en el panel y el taller de IA para terapeutas, y quería seguir la plática.</p>",
          "<p>Ziora escucha tu sesión y en minutos te deja la nota clínica, el plan de tratamiento y un resumen del caso listos para revisar y aprobar. El audio se borra en cuanto apruebas la nota y todo va cifrado.</p>",
          "<p>¿Te late que te lo enseñe en una llamada de 15 minutos? Responde este correo con un día y hora que te acomoden y lo agendamos.</p>",
          "<p>Un abrazo,</p>", FIRMA, BAJA,
        ].join("\n"),
      },
    },
    {
      position: 2, dayOffset: 3, channel: "whatsapp",
      whatsappText: "Hola {{nombre}}, soy {{remitente}} de Ziora. Te escribí por correo hace unos días: nos vimos en Mexico Tech Week, en el taller de IA para terapeutas. ¿Te late que te enseñe Ziora en 15 minutos? Tú dime día y hora y yo me acomodo.",
    },
    {
      position: 3, dayOffset: 7, channel: "email",
      template: {
        name: "MTW · Toque 3 · 15 minutos para enseñarte Ziora",
        subject: "15 minutos para enseñarte Ziora, {{nombre}}",
        html: [
          "<p>Hola {{nombre}},</p>",
          "<p>Te escribo de nuevo porque sé lo que cuesta ponerse al día con las notas después de una semana de consulta.</p>",
          "<p>Con Ziora grabas la sesión, revisas la nota que te propone y la apruebas; la idea es devolverte horas cada semana y que el expediente quede completo. Hay cuenta gratuita para empezar, sin tarjeta.</p>",
          "<p>Si quieres verlo funcionando, respóndeme con un hueco de 15 minutos esta semana o la próxima. Si prefieres probarlo tú, dime y te mando la liga.</p>",
          "<p>Saludos,</p>", FIRMA, BAJA,
        ].join("\n"),
      },
    },
    {
      position: 4, dayOffset: 14, channel: "whatsapp",
      whatsappText: "Hola {{nombre}}, soy {{remitente}} de Ziora. Este es mi último mensaje: no te vuelvo a escribir, pero aquí quedo. Si algún día quieres probar Ziora o verlo en 15 minutos, mándame un mensaje y lo armamos. Gracias por tu tiempo y mucho éxito con tu consulta.",
    },
  ],
};

async function upsertTemplate(db: Db, t: NonNullable<SeedStep["template"]>): Promise<string> {
  const [existing] = await db.select({ id: emailTemplates.id }).from(emailTemplates).where(eq(emailTemplates.name, t.name)).limit(1);
  if (existing) {
    await db.update(emailTemplates).set({ subject: t.subject, html: t.html }).where(eq(emailTemplates.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(emailTemplates).values({ name: t.name, subject: t.subject, html: t.html, createdBy: null }).returning({ id: emailTemplates.id });
  return row.id;
}

/** Crea o actualiza la secuencia. Los pasos se actualizan por posición (no se borran) para no soltar el pending_step_id de un enrollment activo. */
export async function seedMtwSequence(db: Db, def = MTW_SEQUENCE): Promise<{ sequenceId: string; created: boolean }> {
  const [existing] = await db.select({ id: sequences.id }).from(sequences).where(eq(sequences.name, def.name)).limit(1);
  let sequenceId: string;
  if (existing) {
    sequenceId = existing.id;
    await db.update(sequences).set({ maxTouches: def.maxTouches, active: true }).where(eq(sequences.id, sequenceId));
  } else {
    const [row] = await db.insert(sequences).values({ name: def.name, maxTouches: def.maxTouches, active: true, stopOnReply: true, createdBy: null }).returning({ id: sequences.id });
    sequenceId = row.id;
  }
  for (const s of def.steps) {
    const emailTemplateId = s.template ? await upsertTemplate(db, s.template) : null;
    const values = { dayOffset: s.dayOffset, channel: s.channel, emailTemplateId, whatsappText: s.whatsappText ?? null };
    const [step] = await db.select({ id: sequenceSteps.id }).from(sequenceSteps).where(and(eq(sequenceSteps.sequenceId, sequenceId), eq(sequenceSteps.position, s.position))).limit(1);
    if (step) await db.update(sequenceSteps).set(values).where(eq(sequenceSteps.id, step.id));
    else await db.insert(sequenceSteps).values({ sequenceId, position: s.position, ...values });
  }
  // Pasos sobrantes de una versión anterior más larga (hoy no hay): se quitan solo si están después del último definido.
  await db.delete(sequenceSteps).where(and(eq(sequenceSteps.sequenceId, sequenceId), gt(sequenceSteps.position, def.steps.length)));
  return { sequenceId, created: !existing };
}

// CLI: solo cuando se ejecuta este archivo directamente (las pruebas lo importan).
if (process.argv[1] && /seed-secuencia-mtw\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  (async () => {
    const { db } = await import("@/db");
    const r = await seedMtwSequence(db);
    console.log(`secuencia «${MTW_SEQUENCE.name}»: ${r.created ? "creada" : "actualizada"} (${r.sequenceId})`);
    process.exit(0);
  })().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
