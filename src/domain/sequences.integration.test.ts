/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base con ambos schemas (PGlite local, nunca producción). */
import { and, eq, inArray, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

describe.runIf(enabled)("cadencia: esquema", () => {
  it("un contacto no puede tener dos enrollments activos en la misma secuencia", async () => {
    const { db } = await import("@/db");
    const { sequences, sequenceEnrollments } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const t = Date.now();
    const [seq] = await db.insert(sequences).values({ name: `Prueba ${t}` }).returning();
    const { id } = await upsertContact(db, { name: "Enrolado", email: `enr${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "nuevo" });
    await db.insert(sequenceEnrollments).values({ contactId: id, sequenceId: seq.id });
    // drizzle envuelve el error de Postgres ("Failed query…"); el detalle viene en cause.
    const err = await db.insert(sequenceEnrollments).values({ contactId: id, sequenceId: seq.id }).then(() => null, (e: unknown) => e as Error & { cause?: Error });
    expect(err).not.toBeNull();
    expect(`${err?.cause?.message ?? ""} ${err?.message}`).toMatch(/enrollments_active_unique|duplicate key/);
    await db.update(sequenceEnrollments).set({ status: "terminada" }).where(eq(sequenceEnrollments.contactId, id));
    await db.insert(sequenceEnrollments).values({ contactId: id, sequenceId: seq.id }); // ya no choca
  });
});

// ---------------------------------------------------------------------------
// Dominio: enrolar, correr el job, paradas y toques pendientes
// ---------------------------------------------------------------------------
process.env.APP_URL ??= "http://localhost:3001";
process.env.UNSUBSCRIBE_SECRET ??= "test";
process.env.MAIL_FROM ??= "Ziora <hola@test>";

const NOW = new Date("2026-11-10T10:00:00-06:00"); // martes 10:00 CDMX, dentro de la ventana
const DAY = 24 * 60 * 60 * 1000;

type StepSpec = { dayOffset: number; channel: "email" | "whatsapp"; text?: string };
const DEFAULT_STEPS: StepSpec[] = [
  { dayOffset: 0, channel: "email" },
  { dayOffset: 3, channel: "whatsapp", text: "Hola {{nombre}}, soy {{remitente}}" },
  { dayOffset: 7, channel: "email" },
  { dayOffset: 14, channel: "whatsapp", text: "¿Sigue en pie, {{nombre}}?" },
];

async function setup() {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const { users } = await import("@/db/shared");
  const contactsMod = await import("./contacts");
  const leadsMod = await import("./leads");
  const seqMod = await import("./sequences");
  const { firstName } = await import("./template");
  const [owner] = await db.select({ id: users.id, name: users.name }).from(users).limit(1);
  const t = Date.now() + Math.floor(Math.random() * 1000);
  // Corridas anteriores (o rotas) dejan enrollments activos de leads de prueba: se detienen para que los conteos sean de esta prueba.
  await db.update(schema.sequenceEnrollments).set({ status: "detenida", stopReason: "prueba" }).where(and(
    eq(schema.sequenceEnrollments.status, "activa"),
    inArray(schema.sequenceEnrollments.contactId, db.select({ id: schema.contacts.id }).from(schema.contacts).where(like(schema.contacts.email, "cad%@example.com"))),
  ));

  async function mkSequence(steps: StepSpec[] = DEFAULT_STEPS, opts: { maxTouches?: number } = {}) {
    const [tpl] = await db.insert(schema.emailTemplates).values({ name: `Tpl ${t}`, subject: "Hola {{nombre}}", html: '<p>{{nombre}} <a href="{{{baja}}}">baja</a></p>' }).returning();
    const [seq] = await db.insert(schema.sequences).values({ name: `MTW ${t}-${Math.random()}`, maxTouches: opts.maxTouches ?? 4 }).returning();
    const rows = await db.insert(schema.sequenceSteps).values(steps.map((s, i) => ({
      sequenceId: seq.id, position: i + 1, dayOffset: s.dayOffset, channel: s.channel,
      emailTemplateId: s.channel === "email" ? tpl.id : null, whatsappText: s.channel === "whatsapp" ? s.text ?? "Hola {{nombre}}" : null,
    }))).returning();
    return { seq, tpl, steps: rows.sort((a, b) => a.position - b.position) };
  }

  let n = 0;
  async function mkLead(opts: { leadStatus?: "nuevo" | "contactado" | "en_trial"; phone?: boolean; email?: boolean; ownerId?: string | null } = {}) {
    n++;
    const email = opts.email === false ? null : `cad${t}-${n}@example.com`;
    // 10 dígitos únicos por setup: seis del timestamp + el consecutivo. Con menos, chocaba con leads de corridas anteriores (phone_e164 es único).
    const phone = opts.phone === false ? null : `+52 55${String(t).slice(-6)}${String(n).padStart(2, "0")}`;
    const { id } = await contactsMod.upsertContact(db, {
      name: `Ana Lead ${n}`, email, phone, source: "manual", tags: ["lead"], leadStatus: opts.leadStatus ?? "nuevo", cityName: "CDMX",
      ownerId: opts.ownerId === undefined ? owner.id : opts.ownerId,
      consents: [{ channel: "email", source: "prueba" }, { channel: "whatsapp", source: "prueba" }],
    });
    return { id, email };
  }

  const sent: { from: string; emails: { to: string; subject: string; html: string }[] }[] = [];
  const fakeSend = async (from: string, emails: { to: string; subject: string; html: string }[]) => {
    sent.push({ from, emails });
    return emails.map((_, i) => `id-${i}`);
  };
  const actor = { userId: owner.id, label: owner.name };
  const enrollment = async (contactId: string) => (await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.contactId, contactId)))[0];
  const contact = async (id: string) => (await db.select().from(schema.contacts).where(eq(schema.contacts.id, id)))[0];
  const activities = async (id: string) => db.select().from(schema.contactActivities).where(eq(schema.contactActivities.contactId, id));
  const run = (o: { now?: Date } = {}) => seqMod.runSequences(db, { now: o.now ?? NOW, send: fakeSend });

  return { db, schema, contactsMod, leadsMod, seqMod, owner, ownerFirst: firstName(owner.name), mkSequence, mkLead, sent, actor, enrollment, contact, activities, run };
}

describe.runIf(enabled)("cadencia: enrolar y correr", () => {
  it("enrolar: solo nuevo/contactado, sin duplicar, deja actividad y programa el paso 0 para ya", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence();
    const a = await s.mkLead({ leadStatus: "nuevo" });
    const b = await s.mkLead({ leadStatus: "en_trial" });
    const c = await s.mkLead({ leadStatus: "contactado" });
    await s.seqMod.enroll(s.db, [c.id], seq.id, s.actor, NOW);
    const r = await s.seqMod.enroll(s.db, [a.id, b.id, c.id], seq.id, s.actor, NOW);
    expect(r.enrolled).toBe(1);
    expect(r.skipped.map((x) => x.reason).sort()).toEqual(["estado", "ya_enrolado"]);
    const e = await s.enrollment(a.id);
    expect(e).toMatchObject({ status: "activa", currentStep: 1, touches: 0, enrolledBy: s.owner.id });
    expect(e.nextRunAt!.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect((await s.activities(a.id)).some((x) => x.type === "secuencia" && /Enrolado/.test(x.summary))).toBe(true);
  });

  it("paso de correo: manda con liga de baja, deja toque, pasa a contactado y programa el WhatsApp del día 3 a las 10:00", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence();
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    const r = await s.run();
    expect(r.sent).toBe(1);
    expect(s.sent[0].emails[0].to).toBe(a.email);
    expect(s.sent[0].emails[0].subject).toBe("Hola Ana");
    expect(s.sent[0].emails[0].html).toContain("/api/unsubscribe?t=");
    const c = await s.contact(a.id);
    expect(c.leadStatus).toBe("contactado");
    expect(c.lastContactAt).not.toBeNull();
    const e = await s.enrollment(a.id);
    expect(e).toMatchObject({ currentStep: 2, touches: 1, status: "activa" });
    expect(e.nextRunAt!.toISOString()).toBe(s.seqMod.computeNextRunAt(e.enrolledAt, 3, NOW).toISOString());
    expect(e.nextRunAt!.toISOString()).toBe(new Date("2026-11-13T10:00:00-06:00").toISOString());
    const acts = await s.activities(a.id);
    expect(acts.some((x) => x.type === "correo" && x.direction === "saliente" && x.meta?.sequenceId === seq.id)).toBe(true);
  });

  it("paso de WhatsApp: no envía, deja pendiente y siguiente paso en el contacto; completar avanza", async () => {
    const s = await setup();
    const { seq, steps } = await s.mkSequence();
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    await s.db.update(s.schema.sequenceEnrollments).set({ currentStep: 2, touches: 1, nextRunAt: NOW }).where(eq(s.schema.sequenceEnrollments.contactId, a.id));
    const r = await s.run();
    expect(r).toMatchObject({ sent: 0, pendingWhatsapp: 1 });
    const e = await s.enrollment(a.id);
    expect(e).toMatchObject({ currentStep: 2, touches: 1, pendingStepId: steps[1].id, pendingText: `Hola Ana, soy ${s.ownerFirst}` });
    expect(e.pendingSince).not.toBeNull();
    const c = await s.contact(a.id);
    expect(c.nextAction).toBe("Toque 2 de 4 · WhatsApp");
    expect(c.nextActionOn).toBe("2026-11-10");
    expect(await s.seqMod.completePendingTouch(s.db, a.id, "whatsapp", NOW)).toBe(true);
    const e2 = await s.enrollment(a.id);
    expect(e2).toMatchObject({ currentStep: 3, touches: 2, pendingStepId: null, pendingText: null, pendingSince: null });
    expect(e2.nextRunAt!.toISOString()).toBe(s.seqMod.computeNextRunAt(e2.enrolledAt, 7, NOW).toISOString());
    // El siguiente paso que puso la secuencia se limpia al completarlo; si no, el lead se queda en "Hoy" para siempre.
    const c2 = await s.contact(a.id);
    expect(c2.nextAction).toBeNull();
    expect(c2.nextActionOn).toBeNull();
    expect(await s.seqMod.completePendingTouch(s.db, a.id, "whatsapp", NOW)).toBe(false);
  });

  it("una respuesta detiene la secuencia antes del siguiente paso", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence();
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    await s.run();
    await s.leadsMod.markReplied(s.db, a.id, s.actor);
    expect(await s.enrollment(a.id)).toMatchObject({ status: "detenida", stopReason: "respondio", nextRunAt: null });
    await s.db.update(s.schema.sequenceEnrollments).set({ nextRunAt: NOW }).where(eq(s.schema.sequenceEnrollments.contactId, a.id));
    const before = s.sent.length;
    const r = await s.run();
    expect(r.sent).toBe(0);
    expect(s.sent.length).toBe(before);
  });

  it("correo rebotado: se omite el paso y sigue el WhatsApp", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence();
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    await s.contactsMod.emailBounced(s.db, a.email!);
    const r = await s.run();
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    const e = await s.enrollment(a.id);
    expect(e).toMatchObject({ status: "activa", currentStep: 2, touches: 0 });
    expect(e.nextRunAt!.toISOString()).toBe(new Date("2026-11-13T10:00:00-06:00").toISOString());
    expect((await s.activities(a.id)).some((x) => x.type === "sistema" && /omitido/.test(x.summary))).toBe(true);
  });

  it("sin ningún canal termina sin_canal", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence([{ dayOffset: 0, channel: "email" }, { dayOffset: 0, channel: "whatsapp" }]);
    const a = await s.mkLead({ phone: false });
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    await s.contactsMod.emailBounced(s.db, a.email!);
    const r = await s.run();
    expect(r).toMatchObject({ sent: 0, skipped: 2, finished: 1 });
    expect(await s.enrollment(a.id)).toMatchObject({ status: "terminada", stopReason: "sin_canal", nextRunAt: null });
    expect((await s.contact(a.id)).nextAction).toBeNull();
  });

  it("fin sin respuesta deja 'Nutrir por newsletter'", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence([{ dayOffset: 0, channel: "email" }]);
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    const r = await s.run();
    expect(r).toMatchObject({ sent: 1, finished: 1 });
    expect(await s.enrollment(a.id)).toMatchObject({ status: "terminada", stopReason: "completada", touches: 1 });
    expect(await s.contact(a.id)).toMatchObject({ nextAction: "Nutrir por newsletter", nextActionOn: null, leadStatus: "contactado" });
  });

  it("tope de toques termina la secuencia", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence([{ dayOffset: 0, channel: "email" }, { dayOffset: 0, channel: "email" }], { maxTouches: 1 });
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    expect((await s.run()).sent).toBe(1);
    const r = await s.run();
    expect(r).toMatchObject({ sent: 0, finished: 1 });
    expect(await s.enrollment(a.id)).toMatchObject({ status: "terminada", stopReason: "tope" });
  });

  it("dos corridas seguidas no duplican el envío", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence();
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    const r1 = await s.run();
    const r2 = await s.run();
    expect(r1.sent + r2.sent).toBe(1);
    expect(s.sent.length).toBe(1);
  });

  it("un WhatsApp pendiente más de 7 días se omite y la secuencia sigue", async () => {
    const s = await setup();
    const { seq, steps } = await s.mkSequence();
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    await s.db.update(s.schema.sequenceEnrollments)
      .set({ currentStep: 2, touches: 1, nextRunAt: null, pendingStepId: steps[1].id, pendingText: "Hola", pendingSince: new Date(NOW.getTime() - 8 * DAY) })
      .where(eq(s.schema.sequenceEnrollments.contactId, a.id));
    const r = await s.run();
    expect(r.skipped).toBe(1);
    const e = await s.enrollment(a.id);
    expect(e).toMatchObject({ currentStep: 3, touches: 1, pendingStepId: null, pendingText: null, pendingSince: null, status: "activa" });
    expect(e.nextRunAt).not.toBeNull();
    expect((await s.activities(a.id)).some((x) => x.type === "sistema" && /7 días/.test(x.summary))).toBe(true);
  });

  it("fuera de horario no hace nada", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence();
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    const r = await s.run({ now: new Date("2026-11-10T21:00:00-06:00") });
    expect(r).toEqual({ sent: 0, pendingWhatsapp: 0, skipped: 0, finished: 0, stopped: 0 });
    expect(await s.enrollment(a.id)).toMatchObject({ currentStep: 1, touches: 0 });
  });

  it("baja de correo detiene la secuencia con motivo baja", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence();
    const a = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    await s.contactsMod.optOut(s.db, a.id);
    expect(await s.enrollment(a.id)).toMatchObject({ status: "detenida", stopReason: "baja" });
    expect((await s.contact(a.id)).leadStatus).toBe("perdido");
  });

  it("loadCadence devuelve el enrollment más reciente por contacto", async () => {
    const s = await setup();
    const { seq } = await s.mkSequence();
    const a = await s.mkLead();
    const b = await s.mkLead();
    await s.seqMod.enroll(s.db, [a.id], seq.id, s.actor, NOW);
    const m = await s.seqMod.loadCadence(s.db, [a.id, b.id]);
    expect(m.get(b.id)).toBeUndefined();
    expect(m.get(a.id)).toMatchObject({ sequenceName: seq.name, status: "activa", touches: 0, total: 4, nextChannel: "email", pendingText: null });
  });
});
